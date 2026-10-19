"""Supabase Auth (GoTrue) client: request shapes and error mapping."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from app.config import Settings
from app.errors import ApiError
from app.supabase_auth import SupabaseAuth

USER_ID = "5c8f0e3a-6d1b-4e2f-9a3c-7b4d5e6f7a8b"


@pytest.fixture
def settings() -> Settings:
    return Settings(
        app_env="local",
        supabase_url="https://project.supabase.co",
        supabase_anon_key="anon-key",
        database_url="postgresql://postgres:postgres@localhost:5432/postgres",
    )


def make_provider(
    settings: Settings, handler: Callable[[httpx.Request], httpx.Response]
) -> SupabaseAuth:
    return SupabaseAuth(settings, transport=httpx.MockTransport(handler))


async def test_sign_in_maps_session(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["grant_type"] == "password"
        return httpx.Response(
            200,
            json={
                "access_token": "at",
                "refresh_token": "rt",
                "expires_in": 3600,
                "expires_at": 1_760_000_000,
                "user": {"id": USER_ID, "email": "user@example.com"},
            },
        )

    provider = make_provider(settings, handler)
    try:
        session = await provider.sign_in("user@example.com", "pw")
    finally:
        await provider.aclose()

    assert session.access_token == "at"
    assert session.refresh_token == "rt"
    assert session.expires_in == 3600
    assert session.user.id == USER_ID


async def test_sign_in_invalid_credentials(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400, json={"error_code": "invalid_credentials", "msg": "Invalid login credentials"}
        )

    provider = make_provider(settings, handler)
    try:
        with pytest.raises(ApiError) as excinfo:
            await provider.sign_in("user@example.com", "wrong")
    finally:
        await provider.aclose()

    assert excinfo.value.status_code == 401
    assert excinfo.value.code == "invalid_credentials"


async def test_sign_in_email_not_confirmed(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400, json={"error_code": "email_not_confirmed", "msg": "Email not confirmed"}
        )

    provider = make_provider(settings, handler)
    try:
        with pytest.raises(ApiError) as excinfo:
            await provider.sign_in("user@example.com", "pw")
    finally:
        await provider.aclose()

    assert excinfo.value.status_code == 403
    assert excinfo.value.code == "email_not_confirmed"


async def test_upstream_failure_maps_to_unavailable(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="bad gateway")

    provider = make_provider(settings, handler)
    try:
        with pytest.raises(ApiError) as excinfo:
            await provider.sign_in("user@example.com", "pw")
    finally:
        await provider.aclose()

    assert excinfo.value.status_code == 503
    assert excinfo.value.code == "auth_unavailable"


async def test_refresh_message_fallback_maps_reuse_to_expired(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["grant_type"] == "refresh_token"
        return httpx.Response(400, json={"msg": "Invalid Refresh Token: Refresh Token Not Found"})

    provider = make_provider(settings, handler)
    try:
        with pytest.raises(ApiError) as excinfo:
            await provider.refresh("old-token")
    finally:
        await provider.aclose()

    assert excinfo.value.status_code == 401
    assert excinfo.value.code == "session_expired"


async def test_get_user_rejects_bad_token(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer bad-token"
        return httpx.Response(401, json={"msg": "invalid JWT"})

    provider = make_provider(settings, handler)
    try:
        with pytest.raises(ApiError) as excinfo:
            await provider.get_user("bad-token")
    finally:
        await provider.aclose()

    assert excinfo.value.code == "session_expired"


async def test_get_user_returns_identity(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": USER_ID, "email": "user@example.com"})

    provider = make_provider(settings, handler)
    try:
        user = await provider.get_user("good-token")
    finally:
        await provider.aclose()

    assert user.id == USER_ID
    assert user.email == "user@example.com"


async def test_sign_up_without_session_requires_confirmation(settings: Settings) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200, json={"id": USER_ID, "email": "new@example.com", "session": None}
        )

    provider = make_provider(settings, handler)
    try:
        result = await provider.sign_up(
            "new@example.com",
            "pw-12345678",
            redirect_to="https://web.example/auth/confirm",
        )
    finally:
        await provider.aclose()

    assert result.session is None
    assert result.user is not None
    assert result.user.email == "new@example.com"
    # The confirmation email must return the browser to our own route.
    assert seen[0].url.params["redirect_to"] == "https://web.example/auth/confirm"


async def test_resend_confirmation_sends_redirect_and_type(settings: Settings) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={})

    provider = make_provider(settings, handler)
    try:
        await provider.resend_confirmation(
            "new@example.com", redirect_to="https://web.example/auth/confirm"
        )
    finally:
        await provider.aclose()

    assert seen[0].url.params["redirect_to"] == "https://web.example/auth/confirm"
    assert json.loads(seen[0].content)["type"] == "signup"


async def test_resend_confirmation_maps_rate_limit(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429, json={"error_code": "over_email_send_rate_limit", "msg": "too many"}
        )

    provider = make_provider(settings, handler)
    try:
        with pytest.raises(ApiError) as caught:
            await provider.resend_confirmation(
                "new@example.com", redirect_to="https://web.example/auth/confirm"
            )
    finally:
        await provider.aclose()

    assert caught.value.status_code == 429
    assert caught.value.code == "rate_limited"


async def test_revoke_never_raises(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("network down")

    provider = make_provider(settings, handler)
    try:
        await provider.revoke("access-token")
    finally:
        await provider.aclose()


async def test_exchange_pkce_sends_verifier(settings: Settings) -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["grant_type"] = request.url.params["grant_type"]
        captured["body"] = request.read().decode()
        return httpx.Response(
            200,
            json={
                "access_token": "at",
                "refresh_token": "rt",
                "expires_in": 3600,
                "user": {"id": USER_ID, "email": "user@example.com"},
            },
        )

    provider = make_provider(settings, handler)
    try:
        session = await provider.exchange_pkce("auth-code", "verifier-value")
    finally:
        await provider.aclose()

    assert captured["grant_type"] == "pkce"
    assert "verifier-value" in captured["body"]
    assert session.access_token == "at"


async def test_authorize_url_contains_pkce_parameters(settings: Settings) -> None:
    provider = SupabaseAuth(settings)
    try:
        url = provider.authorize_url(
            provider="google",
            redirect_to="https://web.example/api/v1/auth/callback",
            code_challenge="challenge",
            state="state-value",
        )
    finally:
        await provider.aclose()

    assert url.startswith("https://project.supabase.co/auth/v1/authorize?")
    assert "provider=google" in url
    assert "code_challenge_method=s256" in url
    assert "state=state-value" in url
