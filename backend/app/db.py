from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

_url = settings.normalized_database_url()
_kwargs: dict = {"pool_pre_ping": True}
if _url.startswith("postgresql"):
    _kwargs.update(pool_size=5, max_overflow=5)
    if "neon.tech" in settings.database_url:
        _kwargs["connect_args"] = {"ssl": True}

engine = create_async_engine(_url, **_kwargs)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
