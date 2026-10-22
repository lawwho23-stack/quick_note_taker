"""Extension tokens and account data against real Postgres, running as qn_runtime."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Callable

import pytest
from app.errors import ApiError
from app.extension_tokens import ExtensionTokenStore
from app.notes import NoteStore
from app.schemas import NoteCreate
from app.security import sha256_hex
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker


@pytest.fixture
async def make_tokens(
    runtime_engine: AsyncEngine,
) -> AsyncIterator[Callable[[], ExtensionTokenStore]]:
    """A fresh token store with its own session, like a separate request."""
    factory = async_sessionmaker(runtime_engine, expire_on_commit=False)
    sessions: list[AsyncSession] = []

    def _make() -> ExtensionTokenStore:
        session = factory()
        sessions.append(session)
        return ExtensionTokenStore(session)

    yield _make
    for session in sessions:
        await session.close()


async def _row(engine: AsyncEngine, token_id: uuid.UUID) -> dict[str, object]:
    async with engine.connect() as connection:
        row = (
            await connection.execute(
                text("select * from app.extension_tokens where id = :id"), {"id": token_id}
            )
        ).one()
    return dict(row._mapping)


async def test_only_the_hash_is_stored_and_lookup_works(
    make_tokens: Callable[[], ExtensionTokenStore],
    owner_engine: AsyncEngine,
    account_a: uuid.UUID,
) -> None:
    token, secret = await make_tokens().create(account_a, "Chrome")

    stored = await _row(owner_engine, token.id)
    assert secret.startswith("qnx_")
    assert stored["token_hash"] == sha256_hex(secret)
    assert secret not in {str(value) for value in stored.values()}
    assert stored["scopes"] == ["notes:create"]

    found, account = await make_tokens().authenticate(secret)
    assert found.id == token.id
    assert account.id == account_a


async def test_unknown_secret_is_unauthenticated(
    make_tokens: Callable[[], ExtensionTokenStore],
) -> None:
    with pytest.raises(ApiError) as caught:
        await make_tokens().authenticate("qnx_" + "x" * 43)
    assert (caught.value.status_code, caught.value.code) == (401, "unauthenticated")


async def test_last_used_at_is_written_at_most_once_a_minute(
    make_tokens: Callable[[], ExtensionTokenStore],
    owner_engine: AsyncEngine,
    account_a: uuid.UUID,
) -> None:
    token, secret = await make_tokens().create(account_a, None)
    assert (await _row(owner_engine, token.id))["last_used_at"] is None

    await make_tokens().authenticate(secret)
    first = (await _row(owner_engine, token.id))["last_used_at"]
    await make_tokens().authenticate(secret)
    second = (await _row(owner_engine, token.id))["last_used_at"]
    assert first is not None
    assert second == first

    async with owner_engine.begin() as connection:
        await connection.execute(
            text(
                "update app.extension_tokens set last_used_at = now() - interval '2 minutes'"
                " where id = :id"
            ),
            {"id": token.id},
        )
    await make_tokens().authenticate(secret)
    third = (await _row(owner_engine, token.id))["last_used_at"]
    assert isinstance(third, type(first)) and third > first  # type: ignore[operator]


async def test_revoked_token_is_rejected(
    make_tokens: Callable[[], ExtensionTokenStore], account_a: uuid.UUID
) -> None:
    token, secret = await make_tokens().create(account_a, None)

    await make_tokens().revoke(account_a, token.id)

    with pytest.raises(ApiError) as caught:
        await make_tokens().authenticate(secret)
    assert (caught.value.status_code, caught.value.code) == (401, "token_revoked")
    assert await make_tokens().list_active(account_a) == []
    with pytest.raises(ApiError) as again:
        await make_tokens().revoke(account_a, token.id)
    assert again.value.code == "token_not_found"


async def test_another_account_cannot_list_or_revoke_a_token(
    make_tokens: Callable[[], ExtensionTokenStore],
    account_a: uuid.UUID,
    account_b: uuid.UUID,
) -> None:
    token, secret = await make_tokens().create(account_a, "mine")

    assert await make_tokens().list_active(account_b) == []
    with pytest.raises(ApiError) as caught:
        await make_tokens().revoke(account_b, token.id)
    assert (caught.value.status_code, caught.value.code) == (404, "token_not_found")

    _, owner = await make_tokens().authenticate(secret)
    assert owner.id == account_a
    assert [t.id for t in await make_tokens().list_active(account_a)] == [token.id]


async def test_export_is_isolated_oldest_first_and_live_only(
    make_store: Callable[[], NoteStore], account_a: uuid.UUID, account_b: uuid.UUID
) -> None:
    ids = [uuid.uuid4() for _ in range(3)]
    for index, note_id in enumerate(ids):
        await make_store().create(account_a, NoteCreate(id=note_id, body=f"a{index}"))
    await make_store().create(account_b, NoteCreate(id=uuid.uuid4(), body="b's note"))
    await make_store().soft_delete(account_a, ids[1])

    exported = await make_store().export(account_a)

    assert [note.body for note in exported] == ["a0", "a2"]
    assert all(note.user_id == account_a for note in exported)


async def test_deleting_the_auth_user_cascades_to_notes_and_tokens(
    make_store: Callable[[], NoteStore],
    make_tokens: Callable[[], ExtensionTokenStore],
    owner_engine: AsyncEngine,
    account_a: uuid.UUID,
    account_b: uuid.UUID,
) -> None:
    await make_store().create(account_a, NoteCreate(id=uuid.uuid4(), body="gone soon"))
    await make_store().create(account_b, NoteCreate(id=uuid.uuid4(), body="stays"))
    await make_tokens().create(account_a, None)
    await make_tokens().create(account_b, None)

    async with owner_engine.begin() as connection:
        await connection.execute(
            text(
                "delete from auth.users where id = (select auth_user_id from app.users"
                " where id = :id)"
            ),
            {"id": account_a},
        )
        counts = (
            await connection.execute(
                text(
                    "select (select count(*) from app.users where id = :a),"
                    " (select count(*) from app.notes where user_id = :a),"
                    " (select count(*) from app.extension_tokens where user_id = :a),"
                    " (select count(*) from app.notes where user_id = :b),"
                    " (select count(*) from app.extension_tokens where user_id = :b)"
                ),
                {"a": account_a, "b": account_b},
            )
        ).one()

    assert tuple(counts) == (0, 0, 0, 1, 1)
