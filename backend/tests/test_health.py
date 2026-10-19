"""Health, readiness, request-id, and cache-header behaviour."""

from __future__ import annotations

from app.db import get_engine
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import FakeEngine


def test_health_reports_environment_and_request_id(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-Id": "probe-123"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["environment"] == "local"
    assert response.headers["x-request-id"] == "probe-123"
    assert response.headers["cache-control"] == "private, no-store"


def test_request_id_is_generated_when_missing(client: TestClient) -> None:
    response = client.get("/health")

    assert response.headers["x-request-id"].startswith("req_")


def test_ready_ok(client: TestClient, app: FastAPI) -> None:
    app.dependency_overrides[get_engine] = lambda: FakeEngine()

    response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "checks": {"database": "ok"}}


def test_ready_reports_database_failure(client: TestClient, app: FastAPI) -> None:
    app.dependency_overrides[get_engine] = lambda: FakeEngine(fail=True)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "checks": {"database": "error"}}


def test_error_shape_for_unknown_route(client: TestClient) -> None:
    response = client.get("/v1/does-not-exist", headers={"X-Request-Id": "abc"})

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["request_id"] == "abc"
    assert "message" in error
