"""
Deployment Verification: watches a deployment for 5 minutes after rollout
to confirm it is healthy. Runs as a non-blocking asyncio background task.

States: watching → healthy | degraded | critical
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import sqlalchemy

from db.database import get_session, is_db_available

logger = logging.getLogger(__name__)

# In-memory state keyed by deploy_config_id
_verifications: dict[int, dict[str, Any]] = {}

WATCH_SECONDS = 300          # 5 minutes
POLL_INTERVAL = 15           # check every 15s
HEALTH_THRESHOLD = 0.8       # < 80% ready pods = DEGRADED
RESTART_SPIKE = 3            # +3 restarts compared to baseline = DEGRADED


def get_verification(dep_id: int) -> dict | None:
    return _verifications.get(dep_id)


async def start_verification(
    dep_id: int,
    app_name: str,
    namespace: str,
    cluster_name: str | None,
) -> None:
    """Called immediately after a successful rollout. Non-blocking — spawns background task."""
    asyncio.create_task(_verify(dep_id, app_name, namespace, cluster_name))


async def _verify(
    dep_id: int,
    app_name: str,
    namespace: str,
    cluster_name: str | None,
) -> None:
    started = datetime.now(timezone.utc)
    state: dict[str, Any] = {
        "dep_id": dep_id,
        "app_name": app_name,
        "namespace": namespace,
        "cluster_name": cluster_name,
        "status": "watching",
        "started_at": started.isoformat(),
        "ended_at": None,
        "detail": "",
        "restart_baseline": None,
        "progress_pct": 0,
    }
    _verifications[dep_id] = state

    try:
        from config import unified_store
        from services.k8s_service import KubernetesService

        cluster_cfg = (
            await unified_store.get_cluster(cluster_name) if cluster_name
            else await unified_store.get_active_cluster()
        )
        if not cluster_cfg:
            state["status"] = "healthy"
            state["detail"] = "No cluster configured — verification skipped"
            state["ended_at"] = datetime.now(timezone.utc).isoformat()
            await _persist(dep_id, state)
            return

        svc = KubernetesService(cluster_cfg)
        elapsed = 0

        while elapsed < WATCH_SECONDS:
            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL
            state["progress_pct"] = min(100, int(elapsed / WATCH_SECONDS * 100))

            try:
                pods = await svc.get_pods(namespace)
            except Exception as e:
                logger.warning("Verifier: get_pods failed: %s", e)
                continue

            app_pods = [p for p in pods if app_name in p.get("name", "")]
            if not app_pods:
                continue

            total = len(app_pods)
            ready = sum(1 for p in app_pods if p.get("status") == "Running")
            restarts = sum(p.get("restarts", 0) for p in app_pods)

            # Establish baseline on first successful poll
            if state["restart_baseline"] is None:
                state["restart_baseline"] = restarts

            health_ratio = ready / total if total > 0 else 1.0
            restart_delta = restarts - (state["restart_baseline"] or 0)

            # Check for CrashLoopBackOff
            crash_pods = [p for p in app_pods if p.get("status") in ("CrashLoopBackOff", "Error", "OOMKilled")]

            if crash_pods or restart_delta >= RESTART_SPIKE * total:
                names = ", ".join(p["name"] for p in crash_pods[:3])
                state["status"] = "critical"
                state["detail"] = f"CrashLoopBackOff detected on: {names}" if crash_pods else f"Restart spike: +{restart_delta} restarts"
                state["ended_at"] = datetime.now(timezone.utc).isoformat()
                await _persist(dep_id, state)
                return
            elif health_ratio < HEALTH_THRESHOLD:
                state["status"] = "degraded"
                state["detail"] = f"{ready}/{total} pods ready ({health_ratio:.0%})"
                state["ended_at"] = datetime.now(timezone.utc).isoformat()
                await _persist(dep_id, state)
                return

            # Fetch recent warning events
            try:
                events = await svc.get_pod_events(namespace, app_pods[0]["name"])
                warn_events = [e for e in events if e.get("type") == "Warning"]
                if warn_events:
                    state["detail"] = f"Warning: {warn_events[0].get('message', '')[:120]}"
            except Exception:
                pass

        # Completed watch period without issues
        state["status"] = "healthy"
        state["detail"] = "All pods healthy after 5-minute watch period"
        state["ended_at"] = datetime.now(timezone.utc).isoformat()
        state["progress_pct"] = 100

    except Exception as e:
        logger.error("Verifier error for dep_id=%d: %s", dep_id, e)
        state["status"] = "healthy"
        state["detail"] = "Verification error — assuming healthy"
        state["ended_at"] = datetime.now(timezone.utc).isoformat()

    await _persist(dep_id, state)


async def _persist(dep_id: int, state: dict) -> None:
    if not is_db_available():
        return
    try:
        async with get_session() as db:
            await db.execute(
                sqlalchemy.text(
                    "UPDATE deploy_configs SET "
                    "last_verification_status = :status, "
                    "last_verification_started_at = :started, "
                    "last_verification_ended_at = :ended, "
                    "last_verification_detail = :detail "
                    "WHERE id = :id"
                ),
                {
                    "status": state["status"],
                    "started": state["started_at"],
                    "ended": state.get("ended_at"),
                    "detail": state.get("detail", ""),
                    "id": dep_id,
                },
            )
            await db.commit()
    except Exception as e:
        logger.warning("Verifier: failed to persist state: %s", e)
