"""Application settings, loaded from environment variables or backend/.env."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. One instance per process."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # General
    app_env: Literal["local", "staging", "production"] = "local"
    log_level: str = "INFO"

    # Supabase Auth
    supabase_url: str
    supabase_anon_key: str

    # Database connections (owner/migration and runtime)
    database_url: str = ""
    runtime_database_url: str = ""

    # Website
    web_base_url: str = "http://localhost:3000"
    web_origin_allowlist: str = "http://localhost:3000"

    # Cookies (all app cookies are host-only: no Domain attribute)
    cookies_secure: bool = False
    cookie_same_site: Literal["lax", "strict", "none"] = "lax"
    access_cookie: str = "qn_at"
    refresh_cookie: str = "qn_rt"
    csrf_cookie: str = "qn_csrf"
    oauth_state_cookie: str = "qn_oauth_state"
    pkce_cookie: str = "qn_pkce"
    next_cookie: str = "qn_next"
    access_cookie_max_age: int = 3600
    refresh_cookie_max_age: int = 60 * 60 * 24 * 30
    oauth_flow_cookie_max_age: int = 600
    csrf_cookie_max_age: int = 60 * 60 * 24 * 30
    default_next_path: str = "/notes"

    @field_validator("supabase_url", "web_base_url")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @property
    def auth_base_url(self) -> str:
        """Base URL of the Supabase Auth (GoTrue) REST API."""
        return f"{self.supabase_url}/auth/v1"

    @property
    def allowed_origins(self) -> list[str]:
        return [
            item.strip().rstrip("/")
            for item in self.web_origin_allowlist.split(",")
            if item.strip()
        ]

    @property
    def runtime_database_uri(self) -> str:
        """The connection the API uses at runtime (falls back to the owner URL)."""
        return self.runtime_database_url or self.database_url


def as_sqlalchemy_url(raw: str) -> str:
    """Return the psycopg (async) SQLAlchemy URL for a Postgres connection string."""
    if raw.startswith(("postgresql+psycopg://", "postgres+psycopg://")):
        return raw
    for prefix in ("postgresql://", "postgres://"):
        if raw.startswith(prefix):
            return "postgresql+psycopg://" + raw[len(prefix) :]
    return raw


@lru_cache
def get_settings() -> Settings:
    return Settings()
