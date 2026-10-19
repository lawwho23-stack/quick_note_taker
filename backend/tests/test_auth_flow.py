"""Authentication flows: register, login, session probe, /me, logout, Google."""

from __future__ import annotations

from http.cookies import SimpleCookie

from app.errors import ApiError
from fastapi.testclient import TestClient

from tests.conftest import ALLOWED_ORIGIN, FakeAuthProvider, FakeDbSession, make_account

LOGIN_BODY = {"email": "user@example.com", "password": "correct-horse-battery"}
ORIGIN = {"Origin": ALLOWED_ORIGIN}


def _cookie_headers(response: object) -> dict[str, str]:
    """All Set-Cookie headers as {name: value}."""
    raw_headers = response.headers.get_list("set-cookie")  # type: ignore[attr-defined]
    jar: dict[str, str] = {}
    for raw in raw_headers:
        parsed = SimpleCookie()
        parsed.load(raw)
        for name, morsel in parsed.items():
            jar[name] = morsel.value
    return jar


def _cookie_string(response: object) -> str:
    return "; ".join(f"{name}={value}" for name, value in _cookie_headers(response).items())


def test_login_sets_session_cookies_with_expected_attributes(client: TestClient) -> None:
    response = client.post("/v1/auth/login", json=LOGIN_BODY, headers=ORIGIN)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"

    raw = response.headers.get_list("set-cookie")
    assert len(raw) >= 3, f"expected access, refresh and csrf cookies, got {raw}"

    access = next(item for item in raw if item.startswith("qn_at="))
    refresh = next(item for item in raw if item.startswith("qn_rt="))
    csrf = next(item for item in raw if item.startswith("qn_csrf="))

    for token_cookie in (access, refresh):
        assert "HttpOnly" in token_cookie
        assert "SameSite=lax" in token_cookie
        assert "Path=/" in token_cookie
    assert "HttpOnly" not in csrf
    assert "Path=/" in csrf

    body = response.json()
    assert body["status"] == "signed_in"
    assert body["user"]["email"] == "user@example.com"
    assert body["account"]["email"] == "user@example.com"


def test_session_without_cookie_is_unauthenticated(client: TestClient) -> None:
    response = client.get("/v1/auth/session")

    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is False
    # The probe guarantees a CSRF cookie so later writes can double-submit.
    assert "qn_csrf=" in response.headers.get_list("set-cookie")[0]


