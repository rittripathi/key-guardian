from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import get_redis
from app.db import get_db

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz(db: AsyncSession = Depends(get_db)):
    status = {"status": "ok", "db": "ok", "redis": "ok"}

    try:
        await db.execute(select(1))
    except Exception as exc:  # noqa: BLE001
        status["db"] = f"error: {exc.__class__.__name__}"
        status["status"] = "degraded"

    try:
        await get_redis().ping()
    except Exception as exc:  # noqa: BLE001
        status["redis"] = f"error: {exc.__class__.__name__}"
        status["status"] = "degraded"

    return status
