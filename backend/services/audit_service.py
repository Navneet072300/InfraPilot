"""Immutable audit log — call from any route that performs a sensitive action."""
import logging

from db.database import get_session, is_db_available
from db.models import AuditLog

logger = logging.getLogger(__name__)


async def log(
    user_id: int | None,
    user_email: str,
    action: str,
    resource: str = "",
    ip_address: str = "",
    status: str = "success",
    details: str | None = None,
) -> None:
    if not is_db_available():
        logger.info("AUDIT [%s] user=%s action=%s resource=%s status=%s", ip_address, user_email, action, resource, status)
        return
    try:
        async with get_session() as session:
            entry = AuditLog(
                user_id=user_id,
                user_email=user_email,
                action=action,
                resource=resource,
                ip_address=ip_address,
                status=status,
                details=details,
            )
            session.add(entry)
            await session.commit()
    except Exception as e:
        logger.error("Failed to write audit log: %s", e)
