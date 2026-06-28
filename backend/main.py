import logging

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from routes.agent import router as agent_router
from routes.alerts import router as alerts_router
from routes.audit import router as audit_router
from routes.auth import router as auth_router
from routes.incidents import router as incidents_router
from routes.design import router as design_router
from routes.diagnose import router as diagnose_router
from routes.generate import router as generate_router
from routes.github import router as github_router
from routes.health import router as health_router
from routes.kubernetes import router as k8s_router
from routes.platform import router as platform_router
from routes.profile import router as profile_router
from routes.settings import router as settings_router
from routes.implement import router as implement_router
from routes.subscription import router as subscription_router
from routes.support import router as support_router
from routes.team import router as team_router

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="InfraPilot API v2", version="2.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (
    health_router,
    auth_router,
    platform_router,
    k8s_router,
    generate_router,
    diagnose_router,
    design_router,
    github_router,
    agent_router,
    settings_router,
    profile_router,
    audit_router,
    team_router,
    support_router,
    subscription_router,
    implement_router,
    incidents_router,
    alerts_router,
):
    app.include_router(r, prefix="/api")


@app.on_event("startup")
async def startup():
    import asyncio as _aio
    from db.database import init_db
    from services.cache_service import init_redis
    from workers import cluster_monitor

    await init_db()
    await init_redis()
    _aio.create_task(cluster_monitor.run())
    logger.info("InfraPilot v2 backend ready")
