"""
Redis caching layer — gracefully disabled when REDIS_URL is not set.
All public functions are safe to call even without Redis.
"""
import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "")
_redis: Any = None


async def init_redis() -> bool:
    global _redis
    if not REDIS_URL:
        logger.info("REDIS_URL not set — caching disabled")
        return False
    try:
        import redis.asyncio as aioredis  # type: ignore
        client = aioredis.from_url(REDIS_URL, decode_responses=True)
        await client.ping()
        _redis = client
        logger.info("Redis connected: %s", REDIS_URL.split("@")[-1])
        return True
    except Exception as e:
        logger.warning("Redis unavailable: %s — caching disabled", e)
        _redis = None
        return False


def is_cache_available() -> bool:
    return _redis is not None


async def get(key: str) -> Any | None:
    if _redis is None:
        return None
    try:
        raw = await _redis.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def set(key: str, value: Any, ttl: int = 30) -> None:
    if _redis is None:
        return
    try:
        await _redis.set(key, json.dumps(value), ex=ttl)
    except Exception:
        pass


async def delete(key: str) -> None:
    if _redis is None:
        return
    try:
        await _redis.delete(key)
    except Exception:
        pass


async def delete_pattern(pattern: str) -> None:
    """Delete all keys matching a glob pattern."""
    if _redis is None:
        return
    try:
        keys = await _redis.keys(pattern)
        if keys:
            await _redis.delete(*keys)
    except Exception:
        pass


# Convenience TTL constants
TTL_HEALTH = 30       # cluster health check
TTL_NAMESPACES = 60   # namespace list
TTL_PODS = 15         # pod list
TTL_OVERVIEW = 30     # cluster overview
