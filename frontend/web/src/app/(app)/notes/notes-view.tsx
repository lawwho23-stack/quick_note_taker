"use client";

import {
  NOTE_MAX_CHARS,
  type NoteCreateAck,
  type NoteList,
  type NoteOut,
  type VersionConflictBody,
} from "@quick-note/shared";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Dialog } from "@/components/dialog";
import { Quinn } from "@/components/quinn";
import { apiFetch, apiJson } from "@/lib/api";
import { formatDateTime, formatListDate, notePreview, noteTitle } from "@/lib/format";

const PAGE_SIZE = 30;
const AUTOSAVE_MS = 800;
const SEARCH_MS = 300;

/** A note in the list. `persisted: false` is a new note not yet sent to the API. */
type LocalNote = NoteOut & { persisted: boolean };

type ListState =
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "error"; message: string };

type SaveKind = "idle" | "saving" | "saved" | "error" | "empty";
type SaveState = { id: string; kind: SaveKind; message?: string };

type Conflict = { id: string; mine: string; current: NoteOut };

type NoteMeta = { version: number; persisted: boolean };

type SaveOutcome =
  | { kind: "ok" }
  | { kind: "conflict"; current: NoteOut }
  | { kind: "failed"; message: string };

function newLocalNote(id: string): LocalNote {
  const now = new Date().toISOString();
  return {
    id,
    body: "",
    version: 0,
    source: "web",
    meta: {},
    created_at: now,
    updated_at: now,
    persisted: false,
  };
}

function errorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "note_too_large":
      return `A note can hold at most ${NOTE_MAX_CHARS.toLocaleString()} characters.`;
    case "note_not_found":
    case "not_found":
      return "This note no longer exists. It may have been deleted somewhere else.";
    case "rate_limited":
      return "Too many saves at once. We will try again in a moment.";
    default:
      return fallback;
  }
}

