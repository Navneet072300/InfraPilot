import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from core.security import decode_token
from db.database import get_session, is_db_available
from db.models import TeamInvite, TeamMember, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/team", tags=["team"])


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
    if user.plan != "team":
        raise HTTPException(403, "Team features require the Team plan")
    return user


class InviteRequest(BaseModel):
    email: str
    role: str = "member"


class RoleUpdate(BaseModel):
    role: str


@router.get("/members")
async def list_members(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        result = await session.execute(
            select(TeamMember).where(TeamMember.workspace_owner_id == user.id)
        )
        members = result.scalars().all()

    # Include the owner themselves
    member_list = [
        {
            "id": 0,
            "email": user.email,
            "name": user.name,
            "role": "owner",
            "joined_at": user.created_at.isoformat(),
            "is_current": True,
        }
    ]
    for m in members:
        member_list.append({
            "id": m.id,
            "email": m.email,
            "name": m.name,
            "role": m.role,
            "joined_at": m.joined_at.isoformat(),
            "is_current": False,
        })

    return {"members": member_list}


@router.post("/invite", status_code=201)
async def invite_member(
    body: InviteRequest,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        invite = TeamInvite(
            workspace_owner_id=user.id,
            email=body.email,
            role=body.role,
            token=secrets.token_urlsafe(32),
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
        session.add(invite)
        await session.commit()
        await session.refresh(invite)

    logger.info("Team invite sent: to=%s by=%s", body.email, user.email)
    return {"message": f"Invite sent to {body.email}", "invite_id": invite.id}


@router.get("/invites")
async def list_invites(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        result = await session.execute(
            select(TeamInvite).where(
                TeamInvite.workspace_owner_id == user.id,
                TeamInvite.is_cancelled == False,
                TeamInvite.expires_at > datetime.now(timezone.utc),
            )
        )
        invites = result.scalars().all()

    return {
        "invites": [
            {
                "id": i.id,
                "email": i.email,
                "role": i.role,
                "created_at": i.created_at.isoformat(),
                "expires_at": i.expires_at.isoformat(),
            }
            for i in invites
        ]
    }


@router.put("/members/{member_id}/role")
async def update_member_role(
    member_id: int,
    body: RoleUpdate,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        result = await session.execute(
            select(TeamMember).where(
                TeamMember.id == member_id, TeamMember.workspace_owner_id == user.id
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise HTTPException(404, "Member not found")
        member.role = body.role
        await session.commit()

    return {"ok": True}


@router.delete("/members/{member_id}", status_code=204)
async def remove_member(
    member_id: int,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        result = await session.execute(
            select(TeamMember).where(
                TeamMember.id == member_id, TeamMember.workspace_owner_id == user.id
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise HTTPException(404, "Member not found")
        await session.delete(member)
        await session.commit()


@router.delete("/invites/{invite_id}", status_code=204)
async def cancel_invite(
    invite_id: int,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        result = await session.execute(
            select(TeamInvite).where(
                TeamInvite.id == invite_id, TeamInvite.workspace_owner_id == user.id
            )
        )
        invite = result.scalar_one_or_none()
        if not invite:
            raise HTTPException(404, "Invite not found")
        invite.is_cancelled = True
        await session.commit()
