import re
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import cache
from app.config import settings
from app.db import get_db
from app.deps import current_user, current_user_optional
from app.models import Alert, ApiKey, KeyLimit, KeyUsage, User
from app.providers import PROVIDERS, auth_headers, probe_path, resolve_base_url
from app.security import decrypt_secret, encrypt_secret, hash_secret
from app.templating import templates
from app.usage import cached_spend

router = APIRouter(tags=["keys"])

ALIAS_RE = re.compile(r"^[a-zA-Z0-9_-]{2,32}$")


async def _owned_key(db: AsyncSession, user: User, alias: str) -> ApiKey:
    result = await db.execute(
        select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.alias == alias)
    )
    key = result.scalar_one_or_none()
    if key is None:
        raise HTTPException(status_code=404, detail="Alias not found")
    return key


async def _next_alias(db: AsyncSession, user_id: int) -> str:
    rows = (
        await db.execute(select(ApiKey.alias).where(ApiKey.user_id == user_id))
    ).scalars().all()
    used = {int(m.group(1)) for a in rows if (m := re.fullmatch(r"key(\d+)", a))}
    n = 1
    while n in used:
        n += 1
    return f"key{n}"


async def _key_view(db: AsyncSession, key: ApiKey) -> dict:
    limit = (
        await db.execute(select(KeyLimit).where(KeyLimit.api_key_id == key.id))
    ).scalar_one_or_none()
    spend = await cached_spend(db, key.id)
    requests_today = await db.scalar(
        select(func.count(KeyUsage.id)).where(
            KeyUsage.api_key_id == key.id,
            KeyUsage.created_at
            >= datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0),
        )
    )
    rate_used = (
        await cache.peek_rate(key.id, limit.rate_window_seconds) if limit and limit.rate_limit else 0
    )
    return {
        "key": key,
        "limit": limit,
        "spend": spend,
        "spend_pct": min(100, int(spend / limit.spend_cap_usd * 100)) if limit and limit.spend_cap_usd else 0,
        "rate_used": rate_used,
        "rate_pct": min(100, int(rate_used / limit.rate_limit * 100)) if limit and limit.rate_limit else 0,
        "requests_today": requests_today or 0,
    }


# ---------------- dashboard ----------------

