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
