"""Optional Sentry error tracking. Notes are private: no note body may reach Sentry.

Defences, from outermost in:
- Sentry never reads request bodies, never sends PII, never records frame locals
  (a handler's locals hold the note payload);
- SQLAlchemy hides bound values in its error messages (see `app.db`);
- `scrub_event` drops anything request-shaped that could still carry user data,
  including the query string (search terms are note text).
"""

from __future__ import annotations

from typing import Any

import sentry_sdk

from app.config import Settings

_SAFE_HEADERS = frozenset({"user-agent", "x-request-id", "content-type", "content-length"})


def scrub_event(event: Any, _hint: Any) -> Any:
    """Remove request bodies, cookies, query strings and credentials from an event."""
    request = event.get("request")
    if isinstance(request, dict):
        for key in ("data", "cookies", "query_string", "env"):
            request.pop(key, None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {
                name: value for name, value in headers.items() if name.lower() in _SAFE_HEADERS
            }
        url = request.get("url")
        if isinstance(url, str):
            request["url"] = url.split("?", 1)[0]
    event.pop("user", None)
    for exception in (event.get("exception") or {}).get("values") or []:
        for frame in (exception.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)
    return event


def init_error_tracking(settings: Settings) -> bool:
    """Start Sentry when `SENTRY_DSN` is set. Returns whether it was started."""
    if not settings.sentry_dsn:
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        traces_sample_rate=0.0,
        before_send=scrub_event,
        before_send_transaction=scrub_event,
    )
    return True
