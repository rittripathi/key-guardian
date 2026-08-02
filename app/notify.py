"""Alert creation plus outbound delivery channels."""

import logging

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Alert

log = logging.getLogger("keyshort.notify")


async def send_telegram(text: str) -> None:
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        return
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                url,
                json={
                    "chat_id": settings.telegram_chat_id,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
            )
    except Exception as exc:  # noqa: BLE001 - alerting must never break the request
        log.warning("telegram delivery failed: %s", exc)


async def notify(
    db: AsyncSession,
    *,
    user_id: int,
    api_key_id: int | None,
    kind: str,
    message: str,
    severity: str = "warning",
) -> None:
    db.add(
        Alert(
            user_id=user_id,
            api_key_id=api_key_id,
            kind=kind,
            severity=severity,
            message=message,
        )
    )
    await db.commit()
    prefix = "\u26a0\ufe0f" if severity == "warning" else "\U0001f6d1"
    await send_telegram(f"{prefix} <b>KeyShort</b>\n{message}")
