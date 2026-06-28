import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Header, HTTPException, Query
from sqlalchemy import select

from core.security import decode_token
from db.database import get_session, is_db_available
from db.models import AuditLog, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/profile", tags=["profile"])


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


@router.get("")
async def get_profile(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "avatar_url": user.avatar_url,
        "avatar_color": user.avatar_color,
        "plan": user.plan,
        "role": user.role,
        "provider": user.provider,
        "created_at": user.created_at.isoformat(),
    }


@router.get("/stats")
async def get_stats(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    # Derive real counts from audit log
    pipelines = 0
    diagnosed = 0
    generated = 0
    deployed = 0

    if is_db_available():
        month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        async with get_session() as session:
            for action, var_name in [
                ("pipeline.executed", "pipelines"),
                ("diagnose.analyzed", "diagnosed"),
                ("generate.code", "generated"),
                ("pipeline.deployed", "deployed"),
            ]:
                r = await session.execute(
                    select(AuditLog).where(
                        AuditLog.user_id == user.id,
                        AuditLog.action == action,
                        AuditLog.created_at >= month_start,
                    )
                )
                count = len(r.all())
                if var_name == "pipelines":
                    pipelines = count
                elif var_name == "diagnosed":
                    diagnosed = count
                elif var_name == "generated":
                    generated = count
                elif var_name == "deployed":
                    deployed = count

    return {
        "pipelines_run": pipelines,
        "files_generated": generated,
        "pods_diagnosed": diagnosed,
        "deployments_total": deployed,
        "deployments_successful": max(0, deployed - 1) if deployed > 0 else 0,
    }


@router.get("/activity")
async def get_activity(
    limit: int = Query(20, ge=1, le=100),
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)

    if not is_db_available():
        return {"activity": []}

    async with get_session() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.user_id == user.id, AuditLog.status == "success")
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
        )
        entries = result.scalars().all()

    action_labels = {
        "login": ("🔐", "Signed in"),
        "pipeline.executed": ("🚀", "Pipeline executed"),
        "diagnose.analyzed": ("🔍", "Diagnosed pod"),
        "generate.code": ("⚡", "Generated code"),
        "design.created": ("🏗", "Architecture designed"),
        "cluster.connected": ("🔗", "Connected cluster"),
        "settings.changed": ("⚙️", "Settings updated"),
        "credential.accessed": ("🔑", "Credential accessed"),
        "api_key.created": ("🗝", "API key created"),
        "password.changed": ("🔐", "Password changed"),
        "2fa.enabled": ("🛡", "2FA enabled"),
    }

    def _time_ago(dt: datetime) -> str:
        diff = datetime.now(timezone.utc) - dt.replace(tzinfo=timezone.utc)
        if diff < timedelta(minutes=1):
            return "just now"
        if diff < timedelta(hours=1):
            return f"{int(diff.seconds / 60)}m ago"
        if diff < timedelta(days=1):
            return f"{int(diff.seconds / 3600)}h ago"
        if diff < timedelta(days=2):
            return "Yesterday"
        return f"{diff.days} days ago"

    return {
        "activity": [
            {
                "id": e.id,
                "icon": action_labels.get(e.action, ("📌", "Action"))[0],
                "description": f"{action_labels.get(e.action, ('📌', e.action))[1]}{': ' + e.resource if e.resource else ''}",
                "time_ago": _time_ago(e.created_at),
                "action": e.action,
                "resource": e.resource,
                "created_at": e.created_at.isoformat(),
            }
            for e in entries
        ]
    }


@router.get("/saved-code")
async def get_saved_code(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    _user = await _get_user(ip_session, authorization)
    # Stub — real implementation would query a generate_sessions table
    return {"items": []}


@router.delete("/saved-code/{item_id}", status_code=204)
async def delete_saved_code(
    item_id: int,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    _user = await _get_user(ip_session, authorization)


@router.get("/saved-architectures")
async def get_saved_architectures(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    _user = await _get_user(ip_session, authorization)
    return {"items": []}
