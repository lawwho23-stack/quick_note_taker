"""Notes HTTP API: status codes, error shapes, auth and CSRF wiring.

The store is an in-memory fake here. The real SQL, idempotency and row-level
security are covered against Postgres in tests/db/.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from app.errors import ApiError
from app.models import Note
from app.notes import (
    check_body,
    decode_cursor,
    escape_like,
    get_note_store,
    note_out,
    payload_hash,
)
from app.schemas import NoteCreate
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import ALLOWED_ORIGIN, FakeDbSession, make_account

SESSION = {
    "Cookie": "qn_at=access-1; qn_csrf=csrf-1",
    "Origin": ALLOWED_ORIGIN,
    "x-csrf-token": "csrf-1",
}


class FakeNoteStore:
    """Same contract as NoteStore, kept in a dict."""

    def __init__(self) -> None:
        self.notes: dict[uuid.UUID, Note] = {}

    async def create(self, account_id: uuid.UUID, payload: NoteCreate) -> tuple[Note, bool]:
        check_body(payload.body)
        digest = payload_hash(payload)
        existing = self.notes.get(payload.id)
        if existing is not None:
            if existing.user_id == account_id and existing.payload_hash == digest:
                return existing, False
            raise ApiError(409, "note_id_conflict", "A different note already uses this id.")
        now = datetime.now(UTC)
        note = Note(
            id=payload.id,
            user_id=account_id,
            body=payload.body,
            version=1,
            source=payload.source,
            meta=payload.meta,
            payload_hash=digest,
            created_at=now,
            updated_at=now,
            deleted_at=None,
        )
        self.notes[note.id] = note
        return note, True

    async def list(
        self, account_id: uuid.UUID, *, limit: int, cursor: str | None = None, q: str | None = None
    ) -> tuple[list[Note], str | None]:
        rows = [
            n
            for n in self.notes.values()
            if n.user_id == account_id and n.deleted_at is None and (not q or q in n.body)
        ]
        return sorted(rows, key=lambda n: n.created_at, reverse=True)[:limit], None

    async def get(self, account_id: uuid.UUID, note_id: uuid.UUID) -> Note:
        note = self.notes.get(note_id)
        if note is None or note.user_id != account_id or note.deleted_at is not None:
            raise ApiError(404, "note_not_found", "This note does not exist.")
        return note

    async def update(
        self, account_id: uuid.UUID, note_id: uuid.UUID, *, body: str, base_version: int
    ) -> Note:
        note = await self.get(account_id, note_id)
        if note.version != base_version:
            raise ApiError(
                409,
                "version_conflict",
                "This note changed somewhere else.",
                extra={"current": note_out(note).model_dump(mode="json")},
            )
        note.body = body
        note.version += 1
        return note

    async def soft_delete(self, account_id: uuid.UUID, note_id: uuid.UUID) -> None:
        note = await self.get(account_id, note_id)
        note.deleted_at = datetime.now(UTC)


@pytest.fixture
def fake_store(app: FastAPI, fake_db: FakeDbSession) -> FakeNoteStore:
    fake_db.account = make_account()
    store = FakeNoteStore()
    app.dependency_overrides[get_note_store] = lambda: store
    return store


def test_create_returns_201_and_an_ack_without_the_body(
    client: TestClient, fake_store: FakeNoteStore
) -> None:
    note_id = uuid.uuid4()

    response = client.post(
        "/v1/notes",
        json={"id": str(note_id), "body": "buy rice", "source": "extension"},
        headers=SESSION,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["id"] == str(note_id)
    assert body["version"] == 1
    assert "body" not in body
    assert fake_store.notes[note_id].source == "extension"


def test_identical_retry_returns_200_with_the_same_ack(
    client: TestClient, fake_store: FakeNoteStore
) -> None:
    note_id = uuid.uuid4()
    first = client.post("/v1/notes", json={"id": str(note_id), "body": "x"}, headers=SESSION)

    again = client.post("/v1/notes", json={"id": str(note_id), "body": "x"}, headers=SESSION)

    assert again.status_code == 200
    assert again.json() == first.json()
    assert len(fake_store.notes) == 1


def test_changed_retry_is_a_409(client: TestClient, fake_store: FakeNoteStore) -> None:
    note_id = uuid.uuid4()
    client.post("/v1/notes", json={"id": str(note_id), "body": "x"}, headers=SESSION)

    response = client.post("/v1/notes", json={"id": str(note_id), "body": "y"}, headers=SESSION)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "note_id_conflict"


def test_too_long_note_is_a_413(client: TestClient, fake_store: FakeNoteStore) -> None:
    response = client.post(
        "/v1/notes", json={"id": str(uuid.uuid4()), "body": "a" * 20_001}, headers=SESSION
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "note_too_large"


def test_exactly_20000_characters_is_allowed(client: TestClient, fake_store: FakeNoteStore) -> None:
    response = client.post(
        "/v1/notes", json={"id": str(uuid.uuid4()), "body": "မ" * 20_000}, headers=SESSION
    )

    assert response.status_code == 201


@pytest.mark.parametrize(
    "payload",
    [
        {"body": "missing id"},
        {"id": "not-a-uuid", "body": "x"},
        {"id": str(uuid.uuid4()), "body": ""},
        {"id": str(uuid.uuid4()), "body": "x", "source": "Bad Source!"},
    ],
)
def test_invalid_create_payloads_are_400(
    client: TestClient, fake_store: FakeNoteStore, payload: dict[str, str]
) -> None:
    response = client.post("/v1/notes", json=payload, headers=SESSION)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_cookie_write_needs_the_csrf_token(client: TestClient, fake_store: FakeNoteStore) -> None:
    headers = {k: v for k, v in SESSION.items() if k != "x-csrf-token"}

    response = client.post(
        "/v1/notes", json={"id": str(uuid.uuid4()), "body": "x"}, headers=headers
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_token_missing"
    assert fake_store.notes == {}


def test_cookie_write_from_a_foreign_origin_is_rejected(
    client: TestClient, fake_store: FakeNoteStore
) -> None:
    response = client.post(
        "/v1/notes",
        json={"id": str(uuid.uuid4()), "body": "x"},
        headers=SESSION | {"Origin": "https://evil.example"},
    )

    assert response.status_code == 403
    assert fake_store.notes == {}


def test_notes_need_a_signed_in_account(client: TestClient, fake_store: FakeNoteStore) -> None:
    response = client.get("/v1/notes")

    assert response.status_code == 401


def test_list_get_edit_and_delete(client: TestClient, fake_store: FakeNoteStore) -> None:
    note_id = uuid.uuid4()
    client.post("/v1/notes", json={"id": str(note_id), "body": "first"}, headers=SESSION)

    listed = client.get("/v1/notes", headers=SESSION)
    assert listed.status_code == 200
    assert [item["body"] for item in listed.json()["items"]] == ["first"]
    assert listed.json()["next_cursor"] is None

    fetched = client.get(f"/v1/notes/{note_id}", headers=SESSION)
    assert fetched.status_code == 200
    assert fetched.json()["version"] == 1

    edited = client.patch(
        f"/v1/notes/{note_id}", json={"body": "second", "base_version": 1}, headers=SESSION
    )
    assert edited.status_code == 200
    assert edited.json()["body"] == "second"
    assert edited.json()["version"] == 2

    deleted = client.delete(f"/v1/notes/{note_id}", headers=SESSION)
    assert deleted.status_code == 204
    assert client.get(f"/v1/notes/{note_id}", headers=SESSION).status_code == 404


def test_stale_edit_is_a_409_with_the_current_note(
    client: TestClient, fake_store: FakeNoteStore
) -> None:
    note_id = uuid.uuid4()
    client.post("/v1/notes", json={"id": str(note_id), "body": "v1"}, headers=SESSION)
    client.patch(f"/v1/notes/{note_id}", json={"body": "v2", "base_version": 1}, headers=SESSION)

    response = client.patch(
        f"/v1/notes/{note_id}", json={"body": "stale", "base_version": 1}, headers=SESSION
    )

    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "version_conflict"
    assert body["current"]["body"] == "v2"
    assert body["current"]["version"] == 2


def test_unknown_note_is_a_404(client: TestClient, fake_store: FakeNoteStore) -> None:
    response = client.get(f"/v1/notes/{uuid.uuid4()}", headers=SESSION)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "note_not_found"


def test_bad_cursor_is_a_400() -> None:
    with pytest.raises(ApiError) as caught:
        decode_cursor("not-a-cursor")
    assert caught.value.status_code == 400


def test_like_wildcards_are_escaped() -> None:
    assert escape_like(r"50%_off\now") == r"50\%\_off\\now"
