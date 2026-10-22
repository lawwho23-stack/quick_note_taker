"""Authentication endpoints.

The website talks to these endpoints through the Next.js rewrite (`/api/v1/*`
-> API `/v1/*`). Session state lives only in host-only, HttpOnly cookies.
"""

from __future__ import annotations

import logging
import secrets
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts import account_out, ensure_account
from app.auth_types import AuthSession
from app.config import Settings, get_settings
from app.cookies import (
    clear_oauth_cookies,
    clear_session_cookies,
    ensure_csrf_cookie,
    set_oauth_cookies,
    set_session_cookies,
)
from app.db import get_session
from app.deps import client_ip, get_auth_provider
from app.errors import ApiError, error_body
from app.models import User
from app.rate_limit import (
    LOGIN,
    REGISTER,
    RESEND_BURST,
    RESEND_HOURLY,
    RateLimiter,
    get_rate_limiter,
)
from app.schemas import (
    AuthResponse,
    ExchangeRequest,
    LoginRequest,
    RegisterRequest,
    RegisterResponse,
    ResendRequest,
    SessionResponse,
    UserOut,
)
from app.security import (
    jwt_expiry,
    pkce_pair,
    require_cookie_csrf,
    sanitize_next_path,
    sha256_hex,
)
from app.single_flight import cached_session, refresh_lock, store_session
from app.supabase_auth import SupabaseAuth

logger = logging.getLogger("quick_note.auth")

router = APIRouter(prefix="/v1/auth", tags=["auth"], dependencies=[Depends(require_cookie_csrf)])

SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
ProviderDep = Annotated[SupabaseAuth, Depends(get_auth_provider)]
LimiterDep = Annotated[RateLimiter, Depends(get_rate_limiter)]


def _user_out(auth_session: AuthSession) -> UserOut:
    return UserOut(id=auth_session.user.id, email=auth_session.user.email)


def _auth_response(auth_session: AuthSession, account: User) -> AuthResponse:
    return AuthResponse(
        user=_user_out(auth_session),
        account=account_out(account),
        access_token_expires_at=auth_session.expires_at or jwt_expiry(auth_session.access_token),
    )


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=error_body(code, message))


def _confirmation_redirect(settings: Settings) -> str:
    """Where a confirmation email link returns the browser.

    Points at the website route that exchanges the link for session cookies.
    """
    return f"{settings.web_base_url}/auth/confirm"


@router.post("/register", response_model=RegisterResponse)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    provider: ProviderDep,
    limiter: LimiterDep,
    session: SessionDep,
    settings: SettingsDep,
) -> RegisterResponse:
    """Create an account. With email confirmation on, no session is issued yet."""
    await limiter.hit(REGISTER, client_ip(request))
    result = await provider.sign_up(
        payload.email,
        payload.password,
        redirect_to=_confirmation_redirect(settings),
    )
    if result.session is None:
        return RegisterResponse(
            status="confirmation_required",
            user=UserOut(id=result.user.id, email=result.user.email) if result.user else None,
        )
    account = await ensure_account(
        session,
        auth_user_id=result.session.user.id,
        email=result.session.user.email,
    )
    set_session_cookies(response, settings, result.session)
    return RegisterResponse(
        status="signed_in",
        user=_user_out(result.session),
        account=account_out(account),
        access_token_expires_at=result.session.expires_at
        or jwt_expiry(result.session.access_token),
    )


@router.post("/resend", status_code=202)
async def resend_confirmation(
    payload: ResendRequest,
    provider: ProviderDep,
    limiter: LimiterDep,
    settings: SettingsDep,
) -> Response:
    """Send another confirmation email.

    Answers 202 whether or not the address has an account, so the endpoint cannot
    be used to discover accounts. Rate limits are the exception: the user must
    learn to wait instead of being told an email is on its way.
    """
    email = payload.email.lower()
    await limiter.hit(RESEND_BURST, email)
    await limiter.hit(RESEND_HOURLY, email)
    try:
        await provider.resend_confirmation(
            payload.email, redirect_to=_confirmation_redirect(settings)
        )
    except ApiError as exc:
        if exc.status_code >= 500 or exc.code == "rate_limited":
            raise
        logger.info("resend confirmation suppressed", extra={"error_code": exc.code})
    return Response(status_code=202)


@router.post("/login", response_model=AuthResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    provider: ProviderDep,
    limiter: LimiterDep,
    session: SessionDep,
    settings: SettingsDep,
) -> AuthResponse:
    await limiter.hit(LOGIN, f"{client_ip(request)}|{payload.email.lower()}")
    auth_session = await provider.sign_in(payload.email, payload.password)
    account = await ensure_account(
        session,
        auth_user_id=auth_session.user.id,
        email=auth_session.user.email,
    )
    set_session_cookies(response, settings, auth_session)
    return _auth_response(auth_session, account)


@router.get("/google")
async def google_login(
    provider: ProviderDep,
    settings: SettingsDep,
    next_path: Annotated[str | None, Query(alias="next")] = None,
) -> RedirectResponse:
    """Start the Google flow with PKCE; the verifier travels in an HttpOnly cookie."""
    verifier, challenge = pkce_pair()
    state = secrets.token_urlsafe(24)
    destination = sanitize_next_path(next_path, settings.default_next_path)
    redirect_to = f"{settings.web_base_url}/api/v1/auth/callback"
    authorize_url = provider.authorize_url(
        provider="google",
        redirect_to=redirect_to,
        code_challenge=challenge,
        state=state,
    )
    response = RedirectResponse(authorize_url, status_code=302)
    set_oauth_cookies(response, settings, verifier=verifier, state=state, next_path=destination)
    return response


