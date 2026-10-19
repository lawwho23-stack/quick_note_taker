"""CSRF protection: origin allowlist plus double-submit token."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import ALLOWED_ORIGIN, FakeAuthProvider

LOGIN_BODY = {"email": "user@example.com", "password": "correct-horse-battery"}
CSRF_COOKIE_HEADER = {"Cookie": "qn_csrf=token-value"}


def test_write_with_foreign_origin_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/v1/auth/login",
        json=LOGIN_BODY,
        headers={"Origin": "https://evil.example"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_origin_rejected"


def test_write_without_origin_is_rejected(client: TestClient) -> None:
    response = client.post("/v1/auth/login", json=LOGIN_BODY)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_origin_rejected"


def test_first_login_passes_with_allowed_origin_only(
    client: TestClient, fake_provider: FakeAuthProvider
) -> None:
    response = client.post(
        "/v1/auth/login",
        json=LOGIN_BODY,
        headers={"Origin": ALLOWED_ORIGIN},
    )

    assert response.status_code == 200
    assert fake_provider.sign_in_calls == 1


def test_double_submit_requires_header_when_cookie_present(client: TestClient) -> None:
    response = client.post(
        "/v1/auth/login",
        json=LOGIN_BODY,
        headers={"Origin": ALLOWED_ORIGIN, **CSRF_COOKIE_HEADER},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_token_missing"


def test_double_submit_rejects_mismatched_header(client: TestClient) -> None:
    response = client.post(
        "/v1/auth/login",
        json=LOGIN_BODY,
        headers={
            "Origin": ALLOWED_ORIGIN,
            "X-CSRF-Token": "other-value",
            **CSRF_COOKIE_HEADER,
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_token_mismatch"


def test_double_submit_accepts_matching_header(
    client: TestClient, fake_provider: FakeAuthProvider
) -> None:
    response = client.post(
        "/v1/auth/login",
        json=LOGIN_BODY,
        headers={
            "Origin": ALLOWED_ORIGIN,
            "X-CSRF-Token": "token-value",
            **CSRF_COOKIE_HEADER,
        },
    )

    assert response.status_code == 200
    assert fake_provider.sign_in_calls == 1


def test_safe_methods_ignore_origin(client: TestClient) -> None:
    response = client.get("/v1/auth/session", headers={"Origin": "https://evil.example"})

    assert response.status_code == 200


def test_bearer_requests_are_exempt_from_csrf(client: TestClient) -> None:
    response = client.post(
        "/v1/auth/logout",
        headers={"Authorization": "Bearer extension-token-later", **CSRF_COOKIE_HEADER},
    )

    assert response.status_code == 204
