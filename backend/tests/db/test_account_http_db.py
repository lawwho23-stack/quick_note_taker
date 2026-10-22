"""Extension connect, export and account deletion end to end, on real Postgres."""

from __future__ import annotations

import uuid

import pytest
from app.config import Settings
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import ALLOWED_ORIGIN, FakeAuthProvider

SESSION = {
    "Cookie": "qn_at=access-1; qn_csrf=csrf-1",
    "Origin": ALLOWED_ORIGIN,
    "x-csrf-token": "csrf-1",
}


def test_extension_token_life_cycle(api: TestClient) -> None:
    created = api.post("/v1/extension-tokens", json={"label": "Chrome"}, headers=SESSION)
    assert created.status_code == 201, created.text
    secret = created.json()["token"]
    bearer = {"Authorization": f"Bearer {secret}"}

    status = api.get("/v1/extension/status", headers=bearer)
    note_id = str(uuid.uuid4())
    saved = api.post(
        "/v1/notes", json={"id": note_id, "body": "ဈေး", "source": "web"}, headers=bearer
    )
    read_back = api.get(f"/v1/notes/{note_id}", headers=SESSION)
    listed = api.get("/v1/extension-tokens", headers=SESSION)
    denied = api.get("/v1/notes", headers=bearer)
    revoked = api.delete(f"/v1/extension-tokens/{created.json()['id']}", headers=SESSION)
    after = api.get("/v1/extension/status", headers=bearer)

    assert status.json() == {"status": "connected"}
    assert saved.status_code == 201, saved.text
    assert "body" not in saved.json()
    assert read_back.json()["source"] == "extension"
    assert listed.json()["items"][0]["last_used_at"] is not None
    assert secret not in listed.text
    assert denied.status_code == 403
    assert revoked.status_code == 204
    assert after.status_code == 401
    assert after.json()["error"]["code"] == "token_revoked"


def test_export_round_trip(api: TestClient) -> None:
    for body in ("one", "two"):
        api.post("/v1/notes", json={"id": str(uuid.uuid4()), "body": body}, headers=SESSION)

    exported = api.get("/v1/export", headers=SESSION)
    markdown = api.get("/v1/export", params={"format": "markdown"}, headers=SESSION)

    assert exported.status_code == 200
    assert [note["body"] for note in exported.json()["notes"]] == ["one", "two"]
    assert markdown.text.count("\n---\n") == 1


def test_delete_account_removes_everything(
    api: TestClient,
    settings: Settings,
    signed_in_as_a: FakeAuthProvider,
    owner_engine: AsyncEngine,
    account_a: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings.supabase_service_role_key = "service-role-key"

    async def delete_auth_user(auth_user_id: str) -> None:
        # What the Supabase admin API does: delete the auth user, so the cascade runs.
        async with owner_engine.begin() as connection:
            await connection.execute(
                text("delete from auth.users where id = :id"), {"id": auth_user_id}
            )

    monkeypatch.setattr(signed_in_as_a, "delete_user", delete_auth_user)
    api.post("/v1/notes", json={"id": str(uuid.uuid4()), "body": "x"}, headers=SESSION)
    api.post("/v1/extension-tokens", json={}, headers=SESSION)

    response = api.request("DELETE", "/v1/me", json={"confirm": "DELETE"}, headers=SESSION)

    assert response.status_code == 204, response.text
    assert api.get("/v1/me", headers=SESSION).json()["error"]["code"] == "account_not_found"
