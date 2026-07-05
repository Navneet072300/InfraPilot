"""
Always-on cluster monitor worker.
Polls all active clusters every 60s, detects issues, fires alerts.
Started as a background asyncio task on app startup.
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from uuid import uuid4

import httpx

from config import unified_store
from services.k8s_service import KubernetesService

logger = logging.getLogger(__name__)

POLL_INTERVAL = int(os.getenv("MONITOR_POLL_INTERVAL", "60"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# In-memory incident store (keyed by user_id:cluster:resource_type:resource_name)
_active_incidents: dict[str, dict] = {}
# In-memory alert channel store (loaded from DB or env on startup)
_user_channels: dict[str, list[dict]] = {}  # user_id → list of channel configs

ISSUE_MAP = {
    "CrashLoopBackOff": {"severity": "critical", "title": "Pod keeps crashing"},
    "ImagePullBackOff": {"severity": "high", "title": "Cannot pull container image"},
    "ErrImagePull": {"severity": "high", "title": "Image pull error"},
    "OOMKilled": {"severity": "high", "title": "Pod killed — out of memory"},
    "CreateContainerConfigError": {"severity": "high", "title": "Missing secret or configmap"},
    "Pending": {"severity": "medium", "title": "Pod stuck in pending"},
    "Evicted": {"severity": "medium", "title": "Pod evicted"},
}

SEV_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵"}


# ─── Public API for routes to call ───────────────────────────────────────────

def get_incidents(user_id: str | None = None) -> list[dict]:
    incidents = list(_active_incidents.values())
    if user_id:
        incidents = [i for i in incidents if i.get("user_id") == user_id]
    return sorted(incidents, key=lambda x: x.get("detected_at", ""), reverse=True)


def get_incident(incident_id: str) -> dict | None:
    for inc in _active_incidents.values():
        if inc.get("id") == incident_id:
            return inc
    return None


def acknowledge_incident(incident_id: str, by: str = "") -> bool:
    for inc in _active_incidents.values():
        if inc.get("id") == incident_id:
            inc["status"] = "acknowledged"
            inc["acknowledged_at"] = datetime.now(timezone.utc).isoformat()
            inc["acknowledged_by"] = by
            return True
    return False


def snooze_incident(incident_id: str, minutes: int) -> bool:
    for inc in _active_incidents.values():
        if inc.get("id") == incident_id:
            from datetime import timedelta
            inc["snoozed_until"] = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
            return True
    return False


def resolve_incident(incident_id: str, resolution: str = "") -> bool:
    for key, inc in list(_active_incidents.items()):
        if inc.get("id") == incident_id:
            inc["status"] = "resolved"
            inc["resolved_at"] = datetime.now(timezone.utc).isoformat()
            inc["resolution_description"] = resolution
            # Move to resolved (keep for history)
            return True
    return False


def add_alert_channel(user_id: str, channel: dict) -> str:
    channel_id = str(uuid4())
    channel["id"] = channel_id
    if user_id not in _user_channels:
        _user_channels[user_id] = []
    _user_channels[user_id].append(channel)
    return channel_id


def get_alert_channels(user_id: str) -> list[dict]:
    return _user_channels.get(user_id, [])


def delete_alert_channel(user_id: str, channel_id: str) -> bool:
    channels = _user_channels.get(user_id, [])
    before = len(channels)
    _user_channels[user_id] = [c for c in channels if c.get("id") != channel_id]
    return len(_user_channels[user_id]) < before


# ─── Worker loop ─────────────────────────────────────────────────────────────

_cleanup_counter = 0


async def run():
    global _cleanup_counter
    logger.info("Cluster monitor worker started (interval=%ds)", POLL_INTERVAL)
    while True:
        try:
            await poll_all_clusters()
        except Exception as e:
            logger.error("Monitor poll error: %s", e)
        _cleanup_counter += 1
        if _cleanup_counter % 60 == 0:  # hourly cleanup of old metric rows
            try:
                from services.anomaly_detector import cleanup_old_metrics
                await cleanup_old_metrics()
            except Exception:
                pass
        await asyncio.sleep(POLL_INTERVAL)


async def poll_all_clusters():
    try:
        clusters = await unified_store.list_clusters(masked=False)
    except Exception as e:
        logger.info("Monitor: could not list clusters: %s", e)
        return

    active = [c for c in clusters if c.get("active")]
    if not active:
        return

    await asyncio.gather(*[
        _safe_poll_cluster(cluster)
        for cluster in active
    ], return_exceptions=True)


async def _safe_poll_cluster(cluster: dict):
    try:
        await poll_cluster(cluster)
    except Exception as e:
        logger.info("Monitor: cluster %s poll failed: %s", cluster.get("name"), e)


async def poll_cluster(cluster: dict):
    svc = KubernetesService(cluster)

    # Get all namespaces first, then fetch pods across all of them
    try:
        namespaces = await svc.get_namespaces()
    except Exception:
        namespaces = ["default"]

    logger.info("Monitor: polling cluster %s — %d namespaces", cluster.get("name"), len(namespaces))

    # Fetch pods from all namespaces + nodes in parallel
    pod_tasks = [_safe_get_pods(svc, ns) for ns in namespaces]
    results = await asyncio.gather(*pod_tasks, _safe_get_nodes(svc), return_exceptions=True)

    # Flatten pods from all namespaces
    pods: list[dict] = []
    for r in results[:-1]:
        if isinstance(r, list):
            pods.extend(r)

    nodes = results[-1] if isinstance(results[-1], list) else []

    logger.info("Monitor: cluster %s — %d pods, %d nodes", cluster.get("name"), len(pods), len(nodes))

    await check_pods(cluster, pods)
    await check_nodes(cluster, nodes)

    # Check recoveries (issues that are now gone)
    await check_recoveries(cluster, pods, nodes)


async def _safe_get_pods(svc: KubernetesService, namespace: str = "default") -> list[dict]:
    try:
        return await svc.get_pods(namespace) or []
    except Exception as e:
        logger.debug("Monitor: get_pods(%s) failed: %s", namespace, e)
        return []


async def _safe_get_nodes(svc: KubernetesService) -> list[dict]:
    try:
        return await svc.get_nodes() or []
    except Exception as e:
        logger.debug("Monitor: get_nodes failed: %s", e)
        return []


def _detect_pod_issue(pod: dict) -> dict | None:
    status = pod.get("status", "")
    for state, cfg in ISSUE_MAP.items():
        if state in status:
            return {
                **cfg,
                "issue_type": state,
                "resource_type": "pod",
                "resource_name": pod.get("name", ""),
                "namespace": pod.get("namespace", "default"),
                "restarts": pod.get("restarts", 0),
            }
    return None


_anomaly_last_fired: dict[str, str] = {}  # key → last_fired ISO timestamp


async def check_pods(cluster: dict, pods: list[dict]):
    from services.anomaly_detector import record_metric, check_anomaly
    cluster_name = cluster.get("name", "unknown")

    for pod in pods:
        issue = _detect_pod_issue(pod)
        if issue:
            await handle_new_issue(cluster, issue)

        # Record metrics for anomaly detection (cpu_percent, memory_mb, restarts)
        pod_name = pod.get("name", "")
        namespace = pod.get("namespace", "default")
        if not pod_name:
            continue

        for metric, raw_val in [
            ("restarts", pod.get("restarts", 0)),
            ("cpu_percent", pod.get("cpu", 0)),
            ("memory_mb", pod.get("memory", 0)),
        ]:
            val = float(raw_val or 0)
            await record_metric(cluster_name, pod_name, namespace, metric, val)

            # Only check anomaly for restarts and cpu (memory less reliable without calibration)
            if metric not in ("restarts", "cpu_percent"):
                continue

            anomaly = await check_anomaly(cluster_name, pod_name, namespace, metric, val)
            if not anomaly:
                continue

            # Deduplication: max 1 anomaly per resource+metric per 4 hours
            dedup_key = f"anomaly:{cluster_name}:{pod_name}:{metric}"
            last_fired = _anomaly_last_fired.get(dedup_key)
            if last_fired:
                from datetime import timedelta
                age = datetime.now(timezone.utc) - datetime.fromisoformat(last_fired)
                if age.total_seconds() < 4 * 3600:
                    continue

            _anomaly_last_fired[dedup_key] = datetime.now(timezone.utc).isoformat()

            # Create anomaly incident
            incident_key = f"anomaly:{cluster_name}:{namespace}:{pod_name}:{metric}"
            anomaly_title = f"Anomaly: {metric.replace('_', ' ')} spike on {pod_name}"
            await handle_new_issue(cluster, {
                "issue_type": f"Anomaly:{metric}",
                "severity": "medium",
                "title": anomaly_title,
                "resource_type": "pod",
                "resource_name": pod_name,
                "namespace": namespace,
                "anomaly": anomaly,
                "_anomaly": True,
            })


async def check_nodes(cluster: dict, nodes: list[dict]):
    for node in nodes:
        status = node.get("status", "Ready")
        name = node.get("name", "")
        if status == "NotReady":
            await handle_new_issue(cluster, {
                "issue_type": "NodeNotReady",
                "severity": "critical",
                "title": "Node not ready",
                "resource_type": "node",
                "resource_name": name,
                "namespace": None,
            })
        # Check pressure conditions returned by get_nodes
        for condition, label, sev in [
            ("memory_pressure", "Node memory pressure", "high"),
            ("disk_pressure", "Node disk pressure", "high"),
            ("pid_pressure", "Node PID pressure", "medium"),
        ]:
            if node.get(condition):
                await handle_new_issue(cluster, {
                    "issue_type": condition.replace("_", " ").title().replace(" ", ""),
                    "severity": sev,
                    "title": label,
                    "resource_type": "node",
                    "resource_name": name,
                    "namespace": None,
                })


async def check_recoveries(cluster: dict, pods: list[dict], nodes: list[dict]):
    healthy_pod_names = {p["name"] for p in pods if _detect_pod_issue(p) is None}
    healthy_node_names = {n["name"] for n in nodes if n.get("status") == "Ready"}

    cluster_name = cluster.get("name", "")
    for key, inc in list(_active_incidents.items()):
        if inc.get("cluster_name") != cluster_name:
            continue
        if inc.get("status") not in ("active", "acknowledged"):
            continue

        rtype = inc.get("resource_type")
        rname = inc.get("resource_name", "")

        recovered = (
            (rtype == "pod" and rname in healthy_pod_names) or
            (rtype == "node" and rname in healthy_node_names)
        )

        if recovered:
            inc["status"] = "auto_resolved"
            inc["resolved_at"] = datetime.now(timezone.utc).isoformat()
            logger.info("Monitor: auto-resolved incident %s (%s)", inc["id"], rname)
            await _send_recovery_alert(inc)


async def handle_new_issue(cluster: dict, issue: dict):
    cluster_name = cluster.get("name", "")
    key = f"{cluster_name}:{issue['resource_type']}:{issue['resource_name']}"

    # Already tracking?
    if key in _active_incidents:
        existing = _active_incidents[key]
        if existing.get("status") in ("active", "acknowledged", "fixing"):
            await _maybe_re_alert(existing)
            return
        # Same resource crashed again after auto-resolving (e.g. CrashLoopBackOff
        # oscillation). Re-activate instead of opening a duplicate incident.
        if existing.get("status") == "auto_resolved":
            existing["status"] = "active"
            existing["detected_at"] = datetime.now(timezone.utc).isoformat()
            existing["resolved_at"] = None
            existing["alert_count"] = 0
            existing["last_alerted_at"] = None
            logger.info("Monitor: re-activated incident %s (%s)", existing["id"], issue["resource_name"])
            await _send_incident_alert(existing, cluster)
            return

    # New incident
    incident_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()
    incident = {
        "id": incident_id,
        "user_id": "system",
        "cluster_name": cluster_name,
        "namespace": issue.get("namespace"),
        "resource_type": issue["resource_type"],
        "resource_name": issue["resource_name"],
        "issue_type": issue["issue_type"],
        "severity": issue["severity"],
        "title": issue["title"],
        "status": "active",
        "detected_at": now,
        "last_alerted_at": None,
        "alert_count": 0,
        "snoozed_until": None,
        "acknowledged_at": None,
        "resolved_at": None,
    }
    _active_incidents[key] = incident
    logger.info("Monitor: new incident %s — %s on %s", severity_tag(issue["severity"]), issue["title"], cluster_name)

    # Send initial alert
    await _send_incident_alert(incident, cluster)


def severity_tag(sev: str) -> str:
    return f"{SEV_EMOJI.get(sev, '⚪')} {sev.upper()}"


async def _maybe_re_alert(incident: dict):
    snoozed_until = incident.get("snoozed_until")
    if snoozed_until:
        now = datetime.now(timezone.utc)
        snooze_dt = datetime.fromisoformat(snoozed_until.replace("Z", "+00:00"))
        if now < snooze_dt:
            return

    last_alerted = incident.get("last_alerted_at")
    if not last_alerted:
        return

    now = datetime.now(timezone.utc)
    last_dt = datetime.fromisoformat(last_alerted.replace("Z", "+00:00"))
    detected_dt = datetime.fromisoformat(incident["detected_at"].replace("Z", "+00:00"))

    minutes_active = int((now - detected_dt).total_seconds() // 60)
    minutes_since = int((now - last_dt).total_seconds() // 60)

    if minutes_active < 15 and minutes_since >= 5:
        await _send_re_alert(incident, minutes_active, escalate=False)
    elif minutes_active >= 15 and minutes_since >= 15:
        await _send_re_alert(incident, minutes_active, escalate=True)


# ─── Alert sending ────────────────────────────────────────────────────────────

async def _send_incident_alert(incident: dict, cluster: dict):
    # Fire new-style DB-backed alert sender (non-blocking, never raises)
    try:
        from services import alert_sender
        asyncio.create_task(
            alert_sender.send_incident(
                incident.get("user_id", "system"),
                incident,
                incident.get("diagnosis") or {},
            )
        )
    except Exception:
        pass

    user_id = incident.get("user_id", "system")
    channels = _user_channels.get(user_id, [])

    sev = incident["severity"]
    emoji = SEV_EMOJI.get(sev, "⚪")

    for ch in channels:
        if sev not in ch.get("alert_severities", ["critical", "high"]):
            continue
        try:
            await _dispatch_channel(ch, incident, "new")
        except Exception as e:
            logger.error("Alert dispatch failed for channel %s: %s", ch.get("channel_type"), e)

    incident["last_alerted_at"] = datetime.now(timezone.utc).isoformat()
    incident["alert_count"] = incident.get("alert_count", 0) + 1


async def _send_re_alert(incident: dict, minutes_active: int, escalate: bool):
    user_id = incident.get("user_id", "system")
    channels = _user_channels.get(user_id, [])

    for ch in channels:
        try:
            await _dispatch_channel(ch, incident, "re_alert", minutes_active=minutes_active, escalate=escalate)
        except Exception as e:
            logger.error("Re-alert failed: %s", e)

    incident["last_alerted_at"] = datetime.now(timezone.utc).isoformat()
    incident["alert_count"] = incident.get("alert_count", 0) + 1


async def _send_recovery_alert(incident: dict):
    # Fire new-style DB-backed alert sender (non-blocking, never raises)
    try:
        from services import alert_sender
        resolved_at = incident.get("resolved_at") or ""
        detected_at = incident.get("detected_at") or resolved_at
        dur = 0
        if resolved_at and detected_at:
            from datetime import timedelta
            t1 = datetime.fromisoformat(detected_at.replace("Z", "+00:00"))
            t2 = datetime.fromisoformat(resolved_at.replace("Z", "+00:00"))
            dur = int((t2 - t1).total_seconds() // 60)
        asyncio.create_task(
            alert_sender.send_resolution(
                incident.get("user_id", "system"),
                incident,
                duration_minutes=dur,
                fix_method=incident.get("status", "auto_resolved"),
            )
        )
    except Exception:
        pass

    user_id = incident.get("user_id", "system")
    channels = _user_channels.get(user_id, [])
    for ch in channels:
        try:
            await _dispatch_channel(ch, incident, "resolved")
        except Exception as e:
            logger.error("Recovery alert failed: %s", e)


async def _dispatch_channel(channel: dict, incident: dict, alert_type: str, **kwargs):
    ch_type = channel.get("channel_type")
    cfg = channel.get("config", {})

    if ch_type == "slack":
        await _send_slack(cfg, incident, alert_type, **kwargs)
    elif ch_type == "teams":
        await _send_teams(cfg, incident, alert_type, **kwargs)
    elif ch_type == "email":
        await _send_email_alert(cfg, incident, alert_type, **kwargs)
    elif ch_type in ("incidentio", "pagerduty", "gchat"):
        logger.info("Alert channel %s: dispatch placeholder for %s", ch_type, incident["id"])


async def _send_slack(cfg: dict, incident: dict, alert_type: str, minutes_active: int = 0, escalate: bool = False, **_):
    webhook_url = cfg.get("webhook_url", "")
    if not webhook_url:
        return

    sev = incident["severity"]
    emoji = SEV_EMOJI.get(sev, "⚪")
    inc_url = f"{FRONTEND_URL}/app/monitor"

    if alert_type == "resolved":
        detected = incident.get("detected_at", "")
        resolved = incident.get("resolved_at", "")
        duration = ""
        if detected and resolved:
            try:
                d = datetime.fromisoformat(detected.replace("Z", "+00:00"))
                r = datetime.fromisoformat(resolved.replace("Z", "+00:00"))
                m = int((r - d).total_seconds() // 60)
                duration = f" · Duration: {m} min"
            except Exception:
                pass
        text = f"✅ *Resolved* — {incident['title']}\nCluster: {incident['cluster_name']}{duration}"
    elif alert_type == "re_alert":
        esc = f"\n⚠️ *ESCALATION* — still unacknowledged after {minutes_active} min" if escalate else ""
        text = f"🔄 *Still active* — {incident['title']}\nActive for {minutes_active} min{esc}\n<{inc_url}|View in InfraPilot>"
    else:
        blocks = [
            {"type": "header", "text": {"type": "plain_text", "text": f"{emoji} {sev.upper()} — {incident['title']}"}},
            {"type": "section", "fields": [
                {"type": "mrkdwn", "text": f"*Cluster:*\n{incident['cluster_name']}"},
                {"type": "mrkdwn", "text": f"*Namespace:*\n{incident.get('namespace') or 'N/A'}"},
                {"type": "mrkdwn", "text": f"*Resource:*\n{incident['resource_name']}"},
                {"type": "mrkdwn", "text": f"*Issue:*\n{incident['issue_type']}"},
            ]},
            {"type": "actions", "elements": [
                {"type": "button", "text": {"type": "plain_text", "text": "🔍 View in InfraPilot"},
                 "url": inc_url, "style": "primary"},
                {"type": "button", "text": {"type": "plain_text", "text": "💤 Snooze 30min"},
                 "action_id": "snooze", "value": incident["id"]},
            ]},
        ]
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(webhook_url, json={"blocks": blocks})
        return

    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(webhook_url, json={"text": text})


async def _send_teams(cfg: dict, incident: dict, alert_type: str, **_):
    webhook_url = cfg.get("webhook_url", "")
    if not webhook_url:
        return

    sev = incident["severity"]
    inc_url = f"{FRONTEND_URL}/app/monitor"
    card = {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": [
                    {"type": "TextBlock", "text": f"{SEV_EMOJI.get(sev, '⚪')} {sev.upper()} — {incident['title']}", "weight": "Bolder", "size": "Medium"},
                    {"type": "FactSet", "facts": [
                        {"title": "Cluster", "value": incident["cluster_name"]},
                        {"title": "Resource", "value": incident["resource_name"]},
                        {"title": "Issue", "value": incident["issue_type"]},
                    ]},
                ],
                "actions": [{"type": "Action.OpenUrl", "title": "View in InfraPilot", "url": inc_url}],
            },
        }],
    }
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(webhook_url, json=card)


async def _send_email_alert(cfg: dict, incident: dict, alert_type: str, **_):
    resend_key = os.getenv("RESEND_API_KEY", "")
    to_email = cfg.get("email", "")
    if not resend_key or not to_email:
        return

    sev = incident["severity"]
    emoji = SEV_EMOJI.get(sev, "⚪")
    inc_url = f"{FRONTEND_URL}/app/monitor"

    subject = f"{emoji} {sev.upper()} — {incident['title']}"
    if alert_type == "resolved":
        subject = f"✅ Resolved — {incident['title']}"

    body = f"""
    <div style="font-family:sans-serif;max-width:520px">
      <h2 style="color:#1a1a2e">{subject}</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:6px;color:#666"><b>Cluster</b></td><td>{incident['cluster_name']}</td></tr>
        <tr><td style="padding:6px;color:#666"><b>Resource</b></td><td>{incident['resource_name']}</td></tr>
        <tr><td style="padding:6px;color:#666"><b>Namespace</b></td><td>{incident.get('namespace') or 'N/A'}</td></tr>
        <tr><td style="padding:6px;color:#666"><b>Issue</b></td><td>{incident['issue_type']}</td></tr>
      </table>
      <p style="margin-top:20px">
        <a href="{inc_url}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">
          View in InfraPilot →
        </a>
      </p>
    </div>
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {resend_key}"},
                json={"from": "InfraPilot <noreply@infrapilot.dev>", "to": to_email, "subject": subject, "html": body},
            )
    except Exception as e:
        logger.error("Email alert failed: %s", e)
