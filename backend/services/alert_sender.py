"""
Multi-channel alert dispatcher.
Called by cluster_monitor when an incident fires or resolves.
Never raises — per-channel errors are caught and logged.
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import httpx
from sqlalchemy import text

from db.database import get_session, is_db_available
from services.encryption_service import decrypt_dict

logger = logging.getLogger(__name__)

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

SEV_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵"}


# ─── Public API ───────────────────────────────────────────────────────────────

async def send_incident(user_id: str | int, incident: dict, diagnosis: dict) -> None:
    """Send firing alert to all matching channels (non-blocking)."""
    channels = await _get_channels(user_id, incident.get("severity", "high"))
    await asyncio.gather(
        *[_send_to_channel(ch, incident, diagnosis, "firing") for ch in channels],
        return_exceptions=True,
    )


async def send_resolution(user_id: str | int, incident: dict,
                          duration_minutes: int = 0, fix_method: str = "auto_resolved") -> None:
    """Send resolved notification to all matching channels."""
    channels = await _get_channels(user_id, incident.get("severity", "high"))
    await asyncio.gather(
        *[_send_to_channel(ch, incident, {}, "resolved",
                           duration_minutes=duration_minutes, fix_method=fix_method)
          for ch in channels],
        return_exceptions=True,
    )


# ─── Channel dispatch ─────────────────────────────────────────────────────────

async def _send_to_channel(channel: dict, incident: dict, diagnosis: dict,
                           event_type: str, **kwargs) -> None:
    ch_type = channel.get("channel_type", "")
    try:
        cfg = decrypt_dict(channel["config_encrypted"])
        if ch_type == "slack":
            await _send_slack(cfg, incident, diagnosis, event_type, **kwargs)
        elif ch_type == "teams":
            await _send_teams(cfg, incident, diagnosis, event_type, **kwargs)
        elif ch_type == "email":
            await _send_email(cfg, incident, diagnosis, event_type, **kwargs)
        elif ch_type == "discord":
            await _send_discord(cfg, incident, diagnosis, event_type, **kwargs)
        elif ch_type == "gchat":
            await _send_gchat(cfg, incident, diagnosis, event_type, **kwargs)
        elif ch_type == "webhook":
            await _send_webhook(cfg, incident, diagnosis, event_type, **kwargs)
        await _log_history(channel, incident, "sent")
    except Exception as exc:
        logger.warning("Alert send failed [%s / %s]: %s", ch_type, channel.get("id"), exc)
        await _log_history(channel, incident, "failed", str(exc))


# ─── Slack ────────────────────────────────────────────────────────────────────

async def _send_slack(cfg: dict, incident: dict, diagnosis: dict,
                      event_type: str, **kwargs) -> None:
    url = cfg["webhook_url"]
    sev = incident.get("severity", "high")
    emoji = SEV_EMOJI.get(sev, "⚪")

    if event_type == "firing":
        top_cause = (diagnosis.get("causes") or [{}])[0]
        blocks: list[dict] = [
            {"type": "header", "text": {"type": "plain_text",
                "text": f"{emoji} {sev.upper()} — {incident['title']}"}},
            {"type": "section", "fields": [
                {"type": "mrkdwn", "text": f"*Cluster*\n{incident.get('cluster_name','—')}"},
                {"type": "mrkdwn", "text": f"*Namespace*\n{incident.get('namespace') or '—'}"},
                {"type": "mrkdwn", "text": f"*Resource*\n{incident.get('resource_name','—')}"},
                {"type": "mrkdwn", "text": f"*Issue*\n{incident.get('issue_type','—')}"},
            ]},
        ]
        what = diagnosis.get("what_is_happening")
        if what:
            blocks.append({"type": "section", "text": {"type": "mrkdwn",
                "text": f"*What happened*\n{what}"}})
        if top_cause:
            pct = top_cause.get("confidence_percent", 0)
            blocks.append({"type": "section", "text": {"type": "mrkdwn",
                "text": f"*Most likely cause ({pct}%)*\n{top_cause.get('title','—')}\n_{top_cause.get('why','')}_"}})
        if diagnosis.get("fix_steps"):
            cmd = diagnosis["fix_steps"][0].get("command", "")
            blocks.append({"type": "section", "text": {"type": "mrkdwn",
                "text": f"*Fastest fix*\n```{cmd}```"}})
        blocks.append({"type": "actions", "elements": [
            {"type": "button", "style": "primary",
             "text": {"type": "plain_text", "text": "View in InfraPilot →"},
             "url": f"{FRONTEND_URL}/app/monitor"},
        ]})
        payload = {"blocks": blocks}
    else:
        dur = kwargs.get("duration_minutes", 0)
        fix = "Fixed by InfraPilot AI" if kwargs.get("fix_method") == "ai_auto" else "Fixed manually"
        payload = {"text": f"✅ *Resolved* — {incident['title']}\nDuration: {dur} min · {fix}"}

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(url, json=payload)
        r.raise_for_status()


# ─── Teams ────────────────────────────────────────────────────────────────────

async def _send_teams(cfg: dict, incident: dict, diagnosis: dict,
                      event_type: str, **kwargs) -> None:
    url = cfg["webhook_url"]
    sev = incident.get("severity", "high")
    ac_color = "Attention" if sev in ("critical", "high") else "Warning"

    if event_type == "firing":
        top_cause = (diagnosis.get("causes") or [{}])[0]
        facts = [
            {"name": "Cluster",   "value": incident.get("cluster_name", "—")},
            {"name": "Namespace", "value": incident.get("namespace") or "—"},
            {"name": "Resource",  "value": incident.get("resource_name", "—")},
            {"name": "Issue",     "value": incident.get("issue_type", "—")},
        ]
        if top_cause:
            pct = top_cause.get("confidence_percent", 0)
            facts.append({"name": f"Most likely cause ({pct}%)", "value": top_cause.get("title", "—")})
        body_items: list[dict] = [
            {"type": "TextBlock", "size": "Medium", "weight": "Bolder",
             "color": ac_color,
             "text": f"🔴 {sev.upper()} — {incident['title']}"},
            {"type": "FactSet", "facts": facts},
        ]
        what = diagnosis.get("what_is_happening")
        if what:
            body_items.append({"type": "TextBlock", "wrap": True, "text": what})
        card = {
            "type": "message",
            "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive",
                "content": {"$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard", "version": "1.4",
                    "body": body_items,
                    "actions": [{"type": "Action.OpenUrl", "title": "View in InfraPilot",
                        "url": f"{FRONTEND_URL}/app/monitor"}]}}]
        }
    else:
        dur = kwargs.get("duration_minutes", 0)
        card = {
            "type": "message",
            "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive",
                "content": {"$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard", "version": "1.4",
                    "body": [{"type": "TextBlock", "wrap": True, "color": "Good",
                        "text": f"✅ Resolved — {incident['title']}\nDuration: {dur} min"}]}}]
        }

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(url, json=card)
        r.raise_for_status()


# ─── Email ────────────────────────────────────────────────────────────────────

async def _send_email(cfg: dict, incident: dict, diagnosis: dict,
                      event_type: str, **kwargs) -> None:
    address = cfg["address"]
    sev = incident.get("severity", "high")
    sev_color = {"critical": "#ef4444", "high": "#f59e0b",
                 "medium": "#3b82f6", "low": "#22c55e"}.get(sev, "#6b7280")

    if event_type == "firing":
        subject = f"[{sev.upper()}] {incident['title']} — {incident.get('cluster_name','')}"
        top_cause = (diagnosis.get("causes") or [{}])[0]
        fix_cmd = (diagnosis.get("fix_steps") or [{}])[0].get("command", "")
        cause_html = ""
        if top_cause:
            pct = top_cause.get("confidence_percent", 0)
            cause_html = f"""<p><strong>Most likely cause ({pct}%)</strong><br>
            {top_cause.get("title","")}<br><em>{top_cause.get("why","")}</em></p>"""
        fix_html = f"""<p><strong>Fastest fix</strong></p>
        <pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:13px;">{fix_cmd}</pre>""" if fix_cmd else ""
        html = f"""<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <div style="background:{sev_color};color:white;padding:12px 20px;border-radius:8px 8px 0 0;">
    <strong>{sev.upper()} — {incident['title']}</strong>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 8px 8px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr><td style="color:#6b7280;padding:4px 0;width:120px;">Cluster</td><td><strong>{incident.get('cluster_name','—')}</strong></td></tr>
      <tr><td style="color:#6b7280;padding:4px 0;">Namespace</td><td><strong>{incident.get('namespace') or '—'}</strong></td></tr>
      <tr><td style="color:#6b7280;padding:4px 0;">Resource</td><td><strong>{incident.get('resource_name','—')}</strong></td></tr>
      <tr><td style="color:#6b7280;padding:4px 0;">Issue</td><td><strong>{incident.get('issue_type','—')}</strong></td></tr>
    </table>
    {f'<p>{diagnosis.get("what_is_happening","")}</p>' if diagnosis.get("what_is_happening") else ""}
    {cause_html}
    {fix_html}
    <a href="{FRONTEND_URL}/app/monitor" style="display:inline-block;background:#6366f1;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500;">View in InfraPilot →</a>
  </div>
  <p style="color:#9ca3af;font-size:12px;margin-top:16px;text-align:center;">InfraPilot · <a href="{FRONTEND_URL}/app/settings" style="color:#6366f1;">Manage alerts</a></p>
</div>"""
    else:
        dur = kwargs.get("duration_minutes", 0)
        fix_label = "Fixed automatically by InfraPilot AI" if kwargs.get("fix_method") == "ai_auto" else "Fixed manually"
        subject = f"[RESOLVED] {incident['title']} — {incident.get('cluster_name','')}"
        html = f"""<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <div style="background:#22c55e;color:white;padding:12px 20px;border-radius:8px;">
    <strong>✅ Resolved — {incident['title']}</strong>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;">
    <p>Duration: {dur} minutes · {fix_label}</p>
  </div>
</div>"""

    resend_key = os.getenv("RESEND_API_KEY", "")
    if not resend_key:
        logger.warning("RESEND_API_KEY not set — email alert skipped")
        return
    import resend
    resend.api_key = resend_key
    resend.Emails.send({
        "from": "InfraPilot Alerts <alerts@infrapilot.dev>",
        "to": address,
        "subject": subject,
        "html": html,
    })


