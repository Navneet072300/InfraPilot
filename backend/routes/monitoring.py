import logging

from fastapi import APIRouter, Cookie, Header, HTTPException, Query
from sqlalchemy import select

from core.security import decode_token
from db.database import get_session, is_db_available
from db.models import User, UserSettings
from services.grafana_service import get_embed_url, setup_user
from services.prometheus_service import get_cluster_metrics

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


async def _get_user(ip_session: str, authorization: str) -> User:
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    from core.security import decode_token
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


async def _get_settings(user_id: int) -> UserSettings | None:
    async with get_session() as session:
        result = await session.execute(select(UserSettings).where(UserSettings.user_id == user_id))
        return result.scalar_one_or_none()


@router.get("/status")
async def get_monitoring_status(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    """Return monitoring enablement state and connectivity status."""
    user = await _get_user(ip_session, authorization)
    settings = await _get_settings(user.id)
    monitoring_enabled = getattr(settings, "monitoring_enabled", True) if settings else True
    grafana_org_id = getattr(settings, "grafana_org_id", None) if settings else None

    import os
    grafana_url = os.getenv("GRAFANA_URL", "http://grafana:3000")
    prometheus_url = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")

    prom_ok = False
    grafana_ok = False
    try:
        import httpx
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{prometheus_url}/-/healthy")
            prom_ok = r.is_success
    except Exception:
        pass
    try:
        import httpx
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{grafana_url}/api/health")
            grafana_ok = r.is_success
    except Exception:
        pass

    return {
        "monitoring_enabled": monitoring_enabled,
        "grafana_configured": grafana_org_id is not None,
        "grafana_org_id": grafana_org_id,
        "prometheus_connected": prom_ok,
        "grafana_connected": grafana_ok,
    }


@router.get("/embed-url")
async def get_monitoring_embed_url(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    """Return a 1-hour Grafana embed URL for the current user's dashboard.

    Auto-provisions the Grafana org on first call.
    """
    user = await _get_user(ip_session, authorization)
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")

    async with get_session() as session:
        result = await session.execute(select(UserSettings).where(UserSettings.user_id == user.id))
        settings = result.scalar_one_or_none()
        if not settings:
            from db.models import UserSettings as US
            settings = US(user_id=user.id)
            session.add(settings)
            await session.commit()
            await session.refresh(settings)

        grafana_org_id = getattr(settings, "grafana_org_id", None)
        dashboard_uid = None

        if grafana_org_id is None:
            try:
                info = await setup_user(user.id)
                grafana_org_id = info["org_id"]
                dashboard_uid = info["dashboard_uid"]
                settings.grafana_org_id = grafana_org_id
                await session.commit()
            except Exception as exc:
                logger.warning("Grafana setup_user failed: %s", exc)
                raise HTTPException(503, f"Grafana unavailable: {exc}")

    try:
        result = await get_embed_url(user.id, grafana_org_id, dashboard_uid or "")
        return result
    except Exception as exc:
        logger.warning("Grafana get_embed_url failed: %s", exc)
        raise HTTPException(503, f"Could not generate embed URL: {exc}")


@router.get("/metrics")
async def get_metrics(
    cluster: str = Query(default=""),
    time_range: str = Query(default="1h"),
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    """Return raw Prometheus metrics for a cluster scoped to this user."""
    user = await _get_user(ip_session, authorization)
    if not cluster:
        return {"cpu": [], "memory": [], "restarts": [], "pod_status": []}
    try:
        metrics = await get_cluster_metrics(user.id, cluster, time_range)
        return metrics
    except Exception as exc:
        logger.warning("get_cluster_metrics failed: %s", exc)
        raise HTTPException(503, f"Metrics unavailable: {exc}")
