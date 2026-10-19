# Quick Note — V1 Architecture & System Design

Status: brainstorm result, ready to build from. Popup visual design is pending (to be supplied separately).

---

## 1. Goal

A simple note taker for capturing ideas without leaving what you are doing (for example, watching a YouTube video).

The whole product is one loop:

> Shortcut → small popup appears (top-middle) → type → Enter → popup closes → back to what you were doing.

Plus a website where you sign up, sign in, and read, search and edit your notes.

**Non-goals for V1:** AI features, folders, rich text, sharing, native desktop app, mobile app, offline queue, end-to-end encryption.

---

## 2. Key constraint (read this first)

A website cannot register a global keyboard shortcut or run in the background. Browsers block this by design. STT-style apps (Wispr Flow, SuperWhisper) work because they are native apps.

V1 is web-only, so the shortcut comes from a **browser extension (Chrome / Edge, Manifest V3)**:

| Situation | Shortcut works? |
|---|---|
| Browser focused | Yes |
| Another app in front, browser still running | Yes, once the user sets the shortcut scope to "Global" |
| Browser fully quit | No |
| Firefox / Safari | Not supported in V1 (no global extension shortcuts, to our knowledge) |
| No extension installed | No (in-page shortcut only) |

Known limitations accepted in V1:

- The popup is a small browser popup window, not a frameless Spotlight-style overlay (that needs a native app).
- Opening the popup brings the browser to the front. Focus does not return to the previous app automatically.
- Over fullscreen apps on macOS the popup may open on another Space or behind. Must be tested.
- Capture needs a network connection (no offline queue in V1).
- The extension cannot set the shortcut to "Global" itself. The user must do it once at `chrome://extensions/shortcuts`.

A native desktop app (Tauri) is the V2 answer if these limits matter to users.

---

## 3. Design principles (this is how it stays flexible)

1. **Contract first.** One versioned HTTP API (`/v1`) described by an OpenAPI spec. The website, the extension, and any future client (mobile, native, CLI) are just clients of that contract.
2. **Ports and adapters.** Every external service sits behind a small interface, so it can be swapped without touching business logic:
   - Database: plain PostgreSQL via `DATABASE_URL`. No vendor-only features (works on Neon, Supabase, RDS, or local Docker).
   - Auth: `AuthProvider` interface. Provider choice is open (see Open decisions).
   - Cache and rate limiting: `RateLimiter` interface with Upstash Redis, in-memory, and no-op implementations.
   - Search: `NoteSearch` interface, starting with Postgres full-text search.
3. **Modular monolith.** One API service with clear modules (auth, notes, tokens, search). No microservices.
4. **Config over code.** Limits, defaults, origins, and feature flags come from environment variables.
5. **Extensible data.** A `meta jsonb` column and a `source` field allow new features without painful migrations.
6. **Least privilege.** The extension uses its own revocable token that can only create notes.
7. **Boring, standard parts.** Anything a new contributor would already know (REST, Postgres, Next.js).

---

## 4. System overview

```
 USER'S BROWSER (Chrome / Edge)                       YOUR SERVER
 ┌─────────────────────────────────────────┐         ┌──────────────────────────────┐
 │  Next.js site        Extension (MV3)    │         │          API  /v1            │
 │  sign-in, notes     global shortcut     │         │  auth · notes · tokens ·     │
 │  list/edit, setup   background worker   │         │  search · rate limit         │
 │        │                  │             │         │      │               │       │
 │        │          Capture popup         │         │      ▼               ▼       │
 │        │        (small window, bundled) │         │  Postgres         Upstash    │
 │        │                  │             │         │ (Neon/Supabase)    Redis     │
 └────────┼──────────────────┼─────────────┘         └──────┼───────────────────────┘
          └────── HTTPS ─────┴──────────────────────────────►┘
```

Everything talks to the API. Nothing else touches the database directly.

---

## 5. Components

### 5.1 Next.js website (`apps/web`)

- Next.js App Router, TypeScript, simple clean UI (design to come).
- Pages:
  - `/sign-up`, `/sign-in`
  - `/notes`: list (newest first), search box, note editor beside the list, autosave after a short pause
  - `/quick-note`: guided setup for the shortcut (see 6.4)
  - `/settings`: account, extension tokens (list and revoke), export, delete account
