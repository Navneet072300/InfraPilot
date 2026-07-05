"""In-house encrypted secrets vault — stores user secrets in user_secrets table with Fernet encryption."""
import json
from datetime import datetime
from typing import Optional

import sqlalchemy
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db.database import get_db
from routes.auth import get_current_user
from services.encryption_service import encrypt_str, decrypt_str

router = APIRouter(tags=["vault"])

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


@router.get("/vault")
async def list_secrets(user=Depends(get_current_user), db=Depends(get_db)):
    rows = await db.execute(
        sqlalchemy.text(
            "SELECT id, name, value_encrypted, secret_type, description, created_at, updated_at "
            "FROM user_secrets WHERE user_id = :uid ORDER BY created_at DESC"
        ),
        {"uid": user["id"]},
    )
    return {"secrets": [_row_to_response(r) for r in rows.mappings().all()]}


@router.post("/vault", status_code=201)
async def create_secret(body: SecretCreate, user=Depends(get_current_user), db=Depends(get_db)):
    if not body.name.strip():
        raise HTTPException(400, "name is required")
    if not body.value.strip():
        raise HTTPException(400, "value is required")
    stype = body.secret_type if body.secret_type in SECRET_TYPES else "other"

    try:
        row = await db.execute(
            sqlalchemy.text(
                "INSERT INTO user_secrets (user_id, name, value_encrypted, secret_type, description) "
                "VALUES (:uid, :name, :enc, :stype, :desc) "
                "RETURNING id, name, value_encrypted, secret_type, description, created_at, updated_at"
            ),
            {
                "uid": user["id"],
                "name": body.name.strip(),
                "enc": encrypt_str(body.value),
                "stype": stype,
                "desc": body.description,
            },
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(409, f"A secret named '{body.name}' already exists")
        raise HTTPException(500, "Failed to save secret")

    return _row_to_response(row.mappings().one())


@router.patch("/vault/{secret_id}")
async def update_secret(secret_id: str, body: SecretUpdate, user=Depends(get_current_user), db=Depends(get_db)):
    existing = (await db.execute(
        sqlalchemy.text("SELECT id FROM user_secrets WHERE id = :id AND user_id = :uid"),
        {"id": secret_id, "uid": user["id"]},
    )).mappings().first()
    if not existing:
        raise HTTPException(404, "Secret not found")

    updates = []
    params: dict = {"id": secret_id, "uid": user["id"]}

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
    row = (await db.execute(
        sqlalchemy.text(
            f"UPDATE user_secrets SET {', '.join(updates)} WHERE id = :id AND user_id = :uid "
            "RETURNING id, name, value_encrypted, secret_type, description, created_at, updated_at"
        ),
        params,
    )).mappings().one()
    await db.commit()
    return _row_to_response(row)


@router.delete("/vault/{secret_id}", status_code=204)
async def delete_secret(secret_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    result = await db.execute(
        sqlalchemy.text("DELETE FROM user_secrets WHERE id = :id AND user_id = :uid RETURNING id"),
        {"id": secret_id, "uid": user["id"]},
    )
    await db.commit()
    if not result.rowcount:
        raise HTTPException(404, "Secret not found")


@router.post("/vault/{secret_id}/reveal")
async def reveal_secret(secret_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    """Return the decrypted value for clipboard copy. Use POST to avoid value appearing in access logs."""
    row = (await db.execute(
        sqlalchemy.text("SELECT value_encrypted FROM user_secrets WHERE id = :id AND user_id = :uid"),
        {"id": secret_id, "uid": user["id"]},
    )).mappings().first()
    if not row:
        raise HTTPException(404, "Secret not found")
    try:
        return {"value": decrypt_str(row["value_encrypted"])}
    except Exception:
        raise HTTPException(500, "Failed to decrypt secret")
