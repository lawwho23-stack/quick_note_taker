"""Notes for the signed-in account."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.deps import current_account
from app.models import User
from app.notes import LIST_LIMIT_MAX, NoteStore, get_note_store, note_out
from app.schemas import NoteCreate, NoteCreateAck, NoteList, NoteOut, NoteUpdate
from app.security import require_cookie_csrf

router = APIRouter(prefix="/v1/notes", tags=["notes"], dependencies=[Depends(require_cookie_csrf)])

AccountDep = Annotated[User, Depends(current_account)]
StoreDep = Annotated[NoteStore, Depends(get_note_store)]


@router.post(
    "",
    response_model=NoteCreateAck,
    status_code=201,
    responses={200: {"model": NoteCreateAck, "description": "Identical retry"}},
)
async def create_note(
    payload: NoteCreate, response: Response, account: AccountDep, store: StoreDep
) -> NoteCreateAck:
    note, created = await store.create(account.id, payload)
    if not created:
        response.status_code = 200
    return NoteCreateAck(id=note.id, version=note.version, created_at=note.created_at)


@router.get("", response_model=NoteList)
async def list_notes(
    account: AccountDep,
    store: StoreDep,
    limit: Annotated[int, Query(ge=1, le=LIST_LIMIT_MAX)] = 50,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
    q: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
) -> NoteList:
    notes, next_cursor = await store.list(account.id, limit=limit, cursor=cursor, q=q)
    return NoteList(items=[note_out(note) for note in notes], next_cursor=next_cursor)


@router.get("/{note_id}", response_model=NoteOut)
async def get_note(note_id: uuid.UUID, account: AccountDep, store: StoreDep) -> NoteOut:
    return note_out(await store.get(account.id, note_id))


@router.patch("/{note_id}", response_model=NoteOut)
async def update_note(
    note_id: uuid.UUID, payload: NoteUpdate, account: AccountDep, store: StoreDep
) -> NoteOut:
    note = await store.update(
        account.id, note_id, body=payload.body, base_version=payload.base_version
    )
    return note_out(note)


@router.delete("/{note_id}", status_code=204)
async def delete_note(note_id: uuid.UUID, account: AccountDep, store: StoreDep) -> Response:
    await store.soft_delete(account.id, note_id)
    return Response(status_code=204)
