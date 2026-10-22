"""Extension tokens: create, list, revoke, and authenticate.

A token is `qnx_` plus a random secret. Only its sha-256 hash is stored, so a
database leak does not leak working tokens. The secret is shown once, when the
token is created.

app.extension_tokens has no row-level security: a token is looked up by its hash
before any account is known. Every query that acts for an account still filters
by `user_id`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import Depends
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.errors import ApiError
from app.models import ExtensionToken, User
from app.schemas import ExtensionTokenOut
from app.security import new_secret, sha256_hex

TOKEN_PREFIX = "qnx_"  # noqa: S105 (a public prefix, not a secret)
EXTENSION_SCOPES = ("notes:create",)
TOUCH_INTERVAL = timedelta(minutes=1)


def is_extension_token(token: str) -> bool:
    return token.startswith(TOKEN_PREFIX)


def token_out(token: ExtensionToken) -> ExtensionTokenOut:
    return ExtensionTokenOut(
        id=token.id,
        label=token.label,
        scopes=list(token.scopes),
        created_at=token.created_at,
        last_used_at=token.last_used_at,
    )


def _unauthenticated() -> ApiError:
    return ApiError(401, "unauthenticated", "This extension token is not valid.")


class ExtensionTokenStore:
    """Token queries for one request. Each write commits once, when it is done."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, account_id: uuid.UUID, label: str | None) -> tuple[ExtensionToken, str]:
        """Store a new token's hash. Returns (row, secret); the secret is never stored."""
        secret = TOKEN_PREFIX + new_secret(32)
        token = ExtensionToken(
            user_id=account_id,
            token_hash=sha256_hex(secret),
            label=label,
            scopes=list(EXTENSION_SCOPES),
        )
        self._session.add(token)
        await self._session.flush()
        await self._session.refresh(token)
        await self._session.commit()
        return token, secret

    async def list_active(self, account_id: uuid.UUID) -> list[ExtensionToken]:
        statement = (
            select(ExtensionToken)
            .where(ExtensionToken.user_id == account_id, ExtensionToken.revoked_at.is_(None))
            .order_by(ExtensionToken.created_at.desc(), ExtensionToken.id.desc())
        )
        return list((await self._session.execute(statement)).scalars())

    async def revoke(self, account_id: uuid.UUID, token_id: uuid.UUID) -> None:
        """Revoke an active token of this account. Anything else is a 404."""
        statement = (
            update(ExtensionToken)
            .where(
                ExtensionToken.id == token_id,
                ExtensionToken.user_id == account_id,
                ExtensionToken.revoked_at.is_(None),
            )
            .values(revoked_at=func.now())
            .returning(ExtensionToken.id)
            .execution_options(synchronize_session=False)
        )
        revoked = (await self._session.execute(statement)).scalar_one_or_none()
        if revoked is None:
            raise ApiError(404, "token_not_found", "This extension token does not exist.")
        await self._session.commit()

    async def authenticate(self, secret: str) -> tuple[ExtensionToken, User]:
        """Resolve a presented secret to its token and account.

        Unknown secrets are `401 unauthenticated`; revoked ones `401 token_revoked`.
        Records `last_used_at` at most once a minute, and commits that update here,
        because some callers (the status check) never commit afterwards.
        """
        statement = (
            select(ExtensionToken, User)
            .join(User, User.id == ExtensionToken.user_id)
            .where(ExtensionToken.token_hash == sha256_hex(secret))
        )
        row = (await self._session.execute(statement)).one_or_none()
        if row is None:
            raise _unauthenticated()
        token, account = row
        if token.revoked_at is not None:
            raise ApiError(401, "token_revoked", "This extension token was revoked.")
        now = datetime.now(UTC)
        if token.last_used_at is None or now - token.last_used_at >= TOUCH_INTERVAL:
            await self._touch(token.id)
        return token, account

    async def _touch(self, token_id: uuid.UUID) -> None:
        # The database clock decides, so concurrent requests write at most once a minute.
        statement = (
            update(ExtensionToken)
            .where(
                ExtensionToken.id == token_id,
                (ExtensionToken.last_used_at.is_(None))
                | (ExtensionToken.last_used_at < func.now() - text("interval '1 minute'")),
            )
            .values(last_used_at=func.now())
            .execution_options(synchronize_session=False)
        )
        await self._session.execute(statement)
        await self._session.commit()


def get_token_store(session: AsyncSession = Depends(get_session)) -> ExtensionTokenStore:
    return ExtensionTokenStore(session)
