"""Shared test fixtures.

The unit tests are hermetic: no network, no database. The Supabase Auth client
and the database session are replaced with configurable fakes.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime

# Settings are required at import time; give tests safe defaults.
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:54322/postgres")
os.environ.setdefault(
    "RUNTIME_DATABASE_URL", "postgresql://postgres:postgres@localhost:54322/postgres"
)

import pytest
from app import single_flight
from app.auth_types import AuthSession, AuthUser, SignUpResult
from app.config import Settings
from app.db import get_session
from app.deps import get_auth_provider
from app.errors import ApiError
from app.main import create_app
from app.models import User
from fastapi import FastAPI
from fastapi.testclient import TestClient

ALLOWED_ORIGIN = "http://localhost:3000"


def make_account(*, email: str | None = "user@example.com") -> User:
    now = datetime.now(UTC)
    return User(
        id=uuid.uuid4(),
        auth_user_id=uuid.uuid4(),
        email=email,
        created_at=now,
        updated_at=now,
    )


class FakeAuthProvider:
    """Stands in for SupabaseAuth. Records calls; behaviour is configurable."""

    def __init__(self) -> None:
        self.user_id = str(uuid.uuid4())
        self.email = "user@example.com"
        self.sign_in_calls = 0
        self.refresh_calls = 0
        self.revoked: list[str] = []
        self.authorize_calls: list[dict[str, str]] = []
        self.signup_requires_confirmation = False
        self.fail_sign_in: ApiError | None = None
        self.fail_refresh: ApiError | None = None
        self.fail_exchange: ApiError | None = None
        self.reject_tokens = False
        self._serial = 0

    def _session(self) -> AuthSession:
        self._serial += 1
        return AuthSession(
            access_token=f"access-{self._serial}",
            refresh_token=f"refresh-{self._serial}",
            expires_in=3600,
            user=AuthUser(id=self.user_id, email=self.email),
        )

    async def sign_up(self, email: str, password: str) -> SignUpResult:
        user = AuthUser(id=self.user_id, email=email)
        return SignUpResult(
            user=user, session=None if self.signup_requires_confirmation else self._session()
        )

    async def sign_in(self, email: str, password: str) -> AuthSession:
        self.sign_in_calls += 1
        if self.fail_sign_in is not None:
            raise self.fail_sign_in
        return self._session()

    async def refresh(self, refresh_token: str) -> AuthSession:
        self.refresh_calls += 1
        if self.fail_refresh is not None:
            raise self.fail_refresh
        return self._session()

    async def get_user(self, access_token: str) -> AuthUser:
        if self.reject_tokens:
            raise ApiError(401, "session_expired", "Session expired. Sign in again.")
        return AuthUser(id=self.user_id, email=self.email)

    async def revoke(self, access_token: str) -> None:
        self.revoked.append(access_token)

    def authorize_url(
        self, *, provider: str, redirect_to: str, code_challenge: str, state: str
    ) -> str:
        self.authorize_calls.append(
            {
                "provider": provider,
                "redirect_to": redirect_to,
                "code_challenge": code_challenge,
                "state": state,
            }
        )
        return f"https://supabase.test/auth/v1/authorize?provider={provider}&state={state}"

    async def exchange_pkce(self, code: str, code_verifier: str) -> AuthSession:
        if self.fail_exchange is not None:
            raise self.fail_exchange
        return self._session()


class FakeResult:
    def __init__(self, value: User | None, *, missing: bool = False) -> None:
        self._value = value
        self._missing = missing

    def scalar_one(self) -> User:
        assert self._value is not None, "expected an inserted/returned row"
        return self._value

    def scalar_one_or_none(self) -> User | None:
        return None if self._missing else self._value


class FakeDbSession:
    """Mimics enough of AsyncSession for account upserts and lookups."""

    def __init__(self, account: User | None = None) -> None:
        self.account = account
        self.upserts = 0
        self.commits = 0

    async def execute(self, statement: object) -> FakeResult:
        if getattr(statement, "is_insert", False):
            self.upserts += 1
            if self.account is None:
                self.account = make_account()
            return FakeResult(self.account)
        return FakeResult(self.account, missing=self.account is None)

    async def commit(self) -> None:
        self.commits += 1


class _FakeConnectionContext:
    def __init__(self, fail: bool) -> None:
        self._fail = fail

    async def __aenter__(self) -> _FakeConnectionContext:
        if self._fail:
            raise RuntimeError("database unavailable")
        return self

    async def __aexit__(self, *exc_info: object) -> bool:
        return False

    async def execute(self, *args: object) -> None:
        return None


class FakeEngine:
    """Stands in for AsyncEngine in readiness tests."""

    def __init__(self, *, fail: bool = False) -> None:
        self._fail = fail

    def connect(self) -> _FakeConnectionContext:
        return _FakeConnectionContext(self._fail)


@pytest.fixture(autouse=True)
def _reset_single_flight() -> Iterator[None]:
    single_flight.clear_cache()
    yield
    single_flight.clear_cache()


@pytest.fixture
def settings() -> Settings:
    return Settings(
        app_env="local",
        supabase_url="http://localhost:54321",
        supabase_anon_key="test-anon-key",
        database_url="postgresql://postgres:postgres@localhost:54322/postgres",
        web_base_url=ALLOWED_ORIGIN,
        web_origin_allowlist=ALLOWED_ORIGIN,
        cookies_secure=False,
    )


@pytest.fixture
def fake_provider() -> FakeAuthProvider:
    return FakeAuthProvider()


@pytest.fixture
def fake_db() -> FakeDbSession:
    return FakeDbSession()


@pytest.fixture
def app(
    settings: Settings, fake_provider: FakeAuthProvider, fake_db: FakeDbSession
) -> Iterator[FastAPI]:
    application = create_app(settings)
    application.dependency_overrides[get_auth_provider] = lambda: fake_provider

    async def _session_override() -> AsyncIterator[FakeDbSession]:
        yield fake_db

    application.dependency_overrides[get_session] = _session_override
    yield application


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
