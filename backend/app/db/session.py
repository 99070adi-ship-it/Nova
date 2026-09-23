import json
import sys
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings

settings = get_settings()


def json_serializer(value: object) -> str:
    return json.dumps(value, default=str)


# Under pytest, each test function runs on its own asyncio event loop, but this module-level
# engine is created once at import time. A pooled connection created under one test's loop can't
# be reused under a later test's loop. NullPool opens a fresh connection per checkout instead of
# reusing one from a pool, sidestepping that.
if "pytest" in sys.modules:
    engine = create_async_engine(settings.database_url, poolclass=NullPool, json_serializer=json_serializer)
else:
    engine = create_async_engine(
        settings.database_url, pool_size=10, max_overflow=5, pool_pre_ping=True, json_serializer=json_serializer
    )

AsyncSessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session
