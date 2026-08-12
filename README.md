# KeyShort

Secure API key vault for AI applications. Instead of handing out real provider keys (OpenAI, Anthropic, etc.), you generate an **alias** (`key1`, `key2`, ...) and applications authenticate with that. KeyShort stores the real key encrypted, injects it at request time, and adds rate limiting, spend caps, and revocation on top.

**Live:** https://keyvault-2yfb.onrender.com/

## Why

If you hand your real API key to three different apps/scripts and it leaks, you have to rotate it everywhere. With KeyShort, apps only ever see an alias. If one is compromised, you revoke that alias — the real key and every other alias stay untouched.

## What it does

- **Alias-based routing** — real provider keys never leave the vault
- **Encrypted storage** — AES-256-GCM at rest, Argon2 for passphrase hashing
- **Rate limiting** — Redis-backed, fixed-window counters on the proxy hot path
- **Monthly spend caps** — stop a leaked/misused alias from running up a bill
- **Passphrase protection** — optional extra secret per alias
- **Soft revoke** — disable an alias instantly without deleting its usage history
- **Usage tracking** — per-alias request/spend history
- **Telegram alerts** — notified on leaks or spend threshold breaches

## How it works

A single FastAPI app serves both the dashboard (server-rendered Jinja2 + HTMX) and the proxy. On a proxied request:

1. Request hits `/proxy/<alias>/...` with the alias as the bearer token.
2. Redis checks the alias hasn't exceeded its rate limit (fixed-window).
3. Postgres is queried for the alias's hashed passphrase (Argon2, verified if set) and encrypted key.
4. The real key is decrypted in memory, the request is forwarded to the provider with it, and the response is streamed straight back (SSE-safe, so streaming completions aren't buffered).
5. Usage/spend logging happens asynchronously after the response completes, so it doesn't add latency to the request itself.

```
Client → FastAPI proxy → Postgres (encrypted keys) + Redis (rate limits) → provider (OpenAI / Anthropic / etc.)
```

## Usage

**curl:**
```bash
curl https://<your-app>/proxy/key2/v1/chat/completions \
  -H "Authorization: Bearer key2" \
  -H "Content-Type: application/json" \
  -d '{
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "Hello"}]
      }'
```

**OpenAI SDK:**
```python
from openai import OpenAI

client = OpenAI(
    api_key="key2",
    base_url="https://<your-app>/proxy/key2/v1"
)
```

Everything after `/proxy/<alias>/` is forwarded as-is to the underlying provider — so any provider-compatible SDK works, just point `base_url` at your alias.

## Tech stack

| Layer | Tech |
|---|---|
| Backend | FastAPI |
| Templates | Jinja2 + HTMX |
| Database | PostgreSQL (Neon) |
| Cache / rate limiting | Redis |
| ORM | SQLAlchemy |
| Encryption | AES-256-GCM (keys) + Argon2 (passphrases) |
| Migrations | Alembic |
| Deployment | Render |

## Running locally

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env        # fill in the values below
python -m app.security       # generates ENCRYPTION_KEY if needed
alembic upgrade head

uvicorn app.main:app --reload
```

Then visit `http://localhost:8000`.

You'll need Postgres and Redis reachable locally (or point `DATABASE_URL` / `REDIS_URL` at hosted free-tier instances — Neon and Upstash/Redis Cloud both work).

## Environment variables

```
DATABASE_URL          # Postgres connection string
REDIS_URL              # Redis connection string
ENCRYPTION_KEY          # AES-256-GCM key for encrypting stored provider keys
PUBLIC_BASE_URL          # public URL of this deployment, used in proxy URLs
TELEGRAM_BOT_TOKEN         # optional, for leak/spend alerts
TELEGRAM_CHAT_ID          # optional, for leak/spend alerts
```

## Deploying

Deployed on Render with Neon Postgres and Redis. `render.yaml` defines the service; migrations run automatically via Alembic on deploy.

## Project structure

```
backend/
├── app/
│   ├── main.py
│   ├── models.py
│   ├── security.py     # encryption, passphrase hashing
│   ├── cache.py         # Redis rate limiting
│   ├── pricing.py       # per-provider cost calculation
│   ├── usage.py         # async usage/spend logging
│   ├── providers.py       # provider request forwarding
│   ├── notify.py        # Telegram alerts
│   ├── routers/
│   └── templates/
├── migrations/          # Alembic
├── scripts/
└── render.yaml
```

## Roadmap

- OAuth login
- Team workspaces
- Multi-provider support in a single alias (fallback/load balancing)
- Audit logs
- Webhooks
- Python/JS client SDKs
