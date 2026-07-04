"""
Alert channel CRUD + test endpoint.
Webhook URLs and email addresses are always stored encrypted.
"""
import json
import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Cookie, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text

from core.security import decode_token
from db.database import get_session, is_db_available
from db.models import User
from services.encryption_service import decrypt_dict, encrypt_dict
from services import alert_sender

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/alert-channels", tags=["alert-channels"])

VALID_TYPES = {"slack", "teams", "email", "discord", "gchat", "webhook"}
VALID_SEVERITIES = {"critical", "high", "medium", "low"}

# Fake incident for test alerts
_TEST_INCIDENT = {
    "id": "test-00000000",
    "title": "High memory usage on api-gateway",
    "severity": "high",
    "cluster_name": "production-east",
    "namespace": "default",
    "resource_name": "api-gateway-7d9f4b-xkp2q",
    "issue_type": "OOMKilled",
    "status": "active",
}
_TEST_DIAGNOSIS = {
    "what_is_happening": (
        "The pod api-gateway-7d9f4b-xkp2q was OOMKilled after consuming 2.1 GiB of memory "
        "against its 2 GiB limit. This is the third restart in 10 minutes."
    ),
    "causes": [
        {
            "title": "Memory limit too low for current traffic",
            "why": "Request rate increased 3× after 14:00 UTC; memory consumption scaled linearly.",
            "confidence_percent": 82,
        }
    ],
    "fix_steps": [
        {"command": "kubectl set resources deployment/api-gateway --limits=memory=4Gi -n default"},
    ],
}


# ─── Auth helper ──────────────────────────────────────────────────────────────

async def _get_user(ip_session: str, authorization: str) -> User:
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    user_id = int(payload.get("sub", 0))
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")
    async with get_session() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    return user


# ─── Schemas ──────────────────────────────────────────────────────────────────

class ChannelCreate(BaseModel):
    channel_type: str
    name: str
    config: dict[str, Any]       # plain — will be encrypted before storage
    alert_on: list[str] = ["critical", "high"]


class ChannelUpdate(BaseModel):
    name: str | None = None
    config: dict[str, Any] | None = None
    alert_on: list[str] | None = None
    is_active: bool | None = None


def _safe_config(config_encrypted: str) -> dict:
    """Return config with sensitive values masked for API responses."""
    try:
        cfg = decrypt_dict(config_encrypted)
    except Exception:
        return {}
    masked = {}
    for k, v in cfg.items():
        if isinstance(v, str) and any(s in k for s in ("url", "token", "key", "secret", "address")):
            masked[k] = v[:8] + "***" if len(v) > 8 else "***"
        else:
            masked[k] = v
    return masked


def _row_to_response(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "channel_type": row["channel_type"],
        "name": row["name"],
        "is_active": row["is_active"],
        "alert_on": json.loads(row.get("alert_on") or '["critical","high"]'),
        "config_preview": _safe_config(row["config_encrypted"]),
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
    }


# ─── GET /api/alert-channels ──────────────────────────────────────────────────

@router.get("")
async def list_channels(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        result = await session.execute(
            text("SELECT * FROM alert_channels WHERE user_id = :uid ORDER BY created_at"),
            {"uid": user.id},
        )
        rows = result.mappings().all()
    return [_row_to_response(dict(r)) for r in rows]


# ─── POST /api/alert-channels ─────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_channel(
    body: ChannelCreate,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)

    if body.channel_type not in VALID_TYPES:
        raise HTTPException(400, f"channel_type must be one of: {', '.join(VALID_TYPES)}")
    if not body.name.strip():
        raise HTTPException(400, "name required")
    invalid_sev = [s for s in body.alert_on if s not in VALID_SEVERITIES]
    if invalid_sev:
        raise HTTPException(400, f"Invalid severities: {invalid_sev}")
    if not body.config:
        raise HTTPException(400, "config required")

    encrypted = encrypt_dict(body.config)
    alert_on_json = json.dumps(body.alert_on)

    async with get_session() as session:
        result = await session.execute(
            text(
                """INSERT INTO alert_channels
                   (user_id, channel_type, name, config_encrypted, alert_on)
                   VALUES (:uid, :ct, :nm, :cfg, :ao)
                   RETURNING *"""
            ),
            {
                "uid": user.id,
                "ct": body.channel_type,
                "nm": body.name.strip(),
                "cfg": encrypted,
                "ao": alert_on_json,
            },
        )
        row = dict(result.mappings().first())
        await session.commit()

    return _row_to_response(row)


