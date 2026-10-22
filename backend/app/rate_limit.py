"""Fixed-window rate limits stored in Upstash Redis (REST API).

Vercel runs the API as short-lived functions, so an in-memory counter would reset
on every cold start and differ between instances; the counters live in Redis.
Without Upstash credentials (tests, local dev) limits are switched off.

If Redis cannot be reached the request is allowed (fail open): a Redis outage
should not stop people from signing in.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import httpx
from fastapi import Depends

from app.config import Settings, get_settings
from app.errors import ApiError
from app.security import sha256_hex

logger = logging.getLogger("quick_note.rate_limit")


@dataclass(frozen=True, slots=True)
class Limit:
    name: str
    max_calls: int
    window_seconds: int


# One confirmation email per minute per address, and a few per hour. Supabase's own
# mailer is capped project-wide, so these protect every other user's sign-up.
RESEND_BURST = Limit("resend-burst", 1, 60)
RESEND_HOURLY = Limit("resend-hourly", 5, 60 * 60)
REGISTER = Limit("register", 10, 60 * 60)
LOGIN = Limit("login", 10, 5 * 60)

_warned_disabled = False


class RateLimiter:
    def __init__(
        self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._url = settings.upstash_redis_rest_url.rstrip("/")
        self._token = settings.upstash_redis_rest_token
        self._transport = transport

    @property
    def enabled(self) -> bool:
        return bool(self._url and self._token)

    async def hit(self, limit: Limit, subject: str) -> None:
        """Count one call for `subject`; raise 429 once the window's limit is passed."""
        if not self.enabled:
            global _warned_disabled
            if not _warned_disabled:
                logger.info("rate limiting disabled: no Upstash credentials")
                _warned_disabled = True
            return

        now = int(time.time())
        window = now // limit.window_seconds
        # Hash the subject so emails and IPs never sit in Redis in plain text.
        key = f"quick-note:rl:{limit.name}:{sha256_hex(subject)}:{window}"
        commands = [["INCR", key], ["EXPIRE", key, str(limit.window_seconds)]]
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(2.0), transport=self._transport
            ) as client:
                response = await client.post(
                    f"{self._url}/pipeline",
                    json=commands,
                    headers={"authorization": f"Bearer {self._token}"},
                )
                response.raise_for_status()
                count = int(response.json()[0]["result"])
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
            logger.warning("rate limiter unavailable", extra={"limit": limit.name})
            return

        if count > limit.max_calls:
            retry_after = limit.window_seconds - now % limit.window_seconds
            raise ApiError(
                429,
                "rate_limited",
                "Too many attempts. Try again later.",
                headers={"retry-after": str(retry_after)},
            )


def get_rate_limiter(settings: Settings = Depends(get_settings)) -> RateLimiter:
    return RateLimiter(settings)
