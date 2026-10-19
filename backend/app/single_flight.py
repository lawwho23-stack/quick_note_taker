"""In-process single-flight for refresh-token rotation.

Supabase rotates refresh tokens. Two concurrent refreshes with the same token
would race: one succeeds, the other is rejected as reuse. We serialize refreshes
per token and cache the fresh session for a short window, so duplicate requests
(same tab retries, `navigator.locks` misses, multiple function instances within
one process) receive the same result instead of an error.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING
from weakref import WeakValueDictionary

if TYPE_CHECKING:
    from app.auth_types import AuthSession

CACHE_TTL_SECONDS = 30.0
MAX_CACHE_ENTRIES = 256

_locks: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()
_cache: dict[str, tuple[float, AuthSession]] = {}


def _prune() -> None:
    now = time.monotonic()
    for key in [key for key, (expires, _) in _cache.items() if expires <= now]:
        _cache.pop(key, None)
    while len(_cache) > MAX_CACHE_ENTRIES:
        _cache.pop(next(iter(_cache)))


def cached_session(key: str) -> AuthSession | None:
    _prune()
    entry = _cache.get(key)
    return entry[1] if entry else None


def store_session(key: str, session: AuthSession) -> None:
    _prune()
    _cache[key] = (time.monotonic() + CACHE_TTL_SECONDS, session)


def clear_cache() -> None:
    """Reset state (used by tests)."""
    _cache.clear()
    _locks.clear()


@asynccontextmanager
async def refresh_lock(key: str) -> AsyncIterator[None]:
    lock = _locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _locks[key] = lock
    async with lock:
        yield
