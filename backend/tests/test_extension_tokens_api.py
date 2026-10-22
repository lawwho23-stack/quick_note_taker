"""Extension tokens and principals over HTTP: scopes, revocation, CSRF wiring.

The token store is an in-memory fake here. Hash lookups, revocation and
cross-account denial run against Postgres in tests/db/.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from app.errors import ApiError
from app.extension_tokens import TOKEN_PREFIX, get_token_store
from app.models import ExtensionToken, User
from app.notes import get_note_store
from app.security import new_secret, sha256_hex
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import ALLOWED_ORIGIN, FakeAuthProvider, FakeDbSession, make_account
from tests.test_notes_api import SESSION, FakeNoteStore


class FakeTokenStore:
    """Same contract as ExtensionTokenStore, kept in a dict."""

    def __init__(self, accounts: dict[uuid.UUID, User]) -> None:
        self.accounts = accounts
        self.tokens: dict[uuid.UUID, ExtensionToken] = {}

    async def create(self, account_id: uuid.UUID, label: str | None) -> tuple[ExtensionToken, str]:
        secret = TOKEN_PREFIX + new_secret(32)
        token = ExtensionToken(
            id=uuid.uuid4(),
            user_id=account_id,
            token_hash=sha256_hex(secret),
            label=label,
            scopes=["notes:create"],
            created_at=datetime.now(UTC),
            last_used_at=None,
            revoked_at=None,
        )
        self.tokens[token.id] = token
        return token, secret

    async def list_active(self, account_id: uuid.UUID) -> list[ExtensionToken]:
        return [t for t in self.tokens.values() if t.user_id == account_id and t.revoked_at is None]

    async def revoke(self, account_id: uuid.UUID, token_id: uuid.UUID) -> None:
        token = self.tokens.get(token_id)
        if token is None or token.user_id != account_id or token.revoked_at is not None:
            raise ApiError(404, "token_not_found", "This extension token does not exist.")
        token.revoked_at = datetime.now(UTC)

    async def authenticate(self, secret: str) -> tuple[ExtensionToken, User]:
        digest = sha256_hex(secret)
        for token in self.tokens.values():
            if token.token_hash == digest:
                if token.revoked_at is not None:
                    raise ApiError(401, "token_revoked", "This extension token was revoked.")
                token.last_used_at = datetime.now(UTC)
                return token, self.accounts[token.user_id]
        raise ApiError(401, "unauthenticated", "This extension token is not valid.")


@pytest.fixture
def account(fake_db: FakeDbSession) -> User:
    fake_db.account = make_account()
    return fake_db.account


@pytest.fixture
def tokens(app: FastAPI, account: User) -> FakeTokenStore:
    store = FakeTokenStore({account.id: account})
    app.dependency_overrides[get_token_store] = lambda: store
    return store


@pytest.fixture
def notes(app: FastAPI) -> FakeNoteStore:
    store = FakeNoteStore()
    app.dependency_overrides[get_note_store] = lambda: store
    return store


def _bearer(secret: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


def _create_token(client: TestClient, label: str | None = "Chrome") -> dict[str, Any]:
    response = client.post("/v1/extension-tokens", json={"label": label}, headers=SESSION)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def test_create_shows_the_secret_once_and_stores_only_its_hash(
    client: TestClient, tokens: FakeTokenStore, account: User
) -> None:
    created = _create_token(client)

    assert created["token"].startswith("qnx_")
    assert created["label"] == "Chrome"
    assert created["scopes"] == ["notes:create"]
    stored = tokens.tokens[uuid.UUID(created["id"])]
    assert stored.token_hash == sha256_hex(created["token"])
    assert stored.user_id == account.id


def test_create_without_a_body_works(client: TestClient, tokens: FakeTokenStore) -> None:
    response = client.post("/v1/extension-tokens", headers=SESSION)

    assert response.status_code == 201
    assert response.json()["label"] is None


def test_label_over_64_characters_is_a_400(client: TestClient, tokens: FakeTokenStore) -> None:
    response = client.post("/v1/extension-tokens", json={"label": "x" * 65}, headers=SESSION)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_create_needs_the_csrf_token(client: TestClient, tokens: FakeTokenStore) -> None:
    headers = {k: v for k, v in SESSION.items() if k != "x-csrf-token"}

    response = client.post("/v1/extension-tokens", json={}, headers=headers)

    assert response.status_code == 403
    assert tokens.tokens == {}


def test_list_shows_active_tokens_and_never_secrets(
    client: TestClient, tokens: FakeTokenStore
) -> None:
    kept = _create_token(client, "kept")
    gone = _create_token(client, "gone")
    client.delete(f"/v1/extension-tokens/{gone['id']}", headers=SESSION)

    response = client.get("/v1/extension-tokens", headers=SESSION)

    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["id"] for item in items] == [kept["id"]]
    assert set(items[0]) == {"id", "label", "scopes", "created_at", "last_used_at"}
    assert kept["token"] not in response.text


def test_revoke_twice_is_a_404(client: TestClient, tokens: FakeTokenStore) -> None:
    created = _create_token(client)

    first = client.delete(f"/v1/extension-tokens/{created['id']}", headers=SESSION)
    second = client.delete(f"/v1/extension-tokens/{created['id']}", headers=SESSION)

    assert first.status_code == 204
    assert second.status_code == 404
    assert second.json()["error"]["code"] == "token_not_found"


def test_status_with_a_valid_token(client: TestClient, tokens: FakeTokenStore) -> None:
    created = _create_token(client)

    response = client.get("/v1/extension/status", headers=_bearer(created["token"]))

    assert response.status_code == 200
    assert response.json() == {"status": "connected"}
    assert tokens.tokens[uuid.UUID(created["id"])].last_used_at is not None


def test_status_with_an_unknown_token_is_a_401(
    client: TestClient, tokens: FakeTokenStore, fake_provider: FakeAuthProvider
) -> None:
    response = client.get("/v1/extension/status", headers=_bearer("qnx_not-a-real-token"))

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"
    assert fake_provider.get_user_tokens == []  # never sent to Supabase


def test_status_with_a_revoked_token_is_a_401(client: TestClient, tokens: FakeTokenStore) -> None:
    created = _create_token(client)
    client.delete(f"/v1/extension-tokens/{created['id']}", headers=SESSION)

    response = client.get("/v1/extension/status", headers=_bearer(created["token"]))

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "token_revoked"


def test_status_with_a_session_is_wrong_scope(client: TestClient, tokens: FakeTokenStore) -> None:
    response = client.get("/v1/extension/status", headers=SESSION)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "wrong_scope"


def test_status_without_credentials_is_a_401(client: TestClient, tokens: FakeTokenStore) -> None:
    assert client.get("/v1/extension/status").status_code == 401


def test_extension_create_forces_the_source_and_skips_csrf(
    client: TestClient, tokens: FakeTokenStore, notes: FakeNoteStore, account: User
) -> None:
    created = _create_token(client)
    note_id = uuid.uuid4()
    payload = {"id": str(note_id), "body": "from the card", "source": "web"}

    # No cookies, no CSRF header, a foreign origin: bearer requests are exempt.
    first = client.post(
        "/v1/notes",
        json=payload,
        headers=_bearer(created["token"]) | {"Origin": "chrome-extension://abc"},
    )
    retry = client.post("/v1/notes", json=payload, headers=_bearer(created["token"]))

    assert first.status_code == 201, first.text
    assert set(first.json()) == {"id", "version", "created_at"}
    assert retry.status_code == 200
    assert notes.notes[note_id].source == "extension"
    assert notes.notes[note_id].user_id == account.id


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/notes"),
        ("GET", f"/v1/notes/{uuid.uuid4()}"),
        ("PATCH", f"/v1/notes/{uuid.uuid4()}"),
        ("DELETE", f"/v1/notes/{uuid.uuid4()}"),
        ("GET", "/v1/me"),
        ("DELETE", "/v1/me"),
        ("GET", "/v1/export"),
        ("GET", "/v1/extension-tokens"),
        ("POST", "/v1/extension-tokens"),
        ("DELETE", f"/v1/extension-tokens/{uuid.uuid4()}"),
    ],
)
def test_extension_token_is_wrong_scope_everywhere_else(
    client: TestClient,
    tokens: FakeTokenStore,
    notes: FakeNoteStore,
    fake_provider: FakeAuthProvider,
    method: str,
    path: str,
) -> None:
    created = _create_token(client)
    fake_provider.get_user_tokens.clear()
    body = {"body": "x", "base_version": 1, "confirm": "DELETE", "label": "x"}

    response = client.request(method, path, json=body, headers=_bearer(created["token"]))

    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "wrong_scope"
    assert fake_provider.get_user_tokens == []


def test_website_session_can_still_create_notes(
    client: TestClient, tokens: FakeTokenStore, notes: FakeNoteStore
) -> None:
    response = client.post(
        "/v1/notes",
        json={"id": str(uuid.uuid4()), "body": "x", "source": "web"},
        headers=SESSION | {"Origin": ALLOWED_ORIGIN},
    )

    assert response.status_code == 201
    assert next(iter(notes.notes.values())).source == "web"
