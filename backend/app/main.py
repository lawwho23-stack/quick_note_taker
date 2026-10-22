"""FastAPI application entrypoint (auto-detected by Vercel's Python runtime)."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.error_tracking import init_error_tracking
from app.errors import register_error_handlers
from app.logging_setup import configure_logging
from app.request_context import RequestContextMiddleware
from app.routers import auth, export, extension_tokens, health, me, notes


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    init_error_tracking(settings)

    app = FastAPI(
        title="Quick Note API",
        version="0.1.0",
        summary="Quick Note backend: accounts and notes.",
        docs_url="/docs",
        redoc_url=None,
        openapi_url="/openapi.json",
    )
    app.state.settings = settings
    # One settings instance for the whole process (also what tests override).
    app.dependency_overrides[get_settings] = lambda: settings

    app.add_middleware(RequestContextMiddleware)
    # Added last, so it is the outermost layer and error responses carry CORS headers.
    # Exact origins only: the website (credentialed) and the browser extension.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["authorization", "content-type", "x-csrf-token"],
        expose_headers=["retry-after", "x-request-id", "content-disposition"],
        max_age=600,
    )
    register_error_handlers(app)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(me.router)
    app.include_router(notes.router)
    app.include_router(extension_tokens.router)
    app.include_router(export.router)
    return app


app = create_app()
