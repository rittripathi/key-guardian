"""Shared helpers for resolving an alias and doing the fast pre-checks."""

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import cache
from app.models import ApiKey, KeyLimit, KeyUsage


@dataclass
class Denied:
    status_code: int
    reason: str


async def month_spend_from_db(db: AsyncSession, api_key_id: int) -> float:
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    total = await db.scalar(
        select(func.coalesce(func.sum(KeyUsage.cost_usd), 0.0)).where(
            KeyUsage.api_key_id == api_key_id, KeyUsage.created_at >= start
        )
    )
    return float(total or 0.0)


async def cached_spend(db: AsyncSession, api_key_id: int) -> float:
    """Redis first; reconcile from Postgres only on a cache miss."""
    value = await cache.peek_spend(api_key_id)
    if value is not None:
        return value
    total = await month_spend_from_db(db, api_key_id)
    await cache.set_spend(api_key_id, total)
    return total


async def load_key_by_alias(db: AsyncSession, alias: str) -> ApiKey | None:
    result = await db.execute(
        select(ApiKey).where(ApiKey.alias == alias).order_by(ApiKey.id.asc())
    )
    return result.scalars().first()


async def load_limit(db: AsyncSession, api_key_id: int) -> KeyLimit | None:
    result = await db.execute(select(KeyLimit).where(KeyLimit.api_key_id == api_key_id))
    return result.scalar_one_or_none()


async def precheck(db: AsyncSession, key: ApiKey, limit: KeyLimit | None) -> Denied | None:
    """Runs before the provider call. Redis-only, no blocking DB work on the hot path."""
    if limit is None:
        return None

    if limit.rate_limit > 0 and limit.rate_mode == "block":
        used = await cache.peek_rate(key.id, limit.rate_window_seconds)
        if used >= limit.rate_limit:
            return Denied(
                429,
                f"Rate limit reached for '{key.alias}': "
                f"{limit.rate_limit} requests / {limit.rate_window_seconds}s.",
            )

    if limit.spend_cap_usd > 0 and limit.spend_mode == "block":
        spent = await cached_spend(db, key.id)
        if spent >= limit.spend_cap_usd:
            return Denied(
                402,
                f"Monthly spend cap reached for '{key.alias}': "
                f"${spent:.2f} of ${limit.spend_cap_usd:.2f}.",
            )

    return None
