"""
Agent token management — generate install command, check status, revoke.
Auth: standard cookie/JWT session (same as settings).
"""
import logging
import os

from fastapi import APIRouter, Cookie, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from core.security import decode_token
from db.database import get_session, is_db_available
from db.models import User
from services import agent_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agent", tags=["agent-mgmt"])

ENDPOINT = os.getenv("INFRAPILOT_ENDPOINT", "https://api.infrapilot.dev")
HELM_REPO = "https://charts.infrapilot.dev"


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


def _helm_command(token: str, cluster_name: str) -> str:
    return (
        f"helm repo add infrapilot {HELM_REPO} && \\\n"
        f"helm install infrapilot-agent infrapilot/infrapilot-agent \\\n"
        f"  --namespace infrapilot-system \\\n"
        f"  --create-namespace \\\n"
        f"  --set infrapilot.token={token} \\\n"
        f"  --set infrapilot.endpoint={ENDPOINT} \\\n"
        f"  --set infrapilot.clusterName={cluster_name}"
    )


class TokenRequest(BaseModel):
    cluster_name: str


@router.post("/token")
async def create_or_get_token(
    body: TokenRequest,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    cluster_name = body.cluster_name.strip()
    if not cluster_name:
        raise HTTPException(400, "cluster_name required")

    existing = await agent_service.get_existing(user.id, cluster_name)

    if existing and existing["is_active"]:
        # Token exists — don't return full token again, just prefix + status
        status = await agent_service.get_agent_status(user.id, cluster_name)
        return {
            "token": None,  # not shown again
            "token_prefix": existing["token_prefix"],
            "cluster_name": cluster_name,
            "is_new": False,
            "helm_command": None,  # use reinstall endpoint instead
            "status": status,
        }

    # New token (or previous was revoked)
    full_token = await agent_service.generate_token(user.id, cluster_name)
    prefix = full_token[:12]

    return {
        "token": full_token,
        "token_prefix": prefix,
        "cluster_name": cluster_name,
        "is_new": True,
        "helm_command": _helm_command(full_token, cluster_name),
        "warning": "Save this token — it will not be shown again.",
    }


@router.post("/token/regenerate")
async def regenerate_token(
    body: TokenRequest,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    """Force-regenerate: revoke existing + issue new (for Reinstall flow)."""
    user = await _get_user(ip_session, authorization)
    cluster_name = body.cluster_name.strip()
    if not cluster_name:
        raise HTTPException(400, "cluster_name required")

    full_token = await agent_service.generate_token(user.id, cluster_name)
    prefix = full_token[:12]

    return {
        "token": full_token,
        "token_prefix": prefix,
        "cluster_name": cluster_name,
        "is_new": True,
        "helm_command": _helm_command(full_token, cluster_name),
        "warning": "Save this token — it will not be shown again.",
    }


@router.get("/status/{cluster_name}")
async def agent_status(
    cluster_name: str,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    return await agent_service.get_agent_status(user.id, cluster_name)


@router.delete("/token/{cluster_name}", status_code=200)
async def revoke_agent_token(
    cluster_name: str,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    revoked = await agent_service.revoke_token(user.id, cluster_name)
    return {"revoked": revoked, "cluster_name": cluster_name}
