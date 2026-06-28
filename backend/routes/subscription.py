"""
Subscription management routes.
All plan enforcement (rate limiting) is handled via check_plan_limit().
Actual payment processing is mocked — replace with Stripe in production.
"""
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Cookie, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func

from db.database import AsyncSessionLocal
from db.models import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/subscription", tags=["subscription"])

# ─── Plan definitions ─────────────────────────────────────────────────────────

PLAN_DEFINITIONS = {
    "free": {
        "id": "free",
        "name": "Free",
        "monthlyPrice": 0,
        "annualPrice": 0,
        "badge": None,
        "highlighted": False,
        "limits": {
            "clusters": 1,
            "aiRequestsPerDay": 50,
            "pipelineRunsPerDay": 3,
            "diagnoseRunsPerDay": 3,
            "teamSeats": 1,
            "historyDays": 7,
        },
        "features": {
            "designMode": False,
            "monitorMode": False,
            "customModel": False,
            "vaultIntegration": False,
            "apiKeys": False,
            "rbac": False,
            "auditLog": False,
            "sso": False,
            "saml": False,
            "slackNotifications": False,
            "onPremise": False,
            "sla": False,
        },
    },
    "pro": {
        "id": "pro",
        "name": "Pro",
        "monthlyPrice": 49,
        "annualPrice": 39,
        "badge": "Most Popular",
        "highlighted": True,
        "limits": {
            "clusters": 5,
            "aiRequestsPerDay": "unlimited",
            "pipelineRunsPerDay": "unlimited",
            "diagnoseRunsPerDay": "unlimited",
            "teamSeats": 1,
            "historyDays": 90,
        },
        "features": {
            "designMode": True,
            "monitorMode": True,
            "customModel": True,
            "vaultIntegration": True,
            "apiKeys": True,
            "rbac": False,
            "auditLog": False,
            "sso": False,
            "saml": False,
            "slackNotifications": False,
            "onPremise": False,
            "sla": False,
        },
    },
    "team": {
        "id": "team",
        "name": "Team",
        "monthlyPrice": 199,
        "annualPrice": 169,
        "badge": "Best for Teams",
        "highlighted": False,
        "limits": {
            "clusters": 15,
            "aiRequestsPerDay": "unlimited",
            "pipelineRunsPerDay": "unlimited",
            "diagnoseRunsPerDay": "unlimited",
            "teamSeats": 10,
            "historyDays": 365,
        },
        "features": {
            "designMode": True,
            "monitorMode": True,
            "customModel": True,
            "vaultIntegration": True,
            "apiKeys": True,
            "rbac": True,
            "auditLog": True,
            "sso": True,
            "saml": False,
            "slackNotifications": True,
            "onPremise": False,
            "sla": False,
        },
    },
    "enterprise": {
        "id": "enterprise",
        "name": "Enterprise",
        "monthlyPrice": 999,
        "annualPrice": 999,
        "badge": None,
        "highlighted": False,
        "limits": {
            "clusters": "unlimited",
            "aiRequestsPerDay": "unlimited",
            "pipelineRunsPerDay": "unlimited",
            "diagnoseRunsPerDay": "unlimited",
            "teamSeats": "unlimited",
            "historyDays": "unlimited",
        },
        "features": {
            "designMode": True,
            "monitorMode": True,
            "customModel": True,
            "vaultIntegration": True,
            "apiKeys": True,
            "rbac": True,
            "auditLog": True,
            "sso": True,
            "saml": True,
            "slackNotifications": True,
            "onPremise": True,
            "sla": True,
        },
    },
}

# In-memory usage store (replace with Redis/DB counters in production)
_usage: dict[str, dict] = {}


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _midnight_utc() -> str:
    tomorrow = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(days=1)
    return tomorrow.isoformat()


def get_usage(user_id: int) -> dict:
    key = f"{user_id}:{_today_utc()}"
    if key not in _usage:
        _usage[key] = {"ai_requests": 0, "pipeline_runs": 0, "diagnose_runs": 0}
    return _usage[key]


def increment_usage(user_id: int, feature: str) -> int:
    usage = get_usage(user_id)
    usage[feature] = usage.get(feature, 0) + 1
    return usage[feature]


