"""Shared authentication value objects (no framework dependencies)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AuthUser:
    """A Supabase Auth identity."""

    id: str
    email: str | None


@dataclass(frozen=True, slots=True)
class AuthSession:
    """A Supabase Auth session, to be stored in host-only cookies."""

    access_token: str
    refresh_token: str
    expires_in: int
    user: AuthUser
    expires_at: int | None = None


@dataclass(frozen=True, slots=True)
class SignUpResult:
    """Result of Supabase sign-up: a session only when confirmation is disabled."""

    user: AuthUser | None
    session: AuthSession | None