# ─── Discord ──────────────────────────────────────────────────────────────────

async def _send_discord(cfg: dict, incident: dict, diagnosis: dict,
                        event_type: str, **kwargs) -> None:
    url = cfg["webhook_url"]
    sev = incident.get("severity", "high")
    color = {"critical": 15548997, "high": 16744272, "medium": 16776960, "low": 3066993}.get(sev, 0)

    if event_type == "firing":
        top_cause = (diagnosis.get("causes") or [{}])[0]
        desc = diagnosis.get("what_is_happening", "")
        if top_cause:
            desc += f"\n\n**Most likely cause ({top_cause.get('confidence_percent',0)}%)**\n{top_cause.get('title','')}"
        payload = {"embeds": [{"title": f"{sev.upper()} — {incident['title']}", "description": desc,
            "color": color,
            "fields": [
                {"name": "Cluster",   "value": incident.get("cluster_name", "—"), "inline": True},
                {"name": "Namespace", "value": incident.get("namespace") or "—", "inline": True},
                {"name": "Resource",  "value": incident.get("resource_name", "—"), "inline": True},
            ],
            "url": f"{FRONTEND_URL}/app/monitor",
            "footer": {"text": "InfraPilot"},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }]}
    else:
        dur = kwargs.get("duration_minutes", 0)
        payload = {"embeds": [{"title": f"✅ Resolved — {incident['title']}",
            "description": f"Duration: {dur} minutes",
            "color": 3066993, "footer": {"text": "InfraPilot"},
            "timestamp": datetime.now(timezone.utc).isoformat()}]}

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(url, json=payload)
        r.raise_for_status()


