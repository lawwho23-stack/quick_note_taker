"""Rate limiting: the Upstash client (fake transport) and how routes use it."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Callable

import httpx
import pytest
from app.config import Settings
from app.extension_tokens import get_token_store
from app.notes import get_note_store
from app.rate_limit import (
    NoopRateLimiter,
    RateLimiterUnavailable,
    RateLimitResult,
    UpstashRateLimiter,
    get_rate_limiter,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import ALLOWED_ORIGIN, FakeDbSession, make_account
from tests.test_extension_tokens_api import FakeTokenStore
from tests.test_notes_api import SESSION, FakeNoteStore

NOW = 1_760_000_082.0  # 42 seconds into a one-minute window


def _limiter(handler: Callable[[httpx.Request], httpx.Response]) -> UpstashRateLimiter:
    return UpstashRateLimiter(
        "https://redis.example.upstash.io/",
        "rest-token",
        transport=httpx.MockTransport(handler),
        clock=lambda: NOW,
    )


async def test_upstash_counts_in_one_pipeline_call() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[{"result": 3}, {"result": 0}])

    result = await _limiter(handler).hit("extension:abc", 60)

    assert result == RateLimitResult(allowed=True, count=3, retry_after=18)
    assert len(seen) == 1
    assert str(seen[0].url) == "https://redis.example.upstash.io/pipeline"
    assert seen[0].headers["authorization"] == "Bearer rest-token"
    window = int(NOW // 60)
    assert json.loads(seen[0].content) == [
        ["INCR", f"qn:rl:extension:abc:{window}"],
        ["EXPIRE", f"qn:rl:extension:abc:{window}", "120", "NX"],
    ]


async def test_upstash_over_the_limit() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"result": 61}, {"result": 0}])

    result = await _limiter(handler).hit("extension:abc", 60)

    assert not result.allowed
    assert result.retry_after == 18


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, json={"error": "boom"}),
        httpx.Response(401, json={"error": "WRONGPASS"}),
        httpx.Response(200, json=[{"error": "ERR"}, {"result": 0}]),
        httpx.Response(200, json={"result": 1}),
        httpx.Response(200, content=b"not json"),
    ],
)
async def test_upstash_bad_answers_are_unavailable(response: httpx.Response) -> None:
    with pytest.raises(RateLimiterUnavailable):
        await _limiter(lambda _request: response).hit("auth:1.2.3.4", 10)


async def test_upstash_network_errors_are_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    with pytest.raises(RateLimiterUnavailable):
        await _limiter(handler).hit("auth:1.2.3.4", 10)


def test_unconfigured_limiter_is_a_no_op(settings: Settings) -> None:
    assert isinstance(get_rate_limiter(settings), NoopRateLimiter)
    configured = settings.model_copy(
        update={"upstash_redis_rest_url": "https://r.example", "upstash_redis_rest_token": "t"}
    )
    assert isinstance(get_rate_limiter(configured), UpstashRateLimiter)


class FakeLimiter:
    """Counts hits per key; can be told to be over the limit or unreachable."""

    def __init__(self) -> None:
        self.keys: list[str] = []
        self.over_limit = False
        self.down = False

    async def hit(self, key: str, limit: int) -> RateLimitResult:
        self.keys.append(key)
        if self.down:
            raise RateLimiterUnavailable("down")
        return RateLimitResult(allowed=not self.over_limit, count=1, retry_after=17)


@pytest.fixture
def limiter(app: FastAPI) -> FakeLimiter:
    fake = FakeLimiter()
    app.dependency_overrides[get_rate_limiter] = lambda: fake
    return fake


@pytest.fixture
def notes(app: FastAPI, fake_db: FakeDbSession) -> FakeNoteStore:
    fake_db.account = make_account()
    store = FakeNoteStore()
    app.dependency_overrides[get_note_store] = lambda: store
    return store


def test_session_requests_are_counted_per_account(
    client: TestClient, limiter: FakeLimiter, notes: FakeNoteStore, fake_db: FakeDbSession
) -> None:
    assert client.get("/v1/notes", headers=SESSION).status_code == 200
    assert fake_db.account is not None
    assert limiter.keys == [f"session:{fake_db.account.id}"]


def test_over_the_limit_is_a_429_with_retry_after(
    client: TestClient, limiter: FakeLimiter, notes: FakeNoteStore
) -> None:
    limiter.over_limit = True

    response = client.post(
        "/v1/notes", json={"id": str(uuid.uuid4()), "body": "x"}, headers=SESSION
    )

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limited"
    assert response.headers["retry-after"] == "17"
    assert notes.notes == {}


def test_notes_fail_open_when_redis_is_down(
    client: TestClient, limiter: FakeLimiter, notes: FakeNoteStore
) -> None:
    limiter.down = True

    response = client.post(
        "/v1/notes", json={"id": str(uuid.uuid4()), "body": "x"}, headers=SESSION
    )

    assert response.status_code == 201
    assert len(notes.notes) == 1


def test_auth_is_limited_per_first_forwarded_ip(client: TestClient, limiter: FakeLimiter) -> None:
    client.post(
        "/v1/auth/login",
        json={"email": "user@example.com", "password": "pw"},
        headers={"Origin": ALLOWED_ORIGIN, "x-forwarded-for": "203.0.113.9, 10.0.0.1"},
    )

    assert limiter.keys == ["auth:203.0.113.9"]


def test_auth_over_the_limit_is_a_429(
    client: TestClient, limiter: FakeLimiter, fake_provider: object
) -> None:
    limiter.over_limit = True

    response = client.post(
        "/v1/auth/login",
        json={"email": "user@example.com", "password": "pw"},
        headers={"Origin": ALLOWED_ORIGIN},
    )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "17"
    assert getattr(fake_provider, "sign_in_calls", None) == 0


def test_page_load_auth_routes_are_not_limited(client: TestClient, limiter: FakeLimiter) -> None:
    """Session checks run on every page load and many users can share one proxy IP."""
    limiter.over_limit = True
    limiter.down = True

    response = client.get("/v1/auth/session", headers={"Origin": ALLOWED_ORIGIN})

    assert response.status_code == 200
    assert limiter.keys == []


def test_auth_fails_closed_when_redis_is_down(client: TestClient, limiter: FakeLimiter) -> None:
    limiter.down = True

    response = client.post(
        "/v1/auth/login",
        json={"email": "user@example.com", "password": "pw"},
        headers={"Origin": ALLOWED_ORIGIN},
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "auth_unavailable"


@pytest.mark.parametrize(
    ("over_limit", "down", "expected"), [(True, False, 429), (False, True, 201)]
)
def test_extension_tokens_are_limited_per_token(
    app: FastAPI,
    client: TestClient,
    limiter: FakeLimiter,
    notes: FakeNoteStore,
    fake_db: FakeDbSession,
    over_limit: bool,
    down: bool,
    expected: int,
) -> None:
    assert fake_db.account is not None
    tokens = FakeTokenStore({fake_db.account.id: fake_db.account})
    app.dependency_overrides[get_token_store] = lambda: tokens
    token, secret = asyncio.run(tokens.create(fake_db.account.id, None))
    limiter.over_limit, limiter.down = over_limit, down

    response = client.post(
        "/v1/notes",
        json={"id": str(uuid.uuid4()), "body": "x"},
        headers={"Authorization": f"Bearer {secret}"},
    )

    assert response.status_code == expected
    assert limiter.keys == [f"extension:{token.id}"]
    assert all(secret not in key for key in limiter.keys)
    if expected == 429:
        assert response.headers["retry-after"] == "17"
        assert notes.notes == {}
    else:
        assert len(notes.notes) == 1
