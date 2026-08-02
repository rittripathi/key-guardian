from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.deps import get_user_by_email
from app.models import User
from app.security import hash_secret, make_session, verify_secret
from app.templating import templates

router = APIRouter(tags=["auth"])


def _set_session(response: RedirectResponse, user_id: int) -> RedirectResponse:
    response.set_cookie(
        settings.session_cookie,
        make_session(user_id),
        max_age=settings.session_max_age,
        httponly=True,
        samesite="lax",
        secure=settings.public_base_url.startswith("https://"),
        path="/",
    )
    return response


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse(request, "login.html", {"error": None})


@router.post("/login")
async def login(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_email(db, email)
    if user is None or not verify_secret(user.password_hash, password):
        return templates.TemplateResponse(
            request, "login.html", {"error": "Wrong email or password."}, status_code=401
        )
    return _set_session(RedirectResponse("/", status_code=303), user.id)


@router.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    return templates.TemplateResponse(request, "register.html", {"error": None})


@router.post("/register")
async def register(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    email = email.lower().strip()
    if len(password) < 8:
        return templates.TemplateResponse(
            request,
            "register.html",
            {"error": "Password must be at least 8 characters."},
            status_code=400,
        )
    if await get_user_by_email(db, email):
        return templates.TemplateResponse(
            request, "register.html", {"error": "That email is already registered."}, status_code=400
        )

    user = User(email=email, password_hash=hash_secret(password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _set_session(RedirectResponse("/", status_code=303), user.id)


@router.post("/logout")
async def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(settings.session_cookie, path="/")
    return response
