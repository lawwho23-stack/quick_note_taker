"""Refresh rotation, single-flight, and failure handling."""

from __future__ import annotations

from app.errors import ApiError
from fastapi.testclient import TestClient

from tests.conftest import ALLOWED_ORIGIN, FakeAuthProvider

ORIGIN = {"Origin": ALLOWED_ORIGIN}
REFRESH_COOKIE = {"Cookie": "qn_rt=refresh-old"}


def test_refresh_without_cookie_is_session_expired(client: TestClient) -> None:
    response = client.post("/v1/auth/refresh", headers=ORIGIN)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "session_expired"


def test_refresh_rotates_tokens(client: TestClient, fake_provider: FakeAuthProvider) -> None:
    response = client.post("/v1/auth/refresh", headers={**ORIGIN, **REFRESH_COOKIE})

    assert response.status_code == 200
    assert fake_provider.refresh_calls == 1
    body = response.json()
    assert body["status"] == "signed_in"
    raw = "".join(response.headers.get_list("set-cookie"))
    assert "qn_at=" in raw and "qn_rt=" in raw and "qn_csrf=" in raw


def test_refresh_is_single_flighted_for_the_same_token(
    client: TestClient, fake_provider: FakeAuthProvider
) -> None:
    first = client.post("/v1/auth/refresh", headers={**ORIGIN, **REFRESH_COOKIE})
    second = client.post("/v1/auth/refresh", headers={**ORIGIN, **REFRESH_COOKIE})

    assert first.status_code == 200
    assert second.status_code == 200
    # The second call is served from the short-lived cache: one provider call only.
    assert fake_provider.refresh_calls == 1


def test_refresh_rejected_token_clears_session(
    client: TestClient, fake_provider: FakeAuthProvider
) -> None:
    fake_provider.fail_refresh = ApiError(401, "session_expired", "Session expired. Sign in again.")

    response = client.post("/v1/auth/refresh", headers={**ORIGIN, **REFRESH_COOKIE})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "session_expired"
    raw = "".join(response.headers.get_list("set-cookie"))
    assert "qn_at=" in raw and "qn_rt=" in raw
