"""CORS, Sentry setup and scrubbing, and the committed OpenAPI file."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import pytest
import sentry_sdk
from app.config import DEFAULT_EXTENSION_ORIGIN, Settings
from app.error_tracking import init_error_tracking, scrub_event
from fastapi.testclient import TestClient

from tests.conftest import ALLOWED_ORIGIN

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _preflight(client: TestClient, origin: str) -> Any:
    return client.options(
        "/v1/notes",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )


def test_the_extension_origin_passes_preflight(client: TestClient) -> None:
    response = _preflight(client, DEFAULT_EXTENSION_ORIGIN)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == DEFAULT_EXTENSION_ORIGIN
    allowed = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed
    assert "x-csrf-token" in allowed


def test_the_website_origin_gets_credentials(client: TestClient) -> None:
    response = client.get("/v1/notes", headers={"Origin": ALLOWED_ORIGIN})

    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert response.headers["access-control-allow-credentials"] == "true"


def test_unknown_origins_get_no_cors_headers(client: TestClient) -> None:
    preflight = _preflight(client, "https://evil.example")
    simple = client.get("/v1/notes", headers={"Origin": "chrome-extension://someoneelse"})

    assert preflight.status_code == 400
    assert "access-control-allow-origin" not in preflight.headers
    assert "access-control-allow-origin" not in simple.headers


def test_cors_origins_never_include_a_wildcard(settings: Settings) -> None:
    widened = settings.model_copy(update={"extension_origin_allowlist": "*, chrome-extension://x/"})

    assert widened.cors_origins == [ALLOWED_ORIGIN, "chrome-extension://x"]


def test_sentry_is_off_without_a_dsn(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))

    assert init_error_tracking(settings) is False
    assert calls == []


def test_sentry_never_sends_bodies_pii_or_locals(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    configured = settings.model_copy(update={"sentry_dsn": "https://key@sentry.example/1"})

    assert init_error_tracking(configured) is True
    options = calls[0]
    assert options["send_default_pii"] is False
    assert options["include_local_variables"] is False
    assert options["max_request_body_size"] == "never"
    assert options["before_send"] is scrub_event


def test_scrub_event_removes_note_text_and_credentials() -> None:
    event: dict[str, Any] = {
        "request": {
            "url": "https://api.example/v1/notes?q=secret+plans",
            "data": {"body": "secret plans"},
            "query_string": "q=secret+plans",
            "cookies": {"qn_at": "token"},
            "headers": {"Authorization": "Bearer qnx_abc", "Cookie": "qn_at=t", "User-Agent": "UA"},
        },
        "user": {"email": "user@example.com"},
        "exception": {
            "values": [{"stacktrace": {"frames": [{"function": "f", "vars": {"body": "secret"}}]}}]
        },
    }

    scrubbed = scrub_event(event, {})

    assert "secret" not in repr(scrubbed)
    assert "qnx_abc" not in repr(scrubbed)
    assert scrubbed["request"]["headers"] == {"User-Agent": "UA"}
    assert scrubbed["request"]["url"] == "https://api.example/v1/notes"
    assert "user" not in scrubbed


def test_committed_openapi_json_is_current() -> None:
    spec = importlib.util.spec_from_file_location(
        "export_openapi", BACKEND_DIR / "scripts" / "export_openapi.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    expected = module.render(module.build_schema())
    committed = (BACKEND_DIR / "openapi.json").read_text(encoding="utf-8")

    assert committed == expected, "run: uv run python scripts/export_openapi.py"
