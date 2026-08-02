"""The proxy hot path.

Flow (nothing blocking sits between the pre-checks and the provider call):

    resolve alias -> active? -> passphrase? -> Redis rate -> cached spend
    -> forward -> stream back -> BackgroundTask does all accounting
"""

import logging
import time
import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from app import cache, pricing
from app.db import SessionLocal, get_db
from app.models import ApiKey, KeyLimit, KeyUsage
from app.notify import notify
from app.providers import auth_headers, resolve_base_url
from app.security import decrypt_secret, verify_secret
from app.usage import cached_spend, load_key_by_alias, load_limit, precheck

log = logging.getLogger("keyshort.proxy")
router = APIRouter(tags=["proxy"])

# One shared client for the whole process: connection reuse keeps latency down.
_client: httpx.AsyncClient | None = None

# Response bytes buffered for cost parsing. Beyond this we fall back to a flat cost.
MAX_CAPTURE = 512 * 1024

HOP_BY_HOP = {
    "host",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "authorization",
    "x-api-key",
    "cookie",
}


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=600.0, write=60.0, pool=10.0),
            limits=httpx.Limits(max_connections=200, max_keepalive_connections=50),
            follow_redirects=False,
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def split_token(raw: str) -> str:
    token = (raw or "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


async def record_usage(
    *,
    api_key_id: int,
    user_id: int,
    alias: str,
    path: str,
    status_code: int,
    body: bytes,
    latency_ms: int,
    client_ip: str,
    is_test: bool = False,
) -> None:
    """Runs after the response is fully delivered. Never touches the client's latency."""
    try:
        model, prompt_tokens, completion_tokens = pricing.parse_usage(body)
        cost = 0.0 if is_test else pricing.estimate_cost(
            model, prompt_tokens, completion_tokens, status_code
        )

        async with SessionLocal() as db:
            db.add(
                KeyUsage(
                    api_key_id=api_key_id,
                    path=path[:255],
                    model=model[:120],
                    status_code=status_code,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    cost_usd=cost,
                    latency_ms=latency_ms,
                    is_test=is_test,
                    client_ip=client_ip[:64],
                )
            )
            await db.commit()

            limit = await load_limit(db, api_key_id)

            if limit is not None and limit.rate_limit > 0:
                used = await cache.bump_rate(api_key_id, limit.rate_window_seconds)
                if used > limit.rate_limit and await cache.alert_once(f"rate:{api_key_id}", 900):
                    await notify(
                        db,
                        user_id=user_id,
                        api_key_id=api_key_id,
                        kind="rate_spike",
                        severity="warning",
                        message=(
                            f"Alias <b>{alias}</b> exceeded its rate limit "
                            f"({used}/{limit.rate_limit} per {limit.rate_window_seconds}s)."
                        ),
                    )

            if cost > 0:
                total = await cache.add_spend(api_key_id, cost)
                if limit is not None and limit.spend_cap_usd > 0:
                    ratio = total / limit.spend_cap_usd
                    if ratio >= 1.0 and await cache.alert_once(f"spend100:{api_key_id}", 86400):
                        await notify(
                            db,
                            user_id=user_id,
                            api_key_id=api_key_id,
                            kind="spend_100",
                            severity="critical",
                            message=(
                                f"Alias <b>{alias}</b> hit its ${limit.spend_cap_usd:.2f} "
                                f"monthly cap (${total:.2f} spent). "
                                + ("Further calls are blocked." if limit.spend_mode == "block" else "Notify-only mode.")
                            ),
                        )
                    elif ratio >= 0.8 and await cache.alert_once(f"spend80:{api_key_id}", 86400):
                        await notify(
                            db,
                            user_id=user_id,
                            api_key_id=api_key_id,
                            kind="spend_80",
                            severity="warning",
                            message=(
                                f"Alias <b>{alias}</b> is at {ratio * 100:.0f}% of its "
                                f"${limit.spend_cap_usd:.2f} monthly cap (${total:.2f})."
                            ),
                        )
    except Exception as exc:  # noqa: BLE001 - accounting must never surface to the caller
        log.exception("usage accounting failed: %s", exc)


async def report_auth_failure(api_key_id: int, user_id: int, alias: str) -> None:
    count = await cache.bump_auth_failures(api_key_id)
    if count >= 5 and await cache.alert_once(f"authfail:{api_key_id}", 1800):
        async with SessionLocal() as db:
            await notify(
                db,
                user_id=user_id,
                api_key_id=api_key_id,
                kind="auth_failures",
                severity="critical",
                message=(
                    f"{count} failed passphrase attempts on alias <b>{alias}</b> "
                    "in the last 10 minutes. The alias may be leaked."
                ),
            )


async def forward(
    request: Request,
    key: ApiKey,
    limit: KeyLimit | None,
    upstream_path: str,
    body: bytes,
    *,
    is_test: bool = False,
) -> StreamingResponse | JSONResponse:
    base_url = resolve_base_url(key.provider, key.base_url)
    if not base_url:
        return JSONResponse(
            {"error": {"message": f"Alias '{key.alias}' has no base URL configured."}},
            status_code=500,
        )

    url = f"{base_url}/{upstream_path.lstrip('/')}"
    headers = {k.lower(): v for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP}
    headers.update(auth_headers(key.provider, decrypt_secret(key.secret_ciphertext)))
    headers["accept-encoding"] = "identity" # <-- Forces upstream to send plain UTF-8 text

    client = get_client()
    started = time.perf_counter()
    client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "")

    upstream_request = client.build_request(
        request.method,
        url,
        headers=headers,
        content=body or None,
        params=dict(request.query_params),
    )

    try:
        upstream = await client.send(upstream_request, stream=True)
    except httpx.HTTPError as exc:
        return JSONResponse(
            {"error": {"message": f"Upstream request failed: {exc}"}}, status_code=502
        )

    captured = bytearray()

    async def body_iterator():
        try:
            async for chunk in upstream.aiter_bytes(): # <-- Auto-decompresses if upstream sends gzip
                if len(captured) < MAX_CAPTURE:
                    captured.extend(chunk[: MAX_CAPTURE - len(captured)])
                yield chunk
        finally:
            await upstream.aclose()

    def accounting() -> BackgroundTask:
        latency_ms = int((time.perf_counter() - started) * 1000)
        return BackgroundTask(
            record_usage,
            api_key_id=key.id,
            user_id=key.user_id,
            alias=key.alias,
            path=upstream_path,
            status_code=upstream.status_code,
            body=bytes(captured),
            latency_ms=latency_ms,
            client_ip=client_ip,
            is_test=is_test,
        )

    passthrough = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() not in {"content-encoding", "content-length", "transfer-encoding", "connection"}
    }

    return StreamingResponse(
        body_iterator(),
        status_code=upstream.status_code,
        headers=passthrough,
        background=accounting(),
    )


