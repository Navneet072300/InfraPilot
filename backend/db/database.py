import logging
import os

import sqlalchemy
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger(__name__)

_raw_url = os.getenv("DATABASE_URL", "")

# Normalize to async driver
if _raw_url.startswith("postgresql://"):
    DATABASE_URL = _raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
elif _raw_url.startswith("postgres://"):
    DATABASE_URL = _raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
else:
    DATABASE_URL = _raw_url


class Base(DeclarativeBase):
    pass


engine = None
AsyncSessionLocal: async_sessionmaker | None = None


async def _apply_schema_migrations(conn) -> None:
    """
    Idempotent column additions for tables that predate certain features.
    Uses ADD COLUMN IF NOT EXISTS so it's safe to run on every startup.
    """
    migrations = [
        # users — columns added incrementally across versions
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30) UNIQUE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(20) DEFAULT '#6366f1'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'email'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_id VARCHAR(255)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'free'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'owner'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret VARCHAR(64)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()",
        # user_settings — columns added incrementally
        "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS experience_level VARCHAR(20) DEFAULT 'devops'",
        "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS secrets_json TEXT DEFAULT '[]'",
        "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS grafana_org_id INTEGER",
        "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS monitoring_enabled BOOLEAN DEFAULT TRUE",
        # platform_settings — monitoring / external keys
        "ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
        # user_secrets — purpose-built secrets table replacing secrets_json
        """
        CREATE TABLE IF NOT EXISTS user_secrets (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            value_encrypted TEXT NOT NULL,
            secret_type TEXT NOT NULL DEFAULT 'other',
            description TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, name)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_user_secrets_user ON user_secrets(user_id)",
        # agent_tokens — per-cluster Helm agent authentication
        """
        CREATE TABLE IF NOT EXISTS agent_tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            cluster_name TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            token_prefix TEXT NOT NULL,
            is_active BOOLEAN DEFAULT true,
            last_seen_at TIMESTAMPTZ,
            agent_version TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, cluster_name)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_agent_tokens_user ON agent_tokens(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_agent_tokens_token ON agent_tokens(token)",
        # alert_channels — user-configured notification channels
        """
        CREATE TABLE IF NOT EXISTS alert_channels (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            channel_type TEXT NOT NULL CHECK (channel_type IN ('slack','teams','email','discord','gchat','webhook')),
            name TEXT NOT NULL,
            config_encrypted TEXT NOT NULL,
            is_active BOOLEAN DEFAULT true,
            alert_on TEXT DEFAULT '["critical","high"]',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_alert_channels_user ON alert_channels(user_id)",
        # alert_history — send log per channel per incident
        """
        CREATE TABLE IF NOT EXISTS alert_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            incident_id TEXT,
            channel_id UUID,
            channel_type TEXT NOT NULL,
            sent_at TIMESTAMPTZ DEFAULT NOW(),
            status TEXT DEFAULT 'sent' CHECK (status IN ('sent','failed')),
            error_text TEXT
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_alert_history_incident ON alert_history(incident_id)",
        # diagnose_prs — PR records created from DiagnoseMode (persists across restarts)
        """
        CREATE TABLE IF NOT EXISTS diagnose_prs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id TEXT NOT NULL,
            repo_full_name TEXT NOT NULL,
            pr_number INTEGER,
            pr_url TEXT,
            pr_branch TEXT,
            base_branch TEXT DEFAULT 'main',
            pr_state TEXT DEFAULT 'open',
            pr_created_at TIMESTAMPTZ DEFAULT NOW(),
            pr_merged_at TIMESTAMPTZ,
            pr_closed_at TIMESTAMPTZ,
            last_checked_at TIMESTAMPTZ DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_diagnose_prs_session ON diagnose_prs(session_id)",
        # deploy_configs — verification state for the last rollout
        "ALTER TABLE deploy_configs ADD COLUMN IF NOT EXISTS last_verification_status TEXT DEFAULT 'none'",
        "ALTER TABLE deploy_configs ADD COLUMN IF NOT EXISTS last_verification_started_at TIMESTAMPTZ",
        "ALTER TABLE deploy_configs ADD COLUMN IF NOT EXISTS last_verification_ended_at TIMESTAMPTZ",
        "ALTER TABLE deploy_configs ADD COLUMN IF NOT EXISTS last_verification_detail TEXT",
        # metric_history — rolling 7-day window for z-score anomaly detection
        """
        CREATE TABLE IF NOT EXISTS metric_history (
            id BIGSERIAL PRIMARY KEY,
            cluster_name TEXT NOT NULL,
            resource_name TEXT NOT NULL,
            namespace TEXT NOT NULL DEFAULT 'default',
            metric_name TEXT NOT NULL,
            value DOUBLE PRECISION NOT NULL,
            recorded_at TIMESTAMPTZ DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_metric_history_lookup ON metric_history(cluster_name, resource_name, metric_name, recorded_at)",
    ]
    for sql in migrations:
        try:
            await conn.execute(sqlalchemy.text(sql))
        except Exception as e:
            # Already exists or other harmless conflict — log and continue
            logger.debug("Migration skipped (%s): %s", type(e).__name__, sql[:80])


async def init_db() -> bool:
    global engine, AsyncSessionLocal
    if not DATABASE_URL:
        logger.info("DATABASE_URL not set — using JSON config store")
        return False
    try:
        engine = create_async_engine(
            DATABASE_URL,
            echo=False,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
        )
        AsyncSessionLocal = async_sessionmaker(
            engine, expire_on_commit=False, class_=AsyncSession
        )
        # Import models so they register with Base before create_all
        from db import models  # noqa: F401
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await _apply_schema_migrations(conn)
        logger.info("PostgreSQL connected and schema ready")
        return True
    except Exception as e:
        logger.error("Database init failed: %s", e)
        engine = None
        AsyncSessionLocal = None
        return False


def is_db_available() -> bool:
    return AsyncSessionLocal is not None


def get_session():
    """Return a new async session. Always reads the current module-level AsyncSessionLocal
    so it works correctly even though callers may have imported it before init_db() ran."""
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not initialized")
    return AsyncSessionLocal()