@router.get("/", response_class=HTMLResponse)
async def dashboard(
    request: Request,
    user: User | None = Depends(current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    if user is None:
        return RedirectResponse("/login", status_code=303)

    keys = (
        await db.execute(
            select(ApiKey).where(ApiKey.user_id == user.id).order_by(ApiKey.id.asc())
        )
    ).scalars().all()

    active = [await _key_view(db, k) for k in keys if k.active]
    revoked = [await _key_view(db, k) for k in keys if not k.active]
    unread = await db.scalar(
        select(func.count(Alert.id)).where(Alert.user_id == user.id, Alert.read.is_(False))
    )

    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {"user": user, "active_keys": active, "revoked_keys": revoked, "unread": unread or 0},
    )


# ---------------- create ----------------

@router.get("/keys/new", response_class=HTMLResponse)
async def new_key_page(
    request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    return templates.TemplateResponse(
        request,
        "key_new.html",
        {
            "user": user,
            "providers": PROVIDERS,
            "suggested_alias": await _next_alias(db, user.id),
            "created": None,
            "error": None,
        },
    )


@router.post("/keys/new", response_class=HTMLResponse)
async def create_key(
    request: Request,
    secret: str = Form(...),
    provider: str = Form("openai"),
    label: str = Form(""),
    alias: str = Form(""),
    base_url: str = Form(""),
    passphrase: str = Form(""),
    rate_limit: int = Form(0),
    rate_window_seconds: int = Form(60),
    spend_cap_usd: float = Form(0.0),
    mode: str = Form("block"),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    alias = (alias or "").strip() or await _next_alias(db, user.id)
    error = None
    if not ALIAS_RE.match(alias):
        error = "Alias must be 2-32 characters: letters, numbers, dashes or underscores."
    elif (
        await db.execute(select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.alias == alias))
    ).scalar_one_or_none():
        error = f"You already have an alias called '{alias}'."
    elif not secret.strip():
        error = "Paste the provider API key."
    elif provider == "custom" and not base_url.strip():
        error = "A custom provider needs a base URL."

    if error:
        return templates.TemplateResponse(
            request,
            "key_new.html",
            {
                "user": user,
                "providers": PROVIDERS,
                "suggested_alias": alias,
                "created": None,
                "error": error,
            },
            status_code=400,
        )

    secret = secret.strip()
    key = ApiKey(
        user_id=user.id,
        alias=alias,
        label=label.strip(),
        provider=provider,
        base_url=base_url.strip(),
        secret_ciphertext=encrypt_secret(secret),
        secret_last4=secret[-4:],
        passphrase_hash=hash_secret(passphrase.strip()) if passphrase.strip() else None,
        active=True,
    )
    db.add(key)
    await db.flush()

    db.add(
        KeyLimit(
            api_key_id=key.id,
            rate_limit=max(0, rate_limit),
            rate_window_seconds=max(1, rate_window_seconds),
            rate_mode=mode,
            spend_cap_usd=max(0.0, spend_cap_usd),
            spend_mode=mode,
        )
    )
    await db.commit()
    await db.refresh(key)

    return templates.TemplateResponse(
        request,
        "key_new.html",
        {
            "user": user,
            "providers": PROVIDERS,
            "suggested_alias": await _next_alias(db, user.id),
            "created": key,
            "has_passphrase": bool(passphrase.strip()),
            "error": None,
        },
    )


# ---------------- test connection ----------------

@router.post("/api/keys/{alias}/test", response_class=HTMLResponse)
async def test_connection(
    request: Request,
    alias: str,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    key = await _owned_key(db, user, alias)
    if not key.active:
        return HTMLResponse(
            '<span class="badge badge-bad">Revoked &mdash; re-activate this alias first</span>'
        )

    base = resolve_base_url(key.provider, key.base_url)
    url = f"{base}{probe_path(key.provider)}"
    headers = auth_headers(key.provider, decrypt_secret(key.secret_ciphertext))

    started = datetime.now(timezone.utc)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        return HTMLResponse(
            f'<span class="badge badge-bad">Could not reach provider &mdash; {exc.__class__.__name__}</span>'
        )

    ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)

    db.add(
        KeyUsage(
            api_key_id=key.id,
            path=probe_path(key.provider),
            model="",
            status_code=response.status_code,
            cost_usd=0.0,
            latency_ms=ms,
            is_test=True,
            client_ip="dashboard",
        )
    )
    await db.commit()

    if response.status_code < 400:
        return HTMLResponse(
            f'<span class="badge badge-good">Success &mdash; provider responded '
            f'{response.status_code} in {ms}ms</span>'
        )

    detail = response.text[:180].replace("<", "&lt;")
    return HTMLResponse(
        f'<span class="badge badge-bad">Provider returned {response.status_code}</span>'
        f'<pre class="probe-error">{detail}</pre>'
    )


# ---------------- detail / settings ----------------

@router.get("/keys/{alias}", response_class=HTMLResponse)
async def key_detail(
    request: Request,
    alias: str,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    key = await _owned_key(db, user, alias)
    view = await _key_view(db, key)
    recent = (
        await db.execute(
            select(KeyUsage)
            .where(KeyUsage.api_key_id == key.id)
            .order_by(desc(KeyUsage.created_at))
            .limit(50)
        )
    ).scalars().all()
    key_alerts = (
        await db.execute(
            select(Alert)
            .where(Alert.api_key_id == key.id)
            .order_by(desc(Alert.created_at))
            .limit(20)
        )
    ).scalars().all()

    return templates.TemplateResponse(
        request,
        "key_detail.html",
        {"user": user, "view": view, "recent": recent, "alerts": key_alerts, "providers": PROVIDERS},
    )


@router.post("/keys/{alias}/limits")
async def update_limits(
    alias: str,
    rate_limit: int = Form(0),
    rate_window_seconds: int = Form(60),
    rate_mode: str = Form("block"),
    spend_cap_usd: float = Form(0.0),
    spend_mode: str = Form("block"),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    key = await _owned_key(db, user, alias)
    limit = (
        await db.execute(select(KeyLimit).where(KeyLimit.api_key_id == key.id))
    ).scalar_one_or_none()
    if limit is None:
        limit = KeyLimit(api_key_id=key.id)
        db.add(limit)

    limit.rate_limit = max(0, rate_limit)
    limit.rate_window_seconds = max(1, rate_window_seconds)
    limit.rate_mode = rate_mode
    limit.spend_cap_usd = max(0.0, spend_cap_usd)
    limit.spend_mode = spend_mode
    await db.commit()
    return RedirectResponse(f"/keys/{alias}", status_code=303)


@router.post("/keys/{alias}/passphrase")
async def update_passphrase(
    alias: str,
    passphrase: str = Form(""),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    key = await _owned_key(db, user, alias)
    key.passphrase_hash = hash_secret(passphrase.strip()) if passphrase.strip() else None
    await db.commit()
    return RedirectResponse(f"/keys/{alias}", status_code=303)


@router.post("/keys/{alias}/rename")
async def rename_alias(
    alias: str,
    new_alias: str = Form(...),
    label: str = Form(""),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    key = await _owned_key(db, user, alias)
    new_alias = new_alias.strip()
    if ALIAS_RE.match(new_alias):
        clash = (
            await db.execute(
                select(ApiKey).where(
                    ApiKey.user_id == user.id, ApiKey.alias == new_alias, ApiKey.id != key.id
                )
            )
        ).scalar_one_or_none()
        if clash is None:
            key.alias = new_alias
    key.label = label.strip()
    await db.commit()
    return RedirectResponse(f"/keys/{key.alias}", status_code=303)


# ---------------- soft delete ----------------

@router.post("/keys/{alias}/revoke")
async def revoke(
    alias: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    """Soft delete only: flip the flag, keep every usage row and alert."""
    key = await _owned_key(db, user, alias)
    key.active = False
    key.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    return RedirectResponse("/", status_code=303)


@router.post("/keys/{alias}/activate")
async def activate(
    alias: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    key = await _owned_key(db, user, alias)
    key.active = True
    key.revoked_at = None
    await db.commit()
    return RedirectResponse(f"/keys/{alias}", status_code=303)


@router.post("/keys/{alias}/rotate")
async def rotate(
    alias: str,
    secret: str = Form(...),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    key = await _owned_key(db, user, alias)
    secret = secret.strip()
    if secret:
        key.secret_ciphertext = encrypt_secret(secret)
        key.secret_last4 = secret[-4:]
        await db.commit()
    return RedirectResponse(f"/keys/{alias}", status_code=303)


@router.get("/keys/{alias}/curl", response_class=HTMLResponse)
async def curl_snippet(
    alias: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    key = await _owned_key(db, user, alias)
    base = settings.public_base_url.rstrip("/")
    token = f"{key.alias}<passphrase>" if key.passphrase_hash else key.alias
    return HTMLResponse(
        f"curl {base}/proxy/{key.alias}/v1/chat/completions "
        f'-H "Authorization: Bearer {token}"'
    )
