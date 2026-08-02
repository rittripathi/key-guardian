"""Redis counters used for the zero-DB pre-checks on the proxy hot path."""

from datetime import datetime, timezone

import redis.asyncio as aioredis

from app.config import settings

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None


def month_key() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}{now.month:02d}"


def rate_key(api_key_id: int, window: int) -> str:
    bucket = int(datetime.now(timezone.utc).timestamp()) // max(window, 1)
    return f"ks:rate:{api_key_id}:{window}:{bucket}"


def spend_key(api_key_id: int) -> str:
    return f"ks:spend:{api_key_id}:{month_key()}"


def authfail_key(api_key_id: int) -> str:
    return f"ks:authfail:{api_key_id}"


async def peek_rate(api_key_id: int, window: int) -> int:
    value = await get_redis().get(rate_key(api_key_id, window))
    return int(value) if value else 0


async def bump_rate(api_key_id: int, window: int) -> int:
    r = get_redis()
    key = rate_key(api_key_id, window)
    count = await r.incr(key)
    if count == 1:
        await r.expire(key, window + 5)
    return count


async def peek_spend(api_key_id: int) -> float | None:
    """None means 'not cached' — the caller should reconcile from Postgres."""
    value = await get_redis().get(spend_key(api_key_id))
    return float(value) if value is not None else None


async def set_spend(api_key_id: int, amount: float) -> None:
    # 40 days so a month-boundary key expires on its own
    await get_redis().set(spend_key(api_key_id), f"{amount:.6f}", ex=60 * 60 * 24 * 40)


async def add_spend(api_key_id: int, amount: float) -> float:
    r = get_redis()
    key = spend_key(api_key_id)
    total = await r.incrbyfloat(key, amount)
    await r.expire(key, 60 * 60 * 24 * 40)
    return float(total)


async def bump_auth_failures(api_key_id: int) -> int:
    r = get_redis()
    key = authfail_key(api_key_id)
    count = await r.incr(key)
    if count == 1:
        await r.expire(key, 600)
    return count


async def alert_once(tag: str, ttl: int = 3600) -> bool:
    """Returns True the first time a given alert tag is seen within ttl."""
    return bool(await get_redis().set(f"ks:alerted:{tag}", "1", ex=ttl, nx=True))