@router.get("/proxy/{alias}/status")
async def alias_status(alias: str, db: AsyncSession = Depends(get_db)):
    key = await load_key_by_alias(db, alias)
    if key is None:
        return JSONResponse({"error": {"message": "Unknown alias."}}, status_code=404)
    limit = await load_limit(db, key.id)
    return {
        "alias": key.alias,
        "active": key.active,
        "provider": key.provider,
        "spend_this_month": round(await cached_spend(db, key.id), 4),
        "spend_cap_usd": limit.spend_cap_usd if limit else 0,
        "rate_limit": limit.rate_limit if limit else 0,
    }


@router.api_route(
    "/proxy/{alias}/{upstream_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
)
async def proxy(
    alias: str,
    upstream_path: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    token = split_token(
        request.headers.get("authorization") or request.headers.get("x-api-key") or ""
    )

    # 1. Resolve the alias. The path segment wins; the token may carry alias+passphrase.
    key = await load_key_by_alias(db, alias)
    if key is None:
        return JSONResponse({"error": {"message": f"Unknown alias '{alias}'."}}, status_code=404)

    # 2. Soft delete: revoked keys stop here, history stays intact.
    if not key.active:
        return JSONResponse(
            {"error": {"message": f"Alias '{alias}' has been revoked."}}, status_code=403
        )

    # 3. Optional passphrase: caller must send "<alias><passphrase>" as the token.
    if key.passphrase_hash:
        if not token.startswith(key.alias):
            await report_auth_failure(key.id, key.user_id, key.alias)
            return JSONResponse(
                {"error": {"message": "This alias requires a passphrase: send '<alias><passphrase>'."}},
                status_code=401,
            )
        supplied = token[len(key.alias) :]
        if not supplied or not verify_secret(key.passphrase_hash, supplied):
            await report_auth_failure(key.id, key.user_id, key.alias)
            return JSONResponse(
                {"error": {"message": "Invalid passphrase for this alias."}}, status_code=401
            )

    # 4 + 5. Redis-only pre-checks.
    limit = await load_limit(db, key.id)
    denied = await precheck(db, key, limit)
    if denied is not None:
        return JSONResponse(
            {"error": {"message": denied.reason, "type": "keyshort_limit"}},
            status_code=denied.status_code,
        )

    body = await request.body()
    return await forward(request, key, limit, upstream_path, body)
