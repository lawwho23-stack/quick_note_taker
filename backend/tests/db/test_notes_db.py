"""Notes against real Postgres, running as qn_runtime so RLS applies."""

from __future__ import annotations

import uuid
from collections.abc import Callable

import pytest
from app.errors import ApiError
from app.notes import NoteStore
from app.schemas import NoteCreate
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

StoreFactory = Callable[[], NoteStore]


def _note(body: str = "hello", *, id: uuid.UUID | None = None, source: str = "web") -> NoteCreate:
    return NoteCreate(id=id or uuid.uuid4(), body=body, source=source)


async def test_create_is_idempotent_for_an_identical_retry(
    make_store: StoreFactory, account_a: uuid.UUID
) -> None:
    payload = _note("buy rice", source="extension")

    first, created = await make_store().create(account_a, payload)
    again, created_again = await make_store().create(account_a, payload)

    assert created is True
    assert created_again is False
    assert again.id == first.id
    assert again.created_at == first.created_at
    notes, _ = await make_store().list(account_a, limit=10)
    assert [note.id for note in notes] == [payload.id]


async def test_same_id_with_a_different_payload_is_a_conflict(
    make_store: StoreFactory, account_a: uuid.UUID
) -> None:
    payload = _note("first")
    await make_store().create(account_a, payload)

    with pytest.raises(ApiError) as caught:
        await make_store().create(account_a, _note("second", id=payload.id))

    assert caught.value.status_code == 409
    assert caught.value.code == "note_id_conflict"


async def test_another_accounts_id_is_the_same_conflict(
    make_store: StoreFactory, account_a: uuid.UUID, account_b: uuid.UUID
) -> None:
    payload = _note("private to A")
    await make_store().create(account_a, payload)

    with pytest.raises(ApiError) as caught:
        await make_store().create(account_b, payload)

    assert caught.value.status_code == 409
    assert caught.value.code == "note_id_conflict"


async def test_one_account_can_never_reach_another_accounts_notes(
    make_store: StoreFactory, account_a: uuid.UUID, account_b: uuid.UUID
) -> None:
    note, _ = await make_store().create(account_a, _note("A's secret"))

    notes_b, _ = await make_store().list(account_b, limit=50)
    assert notes_b == []
    for attempt in (
        make_store().get(account_b, note.id),
        make_store().update(account_b, note.id, body="hijacked", base_version=1),
        make_store().soft_delete(account_b, note.id),
    ):
        with pytest.raises(ApiError) as caught:
            await attempt
        assert caught.value.status_code == 404

    still_there = await make_store().get(account_a, note.id)
    assert still_there.body == "A's secret"


async def test_rls_hides_other_rows_even_without_a_user_filter(
    make_store: StoreFactory,
    runtime_session: AsyncSession,
    account_a: uuid.UUID,
    account_b: uuid.UUID,
) -> None:
    await make_store().create(account_a, _note("A1"))
    await make_store().create(account_b, _note("B1"))

    unscoped = (await runtime_session.execute(text("select count(*) from app.notes"))).scalar_one()
    assert unscoped == 0  # no app.user_id set: nothing is visible

    await runtime_session.execute(
        text("select set_config('app.user_id', :id, true)"), {"id": str(account_b)}
    )
    bodies = (await runtime_session.execute(text("select body from app.notes"))).scalars().all()
    assert bodies == ["B1"]
    await runtime_session.rollback()


async def test_rls_blocks_writing_a_row_for_another_account(
    runtime_session: AsyncSession, account_a: uuid.UUID, account_b: uuid.UUID
) -> None:
    await runtime_session.execute(
        text("select set_config('app.user_id', :id, true)"), {"id": str(account_a)}
    )
    with pytest.raises(Exception, match="row-level security"):
        await runtime_session.execute(
            text(
                "insert into app.notes (id, user_id, body, payload_hash) "
                "values (gen_random_uuid(), :other, 'x', 'h')"
            ),
            {"other": account_b},
        )
    await runtime_session.rollback()


async def test_update_checks_the_base_version(
    make_store: StoreFactory, account_a: uuid.UUID
) -> None:
    note, _ = await make_store().create(account_a, _note("v1"))

    edited = await make_store().update(account_a, note.id, body="v2", base_version=1)
    assert edited.version == 2
    assert edited.body == "v2"
    assert edited.updated_at >= note.updated_at

    with pytest.raises(ApiError) as caught:
        await make_store().update(account_a, note.id, body="stale edit", base_version=1)
    assert caught.value.status_code == 409
    assert caught.value.code == "version_conflict"
    assert caught.value.extra["current"]["body"] == "v2"
    assert caught.value.extra["current"]["version"] == 2


async def test_soft_delete_hides_the_note(make_store: StoreFactory, account_a: uuid.UUID) -> None:
    note, _ = await make_store().create(account_a, _note("bye"))

    await make_store().soft_delete(account_a, note.id)

    notes, _ = await make_store().list(account_a, limit=10)
    assert notes == []
    with pytest.raises(ApiError):
        await make_store().get(account_a, note.id)


async def test_search_finds_burmese_substrings_and_literal_wildcards(
    make_store: StoreFactory, account_a: uuid.UUID
) -> None:
    await make_store().create(account_a, _note("မနက်ဖြန် ဈေးသွားရန် မှတ်ထားပါ"))
    await make_store().create(account_a, _note("discount 50% today"))
    await make_store().create(account_a, _note("discount 500 baht"))

    burmese, _ = await make_store().list(account_a, limit=10, q="ဈေးသွား")
    assert [note.body for note in burmese] == ["မနက်ဖြန် ဈေးသွားရန် မှတ်ထားပါ"]

    percent, _ = await make_store().list(account_a, limit=10, q="50%")
    assert [note.body for note in percent] == ["discount 50% today"]

    upper, _ = await make_store().list(account_a, limit=10, q="DISCOUNT")
    assert len(upper) == 2


async def test_keyset_pages_cover_every_note_once(
    make_store: StoreFactory, account_a: uuid.UUID
) -> None:
    created = [(await make_store().create(account_a, _note(f"n{i}")))[0].id for i in range(5)]

    seen: list[uuid.UUID] = []
    cursor: str | None = None
    while True:
        page, cursor = await make_store().list(account_a, limit=2, cursor=cursor)
        seen.extend(note.id for note in page)
        if cursor is None:
            break

    assert sorted(seen) == sorted(created)
    assert len(seen) == len(set(seen))


async def test_deleting_the_auth_user_removes_their_notes(
    make_store: StoreFactory, owner_engine: AsyncEngine, account_a: uuid.UUID
) -> None:
    await make_store().create(account_a, _note("gone with the account"))

    async with owner_engine.begin() as connection:
        await connection.execute(
            text(
                "delete from auth.users where id = "
                "(select auth_user_id from app.users where id = :id)"
            ),
            {"id": account_a},
        )
        remaining = (
            await connection.execute(
                text("select count(*) from app.notes where user_id = :id"), {"id": account_a}
            )
        ).scalar_one()

    assert remaining == 0
