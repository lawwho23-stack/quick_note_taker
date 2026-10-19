"""FastAPI application entrypoint (auto-detected by Vercel's Python runtime)."""

from __future__ import annotations

from fastapi import FastAPI

from app.config import Settings, get_settings
from app.errors import register_error_handlers
from app.logging_setup import configure_logging
from app.request_context import RequestContextMiddleware
from app.routers import auth, health, me


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Quick Note API",
        version="0.1.0",
        summary="Quick Note backend: authentication now, notes next.",
        docs_url="/docs",
        redoc_url=None,
        openapi_url="/openapi.json",
    )
    app.state.settings = settings
    # One settings instance for the whole process (also what tests override).
    app.dependency_overrides[get_settings] = lambda: settings

    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(me.router)
    return app


app = create_app()
