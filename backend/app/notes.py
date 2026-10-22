"""Notes: create, list, search, read, edit and soft delete.

Every operation first sets `app.user_id` for the current transaction. Row-level
security on app.notes uses it, so the database itself keeps each account's notes
apart even if a query here forgets its `user_id` filter.
"""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime
from typing import Any

from fastapi import Depends
from sqlalchemy import func, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.errors import ApiError
from app.models import Note
from app.schemas import META_MAX_BYTES, NOTE_MAX_CHARS, NoteCreate, NoteOut
from app.security import sha256_hex

LIST_LIMIT_MAX = 100


def payload_hash(payload: NoteCreate) -> str:
    """A stable hash of what the client asked to create (used to spot changed retries)."""
    canonical = json.dumps(
        {"body": payload.body, "source": payload.source, "meta": payload.meta},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return sha256_hex(canonical)


def check_body(body: str) -> None:
    if len(body) > NOTE_MAX_CHARS:
        raise ApiError(
            413, "note_too_large", f"A note can hold at most {NOTE_MAX_CHARS:,} characters."
        )


def check_meta(meta: dict[str, Any]) -> None:
    if len(json.dumps(meta, separators=(",", ":")).encode("utf-8")) > META_MAX_BYTES:
        raise ApiError(400, "meta_too_large", "Note metadata is too large.")


def escape_like(term: str) -> str:
    """Make `term` match literally inside an ILIKE pattern (escape character: backslash)."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def encode_cursor(created_at: datetime, note_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}|{note_id}".encode()
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        created_raw, id_raw = base64.urlsafe_b64decode(padded).decode().split("|", 1)
        created_at = datetime.fromisoformat(created_raw)
        if created_at.tzinfo is None:
            raise ValueError("cursor timestamp has no timezone")
        return created_at, uuid.UUID(id_raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ApiError(400, "invalid_cursor", "The page cursor is invalid.") from exc


def note_out(note: Note) -> NoteOut:
    return NoteOut(
        id=note.id,
        body=note.body,
        version=note.version,
        source=note.source,
        meta=note.meta,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


def _not_found() -> ApiError:
    return ApiError(404, "note_not_found", "This note does not exist.")


class NoteStore:
    """Note queries for one request. Each write commits once, when it is done."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _scope(self, account_id: uuid.UUID) -> None:
        # `true` makes the setting transaction-local: it ends with the commit.
        await self._session.execute(select(func.set_config("app.user_id", str(account_id), True)))

    async def create(self, account_id: uuid.UUID, payload: NoteCreate) -> tuple[Note, bool]:
        """Insert the note, or return the earlier one for an identical retry.

        Returns (note, created). The same id with a different payload, or an id that
        belongs to another account, is a 409 with the same code, so a collision
        reveals nothing about other accounts.
        """
        check_body(payload.body)
        check_meta(payload.meta)
        digest = payload_hash(payload)
        await self._scope(account_id)
        statement = (
            pg_insert(Note)
            .values(
                id=payload.id,
                user_id=account_id,
                body=payload.body,
                source=payload.source,
                meta=payload.meta,
                payload_hash=digest,
            )
            .on_conflict_do_nothing(index_elements=[Note.id])
            .returning(Note)
        )
        inserted: Note | None = (await self._session.execute(statement)).scalar_one_or_none()
        if inserted is not None:
            await self._session.commit()
            return inserted, True

        existing: Note | None = (
            await self._session.execute(
                select(Note).where(Note.id == payload.id, Note.user_id == account_id)
            )
        ).scalar_one_or_none()
        if existing is not None and existing.payload_hash == digest:
            return existing, False
        raise ApiError(
            409, "note_id_conflict", "A different note already uses this id. Use a new id."
        )

    async def list(
        self,
        account_id: uuid.UUID,
        *,
        limit: int,
        cursor: str | None = None,
        q: str | None = None,
    ) -> tuple[list[Note], str | None]:
        """Newest first, by keyset paging on (created_at, id)."""
        limit = max(1, min(limit, LIST_LIMIT_MAX))
        await self._scope(account_id)
        statement = select(Note).where(Note.user_id == account_id, Note.deleted_at.is_(None))
        if cursor:
            created_at, note_id = decode_cursor(cursor)
            statement = statement.where(tuple_(Note.created_at, Note.id) < (created_at, note_id))
        if q:
            statement = statement.where(Note.body.ilike(f"%{escape_like(q)}%", escape="\\"))
        statement = statement.order_by(Note.created_at.desc(), Note.id.desc()).limit(limit + 1)
        rows = list((await self._session.execute(statement)).scalars())
        if len(rows) <= limit:
            return rows, None
        page = rows[:limit]
        last = page[-1]
        return page, encode_cursor(last.created_at, last.id)

    async def get(self, account_id: uuid.UUID, note_id: uuid.UUID) -> Note:
        await self._scope(account_id)
        note: Note | None = (
            await self._session.execute(
                select(Note).where(
                    Note.id == note_id, Note.user_id == account_id, Note.deleted_at.is_(None)
                )
            )
        ).scalar_one_or_none()
        if note is None:
            raise _not_found()
        return note

    async def update(
        self, account_id: uuid.UUID, note_id: uuid.UUID, *, body: str, base_version: int
    ) -> Note:
        """Edit only if nobody changed the note since `base_version` (one atomic UPDATE)."""
        check_body(body)
        await self._scope(account_id)
        statement = (
            update(Note)
            .where(
                Note.id == note_id,
                Note.user_id == account_id,
                Note.deleted_at.is_(None),
                Note.version == base_version,
            )
            .values(body=body, version=Note.version + 1)
            .returning(Note)
            .execution_options(synchronize_session=False)
        )
        updated: Note | None = (await self._session.execute(statement)).scalar_one_or_none()
        if updated is not None:
            await self._session.commit()
            return updated

        current = await self.get(account_id, note_id)  # 404 if it is gone
        raise ApiError(
            409,
            "version_conflict",
            "This note changed somewhere else. Reload it before saving.",
            extra={"current": note_out(current).model_dump(mode="json")},
        )

    async def soft_delete(self, account_id: uuid.UUID, note_id: uuid.UUID) -> None:
        await self._scope(account_id)
        statement = (
            update(Note)
            .where(Note.id == note_id, Note.user_id == account_id, Note.deleted_at.is_(None))
            .values(deleted_at=func.now())
            .returning(Note.id)
            .execution_options(synchronize_session=False)
        )
        deleted = (await self._session.execute(statement)).scalar_one_or_none()
        if deleted is None:
            raise _not_found()
        await self._session.commit()


def get_note_store(session: AsyncSession = Depends(get_session)) -> NoteStore:
    return NoteStore(session)
