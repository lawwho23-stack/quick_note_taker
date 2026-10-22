"""Request and response models for the public API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

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