def test_session_with_cookie_is_authenticated(client: TestClient) -> None:
    response = client.get(
        "/v1/auth/session",
        headers={"Cookie": "qn_at=access-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is True
    assert body["user"]["email"] == "user@example.com"


def test_session_with_rejected_token_reports_expired(
    client: TestClient, fake_provider: FakeAuthProvider
) -> None:
    fake_provider.reject_tokens = True

    response = client.get("/v1/auth/session", headers={"Cookie": "qn_at=stale"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "session_expired"


def test_me_requires_authentication(client: TestClient) -> None:
    response = client.get("/v1/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


def test_me_returns_account_for_signed_in_user(client: TestClient, fake_db: FakeDbSession) -> None:
    fake_db.account = make_account(email="user@example.com")

    response = client.get("/v1/me", headers={"Cookie": "qn_at=access-1"})

    assert response.status_code == 200
    body = response.json()
    assert body["account"]["id"] == str(fake_db.account.id)
    assert body["account"]["email"] == "user@example.com"
    assert body["user"]["email"] == "user@example.com"


def test_me_survives_account_lookup_miss(client: TestClient) -> None:
    """An old access token must not recreate a deleted account."""
    response = client.get("/v1/me", headers={"Cookie": "qn_at=access-1"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "account_not_found"


def test_register_with_confirmation_required(
    client: TestClient, fake_provider: FakeAuthProvider
) -> None:
    fake_provider.signup_requires_confirmation = True

    response = client.post(
        "/v1/auth/register",
        json=LOGIN_BODY,
        headers=ORIGIN,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "confirmation_required"
    assert body["account"] is None
    assert "qn_at=" not in "".join(response.headers.get_list("set-cookie"))


def test_register_with_autoconfirm_signs_in(client: TestClient, fake_db: FakeDbSession) -> None:
    response = client.post("/v1/auth/register", json=LOGIN_BODY, headers=ORIGIN)

    assert response.status_code == 200
    assert response.json()["status"] == "signed_in"
    assert fake_db.upserts == 1
    assert fake_db.commits == 1


def test_register_sends_confirmation_back_to_the_website(
    client: TestClient, fake_provider: FakeAuthProvider
) -> None:
    """The emailed link must land on our route, never on the Supabase Site URL."""
    fake_provider.signup_requires_confirmation = True

    client.post("/v1/auth/register", json=LOGIN_BODY, headers=ORIGIN)

    assert fake_provider.signup_redirects == ["http://localhost:3000/auth/confirm"]


def test_resend_always_accepts_and_uses_the_website_route(
    client: TestClient, fake_provider: FakeAuthProvider
) -> None:
    response = client.post("/v1/auth/resend", json={"email": "user@example.com"}, headers=ORIGIN)

    assert response.status_code == 202
    assert fake_provider.resend_calls == [
        {"email": "user@example.com", "redirect_to": "http://localhost:3000/auth/confirm"}
    ]


def test_resend_does_not_reveal_whether_an_account_exists(
    client: TestClient, fake_provider: FakeAuthProvider
) -> None:
    """A rejected address answers exactly like an accepted one."""
    fake_provider.fail_resend = ApiError(400, "auth_request_rejected", "rejected")

    response = client.post("/v1/auth/resend", json={"email": "nobody@example.com"}, headers=ORIGIN)

    assert response.status_code == 202
    assert response.content == b""


def test_resend_surfaces_a_real_outage(client: TestClient, fake_provider: FakeAuthProvider) -> None:
    fake_provider.fail_resend = ApiError(503, "auth_unavailable", "unavailable")

    response = client.post("/v1/auth/resend", json={"email": "user@example.com"}, headers=ORIGIN)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "auth_unavailable"


def test_logout_clears_cookies_and_revokes(
    client: TestClient, fake_provider: FakeAuthProvider
) -> None:
    response = client.post(
        "/v1/auth/logout",
        headers={"Cookie": "qn_at=access-1; qn_rt=refresh-1", **ORIGIN},
    )

    assert response.status_code == 204
    raw = "".join(response.headers.get_list("set-cookie"))
    assert "qn_at=" in raw and "qn_rt=" in raw and "qn_csrf=" in raw
    assert fake_provider.revoked == ["access-1"]


def test_google_start_sets_flow_cookies_and_sanitizes_next(
    client: TestClient, fake_provider: FakeAuthProvider
) -> None:
    response = client.get("/v1/auth/google?next=https://evil.example/steal", follow_redirects=False)

    assert response.status_code == 302
    assert "supabase.test" in response.headers["location"]
    cookies = _cookie_headers(response)
    assert cookies["qn_pkce"]
    assert cookies["qn_oauth_state"]
    # Hostile next values fall back to the default path.
    assert cookies["qn_next"] == "/notes"
    call = fake_provider.authorize_calls[-1]
    assert call["provider"] == "google"
    assert call["redirect_to"] == "http://localhost:3000/api/v1/auth/callback"


def test_google_start_keeps_safe_next(client: TestClient) -> None:
    response = client.get("/v1/auth/google?next=/settings", follow_redirects=False)

    assert _cookie_headers(response)["qn_next"] == "/settings"


def test_google_callback_rejects_state_mismatch(client: TestClient) -> None:
    cookies = "qn_pkce=verifier; qn_oauth_state=expected; qn_next=/notes"

    response = client.get(
        "/v1/auth/callback?code=abc&state=other",
        headers={"Cookie": cookies},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "http://localhost:3000/sign-in?auth_error=state_mismatch"


def test_google_callback_requires_verifier(client: TestClient) -> None:
    response = client.get(
        "/v1/auth/callback?code=abc&state=match",
        headers={"Cookie": "qn_oauth_state=match"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert "auth_error=missing_verifier" in response.headers["location"]


def test_google_callback_success_sets_session_and_redirects(
    client: TestClient, fake_db: FakeDbSession
) -> None:
    response = client.get(
        "/v1/auth/callback?code=abc&state=match",
        headers={"Cookie": "qn_pkce=verifier; qn_oauth_state=match; qn_next=/settings"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "http://localhost:3000/settings"

    raw = "".join(response.headers.get_list("set-cookie"))
    assert "qn_at=" in raw
    assert "qn_rt=" in raw
    assert fake_db.upserts == 1


def test_exchange_with_access_token_sets_session(
    client: TestClient, fake_db: FakeDbSession
) -> None:
    response = client.post(
        "/v1/auth/exchange",
        json={
            "access_token": "fragment-access",
            "refresh_token": "fragment-refresh",
            "expires_in": 3600,
        },
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert response.json()["status"] == "signed_in"
    assert fake_db.upserts == 1


def test_exchange_requires_some_credential(client: TestClient) -> None:
    response = client.post("/v1/auth/exchange", json={}, headers=ORIGIN)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_invalid_login_body_does_not_echo_password(client: TestClient) -> None:
    secret = "super-secret-password-value"

    response = client.post(
        "/v1/auth/login",
        json={"email": "not-an-email", "password": secret},
        headers=ORIGIN,
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"
    assert secret not in response.text
