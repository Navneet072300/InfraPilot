import json
import logging

import httpx
from fastapi import APIRouter, Cookie, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from config.unified_store import (
    create_cluster,
    delete_cluster,
    get_cluster,
    get_platform_setting,
    list_clusters,
    set_active_cluster,
    set_platform_setting,
    update_cluster,
)
from core.security import decode_token
from db.database import get_session, is_db_available
from db.models import User, UserSettings
from services import cache_service
from services.k8s_service import KubernetesService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])

# ── Auth helper ───────────────────────────────────────────────────────────────

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


async def _get_or_create_settings(user_id: int) -> UserSettings:
    async with get_session() as session:
        result = await session.execute(select(UserSettings).where(UserSettings.user_id == user_id))
        settings = result.scalar_one_or_none()
        if not settings:
            settings = UserSettings(user_id=user_id)
            session.add(settings)
            await session.commit()
            await session.refresh(settings)
        return settings


# ── Cluster endpoints (existing) ──────────────────────────────────────────────

class ClusterCreateInput(BaseModel):
    name: str
    environment: str = "dev"
    connection_type: str = "token"
    api_url: str = ""
    token: str = ""
    kubeconfig: str = ""


class ClusterUpdateInput(BaseModel):
    environment: str | None = None
    connection_type: str | None = None
    api_url: str | None = None
    token: str | None = None
    kubeconfig: str | None = None


class PlatformSettingInput(BaseModel):
    key: str
    value: str


def _mask(val: str | None, visible: int = 4) -> str | None:
    if not val:
        return val
    return val[:visible] + "***" if len(val) > visible else "***"


def _safe_cluster(c: dict) -> dict:
    out = dict(c)
    if out.get("token"):
        out["token"] = _mask(out["token"])
    if out.get("kubeconfig"):
        out["kubeconfig"] = "***[kubeconfig]***"
    return out


@router.get("/clusters")
async def list_all_clusters():
    clusters = await list_clusters(masked=False)
    return {"clusters": [_safe_cluster(c) for c in clusters]}


@router.post("/clusters", status_code=201)
async def add_cluster(body: ClusterCreateInput):
    existing = await get_cluster(body.name)
    if existing:
        raise HTTPException(400, f"Cluster '{body.name}' already exists")
    data = body.model_dump()
    created = await create_cluster(data)
    return {"cluster": _safe_cluster(created)}


