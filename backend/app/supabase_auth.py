"""Thin async client for the Supabase Auth (GoTrue) REST API.

One client instance per request; nothing is shared between users. We manage our
own cookie storage for the website session instead of relying on a stateful
Supabase client.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlencode

import httpx

from app.auth_types import AuthSession, AuthUser, SignUpResult
from app.config import Settings
from app.errors import ApiError

logger = logging.getLogger("quick_note.supabase_auth")

# GoTrue error code -> (HTTP status, Quick Note error code, safe message)
_ERROR_MAP: dict[str, tuple[int, str, str]] = {
    "invalid_credentials": (401, "invalid_credentials", "Email or password is incorrect."),
    "email_not_confirmed": (
        403,
        "email_not_confirmed",
        "The email address has not been confirmed yet.",
    ),
    "email_exists": (409, "email_in_use", "An account with this email already exists."),
    "user_already_exists": (409, "email_in_use", "An account with this email already exists."),
    "weak_password": (400, "weak_password", "The password does not meet the minimum requirements."),
    "validation_failed": (400, "validation_error", "The submitted values are not valid."),
    "signup_disabled": (403, "signup_disabled", "Sign-up is currently disabled."),
    "user_not_found": (401, "invalid_credentials", "Email or password is incorrect."),
    "over_request_rate_limit": (429, "rate_limited", "Too many attempts. Try again later."),
    "over_email_send_rate_limit": (429, "rate_limited", "Too many attempts. Try again later."),
    "invalid_grant": (401, "session_expired", "Session expired. Sign in again."),
    "refresh_token_not_found": (401, "session_expired", "Session expired. Sign in again."),
    "refresh_token_already_used": (401, "session_expired", "Session expired. Sign in again."),
    "invalid_code": (400, "oauth_exchange_failed", "The sign-in link is invalid or has expired."),
    "pkce_code_verifier_invalid": (
        400,
        "oauth_exchange_failed",
        "The sign-in attempt could not be verified.",
    ),
    "flow_state_not_found": (
        400,
        "oauth_exchange_failed",
        "The sign-in attempt expired. Try again.",
    ),
    "flow_state_expired": (400, "oauth_exchange_failed", "The sign-in attempt expired. Try again."),
}

_MESSAGE_FALLBACKS: tuple[tuple[str, tuple[int, str, str]], ...] = (
    ("invalid login credentials", _ERROR_MAP["invalid_credentials"]),
    ("email not confirmed", _ERROR_MAP["email_not_confirmed"]),
    ("user already registered", _ERROR_MAP["user_already_exists"]),
    ("user already exists", _ERROR_MAP["user_already_exists"]),
    ("for security purposes", _ERROR_MAP["over_request_rate_limit"]),
    ("invalid refresh token", _ERROR_MAP["invalid_grant"]),
    ("refresh token", _ERROR_MAP["invalid_grant"]),
)


class SupabaseAuth:
    """Per-request client for Supabase Auth."""

    def __init__(
        self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._settings = settings
        headers = {
            "apikey": settings.supabase_anon_key,
            "authorization": f"Bearer {settings.supabase_anon_key}",
        }
        self._client = httpx.AsyncClient(
            base_url=settings.auth_base_url,
            headers=headers,
            timeout=httpx.Timeout(10.0, connect=5.0),
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    # -- error handling ---------------------------------------------------

    @staticmethod
    def _error_from_response(response: httpx.Response) -> ApiError:
        try:
            body: dict[str, Any] = response.json()
        except ValueError:
            body = {}
        raw_code = str(body.get("error_code") or "")
        message = str(body.get("msg") or body.get("message") or "")
        logger.warning(
            "supabase auth error",
            extra={"status_code": response.status_code, "error_code": raw_code or "unknown"},
        )
        if response.status_code >= 500:
            return ApiError(
                503, "auth_unavailable", "The authentication service is unavailable. Try again."
            )
        if raw_code in _ERROR_MAP:
            status, code, safe_message = _ERROR_MAP[raw_code]
            return ApiError(status, code, safe_message)
        lowered = message.lower()
        for needle, mapped in _MESSAGE_FALLBACKS:
            if needle in lowered:
                status, code, safe_message = mapped
                return ApiError(status, code, safe_message)
        return ApiError(400, "auth_request_rejected", "The authentication request was rejected.")

    # -- response mapping -------------------------------------------------

    @staticmethod
    def _user_from(data: dict[str, Any]) -> AuthUser | None:
        candidate = data.get("user")
        source: dict[str, Any] = candidate if isinstance(candidate, dict) else data
        user_id = source.get("id")
        if not user_id:
            return None
        email = source.get("email")
        return AuthUser(id=str(user_id), email=str(email) if email else None)

    def _session_from_token_response(self, data: dict[str, Any]) -> AuthSession:
        user = self._user_from(data)
        if user is None or not data.get("access_token"):
            raise ApiError(
                502,
                "auth_unavailable",
                "The authentication service returned an unexpected response.",
            )
        expires_at = data.get("expires_at")
        return AuthSession(
            access_token=str(data["access_token"]),
            refresh_token=str(data.get("refresh_token") or ""),
            expires_in=int(data.get("expires_in") or self._settings.access_cookie_max_age),
            expires_at=int(expires_at) if expires_at else None,
            user=user,
        )

    # -- endpoints --------------------------------------------------------

    async def sign_up(self, email: str, password: str) -> SignUpResult:
        response = await self._client.post("/signup", json={"email": email, "password": password})
        if response.status_code not in (200, 201):
            raise self._error_from_response(response)
        data: dict[str, Any] = response.json()
        session = (
            self._session_from_token_response(data["session"]) if data.get("session") else None
        )
        return SignUpResult(user=self._user_from(data), session=session)

    async def sign_in(self, email: str, password: str) -> AuthSession:
        response = await self._client.post(
            "/token",
            params={"grant_type": "password"},
            json={"email": email, "password": password},
        )
        if response.status_code != 200:
            raise self._error_from_response(response)
        return self._session_from_token_response(response.json())

    async def refresh(self, refresh_token: str) -> AuthSession:
        response = await self._client.post(
            "/token",
            params={"grant_type": "refresh_token"},
            json={"refresh_token": refresh_token},
        )
        if response.status_code != 200:
            raise self._error_from_response(response)
        return self._session_from_token_response(response.json())

    async def exchange_pkce(self, code: str, code_verifier: str) -> AuthSession:
        response = await self._client.post(
            "/token",
            params={"grant_type": "pkce"},
            json={"auth_code": code, "code_verifier": code_verifier},
        )
        if response.status_code != 200:
            raise self._error_from_response(response)
        return self._session_from_token_response(response.json())

    async def get_user(self, access_token: str) -> AuthUser:
        response = await self._client.get(
            "/user", headers={"authorization": f"Bearer {access_token}"}
        )
        if response.status_code != 200:
            logger.warning("access token rejected", extra={"status_code": response.status_code})
            raise ApiError(401, "session_expired", "Session expired. Sign in again.")
        user = self._user_from(response.json())
        if user is None:
            raise ApiError(401, "session_expired", "Session expired. Sign in again.")
        return user

    async def revoke(self, access_token: str) -> None:
        """Best-effort sign-out on the Supabase side; never raises."""
        try:
            await self._client.post("/logout", headers={"authorization": f"Bearer {access_token}"})
        except httpx.HTTPError:
            logger.warning("supabase logout request failed")

    def authorize_url(
        self, *, provider: str, redirect_to: str, code_challenge: str, state: str
    ) -> str:
        query = urlencode(
            {
                "provider": provider,
                "redirect_to": redirect_to,
                "code_challenge": code_challenge,
                "code_challenge_method": "s256",
                "state": state,
            }
        )
        return f"{self._settings.auth_base_url}/authorize?{query}"
