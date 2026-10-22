"""Fixtures for tests against a real, migrated Postgres.

Skipped unless QN_DB_TEST_URL points at a database with the migrations applied
(CI sets it after the "Apply migrations" step). The URL is an owner/superuser
connection: fixtures seed accounts with it, and the note store runs through an
engine that switches every connection to qn_runtime, so row-level security
really applies. A superuser would bypass RLS and the tests would prove nothing.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Any

import pytest
from app.config import Settings
from app.db import build_engine, get_session
from app.deps import get_auth_provider
from app.main import create_app
from app.notes import NoteStore
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from tests.conftest import FakeAuthProvider

DB_URL = os.environ.get("QN_DB_TEST_URL", "")

pytestmark = pytest.mark.db


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    skip = pytest.mark.skip(reason="set QN_DB_TEST_URL to run database tests")
    for item in items:
        if "tests/db/" in str(item.fspath).replace(os.sep, "/"):
            item.add_marker(pytest.mark.db)
            if not DB_URL:
                item.add_marker(skip)


@pytest.fixture
async def owner_engine() -> AsyncIterator[AsyncEngine]:
    engine = build_engine(DB_URL)
    yield engine
    await engine.dispose()


@pytest.fixture
async def runtime_engine() -> AsyncIterator[AsyncEngine]:
    engine = build_engine(DB_URL)

    @event.listens_for(engine.sync_engine, "connect")
    def _as_runtime(dbapi_connection: Any, _record: Any) -> None:
        # NullPool hands out a fresh connection after every commit, so the role
        # must be set on each new connection, not once per session.
        with dbapi_connection.cursor() as cursor:
            cursor.execute("set role qn_runtime")
        dbapi_connection.commit()

    yield engine
    await engine.dispose()


async def _seed_account(engine: AsyncEngine) -> uuid.UUID:
    auth_id = uuid.uuid4()
    async with engine.begin() as connection:
        await connection.execute(text("insert into auth.users (id) values (:id)"), {"id": auth_id})
        account_id = (
            await connection.execute(
                text("insert into app.users (auth_user_id) values (:id) returning id"),
                {"id": auth_id},
            )
        ).scalar_one()
    return uuid.UUID(str(account_id))


@pytest.fixture
async def account_a(owner_engine: AsyncEngine) -> uuid.UUID:
    return await _seed_account(owner_engine)


@pytest.fixture
async def account_b(owner_engine: AsyncEngine) -> uuid.UUID:
    return await _seed_account(owner_engine)


@pytest.fixture
async def runtime_session(runtime_engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    factory = async_sessionmaker(runtime_engine, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest.fixture
def store(runtime_session: AsyncSession) -> NoteStore:
    return NoteStore(runtime_session)


@pytest.fixture
async def make_store(runtime_engine: AsyncEngine) -> AsyncIterator[Callable[[], NoteStore]]:
    """A fresh store with its own session, like a separate request."""
    factory = async_sessionmaker(runtime_engine, expire_on_commit=False)
    sessions: list[AsyncSession] = []

    def _make() -> NoteStore:
        session = factory()
        sessions.append(session)
        return NoteStore(session)

    yield _make
    for session in sessions:
        await session.close()


# HTTP: the real app, signed in as account A, on the qn_runtime engine.


async def _auth_user_id(engine: AsyncEngine, account_id: uuid.UUID) -> str:
    async with engine.connect() as connection:
        value = (
            await connection.execute(
                text("select auth_user_id from app.users where id = :id"), {"id": account_id}
            )
        ).scalar_one()
    return str(value)


@pytest.fixture
async def signed_in_as_a(owner_engine: AsyncEngine, account_a: uuid.UUID) -> FakeAuthProvider:
    provider = FakeAuthProvider()
    provider.user_id = await _auth_user_id(owner_engine, account_a)
    return provider


@pytest.fixture
def api(
    settings: Settings, runtime_engine: AsyncEngine, signed_in_as_a: FakeAuthProvider
) -> Iterator[TestClient]:
    application = create_app(settings)
    application.dependency_overrides[get_auth_provider] = lambda: signed_in_as_a
    factory = async_sessionmaker(runtime_engine, expire_on_commit=False)

    async def _session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    application.dependency_overrides[get_session] = _session
    with TestClient(application) as client:
        yield client
