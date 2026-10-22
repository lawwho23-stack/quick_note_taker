# M2 Phase A handoff: notes API

Date: 2026-10-22 · Branch: `feat/m2-notes-api`

## Goal
This is the first of four phases toward the core flow:
- shortcut → capture card at the top center of the page → Enter → saved → card closes.

The full plan has four phases:
- **A, notes API** (this one)
- **B, extension tokens + "Connect"**
- **C, capture overlay**
- **D, Space+N helper fix**

## What was built
- **Migration `backend/supabase/migrations/0002_notes_tokens.sql`:**
  - the `pg_trgm` extension
  - `app.notes`, with row-level security enabled and forced
  - `app.extension_tokens`, which Phase B uses
- **`app/notes.py`, a `NoteStore` with these operations:**
  - an idempotent create
  - a keyset list with `ILIKE` search (wildcards escaped)
  - get
  - an atomic version-checked update
  - soft delete
- **`app/routers/notes.py`:**
  - `POST/GET /v1/notes`
  - `GET/PATCH/DELETE /v1/notes/{id}`
- **Schemas:** `NoteCreate`, `NoteUpdate`, `NoteOut`, `NoteCreateAck`, `NoteList`.
- **`ApiError(extra=...)`:** a `409 version_conflict` now also carries a `current` note.

## Decisions
- **Commits are per handler, not in `get_session`.** `ensure_account()` now only flushes. Each auth handler, and each `NoteStore` write, commits once at the end of its work.
  - **Rule for later phases:** a write that forgets `commit()` is silently rolled back.
  - `app.user_id` is set with `set_config(..., true)`, so it lasts only until that commit. This is safe on the Supabase transaction pooler.
- **RLS:**
  - The `notes_owner` policy is `to qn_runtime`, with `user_id = app.user_id`.
  - The queries also filter by `user_id`, as a second wall.
  - `extension_tokens` has no RLS. It is looked up by hash before any account is known.
- **Idempotent create:**
  - Same id and same payload hash → `200` with the original ack.
  - Different payload, or an id owned by another account → `409 note_id_conflict`. The code is the same in both cases, so a collision leaks nothing.
  - A new note → `201`.
- **The create response is a body-less ack for every caller.** So an extension token that can only create can never read notes.
- **Field name:** the column is `meta`, not `metadata`, to match the architecture doc.
- **Limits:**
  - body: 1–20,000 characters, otherwise `413 note_too_large`
  - `meta`: at most 4 KB
  - `source`: matches `^[a-z][a-z0-9_-]{0,31}$`
- **Rate limiting is deferred** to a follow-up PR. The Upstash design in `m1-handoff.md` item 2 still applies. Capture does not depend on it.

## Tests
- **Hermetic** (`tests/test_notes_api.py`, fake store): status codes, error shapes, CSRF, auth, and validation.
- **Database tier** (`tests/db/`, `@pytest.mark.db`, needs `QN_DB_TEST_URL`):
  - Runs as `qn_runtime` through a connect-event `SET ROLE`, so RLS really applies.
  - Covers two-account isolation, RLS with no user filter, a blocked cross-account insert, idempotency, conflicts, version checks, Burmese search, a literal `%`, paging, cascade on account delete, and a full HTTP round trip.
  - Turning RLS off makes the two RLS tests fail, so they test the real thing.
- **CI:** a new "Database tests" step runs after "Apply migrations".
- **Run locally:** set `QN_DB_TEST_URL=<superuser url of a migrated db>`, then run `uv run pytest -m db`.

## Laww must do (in this order)
1. Apply the migration to staging: `supabase db push --db-url <owner session-pooler URL>`. Never use `supabase config push`.
2. Check that `RUNTIME_DATABASE_URL` in the Vercel project `quick-note-api` uses the `qn_runtime.<ref>` user, as `.env.staging` does.
   - Any other role without BYPASSRLS would see no notes.
   - A role with BYPASSRLS would skip RLS.
3. Deploy the API: `npx vercel --prod --project quick-note-api`, run from the repo root.

Deploying before step 1 makes `/v1/notes` return 500.

## Follow-ups
- **`pg_trgm` schema:** it may land in `public` on Supabase, and Supabase's advisor flags that. Consider moving it to `extensions` later.
- **Rate limiting:** this PR records the deferral.
- **Missing CSRF cookie:** `require_cookie_csrf` checks only the origin when the CSRF cookie is missing. This behaviour predates M2.

## Next: Phase B (fresh session)
- Build `/v1/extension-tokens`: create returns the secret once, list never shows secrets, delete revokes.
- Build `GET /v1/extension/status`.
- Add `current_principal`, which recognises `qnx_` bearer tokens, and `require_scope("notes:create")`. Only `POST /v1/notes` accepts extension tokens; every other route accepts only a website session.
- Build the website `/quick-note` Connect page, and a read-only `/notes` list.

The full plan is in `~/.claude/plans/i-want-to-shortcut-floating-lantern.md`.
