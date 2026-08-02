"""Run every 10 minutes as a Render Cron Job.

1. Pings /healthz so the free web service never spins down.
2. Reconciles Redis's cached monthly spend against the authoritative
   Postgres rows for every key, so any drift (evicted Redis keys, a
   Redis restart, etc.) self-heals instead of accumulating.
"""

import asyncio
import logging

import httpx
from sqlalchemy import select

from app import cache
from app.config import settings
from app.db import SessionLocal
from app.models import ApiKey
from app.usage import month_spend_from_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("keyshort.keepalive")


async def ping_health() -> None:
    url = settings.public_base_url.rstrip("/") + "/healthz"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url)
        log.info("healthz -> %s", resp.status_code)
    except httpx.HTTPError as exc:
        log.warning("healthz ping failed: %s", exc)


async def reconcile_spend() -> None:
    async with SessionLocal() as db:
        alias_ids = (await db.execute(select(ApiKey.id))).scalars().all()
        for api_key_id in alias_ids:
            total = await month_spend_from_db(db, api_key_id)
            await cache.set_spend(api_key_id, total)
    log.info("reconciled spend for %d keys", len(alias_ids))


async def main() -> None:
    await ping_health()
    await reconcile_spend()
    await cache.close_redis()


if __name__ == "__main__":
    asyncio.run(main())
