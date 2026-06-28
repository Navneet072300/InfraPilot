import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Header, HTTPException, Query
from sqlalchemy import select

from core.security import decode_token
from db.database import get_session, is_db_available
from db.models import AuditLog, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/audit-log", tags=["audit"])


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
async def get_audit_log(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    action_type: str = Query("", alias="action_type"),
    date_from: str = Query("", alias="date_from"),
    date_to: str = Query("", alias="date_to"),
    search: str = Query(""),
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)

    if not is_db_available():
        return {"entries": [], "total": 0, "page": page, "limit": limit}

    async with get_session() as session:
        query = select(AuditLog).where(AuditLog.user_id == user.id)

        if action_type:
            query = query.where(AuditLog.action == action_type)
        if date_from:
            try:
                df = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
                query = query.where(AuditLog.created_at >= df)
            except ValueError:
                pass
        if date_to:
            try:
                dt = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc)
                query = query.where(AuditLog.created_at <= dt)
            except ValueError:
                pass
        if search:
            query = query.where(
                AuditLog.action.ilike(f"%{search}%") |
                AuditLog.resource.ilike(f"%{search}%") |
                AuditLog.details.ilike(f"%{search}%")
            )

        total_q = query
        total_result = await session.execute(total_q)
        total = len(total_result.all())

        query = query.order_by(AuditLog.created_at.desc()).offset((page - 1) * limit).limit(limit)
        result = await session.execute(query)
        entries = result.scalars().all()

    return {
        "entries": [
            {
                "id": e.id,
                "user_email": e.user_email,
                "action": e.action,
                "resource": e.resource,
                "ip_address": e.ip_address,
                "status": e.status,
                "details": e.details,
                "created_at": e.created_at.isoformat(),
            }
            for e in entries
        ],
        "total": total,
        "page": page,
        "limit": limit,
    }
