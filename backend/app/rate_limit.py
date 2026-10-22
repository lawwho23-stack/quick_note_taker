"""Fixed-window rate limiting on Upstash Redis (REST), behind a small interface.

Each limit is a counter per one-minute window: `INCR` the window's key and set
its expiry once (`EXPIRE ... NX`), both in one pipeline call. The key carries the
window number, so the time left in the window is the `Retry-After` value.

Upstash is reached with a short-lived `httpx` client because Vercel functions do
not keep connections alive between invocations.

Three outcomes matter to callers:
- not configured: everything is allowed (local development, tests);
- configured and over the limit: `429 rate_limited` with `Retry-After`;
- configured but unreachable: `RateLimiterUnavailable`. Notes fail open (and log),
  auth routes fail closed with a 503.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from fastapi import Depends, Request

from app.config import Settings, get_settings
from app.errors import ApiError

logger = logging.getLogger("quick_note.rate_limit")

WINDOW_SECONDS = 60
EXTENSION_LIMIT = 60  # per extension token per minute
SESSION_LIMIT = 300  # per website account per minute
AUTH_LIMIT = 10  # per client IP per minute on auth routes


class RateLimiterUnavailable(Exception):
    """The limiter is configured but could not give an answer."""


@dataclass(frozen=True, slots=True)
class RateLimitResult:
    allowed: bool
    count: int
    retry_after: int  # seconds until the current window ends


class RateLimiter(Protocol):
    async def hit(self, key: str, limit: int) -> RateLimitResult:
        """Count one request against `key` and say whether it is within `limit`."""
        ...


class NoopRateLimiter:
    """Used when Upstash is not configured: allows every request."""

    async def hit(self, key: str, limit: int) -> RateLimitResult:
        return RateLimitResult(allowed=True, count=0, retry_after=0)


class UpstashRateLimiter:
    """Fixed one-minute windows on Upstash Redis through its REST pipeline endpoint."""

    def __init__(
        self,
        url: str,
        token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._url = url.rstrip("/")
        self._token = token
        self._transport = transport
        self._clock = clock

    async def hit(self, key: str, limit: int) -> RateLimitResult:
        now = self._clock()
        window = int(now // WINDOW_SECONDS)
        window_key = f"qn:rl:{key}:{window}"
        # The expiry only cleans up; a new window always uses a new key.
        commands = [["INCR", window_key], ["EXPIRE", window_key, str(WINDOW_SECONDS * 2), "NX"]]
        try:
            async with httpx.AsyncClient(
                transport=self._transport, timeout=httpx.Timeout(2.0, connect=1.0)
            ) as client:
                response = await client.post(
                    f"{self._url}/pipeline",
                    json=commands,
                    headers={"authorization": f"Bearer {self._token}"},
                )
        except httpx.HTTPError as exc:
            raise RateLimiterUnavailable(type(exc).__name__) from exc
        count = _parse_count(response)
        retry_after = max(1, WINDOW_SECONDS - int(now % WINDOW_SECONDS))
        return RateLimitResult(allowed=count <= limit, count=count, retry_after=retry_after)


def _parse_count(response: httpx.Response) -> int:
    if response.status_code != 200:
        raise RateLimiterUnavailable(f"status {response.status_code}")
    try:
        items: Any = response.json()
    except ValueError as exc:
        raise RateLimiterUnavailable("invalid json") from exc
    if not isinstance(items, list) or len(items) != 2:
        raise RateLimiterUnavailable("unexpected pipeline response")
    for item in items:
        if not isinstance(item, dict) or "error" in item:
            raise RateLimiterUnavailable("pipeline command failed")
    count = items[0].get("result")
    if not isinstance(count, int):
        raise RateLimiterUnavailable("unexpected INCR result")
    return count


def get_rate_limiter(settings: Settings = Depends(get_settings)) -> RateLimiter:
    if not settings.rate_limit_configured:
        return NoopRateLimiter()
    return UpstashRateLimiter(settings.upstash_redis_rest_url, settings.upstash_redis_rest_token)


def _rate_limited(retry_after: int) -> ApiError:
    return ApiError(
        429,
        "rate_limited",
        "Too many requests. Try again shortly.",
        headers={"retry-after": str(retry_after)},
    )


async def enforce(limiter: RateLimiter, key: str, limit: int, *, fail_open: bool) -> None:
    """Raise 429 when over the limit. When the limiter is down, allow or answer 503."""
    try:
        result = await limiter.hit(key, limit)
    except RateLimiterUnavailable as exc:
        bucket = key.split(":", 1)[0]
        logger.warning(
            "rate limiter unavailable",
            extra={"error_code": "rate_limiter_unavailable", "bucket": bucket, "reason": str(exc)},
        )
        if fail_open:
            return
        raise ApiError(
            503, "auth_unavailable", "The authentication service is unavailable. Try again."
        ) from exc
    if not result.allowed:
        raise _rate_limited(result.retry_after)


def client_ip(request: Request) -> str:
    """The caller's IP: the first `x-forwarded-for` hop (set by Vercel), else the peer."""
    forwarded = request.headers.get("x-forwarded-for", "")
    first = forwarded.split(",", 1)[0].strip()
    if first:
        return first
    return request.client.host if request.client else "unknown"


async def limit_auth_by_ip(
    request: Request, limiter: RateLimiter = Depends(get_rate_limiter)
) -> None:
    """Auth routes: 10 requests per minute per IP. Fails closed when Redis is down."""
    await enforce(limiter, f"auth:{client_ip(request)}", AUTH_LIMIT, fail_open=False)
