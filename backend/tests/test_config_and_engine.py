"""Configuration helpers, PKCE, redirect sanitising, and engine settings."""

from __future__ import annotations

import base64
import hashlib

import pytest
from app import db
from app.config import Settings, as_sqlalchemy_url
from app.security import pkce_pair, sanitize_next_path
from sqlalchemy.pool import NullPool


def test_as_sqlalchemy_url_conversions() -> None:
    assert as_sqlalchemy_url("postgres://u:p@h:5432/db") == "postgresql+psycopg://u:p@h:5432/db"
    assert as_sqlalchemy_url("postgresql://u:p@h:6543/db") == "postgresql+psycopg://u:p@h:6543/db"
    assert (
        as_sqlalchemy_url("postgresql+psycopg://u:p@h:6543/db")
        == "postgresql+psycopg://u:p@h:6543/db"
    )


def test_allowed_origins_parsing() -> None:
    settings = Settings(
        supabase_url="https://project.supabase.co",
        supabase_anon_key="key",
        web_origin_allowlist="http://localhost:3000, https://web.example/",
    )

    assert settings.allowed_origins == ["http://localhost:3000", "https://web.example"]


def test_runtime_database_uri_falls_back_to_owner_url() -> None:
    settings = Settings(
        supabase_url="https://project.supabase.co",
        supabase_anon_key="key",
        database_url="postgresql://owner@h/db",
        runtime_database_url="",
    )

    assert settings.runtime_database_uri == "postgresql://owner@h/db"

    settings_with_runtime = Settings(
        supabase_url="https://project.supabase.co",
        supabase_anon_key="key",
        database_url="postgresql://owner@h/db",
        runtime_database_url="postgresql://runtime@h:6543/db",
    )
    assert settings_with_runtime.runtime_database_uri == "postgresql://runtime@h:6543/db"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, "/notes"),
        ("", "/notes"),
        ("/settings", "/settings"),
        ("//evil.example", "/notes"),
        ("https://evil.example/steal", "/notes"),
        ("/path\\with\\backslash", "/notes"),
        ("/line\nbreak", "/notes"),
    ],
)
def test_sanitize_next_path(value: str | None, expected: str) -> None:
    assert sanitize_next_path(value, "/notes") == expected


def test_pkce_pair_is_s256() -> None:
    verifier, challenge = pkce_pair()

    assert len(verifier) >= 43
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    assert challenge == expected


def test_build_engine_uses_nullpool_without_prepared_statements(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def fake_create_async_engine(url: str, **kwargs: object) -> object:
        captured["url"] = url
        captured["kwargs"] = kwargs
        return object()

    monkeypatch.setattr(db, "create_async_engine", fake_create_async_engine)

    db.build_engine("postgresql://u:p@aws-0-region.pooler.supabase.com:6543/postgres")

    assert (
        captured["url"] == "postgresql+psycopg://u:p@aws-0-region.pooler.supabase.com:6543/postgres"
    )
    kwargs = captured["kwargs"]
    assert isinstance(kwargs, dict)
    assert kwargs["poolclass"] is NullPool
    assert kwargs["connect_args"] == {"prepare_threshold": None}