# ─── Google Chat ──────────────────────────────────────────────────────────────

async def _send_gchat(cfg: dict, incident: dict, diagnosis: dict,
                      event_type: str, **kwargs) -> None:
    url = cfg["webhook_url"]
    sev = incident.get("severity", "high")
    emoji = SEV_EMOJI.get(sev, "⚪")

    if event_type == "firing":
        top_cause = (diagnosis.get("causes") or [{}])[0]
        lines = [
            f"{emoji} *{sev.upper()}* — *{incident['title']}*",
            f"Cluster: {incident.get('cluster_name','—')}",
            f"Namespace: {incident.get('namespace') or '—'}",
            f"Resource: {incident.get('resource_name','—')}",
            f"Issue: {incident.get('issue_type','—')}",
        ]
        if diagnosis.get("what_is_happening"):
            lines.append(f"\n{diagnosis['what_is_happening']}")
        if top_cause:
            pct = top_cause.get("confidence_percent", 0)
            lines.append(f"\n*Most likely cause ({pct}%)*\n{top_cause.get('title','')}")
        lines.append(f"\n<{FRONTEND_URL}/app/monitor|View in InfraPilot →>")
        text = "\n".join(lines)
    else:
        dur = kwargs.get("duration_minutes", 0)
        text = f"✅ *Resolved* — {incident['title']}\nDuration: {dur} minutes"

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(url, json={"text": text})
        r.raise_for_status()