- Sidebar: Notes, Quick Note (shows status badge: Not installed, Installed, Connected), Settings.
- Talks to the API through `packages/api-client` (generated from the OpenAPI spec).
- Web session: httpOnly, Secure, SameSite=Lax cookie.

### 5.2 Browser extension (`apps/extension`)

- Manifest V3, shared codebase for Chrome and Edge.
- Background service worker listens for the command and opens the capture popup.
- Capture page (`capture.html`) is bundled inside the extension so it opens fast. It is a tiny page with one textarea.
- Stores its token in `chrome.storage.local`.

Manifest sketch:

```json
{
  "manifest_version": 3,
  "name": "Quick Note",
  "version": "0.1.0",
  "background": { "service_worker": "background.js" },
  "permissions": ["storage"],
  "host_permissions": ["https://api.example.com/*"],
  "commands": {
    "open-capture": {
      "suggested_key": { "default": "Ctrl+Shift+Y", "mac": "Command+Shift+Y" },
      "description": "Open Quick Note capture"
    }
  },
  "externally_connectable": { "matches": ["https://app.example.com/*"] }
}
```

Background worker sketch (center the popup near the top of the last focused window):

```js
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "open-capture") return;
  const w = await chrome.windows.getLastFocused();
  const width = 560, height = 180;
  const left = Math.round((w.left ?? 0) + ((w.width ?? width) - width) / 2);
  const top = Math.round((w.top ?? 0) + 80);
  await chrome.windows.create({
    url: chrome.runtime.getURL("capture.html"),
    type: "popup", width, height, left, top, focused: true,
  });
});
```

Capture page behavior:

- Textarea is focused immediately.
- `Enter` saves, `Shift+Enter` adds a line, `Esc` closes.
- Unsaved text is kept as a draft (`chrome.storage.local`), so an accidental close does not lose the idea.
- On success: brief "Saved" flash, then `window.close()`.
- On failure (offline or error): keep the text, show a clear message, let the user retry.
- If a capture window is already open, focus it instead of opening a second one.
- Default shortcut and allowed global combos are restricted by Chrome. Verify the allowed set during the build.

### 5.3 API (`apps/api`)

- Language: open decision (Rust/Axum or Python/FastAPI). Nothing in the design depends on it because the contract is OpenAPI.
- Modules: `auth`, `notes`, `extension_tokens`, `search`, `ratelimit`, `health`.
- Stateless, so it can scale horizontally.
- Structured JSON logs with a request ID on every request.

### 5.4 PostgreSQL (Neon or Supabase)

- Single source of truth.
- Use only standard Postgres features so the host can be changed with one env var.
- Migrations managed with a migration tool (one tool, versioned, run in CI).

### 5.5 Upstash Redis

- V1 role: **rate limiting** (and optionally short-lived caching of user profile data).
- It is not a source of truth and is not required for correctness.
- Behind the `RateLimiter` interface. If Redis is unreachable, fail open (allow the request, log it) so notes are never lost because of the cache.
- There is no sync cursor in this design, so Redis does not cache note data in V1.

---

## 6. Key flows

### 6.1 Sign-up / sign-in (website)

1. User signs up or signs in (provider per Open decisions).
2. API sets the session cookie.
3. First login creates a row in `users` keyed by the provider's subject ID.

### 6.2 Quick capture (extension)

1. User presses the global shortcut.
2. Service worker opens the capture popup.
3. User types and presses Enter.
4. Capture page calls `POST /v1/notes` with the extension token and a client-generated note `id` (UUID).
5. API validates, rate-limits, inserts, returns `201`.
6. Popup shows "Saved" and closes.

The client-generated `id` makes retries idempotent: sending the same note twice never creates a duplicate.

### 6.3 Read and edit (website)

1. `GET /v1/notes?limit=50` (keyset pagination) and `GET /v1/notes?q=...` for search.
2. The editor autosaves with `PATCH /v1/notes/:id`, sending `base_version`.
3. If the server version is newer, the API returns `409 version_conflict` with the current note. The UI shows a simple choice: keep mine, keep theirs, or save mine as a new note. This avoids silently overwriting text written from the extension.

### 6.4 Quick Note setup (sidebar page)

The `/quick-note` page is a guided checklist:

