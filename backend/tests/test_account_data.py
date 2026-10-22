"""Export, account deletion, and the Supabase admin delete call."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from app.config import Settings
from app.errors import ApiError
from app.models import Note, User
from app.notes import get_note_store
from app.supabase_auth import SupabaseAuth
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import FakeAuthProvider, FakeDbSession, make_account
from tests.test_notes_api import SESSION, FakeNoteStore


@pytest.fixture
def account(fake_db: FakeDbSession) -> User:
    fake_db.account = make_account()
    return fake_db.account


@pytest.fixture
def notes(app: FastAPI, account: User) -> FakeNoteStore:
    store = FakeNoteStore()
    base = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)
    for offset, body in ((2, "third"), (0, "first"), (1, "second"), (3, "deleted")):
        note = Note(
            id=uuid.uuid4(),
            user_id=account.id,
            body=body,
            version=1,
            source="web",
            meta={},
            payload_hash="h",
            created_at=base + timedelta(hours=offset),
            updated_at=base,
            deleted_at=base if body == "deleted" else None,
        )
        store.notes[note.id] = note
    other = make_account()
    stranger = Note(
        id=uuid.uuid4(),
        user_id=other.id,
        body="someone else",
        version=1,
        source="web",
        meta={},
        payload_hash="h",
        created_at=base,
        updated_at=base,
        deleted_at=None,
    )
    store.notes[stranger.id] = stranger
    app.dependency_overrides[get_note_store] = lambda: store
    return store


def test_json_export_is_an_attachment_oldest_first(
    client: TestClient, notes: FakeNoteStore
) -> None:
    response = client.get("/v1/export", headers=SESSION)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    today = datetime.now(UTC).date().isoformat()
    assert response.headers["content-disposition"] == (
        f'attachment; filename="quick-note-export-{today}.json"'
    )
    body = response.json()
    assert body["count"] == 3
    assert [note["body"] for note in body["notes"]] == ["first", "second", "third"]
    assert "exported_at" in body


def test_markdown_export(client: TestClient, notes: FakeNoteStore) -> None:
    response = client.get("/v1/export", params={"format": "markdown"}, headers=SESSION)

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/markdown; charset=utf-8"
    assert response.headers["content-disposition"].endswith('.md"')
    assert response.text == (
        "## 2026-10-01T09:00:00+00:00\n\nfirst\n"
        "\n---\n\n"
        "## 2026-10-01T10:00:00+00:00\n\nsecond\n"
        "\n---\n\n"
        "## 2026-10-01T11:00:00+00:00\n\nthird\n"
    )


def test_unknown_export_format_is_a_400(client: TestClient, notes: FakeNoteStore) -> None:
    response = client.get("/v1/export", params={"format": "csv"}, headers=SESSION)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_export_needs_a_session(client: TestClient, notes: FakeNoteStore) -> None:
    assert client.get("/v1/export").status_code == 401


# Account deletion -------------------------------------------------------------


@pytest.fixture
def deletion_enabled(settings: Settings) -> Settings:
    settings.supabase_service_role_key = "service-role-key"
    return settings


def _delete_me(
    client: TestClient, body: object, headers: dict[str, str] = SESSION
) -> httpx.Response:
    return client.request("DELETE", "/v1/me", json=body, headers=headers)


def test_delete_account(
    client: TestClient,
    deletion_enabled: Settings,
    account: User,
    fake_provider: FakeAuthProvider,
    fake_db: FakeDbSession,
) -> None:
    response = _delete_me(client, {"confirm": "DELETE"})

    assert response.status_code == 204
    assert fake_provider.deleted_users == [str(account.auth_user_id)]
    assert fake_db.commits == 1
    cleared = response.headers.get_list("set-cookie")
    for name in ("qn_at", "qn_rt", "qn_csrf"):
        assert any(cookie.startswith(f'{name}=""') for cookie in cleared), name


def test_delete_account_needs_the_exact_confirmation(
    client: TestClient, deletion_enabled: Settings, account: User, fake_provider: FakeAuthProvider
) -> None:
    for body in ({"confirm": "delete"}, {}, None):
        response = _delete_me(client, body)
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "validation_error"
    assert fake_provider.deleted_users == []


def test_delete_account_without_the_service_key_is_a_503(
    client: TestClient, account: User, fake_provider: FakeAuthProvider, fake_db: FakeDbSession
) -> None:
    response = _delete_me(client, {"confirm": "DELETE"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "account_deletion_unavailable"
    assert fake_provider.deleted_users == []
    assert fake_db.commits == 0


def test_delete_account_keeps_everything_when_supabase_fails(
    client: TestClient,
    deletion_enabled: Settings,
    account: User,
    fake_provider: FakeAuthProvider,
    fake_db: FakeDbSession,
) -> None:
    fake_provider.fail_delete = ApiError(503, "auth_unavailable", "down")

    response = _delete_me(client, {"confirm": "DELETE"})

    assert response.status_code == 503
    assert fake_db.commits == 0
    assert "set-cookie" not in response.headers


def test_delete_account_needs_the_csrf_token(
    client: TestClient, deletion_enabled: Settings, account: User, fake_provider: FakeAuthProvider
) -> None:
    headers = {k: v for k, v in SESSION.items() if k != "x-csrf-token"}

    response = _delete_me(client, {"confirm": "DELETE"}, headers)

    assert response.status_code == 403
    assert fake_provider.deleted_users == []


# The admin API call itself ------------------------------------------------------


def _admin(settings: Settings, handler: httpx.MockTransport) -> SupabaseAuth:
    return SupabaseAuth(settings, transport=handler)


async def test_admin_delete_sends_the_service_key(deletion_enabled: Settings) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={})

    provider = _admin(deletion_enabled, httpx.MockTransport(handler))
    try:
        await provider.delete_user("5c8f0e3a-6d1b-4e2f-9a3c-7b4d5e6f7a8b")
    finally:
        await provider.aclose()

    assert seen[0].method == "DELETE"
    assert seen[0].url.path == "/auth/v1/admin/users/5c8f0e3a-6d1b-4e2f-9a3c-7b4d5e6f7a8b"
    assert seen[0].headers["apikey"] == "service-role-key"
    assert seen[0].headers["authorization"] == "Bearer service-role-key"


@pytest.mark.parametrize(
    ("status", "expected"),
    [(404, None), (500, "auth_unavailable"), (401, "account_deletion_unavailable")],
)
async def test_admin_delete_outcomes(
    deletion_enabled: Settings, status: int, expected: str | None
) -> None:
    provider = _admin(deletion_enabled, httpx.MockTransport(lambda _r: httpx.Response(status)))
    try:
        if expected is None:
            await provider.delete_user("5c8f0e3a-6d1b-4e2f-9a3c-7b4d5e6f7a8b")
        else:
            with pytest.raises(ApiError) as caught:
                await provider.delete_user("5c8f0e3a-6d1b-4e2f-9a3c-7b4d5e6f7a8b")
            assert caught.value.code == expected
            assert caught.value.status_code == 503
    finally:
        await provider.aclose()


async def test_admin_delete_without_a_key_makes_no_call(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request expected")

    provider = _admin(settings, httpx.MockTransport(handler))
    try:
        with pytest.raises(ApiError) as caught:
            await provider.delete_user("5c8f0e3a-6d1b-4e2f-9a3c-7b4d5e6f7a8b")
    finally:
        await provider.aclose()
    assert caught.value.code == "account_deletion_unavailable"


def test_export_body_never_logged(
    client: TestClient, notes: FakeNoteStore, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level("DEBUG")

    client.get("/v1/export", headers=SESSION)

    assert "first" not in json.dumps([r.getMessage() for r in caplog.records])
