"""Agent token management — generate, validate, revoke tokens for the InfraPilot Helm agent."""
import logging
import secrets
import string
from datetime import datetime, timezone

import sqlalchemy
from sqlalchemy import text

from db.database import get_session

logger = logging.getLogger(__name__)

_CHARS = string.ascii_letters + string.digits


def _gen_token() -> str:
    return "ip_agent_" + "".join(secrets.choice(_CHARS) for _ in range(32))


async def generate_token(user_id: int, cluster_name: str) -> str:
    """
    Create (or replace) an agent token for this cluster.
    Returns the full token — only time it's returned in plaintext.
    """
    token = _gen_token()
    prefix = token[:12]  # "ip_agent_ab1"

    async with get_session() as session:
        # Delete any existing token for this user+cluster (recreate)
        await session.execute(
            text("DELETE FROM agent_tokens WHERE user_id = :uid AND cluster_name = :cn"),
            {"uid": user_id, "cn": cluster_name},
        )
        await session.execute(
            text(
                """INSERT INTO agent_tokens
                   (user_id, cluster_name, token, token_prefix)
                   VALUES (:uid, :cn, :tok, :pfx)"""
            ),
            {"uid": user_id, "cn": cluster_name, "tok": token, "pfx": prefix},
        )
        await session.commit()

    logger.info("Agent token created: user=%s cluster=%s prefix=%s", user_id, cluster_name, prefix)
    return token


async def get_existing(user_id: int, cluster_name: str) -> dict | None:
    """Return token metadata (no full token) if one already exists."""
    async with get_session() as session:
        result = await session.execute(
            text(
                "SELECT token_prefix, is_active, last_seen_at, agent_version, created_at "
                "FROM agent_tokens WHERE user_id = :uid AND cluster_name = :cn"
            ),
            {"uid": user_id, "cn": cluster_name},
        )
        row = result.mappings().first()
    if not row:
        return None
    return dict(row)


async def validate_token(token: str) -> dict | None:
    """
    Verify bearer token. Updates last_seen_at on success.
    Returns {user_id, cluster_name} or None.
    """
    async with get_session() as session:
        result = await session.execute(
            text(
                "SELECT user_id, cluster_name FROM agent_tokens "
                "WHERE token = :tok AND is_active = true"
            ),
            {"tok": token},
        )
        row = result.mappings().first()
        if not row:
            return None

        await session.execute(
            text("UPDATE agent_tokens SET last_seen_at = NOW() WHERE token = :tok"),
            {"tok": token},
        )
        await session.commit()

    return {"user_id": row["user_id"], "cluster_name": row["cluster_name"]}


async def update_agent_version(token: str, version: str) -> None:
    async with get_session() as session:
        await session.execute(
            text("UPDATE agent_tokens SET agent_version = :v, last_seen_at = NOW() WHERE token = :tok"),
            {"v": version, "tok": token},
        )
        await session.commit()


async def get_agent_status(user_id: int, cluster_name: str) -> dict:
    """
    Returns agent installation + heartbeat status for the UI.
    installed = True only if last_seen_at is within the last 5 minutes.
    """
    async with get_session() as session:
        result = await session.execute(
            text(
                "SELECT token_prefix, is_active, last_seen_at, agent_version "
                "FROM agent_tokens WHERE user_id = :uid AND cluster_name = :cn"
            ),
            {"uid": user_id, "cn": cluster_name},
        )
        row = result.mappings().first()

    if not row:
        return {"has_token": False, "installed": False, "last_seen": None,
                "last_seen_minutes_ago": None, "agent_version": None, "token_prefix": ""}

    last_seen = row["last_seen_at"]
    minutes_ago = None
    installed = False

    if last_seen:
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        delta = (datetime.now(timezone.utc) - last_seen).total_seconds()
        minutes_ago = int(delta // 60)
        installed = delta < 300  # 5 minutes

    return {
        "has_token": True,
        "installed": installed,
        "last_seen": last_seen.isoformat() if last_seen else None,
        "last_seen_minutes_ago": minutes_ago,
        "agent_version": row["agent_version"],
        "token_prefix": row["token_prefix"],
    }


async def revoke_token(user_id: int, cluster_name: str) -> bool:
    async with get_session() as session:
        result = await session.execute(
            text(
                "UPDATE agent_tokens SET is_active = false "
                "WHERE user_id = :uid AND cluster_name = :cn AND is_active = true"
            ),
            {"uid": user_id, "cn": cluster_name},
        )
        await session.commit()
    return (result.rowcount or 0) > 0