# ─── Custom webhook ───────────────────────────────────────────────────────────

async def _send_webhook(cfg: dict, incident: dict, diagnosis: dict,
                        event_type: str, **kwargs) -> None:
    import hashlib
    import hmac

    url = cfg["url"]
    secret = cfg.get("secret")

    payload = {
        "event": event_type,
        "source": "infrapilot",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "incident": {
            "id": str(incident.get("id", "")),
            "title": incident.get("title", ""),
            "severity": incident.get("severity", ""),
            "cluster": incident.get("cluster_name", ""),
            "namespace": incident.get("namespace"),
            "resource": incident.get("resource_name", ""),
            "issue_type": incident.get("issue_type", ""),
            "status": incident.get("status", "active"),
        },
        "diagnosis": {
            "summary": diagnosis.get("what_is_happening", ""),
            "top_cause": (diagnosis.get("causes") or [None])[0],
        } if event_type == "firing" else None,
    }

    headers = {"Content-Type": "application/json", "User-Agent": "InfraPilot-Alerts/1.0"}
    if secret:
        body_bytes = json.dumps(payload).encode()
        sig = hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
        headers["X-InfraPilot-Signature"] = f"sha256={sig}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(url, json=payload, headers=headers)
        r.raise_for_status()


# ─── DB helpers ───────────────────────────────────────────────────────────────

async def _get_channels(user_id: str | int, severity: str) -> list[dict]:
    if not is_db_available():
        return []
    try:
        async with get_session() as session:
            if str(user_id) == "system":
                # No user context — send to all users' active channels matching severity
                result = await session.execute(
                    text("SELECT * FROM alert_channels WHERE is_active = true")
                )
            else:
                result = await session.execute(
                    text("SELECT * FROM alert_channels WHERE user_id = :uid AND is_active = true"),
                    {"uid": int(user_id)},
                )
            rows = result.mappings().all()

        channels = []
        for row in rows:
            r = dict(row)
            alert_on = json.loads(r.get("alert_on") or '["critical","high"]')
            if severity in alert_on:
                channels.append(r)
        return channels
    except Exception as exc:
        logger.warning("Failed to fetch alert channels: %s", exc)
        return []


async def _log_history(channel: dict, incident: dict, status: str, error: str | None = None) -> None:
    if not is_db_available():
        return
    try:
        async with get_session() as session:
            await session.execute(
                text(
                    """INSERT INTO alert_history
                       (incident_id, channel_id, channel_type, status, error_text)
                       VALUES (:iid, :cid, :ct, :st, :err)"""
                ),
                {
                    "iid": str(incident.get("id", "")),
                    "cid": channel.get("id"),
                    "ct": channel.get("channel_type", ""),
                    "st": status,
                    "err": error,
                },
            )
            await session.commit()
    except Exception as exc:
        logger.debug("Failed to log alert history: %s", exc)
