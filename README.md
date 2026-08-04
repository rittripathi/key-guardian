# KeyShort

> Secure API Key Management for AI Applications

KeyShort is a FastAPI-based API key vault that lets applications authenticate using **aliases** (`key1`, `key2`, …) instead of real provider secrets. It adds rate limiting, monthly spending caps, passphrase protection, usage tracking, and instant key revocation without requiring applications to rotate API keys.

**Live Demo:** https://keyvault-2yfb.onrender.com/

---

## Why KeyShort?

Sharing API keys across multiple applications is risky.

If a provider key is leaked, every application using that key must be updated after rotation.

KeyShort solves this by introducing an **alias layer**.

Instead of exposing provider secrets, applications authenticate using aliases while KeyShort securely stores and injects the real API key during request forwarding.


| Feature | Description |
|---------|-------------|
| Alias-based routing | Never expose provider keys |
| AES-256 Encryption | Secrets encrypted at rest |
| Monthly spend caps | Prevent unexpected bills |
| Rate limiting | Redis-backed hot path |
| Passphrase protection | Extra security per alias |
| Telegram alerts | Leak and spend notifications |
| Usage tracking | Historical analytics |
| Soft revoke | Disable aliases without deleting history |


<img width="1499" height="387" alt="image" src="https://github.com/user-attachments/assets/fba0c0f7-bb23-4c08-ad04-1c670d21e879" />



One FastAPI process serves both the dashboard (server-rendered Jinja2 + HTMX) and the proxy. Postgres on Neon, Redis for the hot-path counters, deployed on Render.

## Tech Stack

| Layer | Technology |
|--------|------------|
| Backend | FastAPI |
| Templates | Jinja2 + HTMX |
| Database | PostgreSQL (Neon) |
| Cache | Redis |
| ORM | SQLAlchemy |
| Authentication | Secure Sessions |
| Encryption | AES-256-GCM + Argon2 |
| Deployment | Render |
| Migrations | Alembic |

---

# Screenshots

## Add New Key

> <img width="1904" height="748" alt="image" src="https://github.com/user-attachments/assets/0950d371-c887-4fdf-b9dd-7ac6246e6bc1" />

![Dashboard](docs/dashboard.png)

---

## API Keys Dashboard

><img width="1064" height="765" alt="image" src="https://github.com/user-attachments/assets/33ee9037-77c2-4487-a43d-23f884db8588" />
![Keys](docs/keys.png)

---


# Architecture

```
                Client

                   │

                   ▼

             FastAPI Proxy

                   │

        ┌──────────┴──────────┐

        ▼                     ▼

 PostgreSQL               Redis

        │

        ▼

 OpenAI / Anthropic / Gemini
```

---

# Request Flow
```mermaid
flowchart TD
    %% Client Layer
    Client(["📱 / 💻 Client Application"])

    %% KeyVault Core Proxy Subgraph
    subgraph KeyVault [" KeyVault Reverse Proxy Engine (FastAPI) "]
        Router["1. Proxy Router Endpoint\n(/v1/chat/completions)"]
        RateLimit["2. Rate Limiter & Budget Guard\n(app/deps.py)"]
        AuthEngine["3. Cryptographic Auth Engine\n(app/security.py)"]
        StreamEngine["4. Async SSE Streaming Engine\n(app/routers/proxy.py)"]
    end

    %% Storage Layer Subgraph
    subgraph Storage [" Data & Cache Layer "]
        Redis[("⚡ Redis (RAM)\n• Rate Limit Counters\n• TTL Window Timers")]
        Postgres[("🐘 PostgreSQL DB\n• AES-256 Encrypted Keys\n• Argon2 Hashing")]
    end

    %% Upstream Providers Subgraph
    subgraph Upstream [" Upstream LLM Providers "]
        Providers["OpenAI | Anthropic | Groq | OpenRouter"]
    end

    %% Data Flow Connections
    Client -->|"POST Request\n(Alias + Passphrase + Prompt)"| Router
    Router -->|"Verify Limit"| RateLimit
    
    RateLimit <-->|"Atomic INCR & Check Window"| Redis
    
    RateLimit -->|"Pass (If under limit)"| AuthEngine
    AuthEngine <-->|"Fetch Hash & Ciphertext"| Postgres
    
    AuthEngine -->|"Verify Argon2 & Decrypt AES-256 (In-Memory RAM)"| StreamEngine
    
    StreamEngine -->|"Forward API Request\n(Bearer Bearer upstream_key)"| Providers
    Providers -.->|"Return Streaming Tokens"| StreamEngine
    StreamEngine -.->|"Forward Chunks SSE (Preserving TTFT)"| Client

    %% Flow Rejection Path
    RateLimit -- "Exceeded Limit" --> Block["⛔ 429 Too Many Requests"]

    %% Custom Styling
    classDef main fill:#1e293b,stroke:#475569,color:#fff
    classDef store fill:#065f46,stroke:#059669,color:#fff
    classDef provider fill:#4c1d95,stroke:#6d28d9,color:#fff
    classDef block fill:#881337,stroke:#f43f5e,color:#fff
    
    class Router,RateLimit,AuthEngine,StreamEngine main
    class Redis,Postgres store
    class Providers provider
    class Block block
```

Only lightweight validation happens before forwarding the request.

Usage tracking, spend calculation, alerts, and analytics execute asynchronously after the provider response has completed.

---

# Usage

Using curl

```bash
curl https://<your-app>/proxy/key2/v1/chat/completions \
  -H "Authorization: Bearer key2" \
  -H "Content-Type: application/json" \
  -d '{
        "model":"gpt-4o-mini",
        "messages":[
          {
            "role":"user",
            "content":"Hello"
          }
        ]
      }'
```

Using the OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="key2",
    base_url="https://<your-app>/proxy/key2/v1"
)
```

Everything after `/proxy/<alias>/` is forwarded directly to the provider.

---

# Local Development

```bash
cd backend

python -m venv .venv

source .venv/bin/activate

pip install -r requirements.txt

cp .env.example .env

python -m app.security

alembic upgrade head

uvicorn app.main:app --reload
```

Visit

```
http://localhost:8000
```

---

# Deploy

The application is deployed using:

- Neon PostgreSQL
- Redis
- Render

Environment variables

```
DATABASE_URL

REDIS_URL

ENCRYPTION_KEY

PUBLIC_BASE_URL

TELEGRAM_BOT_TOKEN

TELEGRAM_CHAT_ID
```

Schema migrations are applied automatically during deployment using Alembic.

---

# Project Structure

```
backend/

├── app/

│   ├── main.py

│   ├── models.py

│   ├── security.py

│   ├── cache.py

│   ├── pricing.py

│   ├── usage.py

│   ├── providers.py

│   ├── notify.py

│   ├── routers/

│   └── templates/

├── migrations/

├── scripts/

└── render.yaml
```

---

# Future Improvements

- OAuth login
- Team workspaces
- API analytics dashboard
- Multiple provider support
- Audit logs
- Webhooks
- SDK for Python and JavaScript
- Kubernetes deployment

---
