"""Request-scoped context: request ids, cache headers, access logs."""

from __future__ import annotations

import logging
import time
import uuid
from contextvars import ContextVar

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("quick_note.requests")

REQUEST_ID_HEADER = "x-request-id"
_request_id: ContextVar[str] = ContextVar("request_id", default="-")


def current_request_id() -> str:
    return _request_id.get()


def _clean_request_id(value: str | None) -> str | None:
    """Accept client-supplied request ids only when they are simple and short."""
    if not value:
        return None
    value = value.strip()
    if not value or len(value) > 64:
        return None
    if not all(char.isalnum() or char in "-_." for char in value):
        return None
    return value


class RequestContextMiddleware:
    """Pure ASGI middleware.

    Assigns a request id, echoes it back, marks every API response
    `Cache-Control: private, no-store`, and logs one line per request.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        request_id = (
            _clean_request_id(request_headers.get(REQUEST_ID_HEADER)) or f"req_{uuid.uuid4().hex}"
        )
        scope.setdefault("state", {})["request_id"] = request_id
        token = _request_id.set(request_id)
        started = time.perf_counter()

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                response_headers[REQUEST_ID_HEADER] = request_id
                if "cache-control" not in response_headers:
                    response_headers["cache-control"] = "private, no-store"
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            logger.info(
                "request",
                extra={
                    "request_id": request_id,
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                },
            )
            _request_id.reset(token)
