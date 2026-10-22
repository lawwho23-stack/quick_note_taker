# V1 completion plan (everything left after M2 phase A)

Date: 2026-10-22. Base: `feat/m2-notes-api` (PR #3). This plan covers the rest of `docs/quick-note-v1-architecture.md`.

The work is split into four parallel workstreams, each with its own folder. No two workstreams edit the same files. Integration covers CI, generated API types and docs, and happens last.

| Workstream | Owns | Delivers |
|---|---|---|
| **B: Backend** | `backend/**` | extension tokens, scope checks, export, delete account, rate limiting, CORS, error tracking |
| **W: Website** | `frontend/web/**`, `frontend/shared/**` | `/notes` editor, `/quick-note` setup, `/settings`, sidebar + badge, `/privacy` |
| **E: Extension** | `frontend/extension/**` | TS + Vite build, top-center capture card, real saves, token storage, connect protocol |
| **H: macOS helper** | `frontend/macos-helper/**` | reliable Space+N delivery |
| **I: Integration** | root `package.json`, lockfile, `.github/**`, `docs/**` | merge everything, generated types, CI jobs, handoff, PRs |

Fixed facts:
- The extension ID is **`mpnpdndkgajhjmlefflhemibjmkkcnha`**. It is stable because of the `key` in `frontend/extension/manifest.json`; keep that key.
- Staging web: `https://quick-note-web-one.vercel.app`. Staging API: `https://quick-note-api.vercel.app`. Local: web `http://localhost:3000`, API `http://localhost:8000`.

---

## Contract 1: API additions (B implements; W and E consume)

All errors keep the shape `{"error": {"code", "message", "request_id"}}`.

### Principals
- **Session:** the existing cookie or Supabase JWT bearer. This is the website.
- **Extension token:** `Authorization: Bearer qnx_<secret>`. It has the scope `notes:create` only. Only the sha-256 hash is stored. The token is rejected if revoked (`401 token_revoked`) or unknown (`401 unauthenticated`).
- An extension token is only accepted on `POST /v1/notes` and `GET /v1/extension/status`. On every other route it gets `403 wrong_scope`.
- On `POST /v1/notes` with an extension token, the server forces `source = "extension"` and returns the body-less ack.
- `last_used_at` is updated on use, at most once a minute.

### Extension tokens (session only, CSRF as usual)
| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/v1/extension-tokens` | `{"label": str?}` (≤ 64 chars) | `201 {"id", "label", "scopes", "created_at", "token": "qnx_..."}`. The secret is shown **only here**. |
| GET | `/v1/extension-tokens` | n/a | `200 {"items": [{"id", "label", "scopes", "created_at", "last_used_at"}]}`. Active tokens only; never secrets. |
| DELETE | `/v1/extension-tokens/{id}` | n/a | `204`. Another account's token, or one already revoked, gets `404 token_not_found`. |
| GET | `/v1/extension/status` | extension bearer | `200 {"status": "connected"}`. A bad or revoked token gets `401`. |

### Export (session only)
- `GET /v1/export?format=json` (the default) returns `200 application/json` with `Content-Disposition: attachment; filename="quick-note-export-YYYY-MM-DD.json"`. The body is `{"exported_at", "count", "notes": [NoteOut...]}`, oldest first, live notes only.
- `GET /v1/export?format=markdown` returns `text/markdown; charset=utf-8` (`.md` filename). Each note is `## <created_at ISO>` followed by its body, with notes separated by `---`.

### Delete account (session only, CSRF)
- `DELETE /v1/me` with body `{"confirm": "DELETE"}`.
- It deletes the Supabase Auth user through the admin API, using `SUPABASE_SERVICE_ROLE_KEY` (a new optional setting). That cascades to `app.users`, notes and tokens.
- The response is `204`, and the session cookies are cleared.
- If the key isn't set, the response is `503 account_deletion_unavailable` and nothing is deleted.
- A wrong `confirm` gets `400 validation_error`.

### Rate limiting
- Upstash REST, through `httpx` (`INCR` + `EXPIRE ... NX` in a pipeline), with a fixed one-minute window behind a `RateLimiter` interface.
- New optional settings: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. If they aren't set, the limiter is a no-op.
- Limits:
  - extension create: 60/min per token
  - website session: 300/min per account
  - `/v1/auth/*`: 10/min per IP (use the first `x-forwarded-for` hop)
- Over the limit, the response is `429 rate_limited` with `Retry-After`.
- If Redis fails: **fail open** for notes (log it), and **fail closed with 503** for auth routes.

### CORS
- `CORSMiddleware` with `allow_origins` = `allowed_origins` plus the new `EXTENSION_ORIGIN_ALLOWLIST`. The default extension origin is `chrome-extension://mpnpdndkgajhjmlefflhemibjmkkcnha`.
- `allow_credentials=True` only matters for website origins. Methods are GET, POST, PATCH and DELETE. Headers are `authorization`, `content-type` and `x-csrf-token`.
- No wildcards.

### Error tracking
- Optional `SENTRY_DSN`. Initialise `sentry-sdk` only when it is set.
- `send_default_pii=False`, and strip request bodies. Notes are private, so a note body must never reach Sentry.

---

## Contract 2: Website ↔ extension messages (W sends, E answers)

The page calls `chrome.runtime.sendMessage(EXTENSION_ID, msg, callback)`. `EXTENSION_ID` comes from `NEXT_PUBLIC_EXTENSION_ID` (default `mpnpdndkgajhjmlefflhemibjmkkcnha`). If `chrome.runtime` is missing, or `chrome.runtime.lastError` is set, the extension is "Not installed".

| Message | Reply |
|---|---|
| `{"type": "ping"}` | `{"ok": true, "version": "x.y.z", "connected": bool, "lastOpenedAt": number \| null}`. `lastOpenedAt` is ms since epoch of the last time the capture card opened; the setup page uses it for the "press your shortcut now" test. |
| `{"type": "connect", "token": "qnx_..."}` | `{"ok": true}` after the extension stores the token and checks it with `GET /v1/extension/status`. Otherwise `{"ok": false, "error": "invalid_token"}`. |
| `{"type": "disconnect"}` | `{"ok": true}`. The extension forgets the token and clears drafts. |

- The extension answers only if `sender.origin` is in its allowlist: the staging web URL, `http://localhost:3000`, and `http://127.0.0.1:3000`. These are also listed in `externally_connectable.matches`.
- The API base URL is built into the extension at build time (`VITE_API_BASE`, default `https://quick-note-api.vercel.app`). A web page can never set it.
- Badge states on the website: **Not installed**, **Installed** (ping ok, `connected: false`), **Connected**.

---

## Workstream B: Backend
1. `app/deps.py`: `Principal` (`kind: "session" | "extension"`, `account`, `token_id`, `scopes`), `current_principal`, `require_session_account` and `require_scope`. Keep `current_identity` and `current_account` working for existing routes, or migrate them; `/v1/me` must reject extension tokens with 403.
2. `app/extension_tokens.py` (service) and `app/routers/extension_tokens.py` (the token routes plus `/v1/extension/status`).
3. Notes router: only `POST` accepts extension principals, and it forces `source = "extension"`. The other notes routes accept sessions only.
4. `app/routers/export.py`, plus `DELETE /v1/me` in `routers/me.py`, plus an admin delete in `supabase_auth.py`.
5. `app/rate_limit.py` and its wiring: a dependency per router, or middleware.
6. CORS and Sentry setup in `main.py`, and the new settings in `config.py` and `.env.example`.
7. Tests:
   - hermetic tests for every route and failure case above
   - DB tests in `tests/db/` for the token hash lookup, revocation, cross-account token denial, export isolation, and the cascade on delete
   - Limiter tests with a fake transport (`httpx.MockTransport`), covering fail-open and fail-closed.
8. Gates: ruff, format, mypy, `pytest`, and `pytest -m db` against local Postgres.
9. Commit **regenerated `backend/openapi.json`**, the exported schema, through a script `scripts/export_openapi.py`.

## Workstream W: Website
- Read `frontend/web/AGENTS.md` and `node_modules/next/dist/docs/` first. This Next version has breaking changes.
- Keep the Quinn green theme and the existing components (`logo.tsx`, `quinn.tsx`, `auth-shell.tsx`). Use `src/lib/api.ts` for every call; it handles CSRF and refresh.
- **App shell** for signed-in pages: a sidebar with Notes, Quick Note (with the badge) and Settings, plus a mobile layout.
- **`/notes`:**
  - A list, newest first, with "Load more" through `next_cursor`.
  - A search box (`q`, debounced).
  - "New note": the client makes a UUID with `crypto.randomUUID()` and POSTs it.
  - An editor beside the list that autosaves with `PATCH` and `base_version` after about 800 ms idle. It shows Saving, Saved and Error states.
  - On `409 version_conflict` it shows **Keep mine** (re-PATCH with the current version), **Keep theirs** (load `current`) or **Save mine as new** (POST a new id).
  - Delete with a confirm.
  - Empty states using Quinn.
- **`/quick-note`:** the checklist from architecture §6.4:
  1. Install. Link to the store, and for now "Load unpacked" steps for dev.
  2. Connect. POST a token, then send `connect`. The token stays in memory only and is never shown.
  3. Set the shortcut to Global. A copy button for `chrome://extensions/shortcuts`, the Space+N helper note, and a manual confirm stored in `localStorage`.
  4. Test. Poll `ping` every second for 30 s and pass when `lastOpenedAt` moves forward.
- **`/settings`:**
  - Account email and created date.
  - Connected extensions: the token list with Revoke.
  - Export JSON / Markdown, as a download.
  - Delete account: type DELETE to confirm, then go to `/`.
- **`/privacy`:** a plain-language privacy policy. Notes are stored as plain text on the server, we have no access tooling beyond operations, users can export and delete, and it lists the extension's permissions. It is linked from the footer and from auth pages.
- **Types:** write hand types in `frontend/shared/src/index.ts` for Contract 1 for now. Integration replaces them with generated ones.
- **Gates:** `npm run lint`, `npm run typecheck` and `npm run build` from the repo root.

## Workstream E: Extension
- Convert it to **TypeScript + Vite**, as the npm workspace `@quick-note/extension`:
  - `npm run build` writes to `frontend/extension/dist/`, which is the folder to load unpacked.
  - Scripts: `typecheck`, `lint` (eslint) and `test` (Vitest + jsdom).
  - Add the workspace to the root `package.json`.
- **Manifest:**
  - Keep the `key`.
  - Name "Quick Note", version `0.2.0`.
  - Permissions `storage`, `activeTab`, `scripting`.
  - `host_permissions`: the API base (staging plus `http://localhost:8000/*`).
  - The `open-capture` command with `Ctrl+Shift+7` / `MacCtrl+Shift+7` and `"global": true`.
  - `externally_connectable.matches` as in Contract 2.
  - `web_accessible_resources: capture.html` (matches `<all_urls>`).
  - No `content_scripts`, and no `127.0.0.1:8787` beacon. Delete `dev/`.
- **Background service worker:**
  - On the command, record `lastOpenedAt` and focus the last window.
  - Inject `overlay` through `chrome.scripting.executeScript`. If that throws (chrome:// pages, the Web Store, PDFs, the new tab), fall back to a 560×220 popup window at the top center of the screen. Reuse the current `findExistingCaptureWindow` / `openCapture` logic.
  - It owns the token and every API call.
  - Saving:
    - **Before** the fetch, persist `{pendingId, payload}`. A retry reuses the same id.
    - On 201 or 200: clear the pending entry and the draft, then reply `saved`.
    - On 401 / `token_revoked`: go to the disconnected state.
    - On 429: show "slow down".
    - On a network error or 5xx: keep the pending entry so Retry reuses the id.
    - A 15 s timeout counts as an error.
  - Handle Contract 2 in `onMessageExternal`, with the origin check.
- **Overlay** (injected):
  - A fixed host, top 44 px, centered, 560 px wide, in a closed shadow root, with the frosted card from `docs/design/frosted-light/popup-spec.md`. The host holds the `backdrop-filter`.
  - An iframe of `capture.html` inside it.
  - If a card already exists, focus it rather than opening a second one.
  - Esc or a `close` message removes it.
- **Capture page:**
  - Enter saves only when `!e.isComposing && e.keyCode !== 229` (Burmese IME). Shift+Enter adds a line. Esc closes and keeps the draft.
  - States: idle → saving (input locked) → Saved (about 600 ms) → close. Error keeps the text and shows Retry. "Not connected" links to `<web>/quick-note`.
  - Drafts are stored per account in `chrome.storage.local` and restored when the card reopens.
- **Tests:** the IME guard, the save state machine (a lost response gives the same id on retry), the sender-origin check, draft scoping, and a manifest check (exact permissions, no beacon host, `key` present).

## Workstream H: macOS helper
- Goal: Space+N reaches Chrome every time. In M0, 5 of 14 presses were lost.
- Steps:
  1. Pull the chord logic out of `ChordTap.swift` into a pure, testable state machine.
  2. Post Ctrl+Shift+7 **outside** the event-tap callback, with `DispatchQueue.main.asyncAfter` (about 20 ms), after the physical keys are swallowed. Try the `.hidSystemState` source and `.cgSessionEventTap` behind a menu option. The default is the async post.
  3. Mark the posted events with `Synthetic`.
  4. Add timing logs to `EventLog`.
  5. Optionally retry once after 300 ms, behind a setting that is off by default.
- Add an `XCTest` target or a `swift test` target for the state machine, and update `README.md`.
- Gates: `swift build` and `swift test` (or `./build.sh`).

## Integration (I, the main session)
- Merge W, E and H onto `feat/v1-complete`, which is based on `feat/m2-notes-api`, and regenerate `package-lock.json`.
- Generate `frontend/shared/src/api.gen.ts` from `backend/openapi.json` with `openapi-typescript`, and switch W's hand types to it.
- CI: an extension job (lint, typecheck, test, build) and a macOS helper job (`swift build` + test on `macos-latest`).
- Docs: the manual test matrix, the store listing text, and the deploy runbook (the env vars to set in Vercel). Plus a handoff.
- Check everything: all gates, plus a local run with the API and web servers up. Then open the PRs.

## Needs Laww (cannot be done by Claude)
- Apply migrations, then set these in Vercel:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
  - `EXTENSION_ORIGIN_ALLOWLIST`
  - `SENTRY_DSN` (optional)
  - `NEXT_PUBLIC_EXTENSION_ID`
- Deploy both Vercel projects.
- Load the unpacked extension, set its shortcut to Global, and grant the helper its macOS permissions.
- Run the manual test matrix.
- Chrome Web Store and Edge Add-ons accounts and submission.
