"""Application settings, loaded from environment variables or backend/.env."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Stable because of the `key` in frontend/extension/manifest.json.
DEFAULT_EXTENSION_ORIGIN = "chrome-extension://mpnpdndkgajhjmlefflhemibjmkkcnha"


def _split_origins(raw: str) -> list[str]:
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


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

    # Account deletion (Supabase Auth admin API). Empty: DELETE /v1/me answers 503.
    supabase_service_role_key: str = ""

    # Browser extension origins allowed by CORS (comma separated).
    extension_origin_allowlist: str = DEFAULT_EXTENSION_ORIGIN

    # Rate limiting (Upstash Redis REST). Both empty: the limiter allows everything.
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""

    # Error tracking. Empty: Sentry is not initialised.
    sentry_dsn: str = ""

    @field_validator("supabase_url", "web_base_url", "upstash_redis_rest_url")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @property
    def auth_base_url(self) -> str:
        """Base URL of the Supabase Auth (GoTrue) REST API."""
        return f"{self.supabase_url}/auth/v1"

    @property
    def allowed_origins(self) -> list[str]:
        """Website origins: CSRF origin checks and credentialed CORS."""
        return _split_origins(self.web_origin_allowlist)

    @property
    def extension_origins(self) -> list[str]:
        return _split_origins(self.extension_origin_allowlist)

    @property
    def cors_origins(self) -> list[str]:
        """Website origins plus extension origins, without duplicates. Never a wildcard."""
        merged = dict.fromkeys([*self.allowed_origins, *self.extension_origins])
        return [origin for origin in merged if origin != "*"]

    @property
    def rate_limit_configured(self) -> bool:
        return bool(self.upstash_redis_rest_url and self.upstash_redis_rest_token)

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
