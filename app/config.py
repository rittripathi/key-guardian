from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Postgres (Neon). Use the async driver.
    database_url: str = "postgresql+asyncpg://user:pass@localhost:5432/keyshort"
    redis_url: str = "redis://localhost:6379/0"

    # 32+ random chars, signs the session cookie
    secret_key: str = "change-me-please-change-me-please"
    # base64-encoded 32 bytes, encrypts stored provider keys
    encryption_key: str = ""

    # Public base URL of this service, used to build curl snippets
    public_base_url: str = "http://localhost:8000"

    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    session_cookie: str = "keyshort_session"
    session_max_age: int = 60 * 60 * 24  # 24h — was 14 days; tighter for a service holding decrypted keys

    # When true, the proxy hot path returns X-Vault-*-Ms timing headers.
    # Off by default: these are internal diagnostics, not something to leak
    # to every caller. Flip on in Render's env vars only while benchmarking.
    debug_timing: bool = False

    def normalized_database_url(self) -> str:
        url = self.database_url
        # Neon/Render usually hand out a sync-style URL; upgrade it.
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        if url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://") :]
        # asyncpg does not accept libpq query args
        for bad in ("?sslmode=require", "&sslmode=require", "?channel_binding=require", "&channel_binding=require"):
            url = url.replace(bad, "")
        return url

    def sync_database_url(self) -> str:
        return self.normalized_database_url().replace("+asyncpg", "")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()