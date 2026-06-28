"""Incident management — CRUD on incidents detected by the cluster monitor."""
import logging
from typing import Literal

from fastapi import APIRouter, Cookie, Header, HTTPException, Query
from pydantic import BaseModel

from core.security import decode_token
from db.database import is_db_available
from db.models import User
from sqlalchemy import select
from db.database import get_session
from workers import cluster_monitor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/incidents", tags=["incidents"])


async def _get_user_opt(ip_session: str, authorization: str) -> User | None:
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    if not token:
        return None
    payload = decode_token(token)
    if not payload:
        return None
    user_id = int(payload.get("sub", 0))
    if not is_db_available():
        return None
    async with get_session() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()


class SnoozeRequest(BaseModel):
    minutes: Literal[30, 60, 240] = 30


class ManualFixRequest(BaseModel):
    what_changed: str
    recent_deployment: str = ""
    verification: str = ""
    root_cause_confirmed: str = ""


class ChannelRequest(BaseModel):
    channel_type: Literal["slack", "teams", "incidentio", "pagerduty", "email", "gchat"]
    name: str
    config: dict
    alert_severities: list[str] = ["critical", "high"]


@router.get("")
async def list_incidents(
    status: str | None = Query(None),
    severity: str | None = Query(None),
    cluster: str | None = Query(None),
    namespace: str | None = Query(None),
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    incidents = cluster_monitor.get_incidents()

    if status:
        valid_statuses = status.split(",")
        incidents = [i for i in incidents if i.get("status") in valid_statuses]
    if severity:
        incidents = [i for i in incidents if i.get("severity") == severity]
    if cluster:
        incidents = [i for i in incidents if i.get("cluster_name") == cluster]
    if namespace:
        incidents = [i for i in incidents if i.get("namespace") == namespace]

    # Summary counts
    active = [i for i in incidents if i.get("status") == "active"]
    acknowledged = [i for i in incidents if i.get("status") == "acknowledged"]
    snoozed = [i for i in incidents if i.get("snoozed_until") and i.get("status") == "active"]
    resolved_today = [i for i in incidents if i.get("status") in ("resolved", "auto_resolved")]

    return {
        "incidents": incidents,
        "summary": {
            "active": len(active),
            "acknowledged": len(acknowledged),
            "snoozed": len(snoozed),
            "resolved_today": len(resolved_today),
        },
    }


@router.get("/{incident_id}")
async def get_incident(incident_id: str):
    inc = cluster_monitor.get_incident(incident_id)
    if not inc:
        raise HTTPException(404, "Incident not found")
    return inc


@router.post("/{incident_id}/acknowledge")
async def acknowledge(
    incident_id: str,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user_opt(ip_session, authorization)
    by = user.email if user else "user"
    ok = cluster_monitor.acknowledge_incident(incident_id, by)
    if not ok:
        raise HTTPException(404, "Incident not found")
    return {"status": "acknowledged"}


@router.post("/{incident_id}/snooze")
async def snooze(incident_id: str, body: SnoozeRequest):
    ok = cluster_monitor.snooze_incident(incident_id, body.minutes)
    if not ok:
        raise HTTPException(404, "Incident not found")
    return {"status": "snoozed", "minutes": body.minutes}


@router.post("/{incident_id}/fix-auto")
async def fix_auto(incident_id: str):
    inc = cluster_monitor.get_incident(incident_id)
    if not inc:
        raise HTTPException(404, "Incident not found")
    inc["status"] = "fixing"
    logger.info("AI fix requested for incident %s", incident_id)
    return {"status": "fixing", "message": "AI fix started — check back in a moment"}


@router.post("/{incident_id}/fix-manual")
async def fix_manual(incident_id: str, body: ManualFixRequest):
    ok = cluster_monitor.resolve_incident(
        incident_id,
        resolution=f"{body.what_changed}. Verified: {body.verification}",
    )
    if not ok:
        raise HTTPException(404, "Incident not found")
    return {"status": "resolved", "message": "Incident marked as resolved"}


# ─── Alert channels ───────────────────────────────────────────────────────────

@router.get("/channels/list")
async def list_channels(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user_opt(ip_session, authorization)
    user_id = str(user.id) if user else "anon"
    return {"channels": cluster_monitor.get_alert_channels(user_id)}


@router.post("/channels/add", status_code=201)
async def add_channel(
    body: ChannelRequest,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user_opt(ip_session, authorization)
    user_id = str(user.id) if user else "anon"
    channel_id = cluster_monitor.add_alert_channel(user_id, {
        "channel_type": body.channel_type,
        "name": body.name,
        "config": body.config,
        "alert_severities": body.alert_severities,
        "is_active": True,
    })
    return {"id": channel_id, "status": "added"}


@router.delete("/channels/{channel_id}", status_code=204)
async def delete_channel(
    channel_id: str,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user_opt(ip_session, authorization)
    user_id = str(user.id) if user else "anon"
    ok = cluster_monitor.delete_alert_channel(user_id, channel_id)
    if not ok:
        raise HTTPException(404, "Channel not found")