1. **Install the extension.** Link to the Chrome Web Store / Edge Add-ons listing. The browser shows its own permission prompt.
2. **Connect it to the account.** The site creates an extension token (shown once) and passes it to the extension via `chrome.runtime.sendMessage` (enabled by `externally_connectable`). The same message channel is used to detect whether the extension is installed, so the sidebar badge is accurate.
3. **Set the shortcut to Global.** Instructions with a copy button for `chrome://extensions/shortcuts` (pages cannot link to `chrome://` URLs). The extension cannot read or set the scope, so this step is a manual confirmation.
4. **Test.** A "Press your shortcut now" check that confirms the popup opens.

Status badge states: Not installed, Installed but not connected, Connected.

---

## 7. Data model

```sql
create table users (
  id           uuid primary key default gen_random_uuid(),
  auth_subject text unique not null,        -- ID from the auth provider
  email        text,
  created_at   timestamptz not null default now()
);

create table notes (
  id          uuid primary key,             -- generated by the client
  user_id     uuid not null references users(id) on delete cascade,
  body        text not null check (char_length(body) <= 20000),
  version     integer not null default 1,   -- optimistic concurrency
  source      text not null default 'web',  -- 'web' | 'extension' | future clients
  meta        jsonb not null default '{}',  -- room to grow without migrations
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,                  -- soft delete
  search      tsvector generated always as (to_tsvector('simple', body)) stored
);

create index notes_user_created_idx on notes (user_id, created_at desc, id desc)
  where deleted_at is null;
create index notes_search_idx on notes using gin (search);
-- Optional: substring search for scripts without spaces between words
-- create extension pg_trgm; create index notes_trgm_idx on notes using gin (body gin_trgm_ops);

create table extension_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text unique not null,        -- store only a hash (sha-256)
  label        text,
  scopes       text[] not null default '{notes:create}',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
```

Notes on search: the `simple` text-search configuration avoids language-specific stemming, which suits mixed-language notes. Scripts written without spaces between words (such as Burmese and Thai) tokenize poorly in full-text search, so plan the `pg_trgm` index as the fallback for substring search.

---

## 8. API design (`/v1`)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/v1/me` | Current user | session or token |
| GET | `/v1/notes` | List (keyset pagination `cursor`, `limit`), search with `q` | session |
| POST | `/v1/notes` | Create (client supplies `id`; idempotent) | session or extension token |
| GET | `/v1/notes/:id` | Read one | session |
| PATCH | `/v1/notes/:id` | Edit, requires `base_version` | session |
| DELETE | `/v1/notes/:id` | Soft delete | session |
| GET | `/v1/export` | All notes as JSON or Markdown | session |
| POST | `/v1/extension-tokens` | Create token (secret returned once) | session |
| GET | `/v1/extension-tokens` | List tokens (no secrets) | session |
| DELETE | `/v1/extension-tokens/:id` | Revoke | session |
| GET | `/health` | Liveness and readiness | none |

Conventions:

- JSON only. Timestamps in ISO 8601 UTC.
- Error shape: `{ "error": { "code": "version_conflict", "message": "...", "request_id": "..." } }`
- Status codes: `201` created, `400` validation, `401` unauthenticated, `403` wrong scope, `404`, `409` version conflict, `413` too large, `429` rate limited (with `Retry-After`).
- Two auth modes, same API: cookie session for the website, `Authorization: Bearer <extension token>` for the extension. The extension token is limited to the `notes:create` scope.
- CORS allows only the website origin and the extension origin (`chrome-extension://<id>`), set through env.
- Version the API in the path. Additive changes stay in `/v1`; breaking changes go to `/v2`.

Default rate limits (all configurable): extension create 60/min per token, website 300/min per user, auth endpoints 10/min per IP.

---

## 9. Security and privacy

- HTTPS everywhere. Secure, httpOnly, SameSite cookies for the website, plus CSRF protection on mutating requests.
- Every query is scoped by `user_id`. Add automated tests that prove user A can never read or write user B's notes.
- Extension tokens: random, long, shown once, stored hashed, revocable, scoped.
- Input limits: max note length (default 20,000 characters), request body size cap, strict validation.
- Secrets (database URL, Redis token, auth keys) only in server environment variables. Never shipped in the extension or website bundle.
- Extension requests the minimum permissions (`storage` and a single host permission).
- Notes are plain text on the server in V1. Be clear about this in the privacy policy. End-to-end encryption is a possible later feature and is hard to retrofit, so decide early if it is a goal.
- Users can export all data and delete their account (hard delete of their rows).
- Chrome Web Store requires a privacy policy and a clear single-purpose description.

