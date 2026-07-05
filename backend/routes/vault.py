"""In-house encrypted secrets vault — stores user secrets in user_secrets table with Fernet encryption."""
import logging
from typing import Optional

import sqlalchemy
from fastapi import APIRouter, Cookie, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from core.security import decode_token
from db.database import get_session, is_db_available
from db.models import User
from services.encryption_service import encrypt_str, decrypt_str

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/vault", tags=["vault"])

SECRET_TYPES = {
    "api_key", "token", "password", "aws_creds", "gcp_sa",
    "azure_creds", "database_url", "ssh_key", "webhook_url", "other",
}


class SecretCreate(BaseModel):
    name: str
    value: str
    secret_type: str = "other"
    description: Optional[str] = None


class SecretUpdate(BaseModel):
    name: Optional[str] = None
    secret_type: Optional[str] = None
    description: Optional[str] = None
    value: Optional[str] = None


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


def _mask(value: str) -> str:
    if len(value) <= 8:
        return "••••••••"
    return value[:4] + "••••" + value[-4:]


def _row_to_response(row, masked: bool = True) -> dict:
    try:
        plain = decrypt_str(row["value_encrypted"])
    except Exception:
        plain = ""
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "secret_type": row["secret_type"],
        "description": row["description"],
        "value": _mask(plain) if masked else plain,
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


@router.get("")
async def list_secrets(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        rows = await session.execute(
            sqlalchemy.text(
                "SELECT id, name, value_encrypted, secret_type, description, created_at, updated_at "
                "FROM user_secrets WHERE user_id = :uid ORDER BY created_at DESC"
            ),
            {"uid": user.id},
        )
        return {"secrets": [_row_to_response(r) for r in rows.mappings().all()]}


@router.post("", status_code=201)
async def create_secret(
    body: SecretCreate,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    if not body.name.strip():
        raise HTTPException(400, "name is required")
    if not body.value.strip():
        raise HTTPException(400, "value is required")
    stype = body.secret_type if body.secret_type in SECRET_TYPES else "other"

    async with get_session() as session:
        try:
            row = (await session.execute(
                sqlalchemy.text(
                    "INSERT INTO user_secrets (user_id, name, value_encrypted, secret_type, description) "
                    "VALUES (:uid, :name, :enc, :stype, :desc) "
                    "RETURNING id, name, value_encrypted, secret_type, description, created_at, updated_at"
                ),
                {
                    "uid": user.id,
                    "name": body.name.strip(),
                    "enc": encrypt_str(body.value),
                    "stype": stype,
                    "desc": body.description,
                },
            )).mappings().one()
            await session.commit()
        except Exception as e:
            await session.rollback()
            if "unique" in str(e).lower():
                raise HTTPException(409, f"A secret named '{body.name}' already exists")
            raise HTTPException(500, "Failed to save secret")

    return _row_to_response(row)


@router.patch("/{secret_id}")
async def update_secret(
    secret_id: str,
    body: SecretUpdate,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        existing = (await session.execute(
            sqlalchemy.text("SELECT id FROM user_secrets WHERE id = :id AND user_id = :uid"),
            {"id": secret_id, "uid": user.id},
        )).mappings().first()
        if not existing:
            raise HTTPException(404, "Secret not found")

        updates = []
        params: dict = {"id": secret_id, "uid": user.id}

        if body.name is not None:
            updates.append("name = :name")
            params["name"] = body.name.strip()
        if body.secret_type is not None:
            updates.append("secret_type = :stype")
            params["stype"] = body.secret_type if body.secret_type in SECRET_TYPES else "other"
        if body.description is not None:
            updates.append("description = :desc")
            params["desc"] = body.description
        if body.value is not None:
            updates.append("value_encrypted = :enc")
            params["enc"] = encrypt_str(body.value)

        if not updates:
            raise HTTPException(400, "Nothing to update")

        updates.append("updated_at = NOW()")
        row = (await session.execute(
            sqlalchemy.text(
                f"UPDATE user_secrets SET {', '.join(updates)} WHERE id = :id AND user_id = :uid "
                "RETURNING id, name, value_encrypted, secret_type, description, created_at, updated_at"
            ),
            params,
        )).mappings().one()
        await session.commit()

    return _row_to_response(row)


@router.delete("/{secret_id}", status_code=204)
async def delete_secret(
    secret_id: str,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        result = await session.execute(
            sqlalchemy.text("DELETE FROM user_secrets WHERE id = :id AND user_id = :uid RETURNING id"),
            {"id": secret_id, "uid": user.id},
        )
        await session.commit()
    if not result.rowcount:
        raise HTTPException(404, "Secret not found")


@router.post("/{secret_id}/reveal")
async def reveal_secret(
    secret_id: str,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    """Return the decrypted value for clipboard copy. POST to avoid value appearing in access logs."""
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        row = (await session.execute(
            sqlalchemy.text("SELECT value_encrypted FROM user_secrets WHERE id = :id AND user_id = :uid"),
            {"id": secret_id, "uid": user.id},
        )).mappings().first()
    if not row:
        raise HTTPException(404, "Secret not found")
    try:
        return {"value": decrypt_str(row["value_encrypted"])}
    except Exception:
        raise HTTPException(500, "Failed to decrypt secret")