@router.get("/callback")
async def google_callback(
    request: Request,
    provider: ProviderDep,
    session: SessionDep,
    settings: SettingsDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Finish the Google flow: validate, exchange, set cookies, return to the website."""
    next_path = sanitize_next_path(
        request.cookies.get(settings.next_cookie), settings.default_next_path
    )

    def failure(reason: str) -> RedirectResponse:
        logger.warning("google callback failed", extra={"error_code": reason})
        response = RedirectResponse(
            f"{settings.web_base_url}/sign-in?auth_error={quote(reason)}", status_code=302
        )
        clear_oauth_cookies(response, settings)
        return response

    if error:
        return failure(error)
    if not code:
        return failure("missing_code")

    expected_state = request.cookies.get(settings.oauth_state_cookie)
    if not expected_state or not state:
        return failure("state_missing")
    if not secrets.compare_digest(state, expected_state):
        return failure("state_mismatch")

    verifier = request.cookies.get(settings.pkce_cookie)
    if not verifier:
        return failure("missing_verifier")

    try:
        auth_session = await provider.exchange_pkce(code, verifier)
    except ApiError as exc:
        logger.warning("pkce exchange failed", extra={"error_code": exc.code})
        return failure("exchange_failed")

    await ensure_account(
        session,
        auth_user_id=auth_session.user.id,
        email=auth_session.user.email,
    )
    response = RedirectResponse(f"{settings.web_base_url}{next_path}", status_code=302)
    set_session_cookies(response, settings, auth_session)
    clear_oauth_cookies(response, settings)
    return response


@router.post("/exchange", response_model=AuthResponse)
async def exchange_session(
    payload: ExchangeRequest,
    request: Request,
    response: Response,
    provider: ProviderDep,
    session: SessionDep,
    settings: SettingsDep,
) -> AuthResponse:
    """Accept a session from an email confirmation link (fragment tokens or PKCE code)."""
    if payload.access_token:
        user = await provider.get_user(payload.access_token)
        auth_session = AuthSession(
            access_token=payload.access_token,
            refresh_token=payload.refresh_token or "",
            expires_in=payload.expires_in or settings.access_cookie_max_age,
            user=user,
        )
    elif payload.code:
        verifier = request.cookies.get(settings.pkce_cookie)
        if not verifier:
            raise ApiError(400, "oauth_exchange_failed", "The sign-in attempt expired. Try again.")
        auth_session = await provider.exchange_pkce(payload.code, verifier)
    else:
        raise ApiError(400, "validation_error", "Provide access_token or code.")

    account = await ensure_account(
        session,
        auth_user_id=auth_session.user.id,
        email=auth_session.user.email,
    )
    set_session_cookies(response, settings, auth_session)
    clear_oauth_cookies(response, settings)
    return _auth_response(auth_session, account)


@router.post("/refresh")
async def refresh_session(
    request: Request,
    provider: ProviderDep,
    session: SessionDep,
    settings: SettingsDep,
) -> Response:
    """Rotate the session. Concurrent calls with the same token are single-flighted."""
    refresh_token = request.cookies.get(settings.refresh_cookie)
    if not refresh_token:
        response = _error_response(401, "session_expired", "Session expired. Sign in again.")
        clear_session_cookies(response, settings)
        return response

    cache_key = sha256_hex(refresh_token)
    auth_session = cached_session(cache_key)
    if auth_session is None:
        async with refresh_lock(cache_key):
            auth_session = cached_session(cache_key)
            if auth_session is None:
                try:
                    auth_session = await provider.refresh(refresh_token)
                except ApiError as exc:
                    response = _error_response(exc.status_code, exc.code, exc.message)
                    # Only a rejected refresh token ends the session. An outage or a
                    # rate limit keeps the cookies so the next try can still work.
                    if exc.status_code in (400, 401):
                        clear_session_cookies(response, settings)
                    return response
                store_session(cache_key, auth_session)

    account = await ensure_account(
        session,
        auth_user_id=auth_session.user.id,
        email=auth_session.user.email,
    )
    response = JSONResponse(content=_auth_response(auth_session, account).model_dump(mode="json"))
    set_session_cookies(response, settings, auth_session)
    return response


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    provider: ProviderDep,
    settings: SettingsDep,
) -> Response:
    """End the current website session. Extension tokens are revoked separately."""
    access_token = request.cookies.get(settings.access_cookie)
    if access_token:
        await provider.revoke(access_token)
    response = Response(status_code=204)
    clear_session_cookies(response, settings)
    clear_oauth_cookies(response, settings)
    return response


@router.get("/session", response_model=SessionResponse)
async def session_info(
    request: Request,
    response: Response,
    provider: ProviderDep,
    settings: SettingsDep,
) -> SessionResponse:
    """Lightweight session probe for the website's first paint.

    Also guarantees a CSRF cookie exists, so later writes can use double submit.
    """
    ensure_csrf_cookie(request, response, settings)
    access_token = request.cookies.get(settings.access_cookie)
    if not access_token:
        return SessionResponse(authenticated=False)
    user = await provider.get_user(access_token)  # raises 401 session_expired when invalid
    return SessionResponse(
        authenticated=True,
        user=UserOut(id=user.id, email=user.email),
        access_token_expires_at=jwt_expiry(access_token),
    )
