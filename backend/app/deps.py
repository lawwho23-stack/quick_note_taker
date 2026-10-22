"""Shared FastAPI dependencies."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts import get_account
from app.config import Settings, get_settings
from app.db import get_session
from app.errors import ApiError
from app.models import User
from app.supabase_auth import SupabaseAuth


@dataclass(frozen=True, slots=True)
class Identity:
    """The authenticated Supabase identity behind a request."""

    auth_user_id: str
    email: str | None
    access_token: str
    source: str  # "cookie" | "bearer"


async def get_auth_provider(
    settings: Settings = Depends(get_settings),
) -> AsyncIterator[SupabaseAuth]:
    """A fresh Supabase Auth client per request; never shared between users."""
    provider = SupabaseAuth(settings)
    try:
        yield provider
    finally:
        await provider.aclose()


def client_ip(request: Request) -> str:
    """The caller's IP: Vercel puts the real client first in x-forwarded-for."""
    forwarded = request.headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    if first:
        return first
    return request.client.host if request.client else "unknown"


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
    """Resolve and verify the caller's Supabase identity (cookie or bearer token)."""
    token = _bearer_token(request)
    source = "bearer"
    if token is None:
        token = request.cookies.get(settings.access_cookie)
        source = "cookie"
    if not token:
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
