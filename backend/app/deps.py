"""Shared FastAPI dependencies: who is calling, and what they may do.

Two kinds of caller (principal) exist:
- a website session: the session cookie or a Supabase JWT bearer token;
- an extension token: `Authorization: Bearer qnx_...`, scope `notes:create` only.

Extension tokens are accepted only where a route asks for `current_principal`
(`POST /v1/notes` and `GET /v1/extension/status`). Every session-only route goes
through `current_identity`, which answers `403 wrong_scope` to an extension token
without ever sending it to Supabase.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Literal

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts import get_account
from app.config import Settings, get_settings
from app.db import get_session
from app.errors import ApiError
from app.extension_tokens import ExtensionTokenStore, get_token_store, is_extension_token
from app.models import User
from app.rate_limit import (
    EXTENSION_LIMIT,
    SESSION_LIMIT,
    RateLimiter,
    enforce,
    get_rate_limiter,
)
from app.supabase_auth import SupabaseAuth

# A website session may do everything its account may do.
SESSION_SCOPES = frozenset({"notes:create", "notes:read", "notes:write", "account"})


@dataclass(frozen=True, slots=True)
class Identity:
    """The authenticated Supabase identity behind a request."""

    auth_user_id: str
    email: str | None
    access_token: str
    source: str  # "cookie" | "bearer"


@dataclass(frozen=True, slots=True)
class Principal:
    """The caller of a request and what it is allowed to do."""

    kind: Literal["session", "extension"]
    account: User
    token_id: uuid.UUID | None = None
    scopes: frozenset[str] = field(default_factory=frozenset)


def wrong_scope() -> ApiError:
    return ApiError(403, "wrong_scope", "This credential cannot be used here.")


async def get_auth_provider(
    settings: Settings = Depends(get_settings),
) -> AsyncIterator[SupabaseAuth]:
    """A fresh Supabase Auth client per request; never shared between users."""
    provider = SupabaseAuth(settings)
    try:
        yield provider
    finally:
        await provider.aclose()


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
        return token or None
    return None


async def current_identity(
    request: Request,
    provider: SupabaseAuth = Depends(get_auth_provider),
    settings: Settings = Depends(get_settings),
) -> Identity:
    """Resolve and verify the caller's Supabase identity (cookie or bearer token).

    An extension token is refused here with 403, so it never reaches Supabase.
    """
    token = _bearer_token(request)
    source = "bearer"
    if token is not None and is_extension_token(token):
        raise wrong_scope()
    if token is None:
        token = request.cookies.get(settings.access_cookie)
        source = "cookie"
    if not token:
        # The access cookie expires with its token, so after an hour it is simply
        # gone. A refresh cookie means the session can still be renewed.
        if source == "cookie" and request.cookies.get(settings.refresh_cookie):
            raise ApiError(401, "session_expired", "Session expired. Refresh to continue.")
        raise ApiError(401, "unauthenticated", "Sign in to continue.")
    user = await provider.get_user(token)
    return Identity(auth_user_id=user.id, email=user.email, access_token=token, source=source)


async def current_account(
    identity: Identity = Depends(current_identity),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Resolve the application account for the verified identity.

    Missing account rows are an error, not something to create on the fly.
    """
    account = await get_account(session, auth_user_id=identity.auth_user_id)
    if account is None:
        raise ApiError(401, "account_not_found", "This account is no longer available.")
    return account


async def require_session_account(
    account: User = Depends(current_account),
    limiter: RateLimiter = Depends(get_rate_limiter),
) -> User:
    """A website session's account, counted against the per-account rate limit."""
    await enforce(limiter, f"session:{account.id}", SESSION_LIMIT, fail_open=True)
    return account


async def current_principal(
    request: Request,
    provider: SupabaseAuth = Depends(get_auth_provider),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
    tokens: ExtensionTokenStore = Depends(get_token_store),
    limiter: RateLimiter = Depends(get_rate_limiter),
) -> Principal:
    """Resolve either kind of caller, for the routes that accept extension tokens."""
    token = _bearer_token(request)
    if token is not None and is_extension_token(token):
        row, account = await tokens.authenticate(token)
        await enforce(limiter, f"extension:{row.id}", EXTENSION_LIMIT, fail_open=True)
        return Principal(
            kind="extension", account=account, token_id=row.id, scopes=frozenset(row.scopes)
        )
    identity = await current_identity(request, provider, settings)
    account = await current_account(identity, session)
    account = await require_session_account(account, limiter)
    return Principal(kind="session", account=account, scopes=SESSION_SCOPES)


def require_scope(scope: str) -> Callable[..., Awaitable[Principal]]:
    """A dependency that admits any principal holding `scope`, and 403s the rest."""

    async def _require(principal: Principal = Depends(current_principal)) -> Principal:
        if scope not in principal.scopes:
            raise wrong_scope()
        return principal

    return _require


async def require_extension(principal: Principal = Depends(current_principal)) -> Principal:
    """Only an extension token (for the extension's own status check)."""
    if principal.kind != "extension":
        raise wrong_scope()
    return principal