async def check_plan_limit(user: User, feature: str) -> None:
    """Raises HTTP 429 with structured payload when a daily limit is hit."""
    plan = user.plan or "free"
    plan_def = PLAN_DEFINITIONS.get(plan, PLAN_DEFINITIONS["free"])
    limits = plan_def["limits"]
    usage = get_usage(user.id)

    limit_map = {
        "ai_requests": ("aiRequestsPerDay", "ai_requests"),
        "pipeline_runs": ("pipelineRunsPerDay", "pipeline_runs"),
        "diagnose_runs": ("diagnoseRunsPerDay", "diagnose_runs"),
    }

    if feature not in limit_map:
        return

    limit_key, usage_key = limit_map[feature]
    limit = limits.get(limit_key, 0)

    if limit == "unlimited":
        return

    current = usage.get(usage_key, 0)
    if current >= limit:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "limit_exceeded",
                "feature": feature,
                "current": current,
                "limit": limit,
                "reset_at": _midnight_utc(),
                "upgrade_url": "/pricing",
                "required_plan": "pro" if plan == "free" else "enterprise",
            },
        )


# ─── Auth helper ──────────────────────────────────────────────────────────────

async def _get_user(ip_session: str, authorization: str) -> User:
    token = ip_session or (authorization.removeprefix("Bearer ") if authorization else "")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        import jwt as pyjwt
        import os
        secret = os.environ.get("JWT_SECRET", "dev-secret")
        payload = pyjwt.decode(token, secret, algorithms=["HS256"])
        user_id = int(payload.get("sub", 0))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid session")
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.get("/plans")
async def get_plans():
    return {"plans": list(PLAN_DEFINITIONS.values())}


@router.get("/current")
async def get_current(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    plan = user.plan or "free"
    plan_def = PLAN_DEFINITIONS.get(plan, PLAN_DEFINITIONS["free"])
    limits = plan_def["limits"]
    usage = get_usage(user.id)

    def stat(used_key: str, limit_key: str):
        limit = limits.get(limit_key, 0)
        return {
            "used": usage.get(used_key, 0),
            "limit": limit,
            "resets_at": _midnight_utc() if limit != "unlimited" else None,
        }

    return {
        "plan": plan,
        "billing_cycle": "monthly",
        "current_period_end": (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d"),
        "cancel_at_period_end": False,
        "usage": {
            "ai_requests": stat("ai_requests", "aiRequestsPerDay"),
            "pipeline_runs": stat("pipeline_runs", "pipelineRunsPerDay"),
            "diagnose_runs": stat("diagnose_runs", "diagnoseRunsPerDay"),
            "clusters": {"used": 0, "limit": limits.get("clusters", 1), "resets_at": None},
        },
    }


@router.get("/usage")
async def get_usage_endpoint(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    plan = user.plan or "free"
    plan_def = PLAN_DEFINITIONS.get(plan, PLAN_DEFINITIONS["free"])
    limits = plan_def["limits"]
    usage = get_usage(user.id)
    return {
        "ai_requests": {"used": usage.get("ai_requests", 0), "limit": limits.get("aiRequestsPerDay"), "resets_at": _midnight_utc()},
        "pipeline_runs": {"used": usage.get("pipeline_runs", 0), "limit": limits.get("pipelineRunsPerDay"), "resets_at": _midnight_utc()},
        "diagnose_runs": {"used": usage.get("diagnose_runs", 0), "limit": limits.get("diagnoseRunsPerDay"), "resets_at": _midnight_utc()},
    }


class UpgradeRequest(BaseModel):
    plan: str
    billing: str = "monthly"


@router.post("/upgrade")
async def upgrade_plan(
    body: UpgradeRequest,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    valid_plans = ["free", "pro", "team", "enterprise"]
    if body.plan not in valid_plans:
        raise HTTPException(status_code=400, detail="Invalid plan")

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.id == user.id))
        db_user = result.scalar_one_or_none()
        if db_user:
            db_user.plan = body.plan
            await session.commit()

    logger.info("Plan upgrade: user=%s old=%s new=%s billing=%s", user.email, user.plan, body.plan, body.billing)
    return {"success": True, "new_plan": body.plan, "billing": body.billing}


@router.post("/cancel")
async def cancel_subscription(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user = await _get_user(ip_session, authorization)
    cancels_at = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
    logger.info("Subscription cancellation requested: user=%s cancels_at=%s", user.email, cancels_at)
    return {"cancels_at": cancels_at, "message": "Your plan will remain active until the end of the billing period."}


@router.post("/track-usage")
async def track_usage_internal(
    body: dict,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    """Internal — called by other routes to increment usage counters."""
    user = await _get_user(ip_session, authorization)
    feature = body.get("feature", "")
    count = int(body.get("count", 1))
    for _ in range(count):
        increment_usage(user.id, feature)
    return {"ok": True, "feature": feature, "new_total": get_usage(user.id).get(feature, 0)}