# ─── PUT /api/alert-channels/{id} ────────────────────────────────────────────

@router.put("/{channel_id}")
async def update_channel(
    channel_id: str,
    body: ChannelUpdate,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)

    async with get_session() as session:
        result = await session.execute(
            text("SELECT * FROM alert_channels WHERE id = :cid AND user_id = :uid"),
            {"cid": channel_id, "uid": user.id},
        )
        row = result.mappings().first()
        if not row:
            raise HTTPException(404, "Channel not found")

        updates: list[str] = []
        params: dict[str, Any] = {"cid": channel_id}

        if body.name is not None:
            updates.append("name = :nm")
            params["nm"] = body.name.strip()
        if body.config is not None:
            updates.append("config_encrypted = :cfg")
            params["cfg"] = encrypt_dict(body.config)
        if body.alert_on is not None:
            invalid_sev = [s for s in body.alert_on if s not in VALID_SEVERITIES]
            if invalid_sev:
                raise HTTPException(400, f"Invalid severities: {invalid_sev}")
            updates.append("alert_on = :ao")
            params["ao"] = json.dumps(body.alert_on)
        if body.is_active is not None:
            updates.append("is_active = :active")
            params["active"] = body.is_active

        if not updates:
            return _row_to_response(dict(row))

        set_clause = ", ".join(updates)
        result2 = await session.execute(
            text(f"UPDATE alert_channels SET {set_clause} WHERE id = :cid RETURNING *"),
            params,
        )
        updated = dict(result2.mappings().first())
        await session.commit()

    return _row_to_response(updated)


# ─── DELETE /api/alert-channels/{id} ─────────────────────────────────────────

@router.delete("/{channel_id}", status_code=200)
async def delete_channel(
    channel_id: str,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)

    async with get_session() as session:
        result = await session.execute(
            text("DELETE FROM alert_channels WHERE id = :cid AND user_id = :uid"),
            {"cid": channel_id, "uid": user.id},
        )
        await session.commit()

    if (result.rowcount or 0) == 0:
        raise HTTPException(404, "Channel not found")
    return {"deleted": True, "id": channel_id}


# ─── POST /api/alert-channels/{id}/test ──────────────────────────────────────

@router.post("/{channel_id}/test")
async def test_channel(
    channel_id: str,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    """Send a realistic fake incident alert to verify the channel works."""
    user = await _get_user(ip_session, authorization)

    async with get_session() as session:
        result = await session.execute(
            text("SELECT * FROM alert_channels WHERE id = :cid AND user_id = :uid"),
            {"cid": channel_id, "uid": user.id},
        )
        row = result.mappings().first()

    if not row:
        raise HTTPException(404, "Channel not found")

    channel = dict(row)
    if not channel["is_active"]:
        raise HTTPException(400, "Channel is disabled — enable it before testing")

    # Fire the test alert — any exception should bubble back to the UI
    try:
        from services.encryption_service import decrypt_dict
        from services import alert_sender as _sender

        cfg = decrypt_dict(channel["config_encrypted"])
        ch_type = channel["channel_type"]
        dispatch = {
            "slack":   _sender._send_slack,
            "teams":   _sender._send_teams,
            "email":   _sender._send_email,
            "discord": _sender._send_discord,
            "gchat":   _sender._send_gchat,
            "webhook": _sender._send_webhook,
        }
        fn = dispatch.get(ch_type)
        if fn is None:
            raise HTTPException(400, f"Unsupported channel type: {ch_type}")

        await fn(cfg, _TEST_INCIDENT, _TEST_DIAGNOSIS, "firing")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"Test send failed: {exc}") from exc

    return {"ok": True, "message": "Test alert sent — check your channel"}