export function NotesView() {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listState, setListState] = useState<ListState>({ phase: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");

  const [selected, setSelected] = useState<LocalNote | null>(null);
  const [draft, setDraft] = useState("");
  const [save, setSave] = useState<SaveState | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LocalNote | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Phones show either the list or the editor. */
  const [mobileView, setMobileView] = useState<"list" | "editor">("list");

  // Save engine state. Only touched from event handlers and async callbacks.
  const metaRef = useRef(new Map<string, NoteMeta>());
  const pendingRef = useRef(new Map<string, string>());
  const inflightRef = useRef(new Set<string>());
  const timerRef = useRef<number | null>(null);
  const timerIdRef = useRef<string | null>(null);
  const conflictIdRef = useRef<string | null>(null);
  const listRequestRef = useRef(0);
  const searchTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const patchListNote = useCallback((id: string, patch: Partial<LocalNote>) => {
    setNotes((current) => current.map((note) => (note.id === id ? { ...note, ...patch } : note)));
    setSelected((current) => (current && current.id === id ? { ...current, ...patch } : current));
  }, []);

  // ---- Saving -------------------------------------------------------------

  /** One POST (new note) or PATCH (existing note). Never retries by itself. */
  const saveOnce = useCallback(
    async (id: string, body: string, meta: NoteMeta): Promise<SaveOutcome> => {
      try {
        if (!meta.persisted) {
          const result = await apiJson<NoteCreateAck>("/api/v1/notes", {
            method: "POST",
            body: JSON.stringify({ id, body, source: "web" }),
          });
          if (!result.ok) {
            return { kind: "failed", message: errorMessage(result.error?.code, "Could not save this note.") };
          }
          metaRef.current.set(id, { version: result.data.version, persisted: true });
          patchListNote(id, {
            version: result.data.version,
            created_at: result.data.created_at,
            updated_at: result.data.created_at,
            persisted: true,
          });
          return { kind: "ok" };
        }

        const response = await apiFetch(`/api/v1/notes/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ body, base_version: meta.version }),
        });
        if (response.ok) {
          const out = (await response.json()) as NoteOut;
          metaRef.current.set(id, { version: out.version, persisted: true });
          // Keep the local text if more typing arrived while this was in flight.
          const { body: savedBody, ...rest } = out;
          patchListNote(id, pendingRef.current.has(id) ? { ...rest } : { ...rest, body: savedBody });
          return { kind: "ok" };
        }
        const payload = (await response.json().catch(() => null)) as Partial<VersionConflictBody> | null;
        if (response.status === 409 && payload?.error?.code === "version_conflict" && payload.current) {
          return { kind: "conflict", current: payload.current };
        }
        return { kind: "failed", message: errorMessage(payload?.error?.code, "Could not save this note.") };
      } catch {
        return { kind: "failed", message: "You seem to be offline. Your text is still here." };
      }
    },
    [patchListNote],
  );

  /**
   * Save the newest queued text for `id`. Only one request per note runs at a
   * time; text typed meanwhile is sent right after, with the new version.
   */
  const runSave = useCallback(
    async (id: string): Promise<void> => {
      if (inflightRef.current.has(id) || conflictIdRef.current === id) {
        return; // the running loop picks up the newest text
      }
      inflightRef.current.add(id);
      try {
        let saved = false;
        for (;;) {
          const body = pendingRef.current.get(id);
          const meta = metaRef.current.get(id);
          if (body === undefined || !meta) {
            if (saved) {
              setSave({ id, kind: "saved" });
            }
            return;
          }
          pendingRef.current.delete(id);
          if (body.trim() === "") {
            // The API needs some text. A new note waits; an old one shows a hint.
            setSave({ id, kind: meta.persisted ? "empty" : "idle" });
            return;
          }
          setSave({ id, kind: "saving" });
          const outcome = await saveOnce(id, body, meta);
          if (outcome.kind === "conflict") {
            conflictIdRef.current = id;
            // The newest local text is what "mine" means in the dialog.
            const mine = pendingRef.current.get(id) ?? body;
            pendingRef.current.delete(id);
            setConflict({ id, mine, current: outcome.current });
            setSave({ id, kind: "error", message: "This note changed somewhere else." });
            return;
          }
          if (outcome.kind === "failed") {
            // Keep the text queued so "Try again" (or the next keystroke) resends it.
            if (!pendingRef.current.has(id)) {
              pendingRef.current.set(id, body);
            }
            setSave({ id, kind: "error", message: outcome.message });
            return;
          }
          saved = true;
        }
      } finally {
        inflightRef.current.delete(id);
      }
    },
    [saveOnce],
  );

  /** Send any waiting change for `id` right now instead of after the debounce. */
  const flush = useCallback(
    (id: string) => {
      if (timerRef.current !== null && timerIdRef.current === id) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        timerIdRef.current = null;
      }
      void runSave(id);
    },
    [runSave],
  );

  function onDraftChange(value: string) {
    if (!selected) {
      return;
    }
    const id = selected.id;
    setDraft(value);
    setNotes((current) => current.map((note) => (note.id === id ? { ...note, body: value } : note)));
    if (conflictIdRef.current === id) {
      return;
    }
    pendingRef.current.set(id, value);
    if (value.trim() !== "") {
      setSave({ id, kind: "saving" });
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      if (timerIdRef.current && timerIdRef.current !== id) {
        void runSave(timerIdRef.current);
      }
    }
    timerIdRef.current = id;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      timerIdRef.current = null;
      void runSave(id);
    }, AUTOSAVE_MS);
  }

  // ---- Loading the list ---------------------------------------------------

  const loadList = useCallback(async (q: string, cursor: string | null) => {
    const requestId = ++listRequestRef.current;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (q) {
      params.set("q", q);
    }
    if (cursor) {
      params.set("cursor", cursor);
    }
    const result = await apiJson<NoteList>(`/api/v1/notes?${params.toString()}`);
    if (requestId !== listRequestRef.current) {
      return; // a newer search replaced this one
    }
    if (!result.ok) {
      setListState({
        phase: "error",
        message: result.error?.message ?? "Could not load your notes.",
      });
      setLoadingMore(false);
      return;
    }
    const busy = (id: string) =>
      pendingRef.current.has(id) || inflightRef.current.has(id) || conflictIdRef.current === id;
    const items: LocalNote[] = result.data.items.map((note) => {
      const known = metaRef.current.get(note.id);
      if (!known || (!busy(note.id) && note.version >= known.version)) {
        metaRef.current.set(note.id, { version: note.version, persisted: true });
      }
      return { ...note, persisted: true };
    });
    setNotes((current) => {
      if (cursor) {
        const seen = new Set(current.map((note) => note.id));
        return [...current, ...items.filter((note) => !seen.has(note.id))];
      }
      // Keep brand-new local notes at the top while not searching.
      const drafts = q ? [] : current.filter((note) => !note.persisted);
      const draftIds = new Set(drafts.map((note) => note.id));
      return [...drafts, ...items.filter((note) => !draftIds.has(note.id))];
    });
    setNextCursor(result.data.next_cursor);
    setListState({ phase: "ready" });
    setLoadingMore(false);
  }, []);

  useEffect(() => {
    // Mount-only fetch; state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount effect, no update loop
    void loadList("", null);
  }, [loadList]);

  // Warn before leaving with unsaved text, and stop timers on unmount.
  useEffect(() => {
    const pending = pendingRef.current;
    const inflight = inflightRef.current;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const unsaved = [...pending.values()].some((body) => body.trim() !== "");
      if (unsaved || inflight.size > 0) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  function onSearchChange(value: string) {
    setQuery(value);
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      const q = value.trim();
      setActiveQuery(q);
      setListState({ phase: "loading" });
      void loadList(q, null);
    }, SEARCH_MS);
  }

  function loadMore() {
    if (!nextCursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    void loadList(activeQuery, nextCursor);
  }

  // ---- Selecting, creating, deleting --------------------------------------

  /** Leave the current note: save it now, or drop it if it is a blank new note. */
  function leaveCurrent() {
    if (!selected) {
      return;
    }
    const id = selected.id;
    const meta = metaRef.current.get(id);
    if (meta && !meta.persisted && draft.trim() === "" && !inflightRef.current.has(id)) {
      pendingRef.current.delete(id);
      metaRef.current.delete(id);
      setNotes((current) => current.filter((note) => note.id !== id));
      return;
    }
    flush(id);
  }

  function selectNote(note: LocalNote) {
    if (selected?.id === note.id) {
      setMobileView("editor");
      return;
    }
    leaveCurrent();
    setSelected(note);
    setDraft(note.body);
    setMobileView("editor");
  }

  function createNote() {
    leaveCurrent();
    const note = newLocalNote(crypto.randomUUID());
    metaRef.current.set(note.id, { version: 0, persisted: false });
    setNotes((current) => [note, ...current]);
    setSelected(note);
    setDraft("");
    setSave(null);
    setMobileView("editor");
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    const meta = metaRef.current.get(target.id);
    if (meta?.persisted) {
      const result = await apiJson<void>(`/api/v1/notes/${target.id}`, { method: "DELETE" });
      if (!result.ok && result.status !== 404) {
        setDeleting(false);
        setDeleteError(result.error?.message ?? "Could not delete this note. Please try again.");
        return;
      }
    }
    if (timerIdRef.current === target.id && timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      timerIdRef.current = null;
    }
    pendingRef.current.delete(target.id);
    metaRef.current.delete(target.id);
    setNotes((current) => current.filter((note) => note.id !== target.id));
    if (selected?.id === target.id) {
      setSelected(null);
      setDraft("");
      setSave(null);
      setMobileView("list");
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  // ---- Conflict choices ---------------------------------------------------

  function resolveConflict(choice: "mine" | "theirs" | "new") {
    if (!conflict) {
      return;
    }
    const { id, mine, current } = conflict;
    conflictIdRef.current = null;
    setConflict(null);
    metaRef.current.set(id, { version: current.version, persisted: true });

    if (choice === "mine") {
      patchListNote(id, { version: current.version, updated_at: current.updated_at });
      pendingRef.current.set(id, mine);
      void runSave(id);
      return;
    }

    patchListNote(id, { ...current, persisted: true });
    if (choice === "theirs") {
      if (selected?.id === id) {
        setDraft(current.body);
      }
      setSave({ id, kind: "saved" });
      return;
    }

    // Save mine as a new note; the original keeps the other version.
    const copy = { ...newLocalNote(crypto.randomUUID()), body: mine };
    metaRef.current.set(copy.id, { version: 0, persisted: false });
    setNotes((list) => [copy, ...list]);
    setSelected(copy);
    setDraft(mine);
    pendingRef.current.set(copy.id, mine);
    void runSave(copy.id);
  }

  // ---- Render -------------------------------------------------------------

  const saveForSelected = selected && save?.id === selected.id ? save : null;
  const overLimit = draft.length > NOTE_MAX_CHARS;
  const hasAnyNotes = notes.length > 0;

  let saveLabel = "";
  if (selected) {
    if (overLimit) {
      saveLabel = "Too long to save";
    } else if (saveForSelected?.kind === "saving") {
      saveLabel = "Saving…";
    } else if (saveForSelected?.kind === "saved") {
      saveLabel = "Saved";
    } else if (saveForSelected?.kind === "error") {
      saveLabel = "Error";
    } else if (saveForSelected?.kind === "empty") {
      saveLabel = "Not saved";
    } else if (!selected.persisted) {
      saveLabel = "New note";
    } else {
      saveLabel = "Saved";
    }
  }

  return (
    <div className={`notes-layout show-${mobileView}`}>
      <section className="notes-list-pane" aria-label="Your notes">
        <div className="notes-list-head">
          <h1>Notes</h1>
          <button className="button" type="button" onClick={createNote}>
            <span aria-hidden="true">+</span> New note
          </button>
        </div>
        <div className="field">
          <label className="visually-hidden" htmlFor="note-search">
            Search notes
          </label>
          <input
            id="note-search"
            className="input search-input"
            type="search"
            placeholder="Search notes"
            autoComplete="off"
            value={query}
            maxLength={200}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        {listState.phase === "loading" && !hasAnyNotes ? (
          <ul className="note-rows" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <li key={index} className="note-row skeleton" />
            ))}
          </ul>
        ) : null}

        {listState.phase === "error" ? (
          <div className="stack">
            <p className="notice error" role="alert">
              {listState.message}
            </p>
            <button
              className="button ghost"
              type="button"
              onClick={() => {
                setListState({ phase: "loading" });
                void loadList(activeQuery, null);
              }}
            >
              Try again
            </button>
          </div>
        ) : null}

        {listState.phase === "ready" && !hasAnyNotes ? (
          activeQuery ? (
            <div className="empty-state small-empty">
              <p>
                No notes match <strong>“{activeQuery}”</strong>.
              </p>
              <p className="muted small">Try a shorter word, or check the spelling.</p>
            </div>
          ) : (
            <div className="empty-state">
              <Quinn size={96} />
              <h2>Your ideas land here</h2>
              <p className="muted">
                Write your first note, or set up the shortcut to capture ideas from any tab.
              </p>
              <div className="row center">
                <button className="button" type="button" onClick={createNote}>
                  Write a note
                </button>
                <Link className="button ghost" href="/quick-note">
                  Set up Quick Note
                </Link>
              </div>
            </div>
          )
        ) : null}

        {hasAnyNotes ? (
          <ul className="note-rows">
            {notes.map((note) => {
              const active = selected?.id === note.id;
              const preview = notePreview(note.body);
              return (
                <li key={note.id}>
                  <button
                    type="button"
                    className={active ? "note-row active" : "note-row"}
                    aria-current={active ? "true" : undefined}
                    onClick={() => selectNote(note)}
                  >
                    <span className="note-row-title">{noteTitle(note.body)}</span>
                    {preview ? <span className="note-row-preview">{preview}</span> : null}
                    <span className="note-row-meta">
                      {formatListDate(note.created_at)}
                      {note.source === "extension" ? " · Quick Note" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {nextCursor && hasAnyNotes ? (
          <button className="button ghost block" type="button" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        ) : null}
        {listState.phase === "loading" && hasAnyNotes ? (
          <p className="muted small" role="status">
            Searching…
          </p>
        ) : null}
      </section>

      <section className="notes-editor-pane" aria-label="Editor">
        {selected ? (
          <div className="editor">
            <div className="editor-bar">
              <button
                className="button ghost small-button mobile-only"
                type="button"
                onClick={() => {
                  leaveCurrent();
                  setMobileView("list");
                }}
              >
                ← Notes
              </button>
              <span
                className={`save-status save-${overLimit ? "error" : saveForSelected?.kind ?? "idle"}`}
                role="status"
                aria-live="polite"
              >
                {saveLabel}
              </span>
              {saveForSelected?.kind === "error" && !conflict ? (
                <button
                  className="link-button small"
                  type="button"
                  onClick={() => flush(selected.id)}
                >
                  Try again
                </button>
              ) : null}
              <span className="editor-spacer" />
              <button
                className="button ghost small-button danger-text"
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteTarget(selected);
                }}
              >
                Delete
              </button>
            </div>
            {saveForSelected?.kind === "error" && saveForSelected.message ? (
              <p className="notice error small">{saveForSelected.message}</p>
            ) : null}
            {saveForSelected?.kind === "empty" ? (
              <p className="notice info small">
                A note needs some text. Type something, or delete the note.
              </p>
            ) : null}
            <label className="visually-hidden" htmlFor="note-body">
              Note text
            </label>
            <textarea
              id="note-body"
              ref={textareaRef}
              className="editor-text"
              value={draft}
              placeholder="Type your idea…"
              spellCheck
              onChange={(event) => onDraftChange(event.target.value)}
              onBlur={() => flush(selected.id)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  flush(selected.id);
                }
              }}
            />
            <div className="editor-foot muted small">
              <span>
                {selected.persisted ? `Created ${formatDateTime(selected.created_at)}` : "Not saved yet"}
              </span>
              <span className={overLimit ? "danger-text" : undefined}>
                {draft.length.toLocaleString()} / {NOTE_MAX_CHARS.toLocaleString()}
              </span>
            </div>
          </div>
        ) : (
          <div className="empty-state editor-empty">
            <Quinn size={88} />
            <h2>Pick a note</h2>
            <p className="muted">Choose a note on the left, or start a new one.</p>
            <button className="button" type="button" onClick={createNote}>
              New note
            </button>
          </div>
        )}
      </section>

      <Dialog
        open={conflict !== null}
        title="This note changed somewhere else"
        onClose={() => {
          // Escape does nothing here: the user has to pick one of the three options.
        }}
      >
        <p className="muted">
          Someone (maybe you, in another tab) saved a different version. Which one should we keep?
        </p>
        {conflict ? (
          <div className="conflict-grid">
            <div>
              <h3 className="conflict-label">Yours</h3>
              <pre className="conflict-text">{conflict.mine}</pre>
            </div>
            <div>
              <h3 className="conflict-label">The other version</h3>
              <pre className="conflict-text">{conflict.current.body}</pre>
            </div>
          </div>
        ) : null}
        <div className="dialog-actions">
          <button className="button" type="button" onClick={() => resolveConflict("mine")}>
            Keep mine
          </button>
          <button className="button ghost" type="button" onClick={() => resolveConflict("theirs")}>
            Keep theirs
          </button>
          <button className="button ghost" type="button" onClick={() => resolveConflict("new")}>
            Save mine as new
          </button>
        </div>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        title="Delete this note?"
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
          }
        }}
      >
        <p className="muted">This can&apos;t be undone.</p>
        {deleteTarget ? <p className="delete-preview">{noteTitle(deleteTarget.body)}</p> : null}
        {deleteError ? (
          <p className="notice error" role="alert">
            {deleteError}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button
            className="button danger"
            type="button"
            onClick={() => void confirmDelete()}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <button
            className="button ghost"
            type="button"
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
            autoFocus
          >
            Cancel
          </button>
        </div>
      </Dialog>
    </div>
  );
}
