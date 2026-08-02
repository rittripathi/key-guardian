"""Provider registry: base URLs, auth headers, and cheap probe endpoints."""

PROVIDERS: dict[str, dict] = {
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com",
        "auth": "bearer",
        "probe": "/v1/models",
    },
    "anthropic": {
        "label": "Anthropic",
        "base_url": "https://api.anthropic.com",
        "auth": "x-api-key",
        "probe": "/v1/models",
        "extra_headers": {"anthropic-version": "2023-06-01"},
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api",
        "auth": "bearer",
        "probe": "/v1/models",
    },
    "groq": {
        "label": "Groq",
        "base_url": "https://api.groq.com/openai",
        "auth": "bearer",
        "probe": "/v1/models",
    },
    "custom": {
        "label": "Custom (OpenAI-compatible)",
        "base_url": "",
        "auth": "bearer",
        "probe": "/v1/models",
    },
}


def provider_config(provider: str) -> dict:
    return PROVIDERS.get(provider, PROVIDERS["custom"])


def resolve_base_url(provider: str, override: str) -> str:
    base = (override or "").strip() or provider_config(provider)["base_url"]
    return base.rstrip("/")


def auth_headers(provider: str, secret: str) -> dict[str, str]:
    cfg = provider_config(provider)
    headers: dict[str, str] = dict(cfg.get("extra_headers", {}))
    if cfg["auth"] == "x-api-key":
        headers["x-api-key"] = secret
    else:
        headers["Authorization"] = f"Bearer {secret}"
    return headers


def probe_path(provider: str) -> str:
    return provider_config(provider)["probe"]
