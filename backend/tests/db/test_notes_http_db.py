"""The notes API end to end: real routers, real Postgres, running as qn_runtime."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Iterator

import pytest
from app.config import Settings
from app.db import get_session
from app.deps import get_auth_provider
from app.main import create_app
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from tests.conftest import ALLOWED_ORIGIN, FakeAuthProvider

SESSION = {
    "Cookie": "qn_at=access-1; qn_csrf=csrf-1",
    "Origin": ALLOWED_ORIGIN,
    "x-csrf-token": "csrf-1",
}


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


def test_capture_round_trip(api: TestClient) -> None:
    note_id = str(uuid.uuid4())
    payload = {"id": note_id, "body": "ဈေးဝယ်ရန် rice + eggs", "source": "extension"}

    created = api.post("/v1/notes", json=payload, headers=SESSION)
    retried = api.post("/v1/notes", json=payload, headers=SESSION)
    listed = api.get("/v1/notes", headers=SESSION)
    found = api.get("/v1/notes", params={"q": "ဈေးဝယ်"}, headers=SESSION)
    edited = api.patch(
        f"/v1/notes/{note_id}", json={"body": "edited", "base_version": 1}, headers=SESSION
    )
    stale = api.patch(
        f"/v1/notes/{note_id}", json={"body": "stale", "base_version": 1}, headers=SESSION
    )
    deleted = api.delete(f"/v1/notes/{note_id}", headers=SESSION)
    after = api.get(f"/v1/notes/{note_id}", headers=SESSION)

    assert created.status_code == 201, created.text
    assert retried.status_code == 200
    assert retried.json() == created.json()
    assert [item["id"] for item in listed.json()["items"]] == [note_id]
    assert len(found.json()["items"]) == 1
    assert edited.json()["version"] == 2
    assert stale.status_code == 409
    assert stale.json()["current"]["body"] == "edited"
    assert deleted.status_code == 204
    assert after.status_code == 404
