"""The notes API end to end: real routers, real Postgres, running as qn_runtime."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from tests.conftest import ALLOWED_ORIGIN

SESSION = {
    "Cookie": "qn_at=access-1; qn_csrf=csrf-1",
    "Origin": ALLOWED_ORIGIN,
    "x-csrf-token": "csrf-1",
}


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
