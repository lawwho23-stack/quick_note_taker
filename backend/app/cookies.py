"""Cookie helpers.

Rules for every app cookie:
- host-only (no Domain attribute), so cookies never leak to sibling hosts;
- Path=/ so the same cookies work through the website rewrite (`/api/v1/*`)
  and when the API is called directly (`/v1/*`);
- Secure on staging/production, SameSite=Lax;
- tokens are HttpOnly; only the CSRF token is readable by JavaScript.
"""

from __future__ import annotations

from typing import Any

from fastapi import Request, Response

from app.auth_types import AuthSession
from app.config import Settings
from app.security import new_secret


def _cookie_kwargs(settings: Settings) -> dict[str, Any]:
    return {
        "path": "/",
        "secure": settings.cookies_secure,
        "samesite": settings.cookie_same_site,
    }


def set_session_cookies(response: Response, settings: Settings, session: AuthSession) -> str:
    """Attach access, refresh, and CSRF cookies. Returns the new CSRF token."""
    response.set_cookie(
        settings.access_cookie,
        session.access_token,
        max_age=max(60, session.expires_in),
        httponly=True,
        **_cookie_kwargs(settings),
    )
    if session.refresh_token:
        response.set_cookie(
            settings.refresh_cookie,
            session.refresh_token,
            max_age=settings.refresh_cookie_max_age,
            httponly=True,
            **_cookie_kwargs(settings),
        )
    csrf_token = new_secret(24)
    response.set_cookie(
        settings.csrf_cookie,
        csrf_token,
        max_age=settings.csrf_cookie_max_age,
        httponly=False,
        **_cookie_kwargs(settings),
    )
    return csrf_token


def clear_session_cookies(response: Response, settings: Settings) -> None:
    for name in (settings.access_cookie, settings.refresh_cookie, settings.csrf_cookie):
        response.delete_cookie(name, **_cookie_kwargs(settings))


def ensure_csrf_cookie(request: Request, response: Response, settings: Settings) -> str:
    """Set a CSRF cookie when the visitor has none yet (start of a session)."""
    existing = request.cookies.get(settings.csrf_cookie)
    if existing:
        return existing
    csrf_token = new_secret(24)
    response.set_cookie(
        settings.csrf_cookie,
        csrf_token,
        max_age=settings.csrf_cookie_max_age,
        httponly=False,
        **_cookie_kwargs(settings),
    )
    return csrf_token


def set_oauth_cookies(
    response: Response,
    settings: Settings,
    *,
    verifier: str,
    state: str,
    next_path: str,
) -> None:
    """Persist the PKCE verifier, OAuth state, and post-login destination."""
    flow_kwargs = {**_cookie_kwargs(settings), "max_age": settings.oauth_flow_cookie_max_age}
    response.set_cookie(settings.pkce_cookie, verifier, httponly=True, **flow_kwargs)
    response.set_cookie(settings.oauth_state_cookie, state, httponly=True, **flow_kwargs)
    response.set_cookie(settings.next_cookie, next_path, httponly=True, **flow_kwargs)


def clear_oauth_cookies(response: Response, settings: Settings) -> None:
    for name in (settings.pkce_cookie, settings.oauth_state_cookie, settings.next_cookie):
        response.delete_cookie(name, **_cookie_kwargs(settings))
