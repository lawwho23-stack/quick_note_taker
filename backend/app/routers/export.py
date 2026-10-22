"""Download every live note of the signed-in account (JSON or Markdown)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response

from app.deps import require_session_account
from app.models import Note, User
from app.notes import NoteStore, get_note_store, note_out
from app.schemas import NoteExport

router = APIRouter(prefix="/v1", tags=["account"])


def render_markdown(notes: list[Note]) -> str:
    """Each note as `## <created_at ISO>` and its body, separated by `---`."""
    sections = [f"## {note.created_at.isoformat()}\n\n{note.body}\n" for note in notes]
    return "\n---\n\n".join(sections)


def _attachment(exported_at: datetime, extension: str) -> dict[str, str]:
    filename = f"quick-note-export-{exported_at.date().isoformat()}.{extension}"
    return {"content-disposition": f'attachment; filename="{filename}"'}


@router.get(
    "/export",
    response_model=None,
    responses={
        200: {
            "model": NoteExport,
            "description": "All live notes, oldest first, as an attachment.",
            "content": {"text/markdown": {"schema": {"type": "string"}}},
        }
    },
)
async def export_notes(
    account: Annotated[User, Depends(require_session_account)],
    store: Annotated[NoteStore, Depends(get_note_store)],
    output_format: Annotated[Literal["json", "markdown"], Query(alias="format")] = "json",
) -> Response:
    notes = await store.export(account.id)
    exported_at = datetime.now(UTC)
    if output_format == "markdown":
        return Response(
            content=render_markdown(notes),
            media_type="text/markdown; charset=utf-8",
            headers=_attachment(exported_at, "md"),
        )
    export = NoteExport(
        exported_at=exported_at, count=len(notes), notes=[note_out(note) for note in notes]
    )
    body = json.dumps(export.model_dump(mode="json"), ensure_ascii=False, indent=2)
    return Response(
        content=body, media_type="application/json", headers=_attachment(exported_at, "json")
    )
