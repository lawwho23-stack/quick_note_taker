"""Security helpers: CSRF, PKCE, tokens, origin checks."""

from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import urlsplit

from fastapi import Request

from app.config import Settings
from app.errors import ApiError

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


def new_secret(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def pkce_pair() -> tuple[str, str]:
    """Return a PKCE (verifier, S256 challenge) pair."""
    verifier = new_secret(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def jwt_expiry(token: str) -> int | None:
    """Read the `exp` claim of a JWT without verifying it (display purposes only)."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    payload = parts[1]
    padded = payload + "=" * (-len(payload) % 4)
    try:
        import json

        data = json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, TypeError):
        return None
    exp = data.get("exp")
    return int(exp) if isinstance(exp, (int, float)) else None


def request_origin(request: Request) -> str | None:
    """The browser-declared origin of the request (Origin, falling back to Referer)."""
    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/")
    referer = request.headers.get("referer")
    if referer:
        parts = urlsplit(referer)
        if parts.scheme and parts.netloc:
            return f"{parts.scheme}://{parts.netloc}"
    return None


def sanitize_next_path(value: str | None, default: str) -> str:
    """Allow only same-site absolute paths, so a redirect can never leave the website."""
    if not value:
        return default
    if not value.startswith("/") or value.startswith("//"):
        return default
    if any(char in value for char in ("\\", "\r", "\n", ":")):
        return default
    return value


def require_cookie_csrf(request: Request) -> None:
    """Origin allowlist plus double-submit token for cookie-authenticated writes.

    Bearer-token requests are exempt: they are not sent automatically by browsers
    and therefore cannot be forged cross-site.
    """
    if request.method in SAFE_METHODS:
        return
    if request.headers.get("authorization", "").lower().startswith("bearer "):
        return

    settings: Settings = request.app.state.settings
    origin = request_origin(request)
    if origin is None or origin not in settings.allowed_origins:
        raise ApiError(403, "csrf_origin_rejected", "Request origin is not allowed.")

    cookie_value = request.cookies.get(settings.csrf_cookie)
    if cookie_value is None:
        # First request of a session (for example the first sign-in): origin check only.
        return

    header_value = request.headers.get("x-csrf-token")
    if not header_value:
        raise ApiError(403, "csrf_token_missing", "Missing CSRF token header.")
    if not secrets.compare_digest(header_value, cookie_value):
        raise ApiError(403, "csrf_token_mismatch", "CSRF token does not match.")
