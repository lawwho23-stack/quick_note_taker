"""Account records: one app row per Supabase Auth user."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import User


def _as_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise ApiError(401, "unauthenticated", "The account identity is invalid.") from exc


async def ensure_account(session: AsyncSession, *, auth_user_id: str, email: str | None) -> User:
    """Create or refresh the account row. Called only on authentication events.

    Account rows are never created while serving an ordinary protected request:
    a deleted account must not be recreated by an old, unexpired access token.
    """
    statement = (
        pg_insert(User)
        .values(auth_user_id=_as_uuid(auth_user_id), email=email)
        .on_conflict_do_update(
            index_elements=[User.auth_user_id],
            set_={"email": email, "updated_at": func.now()},
        )
        .returning(User)
    )
    account: User = (await session.execute(statement)).scalar_one()
    await session.commit()
    return account


async def get_account(session: AsyncSession, *, auth_user_id: str) -> User | None:
    statement = select(User).where(User.auth_user_id == _as_uuid(auth_user_id))
    account: User | None = (await session.execute(statement)).scalar_one_or_none()
    return account
