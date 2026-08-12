# KeyShort (Node.js / Express port)

> Secure API Key Management for AI Applications

This is a full backend rewrite of the original **FastAPI + SQLAlchemy** KeyShort
service in **Node.js + Express**. Same behavior, same database shape, same
routes — different runtime.

KeyShort lets applications authenticate with **aliases** (`key1`, `key2`, …)
instead of real provider secrets. It proxies requests to OpenAI/Anthropic/
Groq/OpenRouter/any OpenAI-compatible API, decrypting the real key
server-side, while adding rate limiting, monthly spend caps, passphrase
protection, usage tracking, and instant revocation.

## Tech stack

| Layer          | Original (Python)         | This port (Node.js)              |
|----------------|----------------------------|-----------------------------------|
| Web framework  | FastAPI + uvicorn          | Express 4                         |
| Templates      | Jinja2 + HTMX               | Nunjucks (same syntax) + HTMX     |
| ORM            | SQLAlchemy (async)          | Sequelize                         |
| DB driver      | asyncpg                     | pg (node-postgres)                |
| Migrations     | Alembic                     | Plain `.sql` files + small runner |
| Cache          | redis-py (async)            | ioredis                           |
| Password hash  | argon2-cffi                 | argon2 (node-argon2)              |
| Encryption     | `cryptography` AES-256-GCM  | Node `crypto` AES-256-GCM         |
| Sessions       | itsdangerous signed cookie  | Hand-rolled HMAC-signed cookie    |
| HTTP client (proxy) | httpx (streaming)      | native `fetch` (streaming)        |
| Deployment     | Render                      | Render                            |

## Project layout

```
server.js              entry point
src/
  app.js               Express app factory, middleware wiring, error handler
  config.js             env var loading (mirrors config.py)
  db.js                  Sequelize connection (mirrors db.py)
  cache.js               Redis counters (mirrors cache.py)
  security.js            AES-256-GCM, Argon2, signed session cookies (mirrors security.py)
  providers.js            provider registry (mirrors providers.py)
  pricing.js               cost estimation (mirrors pricing.py)
  notify.js                 Alert creation + Telegram (mirrors notify.py)
  usage.js                   pre-check helpers (mirrors usage.py)
  templating.js               Nunjucks setup + money/since filters (mirrors templating.py)
  httpError.js                 HTTPException-equivalent
  models/                       Sequelize models (mirrors models.py)
  middleware/auth.js             session/auth middleware (mirrors deps.py)
  middleware/asyncHandler.js      forwards async route errors to Express
  routes/                          health, auth, keys, alerts, proxy routers
views/                                  Nunjucks templates (ported from Jinja2)
migrations/                              raw SQL, applied by scripts/migrate.js
scripts/                                  migrate.js, generate-key.js, keepalive.js
```

## Setup

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL, REDIS_URL, SECRET_KEY, ...
npm run generate-key        # prints a value for ENCRYPTION_KEY — paste into .env
npm run migrate              # creates the schema
npm start                     # or: npm run dev  (auto-restart on change)
```

Requires Node 18+ (uses the global `fetch`/`AbortController`; developed and
tested against Node 22).

## Notes on the port

- **Aliases are globally unique**, not per-user — `/proxy/{alias}/...` has no
  user context to scope by. This matches migration `0002` in the original app.
- **The proxy route bypasses the dashboard's session/body-parsing
  middleware entirely** and gets its own raw-body parser scoped to `/proxy`,
  so arbitrary request bodies (any content type, streaming SSE responses)
  pass through untouched. It also carries a two-phase timeout — 10s to
  establish the upstream connection, then up to 600s of *inactivity* between
  streamed chunks — matching the original's `httpx.AsyncClient` timeout
  profile so long-running completions aren't killed early.
- **Password/passphrase verification uses async Argon2** (`argon2.verify`),
  whereas the original Python code called its Argon2 verify synchronously
  (blocking the event loop briefly on every check). This port always awaits
  it, which is both more correct for Node's single-threaded event loop and a
  minor performance improvement.
- **Estimated costs are clearly labeled as estimates in the UI.** Token-based
  cost estimation (`src/pricing.js`) uses a hardcoded price table and prefix
  matching — it's a reasonable approximation, not your exact provider
  invoice. The dashboard and key detail page now show a tooltip disclaimer
  next to every "Spend this month" and "Cost" figure.
- **No auto-generated API docs.** FastAPI derives Swagger/OpenAPI docs from
  Pydantic models automatically; Express has no equivalent without adding
  and maintaining separate OpenAPI annotations, which was out of scope here.
- Existing Python-side password hashes and encrypted secrets **will not
  carry over** — this is a new service with its own `SECRET_KEY` and
  `ENCRYPTION_KEY`. Point it at a fresh database (the migrations create the
  schema from scratch) rather than an existing Python-managed one.

## Deploying (Render)

`render.yaml` is included, updated for the Node runtime — `npm install` to
build, `npm run migrate && npm start` to launch the web service, and a
`npm run keepalive` cron job every 10 minutes (pings `/healthz` so the free
tier doesn't spin down, and reconciles Redis's cached monthly spend against
Postgres).

## A note on testing

This port was written and reviewed carefully — every relative `require()`
path and every module was syntax-checked, the pure-logic pieces (pricing,
AES-256-GCM round-tripping, the signed session cookie) were unit-tested
directly, and every route/template was cross-checked line-by-line against
the original Python source. It has **not** been run end-to-end against a
real Postgres + Redis instance, since that requires `npm install` against
the network. Before deploying, run through the core flows once yourself
(register → create a key → test connection → proxy a real request → check
usage/alerts show up) to be sure.