---

## 10. Flexibility map (what can change, and how easily)

| Part | Change | Cost |
|---|---|---|
| Postgres host (Neon to Supabase or other) | Change `DATABASE_URL`, re-run migrations | Low |
| Auth provider | Implement another `AuthProvider` adapter | Medium |
| Redis (Upstash to other, or none) | Swap or disable the `RateLimiter` adapter | Low |
| Search engine | Swap the `NoteSearch` adapter (e.g. Meilisearch) | Low |
| API language / framework | Re-implement against the OpenAPI contract; clients unchanged | Medium |
| New client (mobile PWA, native app, CLI) | Add a client using the same `/v1` API | Low |
| New note fields | Use `meta jsonb`, promote to columns later | Low |
| Self-hosting | Docker Compose with Postgres + API + web; API URL configurable in the extension | Low |
| Firefox / Safari support | New extension build; API unchanged | Medium |

---

## 11. Tech stack

| Layer | Choice |
|---|---|
| Website | Next.js (App Router), TypeScript |
| Extension | Manifest V3, TypeScript, small bundler (Vite or similar) |
| API | Rust (Axum) or Python (FastAPI) — open |
| Database | PostgreSQL on Neon or Supabase — open |
| Cache / rate limit | Upstash Redis |
| Auth | Open (see below) |
| Contract | OpenAPI, generated TypeScript client |
| Local dev | Docker Compose (Postgres + Redis) |
| CI | Lint, type-check, tests, migrations dry run |
| Hosting | Website on a Next.js host; API on a container/serverless host — open |

Suggested monorepo layout:

```
quick-note/
  apps/
    web/          # Next.js site
    extension/    # MV3 extension (background, capture page)
    api/          # API service
  packages/
    contract/     # openapi.yaml
    api-client/   # generated client used by web and extension
  infra/          # docker-compose.yml, .env.example
  docs/
```

---

## 12. Build order

1. **M0 — Foundations:** monorepo, OpenAPI skeleton, Docker Compose, CI.
2. **M1 — API core:** migrations, auth adapter, `/me`, notes CRUD, health, error format.
3. **M2 — Website:** sign-in/up, notes list, search, editor with autosave and conflict handling.
4. **M3 — Extension:** command, popup window, capture page, draft keeping, token storage.
5. **M4 — Setup flow:** token creation and passing, extension detection, `/quick-note` checklist, status badge.
6. **M5 — Hardening:** rate limiting, tenant-isolation tests, export, delete account, logging and error tracking.
7. **M6 — Release:** manual test matrix, privacy policy, store listings (Chrome Web Store, Edge Add-ons).

Manual test matrix: macOS and Windows, Chrome and Edge, shortcut with another app in front, over a fullscreen app, multiple monitors, browser running only in the background, offline failure and retry.

---

## 13. Open decisions

| Decision | Options | Notes |
|---|---|---|
| Auth provider | Clerk, Supabase Auth, Better Auth (self-hosted), or similar | Managed is faster; self-hosted keeps everything in your backend. Affects both site and extension linking. |
| API language | Rust (Axum) or Python (FastAPI) | Contract-first design means either works. FastAPI is faster to build; Axum is stronger on raw performance. |
| Postgres host | Neon or Supabase | Keep to standard Postgres so this stays reversible. |
| API hosting | Container platform vs serverless | Check cold-start behavior if using scale-to-zero. |
| Note format | Plain text or Markdown | Plain text for V1 is simplest; Markdown can be added without schema change. |
| Extension token delivery | `externally_connectable` messaging (recommended) vs cookie-based | Recommended option gives revocable, scoped tokens. |
| Default shortcut | To be verified against Chrome's allowed global combos | User can change it. |
| Popup design | Pending from you | Will constrain what is possible inside a browser popup window. |

---

## 14. Later (V2 and beyond)

- Native desktop app (Tauri): frameless top-middle overlay, works with the browser closed, returns focus to the previous app, offline-first with a local SQLite outbox and sync.
- Offline queue inside the extension (IndexedDB) so notes are never lost without a network.
- Tags, folders, pinning.
- Mobile PWA with a quick-add screen.
- Firefox and Safari extensions.
- Optional end-to-end encryption.
- Import from other note apps; realtime updates across open tabs.
