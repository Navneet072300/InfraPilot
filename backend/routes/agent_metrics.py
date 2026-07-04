"""
Agent metrics ingestion — called by the Helm agent running in user clusters.
Auth: Bearer ip_agent_xxx (no cookie needed).
Rate limited per token: heartbeat 1/30s, metrics 1/60s.
"""
import logging
import time
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from db.database import is_db_available
from services import agent_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agent", tags=["agent-metrics"])

# Simple in-memory rate limit stores (token → last_request_unix)
_hb_last: dict[str, float] = {}
_metrics_last: dict[str, float] = {}


def _bearer(authorization: str) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token required")
    tok = authorization.removeprefix("Bearer ").strip()
    if not tok.startswith("ip_agent_"):
        raise HTTPException(401, "Invalid agent token format")
    return tok


async def _auth(token: str) -> dict:
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")
    ctx = await agent_service.validate_token(token)
    if not ctx:
        raise HTTPException(401, "Invalid or revoked agent token")
    return ctx


def _rate_limit(store: dict, token: str, interval: int) -> None:
    now = time.monotonic()
    if now - store.get(token, 0) < interval:
        raise HTTPException(429, f"Rate limit: 1 request per {interval}s per token")
    store[token] = now


# ─── POST /api/agent/heartbeat ────────────────────────────────────────────────

class HeartbeatBody(BaseModel):
    agent_version: str = ""
    cluster_name: str = ""
    node_count: int = 0
    pod_count: int = 0
    metrics_sample: dict[str, Any] = {}


@router.post("/heartbeat")
async def agent_heartbeat(
    body: HeartbeatBody,
    authorization: str = Header(default=""),
):
    token = _bearer(authorization)
    _rate_limit(_hb_last, token, 30)
    ctx = await _auth(token)

    if body.agent_version:
        await agent_service.update_agent_version(token, body.agent_version)

    logger.info(
        "Heartbeat: cluster=%s nodes=%d pods=%d version=%s",
        ctx["cluster_name"], body.node_count, body.pod_count, body.agent_version,
    )
    return {"accepted": True, "cluster": ctx["cluster_name"]}


# ─── POST /api/agent/metrics ──────────────────────────────────────────────────

class MetricPoint(BaseModel):
    name: str
    value: float
    labels: dict[str, str] = {}
    timestamp: int | None = None


@router.post("/metrics")
async def agent_metrics(
    body: list[MetricPoint],
    authorization: str = Header(default=""),
):
    token = _bearer(authorization)
    _rate_limit(_metrics_last, token, 60)
    ctx = await _auth(token)

    # Forward to Prometheus remote-write if configured.
    # For now accept and log — the actual forwarding happens
    # via the Prometheus remote_write config in the Helm chart.
    count = len(body)
    logger.debug("Metrics: cluster=%s count=%d", ctx["cluster_name"], count)
    return {"accepted": count}
