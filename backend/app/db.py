"""Database engine and session management.

Vercel functions are short-lived and Supabase's transaction pooler (port 6543)
does not support prepared statements, so the engine uses NullPool and disables
psycopg's statement preparation (prepare_threshold=None).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from fastapi import Depends
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import Settings, as_sqlalchemy_url, get_settings


class Base(DeclarativeBase):
    """Declarative base for tables in the private `app` schema."""


def build_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(
        as_sqlalchemy_url(database_url),
        poolclass=NullPool,
        connect_args={"prepare_threshold": None},
        # Keep bound values (note bodies) out of error messages, logs and Sentry.
        hide_parameters=True,
    )


@lru_cache(maxsize=4)
def engine_for(database_url: str) -> AsyncEngine:
    return build_engine(database_url)


def _require_url(settings: Settings) -> str:
    url = settings.runtime_database_uri
    if not url:
        raise RuntimeError("No database URL configured (set RUNTIME_DATABASE_URL or DATABASE_URL).")
    return url


def get_engine(settings: Settings = Depends(get_settings)) -> AsyncEngine:
    return engine_for(_require_url(settings))


async def get_session(settings: Settings = Depends(get_settings)) -> AsyncIterator[AsyncSession]:
    factory = async_sessionmaker(engine_for(_require_url(settings)), expire_on_commit=False)
    async with factory() as session:
        yield session
