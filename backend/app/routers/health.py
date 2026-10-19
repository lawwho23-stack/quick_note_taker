"""Liveness and readiness endpoints."""

from __future__ import annotations

import logging
import os
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import Settings, get_settings
from app.db import get_engine
from app.schemas import HealthResponse

logger = logging.getLogger("quick_note.health")

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    return HealthResponse(
        status="ok",
        environment=settings.app_env,
        commit=os.environ.get("VERCEL_GIT_COMMIT_SHA", ""),
    )


@router.get("/ready")
async def ready(engine: Annotated[AsyncEngine, Depends(get_engine)]) -> JSONResponse:
    try:
        async with engine.connect() as connection:
            await connection.execute(text("select 1"))
    except Exception:
        logger.warning("readiness check failed", exc_info=True)
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "checks": {"database": "error"}},
        )
    return JSONResponse(status_code=200, content={"status": "ready", "checks": {"database": "ok"}})
