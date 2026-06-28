import logging

from fastapi import APIRouter, Cookie, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from core.security import decode_token
from db.database import get_session, is_db_available
from db.models import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/support", tags=["support"])


async def _get_user_optional(ip_session: str, authorization: str) -> User | None:
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload or not is_db_available():
        return None
    user_id = int(payload.get("sub", 0))
    async with get_session() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()


class BugReport(BaseModel):
    description: str
    severity: str = "medium"
    screenshot_url: str = ""


class FeatureRequest(BaseModel):
    title: str
    description: str
    use_case: str = ""


@router.post("/bug", status_code=201)
async def submit_bug(
    body: BugReport,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user_optional(ip_session, authorization)
    email = user.email if user else "anonymous"
    logger.info(
        "Bug report [%s] from %s: %s",
        body.severity.upper(),
        email,
        body.description[:120],
    )
    return {"message": "Thanks — we'll respond within 24 hours", "id": f"BUG-{id(body)}"}


@router.post("/feature", status_code=201)
async def submit_feature(
    body: FeatureRequest,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user_optional(ip_session, authorization)
    email = user.email if user else "anonymous"
    logger.info("Feature request from %s: %s", email, body.title)
    return {"message": "Added to our roadmap — we review all requests", "id": f"FR-{id(body)}"}
