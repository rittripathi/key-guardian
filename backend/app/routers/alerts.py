from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import current_user
from app.models import Alert, ApiKey, User
from app.templating import templates

router = APIRouter(tags=["alerts"])


@router.get("/alerts", response_class=HTMLResponse)
async def alerts_page(
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Alert, ApiKey.alias)
            .outerjoin(ApiKey, Alert.api_key_id == ApiKey.id)
            .where(Alert.user_id == user.id)
            .order_by(Alert.created_at.desc())
            .limit(200)
        )
    ).all()
    return templates.TemplateResponse(
        request, "alerts.html", {"user": user, "alerts": rows}
    )


@router.post("/alerts/read")
async def mark_all_read(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    await db.execute(update(Alert).where(Alert.user_id == user.id).values(read=True))
    await db.commit()
    return RedirectResponse("/alerts", status_code=303)
