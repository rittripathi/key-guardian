import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.cache import close_redis
from app.routers import alerts, auth, health, keys, proxy
from app.templating import templates

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await proxy.close_client()
    await close_redis()


app = FastAPI(title="KeyShort", docs_url="/api/docs", lifespan=lifespan)

app.include_router(health.router)
app.include_router(proxy.router)
app.include_router(auth.router)
app.include_router(keys.router)
app.include_router(alerts.router)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code == 401 and not request.url.path.startswith(("/proxy", "/api")):
        return RedirectResponse("/login", status_code=303)
    if request.url.path.startswith(("/proxy", "/api")):
        return JSONResponse({"error": {"message": exc.detail}}, status_code=exc.status_code)
    return templates.TemplateResponse(
        request,
        "error.html",
        {"status_code": exc.status_code, "detail": exc.detail},
        status_code=exc.status_code,
    )
