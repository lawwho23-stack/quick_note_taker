"""Request and response models for the public API."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


class ResendRequest(BaseModel):
    email: EmailStr


class ExchangeRequest(BaseModel):
    """Session handoff for email confirmation links (fragment tokens or PKCE code)."""

    access_token: str | None = Field(default=None, min_length=1, max_length=4096)
    refresh_token: str | None = Field(default=None, min_length=1, max_length=1024)
    # Sets the access cookie's lifetime, so keep it within what Supabase issues.
    expires_in: int | None = Field(default=None, ge=60, le=3600)
    code: str | None = Field(default=None, min_length=1, max_length=1024)


class UserOut(BaseModel):
    id: str
    email: str | None


class AccountOut(BaseModel):
    id: str
    email: str | None
    created_at: datetime


class AuthResponse(BaseModel):
    status: Literal["signed_in"] = "signed_in"
    user: UserOut
    account: AccountOut
    access_token_expires_at: int | None = None


class RegisterResponse(BaseModel):
    status: Literal["signed_in", "confirmation_required"]
    user: UserOut | None = None
    account: AccountOut | None = None
    access_token_expires_at: int | None = None


class SessionResponse(BaseModel):
    authenticated: bool
    user: UserOut | None = None
    access_token_expires_at: int | None = None


class MeResponse(BaseModel):
    user: UserOut
    account: AccountOut


class HealthResponse(BaseModel):
    status: str
    environment: str
    commit: str


# Notes ----------------------------------------------------------------------

NOTE_MAX_CHARS = 20_000
META_MAX_BYTES = 4_096


class NoteCreate(BaseModel):
    """Create a note. The client generates `id`, so a retry can never duplicate it."""

    id: uuid.UUID
    body: str = Field(min_length=1)
    source: str = Field(default="web", pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    meta: dict[str, Any] = Field(default_factory=dict)


class NoteUpdate(BaseModel):
    body: str = Field(min_length=1)
    base_version: int = Field(ge=1)


class NoteOut(BaseModel):
    id: uuid.UUID
    body: str
    version: int
    source: str
    meta: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class NoteCreateAck(BaseModel):
    """What a create returns. No body, so a token that can only create cannot read notes."""

    id: uuid.UUID
    version: int
    created_at: datetime


class NoteList(BaseModel):
    items: list[NoteOut]
    next_cursor: str | None = None
