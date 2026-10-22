"""Rate limits on register, login and resend (Upstash Redis REST, faked)."""

from __future__ import annotations

import json

import httpx
import pytest
from app.config import Settings
from app.errors import ApiError
from app.rate_limit import Limit, RateLimiter, get_rate_limiter
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import ALLOWED_ORIGIN

ORIGIN = {"Origin": ALLOWED_ORIGIN}
LIMIT = Limit("test", 2, 60)


class FakeRedis:
    """Counts INCR calls per key, like the Upstash pipeline endpoint."""

    def __init__(self) -> None:
        self.counts: dict[str, int] = {}
        self.keys: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/pipeline"
        assert request.headers["authorization"] == "Bearer token"
        (incr, expire) = json.loads(request.content)
        key = incr[1]
        assert expire[0] == "EXPIRE" and expire[1] == key
        self.keys.append(key)
        self.counts[key] = self.counts.get(key, 0) + 1
        return httpx.Response(200, json=[{"result": self.counts[key]}, {"result": 1}])


def _limiter(settings: Settings, transport: httpx.AsyncBaseTransport) -> RateLimiter:
    configured = settings.model_copy(
        update={"upstash_redis_rest_url": "https://redis.test", "upstash_redis_rest_token": "token"}
    )
    return RateLimiter(configured, transport=transport)


async def test_blocks_after_the_limit(settings: Settings) -> None:
    redis = FakeRedis()
    limiter = _limiter(settings, httpx.MockTransport(redis.handler))

    await limiter.hit(LIMIT, "user@example.com")
    await limiter.hit(LIMIT, "user@example.com")
    with pytest.raises(ApiError) as exc_info:
        await limiter.hit(LIMIT, "user@example.com")

    assert exc_info.value.status_code == 429
    assert exc_info.value.code == "rate_limited"
    assert 0 < int(exc_info.value.headers["retry-after"]) <= 60
    # Subjects are hashed: no email in the Redis key.
    assert all("user@example.com" not in key for key in redis.keys)


async def test_subjects_are_counted_separately(settings: Settings) -> None:
    limiter = _limiter(settings, httpx.MockTransport(FakeRedis().handler))

    for subject in ("a@example.com", "b@example.com", "c@example.com"):
        await limiter.hit(LIMIT, subject)
        await limiter.hit(LIMIT, subject)


async def test_disabled_without_credentials(settings: Settings) -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise AssertionError("no Redis call expected")

    limiter = RateLimiter(settings, transport=httpx.MockTransport(handler))

    assert not limiter.enabled
    for _ in range(5):
        await limiter.hit(LIMIT, "user@example.com")


async def test_redis_outage_fails_open(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    limiter = _limiter(settings, httpx.MockTransport(handler))

    for _ in range(5):
        await limiter.hit(LIMIT, "user@example.com")


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/v1/auth/register", {"email": "user@example.com", "password": "correct-horse"}),
        ("/v1/auth/login", {"email": "user@example.com", "password": "correct-horse"}),
        ("/v1/auth/resend", {"email": "user@example.com"}),
    ],
)
def test_auth_routes_are_rate_limited(
    app: FastAPI, settings: Settings, path: str, body: dict[str, str]
) -> None:
    redis = FakeRedis()
    app.dependency_overrides[get_rate_limiter] = lambda: _limiter(
        settings, httpx.MockTransport(redis.handler)
    )

    statuses = []
    with TestClient(app) as client:
        for _ in range(12):
            # A fresh visitor each time: session cookies would bring CSRF checks in.
            client.cookies.clear()
            statuses.append(client.post(path, json=body, headers=ORIGIN).status_code)

    assert statuses[0] != 429
    assert statuses[-1] == 429