@router.patch("/clusters/{name}")
async def edit_cluster(name: str, body: ClusterUpdateInput):
    existing = await get_cluster(name)
    if not existing:
        raise HTTPException(404, f"Cluster '{name}' not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        return {"cluster": _safe_cluster(existing)}
    updated = await update_cluster(name, updates)
    if not updated:
        raise HTTPException(500, "Update failed")
    await cache_service.delete_pattern(f"*:{name}*")
    return {"cluster": _safe_cluster(updated)}


@router.delete("/clusters/{name}", status_code=204)
async def remove_cluster(name: str):
    existing = await get_cluster(name)
    if not existing:
        raise HTTPException(404, f"Cluster '{name}' not found")
    ok = await delete_cluster(name)
    if not ok:
        raise HTTPException(500, "Delete failed")
    await cache_service.delete_pattern(f"*:{name}*")


@router.post("/clusters/{name}/activate")
async def activate_cluster(name: str):
    ok = await set_active_cluster(name)
    if not ok:
        raise HTTPException(404, f"Cluster '{name}' not found")
    return {"active": name}


@router.post("/clusters/{name}/test")
async def test_cluster_connection(name: str, body: ClusterUpdateInput | None = None):
    cluster = await get_cluster(name)
    if not cluster:
        raise HTTPException(404, f"Cluster '{name}' not found")
    if body:
        overrides = {k: v for k, v in body.model_dump().items() if v is not None}
        for field in ("token", "kubeconfig", "api_url"):
            val = overrides.get(field, "")
            if val and "***" in str(val):
                overrides.pop(field, None)
        cluster = {**cluster, **overrides}
    try:
        svc = KubernetesService(cluster)
        result = await svc.health()
        return result
    except Exception as e:
        return {"healthy": False, "error": str(e)}


@router.get("/platform")
async def get_platform_config():
    github_pat = await get_platform_setting("github.pat")
    github_pat_expires_at = await get_platform_setting("github.pat_expires_at")
    github_username = await get_platform_setting("github.username")
    return {
        "github": {
            "pat": _mask(github_pat) if github_pat else "",
            "pat_expires_at": github_pat_expires_at or "",
            "username": github_username or "",
        },
        "vault": {"stub": True},
        "cloudflare": {"stub": True},
    }


async def _fetch_pat_expiry(pat: str) -> str | None:
    """
    Ask GitHub API for token expiry via the github-authentication-token-expiration
    response header. Returns an ISO-8601 date string or None if not set / no expiry.
    """
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://api.github.com/user",
                headers={
                    "Authorization": f"Bearer {pat}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
        raw = resp.headers.get("github-authentication-token-expiration")  # "2025-01-01 00:00:00 UTC"
        if not raw:
            return None
        # Normalise to ISO-8601 date string (YYYY-MM-DD)
        from datetime import datetime
        dt = datetime.strptime(raw.strip(), "%Y-%m-%d %H:%M:%S %Z")
        return dt.date().isoformat()
    except Exception:
        return None


@router.patch("/platform")
async def update_platform_config(body: PlatformSettingInput):
    if "***" in body.value:
        return {"ok": True}  # masked value — ignore, don't overwrite real token
    await set_platform_setting(body.key, body.value)
    # When a GitHub PAT is saved, auto-detect its expiry from the GitHub API
    if body.key == "github.pat" and body.value:
        expiry = await _fetch_pat_expiry(body.value)
        await set_platform_setting("github.pat_expires_at", expiry or "")
    return {"ok": True}


# ── General settings ──────────────────────────────────────────────────────────

class GeneralSettingsInput(BaseModel):
    name: str | None = None
    email: str | None = None
    avatar_color: str | None = None
    timezone: str | None = None
    default_environment: str | None = None
    default_iac_tool: str | None = None
    default_cloud: str | None = None
    default_namespace: str | None = None
    code_font_size: int | None = None
    experience_level: str | None = None


@router.get("")
async def get_all_settings(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    settings = await _get_or_create_settings(user.id)
    try:
        notif = json.loads(settings.notification_prefs or "{}")
    except Exception:
        notif = {}

    return {
        "general": {
            "name": user.name,
            "email": user.email,
            "avatar_color": user.avatar_color,
            "timezone": settings.timezone,
            "default_environment": settings.default_environment,
            "default_iac_tool": settings.default_iac_tool,
            "default_cloud": settings.default_cloud,
            "default_namespace": settings.default_namespace,
            "code_font_size": settings.code_font_size,
            "experience_level": settings.experience_level,
        },
        "notifications": notif,
        "ai": {
            "primary_endpoint": settings.ai_primary_endpoint,
            "primary_model": settings.ai_primary_model,
            "secondary_endpoint": settings.ai_secondary_endpoint,
            "secondary_model": settings.ai_secondary_model,
            "temperature": float(settings.ai_temperature),
            "max_tokens": settings.ai_max_tokens,
            "streaming": settings.ai_streaming,
            "system_prompt_addendum": settings.ai_system_prompt_addendum,
        },
        "team": {
            "workspace_name": settings.workspace_name,
            "require_2fa_team": settings.require_2fa_team,
            "default_member_role": settings.default_member_role,
        },
        "security": {
            "totp_enabled": user.totp_enabled,
        },
    }


@router.put("/general")
async def update_general(
    body: GeneralSettingsInput,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        result = await session.execute(select(User).where(User.id == user.id))
        db_user = result.scalar_one_or_none()
        if not db_user:
            raise HTTPException(404, "User not found")
        if body.name is not None:
            db_user.name = body.name
        if body.email is not None:
            db_user.email = body.email
        if body.avatar_color is not None:
            db_user.avatar_color = body.avatar_color
        await session.commit()

    settings = await _get_or_create_settings(user.id)
    async with get_session() as session:
        result = await session.execute(select(UserSettings).where(UserSettings.user_id == user.id))
        s = result.scalar_one_or_none()
        if s:
            if body.timezone is not None:
                s.timezone = body.timezone
            if body.default_environment is not None:
                s.default_environment = body.default_environment
            if body.default_iac_tool is not None:
                s.default_iac_tool = body.default_iac_tool
            if body.default_cloud is not None:
                s.default_cloud = body.default_cloud
            if body.default_namespace is not None:
                s.default_namespace = body.default_namespace
            if body.code_font_size is not None:
                s.code_font_size = body.code_font_size
            if body.avatar_color is not None:
                s.avatar_color = body.avatar_color
            if body.experience_level is not None:
                allowed = {"builder", "devops", "learning"}
                if body.experience_level in allowed:
                    s.experience_level = body.experience_level
            await session.commit()

    return {"ok": True}


# ── Notification settings ─────────────────────────────────────────────────────

@router.put("/notifications")
async def update_notifications(
    body: dict,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        result = await session.execute(select(UserSettings).where(UserSettings.user_id == user.id))
        s = result.scalar_one_or_none()
        if not s:
            s = UserSettings(user_id=user.id, notification_prefs=json.dumps(body))
            session.add(s)
        else:
            s.notification_prefs = json.dumps(body)
        await session.commit()
    return {"ok": True}


# ── AI settings ───────────────────────────────────────────────────────────────

class AISettingsInput(BaseModel):
    primary_endpoint: str | None = None
    primary_model: str | None = None
    secondary_endpoint: str | None = None
    secondary_model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    streaming: bool | None = None
    system_prompt_addendum: str | None = None


@router.put("/ai")
async def update_ai_settings(
    body: AISettingsInput,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        result = await session.execute(select(UserSettings).where(UserSettings.user_id == user.id))
        s = result.scalar_one_or_none()
        if not s:
            s = UserSettings(user_id=user.id)
            session.add(s)
        if body.primary_endpoint is not None:
            s.ai_primary_endpoint = body.primary_endpoint
        if body.primary_model is not None:
            s.ai_primary_model = body.primary_model
        if body.secondary_endpoint is not None:
            s.ai_secondary_endpoint = body.secondary_endpoint
        if body.secondary_model is not None:
            s.ai_secondary_model = body.secondary_model
        if body.temperature is not None:
            s.ai_temperature = str(body.temperature)
        if body.max_tokens is not None:
            s.ai_max_tokens = body.max_tokens
        if body.streaming is not None:
            s.ai_streaming = body.streaming
        if body.system_prompt_addendum is not None:
            s.ai_system_prompt_addendum = body.system_prompt_addendum
        await session.commit()
    return {"ok": True}


@router.get("/ai/health")
async def test_ai_health(
    endpoint: str = "",
    model: str = "",
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    _user = await _get_user(ip_session, authorization)
    if not endpoint:
        return {"ok": False, "error": "No endpoint configured"}
    try:
        import time
        start = time.monotonic()
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(f"{endpoint.rstrip('/')}/api/tags")
        ms = int((time.monotonic() - start) * 1000)
        if r.status_code == 200:
            return {"ok": True, "message": f"Model responding, avg {ms}ms"}
        return {"ok": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Team settings ─────────────────────────────────────────────────────────────

class TeamSettingsInput(BaseModel):
    workspace_name: str | None = None
    require_2fa_team: bool | None = None
    default_member_role: str | None = None


@router.put("/team")
async def update_team_settings(
    body: TeamSettingsInput,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    async with get_session() as session:
        result = await session.execute(select(UserSettings).where(UserSettings.user_id == user.id))
        s = result.scalar_one_or_none()
        if not s:
            s = UserSettings(user_id=user.id)
            session.add(s)
        if body.workspace_name is not None:
            s.workspace_name = body.workspace_name
        if body.require_2fa_team is not None:
            s.require_2fa_team = body.require_2fa_team
        if body.default_member_role is not None:
            s.default_member_role = body.default_member_role
        await session.commit()
    return {"ok": True}
