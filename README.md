# quick_note_taker

A notes website plus a Chrome/Edge extension that captures ideas without leaving what you are
doing. On macOS a small native helper detects `Space + N` globally and triggers the extension
capture window. The website is where you read, search, and edit your notes.

- Implementation plan: `.spc/quick-note-v1-implementation-plan.md`
- Architecture: `docs/quick-note-v1-architecture.md`
- M0 shortcut evidence: `docs/m0-shortcut-feasibility-report.md`

## Repository layout

```text
frontend/
  web/            Next.js website (workspace @quick-note/web)
  shared/         Types/constants shared by clients (workspace @quick-note/shared)
  extension/      Manifest V3 extension (M0 prototype; outside npm workspaces until M4)
  macos-helper/   Swift menu-bar helper for the Space + N chord (M0 prototype)
backend/
  app/            FastAPI application
  tests/          Hermetic unit tests (no network, no database)
  supabase/       Local Supabase config, migrations, seed
  scripts/        Operational scripts (runtime role password)
.github/workflows/ci.yml
```

npm workspaces cover `frontend/web` and `frontend/shared`. Python dependencies use `uv`
(`backend/uv.lock`). The extension and the Swift helper stay outside workspaces until M4.

## Deployment shape

Two Vercel projects from this repository:

| Project | Root directory | Responsibility |
|---|---|---|
| `quick-note-web` | `frontend/web` | Website; forwards `/api/v1/*` to the API's `/v1/*` |
| `quick-note-api` | `backend` | FastAPI (Vercel auto-detects `app/main.py`) |

The extension will call the API project directly with bearer tokens at M4. The website only
ever talks to its own origin; the rewrite proxies to the API so session cookies stay host-only
on the website domain.

## Local development

Prerequisites: Node 22+, Docker Desktop, `uv`, and the Supabase CLI
(`brew install supabase/tap/supabase`).

```bash
# 1. Install JavaScript workspaces
npm install

# 2. Start local Supabase (applies migrations + seed on first run)
cd backend && supabase start
supabase status          # prints local API URL and keys

# 3. Configure the API
cp backend/.env.example backend/.env   # fill SUPABASE_ANON_KEY from `supabase status`

# 4. Run the API (port 8000)
cd backend && uv run uvicorn app.main:app --reload --port 8000

# 5. Run the website (port 3000) with the rewrite pointing at the API
cp frontend/web/.env.example frontend/web/.env
npm run dev
```

Then open http://localhost:3000. Local Supabase has email confirmation off, so register →
sign in works immediately.

### Common commands

| Command | Purpose |
|---|---|
| `npm run lint` / `npm run typecheck` / `npm run build` | Website checks |
| `cd backend && uv run ruff check .` | API lint |
| `cd backend && uv run mypy app tests` | API types |
| `cd backend && uv run pytest` | API unit tests |
| `cd backend && supabase db reset` | Re-apply migrations and seed locally |

## Database and roles

Application tables live in a private `app` schema, outside the Supabase Data API. Migration
`0001_init.sql` creates:

- `qn_owner` — owns application objects.
- `qn_runtime` — the API's runtime role. It never owns objects, cannot bypass row-level
  security, and holds only explicit grants. Its password is never stored in a migration:
  set it once per database with `backend/scripts/set_runtime_password.sh`.

Staging connects through Supabase's poolers: the API runtime uses the transaction pooler
(port 6543, `prepare_threshold=None`, `NullPool`), while migrations use a session/direct
connection.

## Authentication model

- FastAPI owns the integration; Supabase Auth owns identity, passwords, and Google sign-in.
- Session state lives only in host-only cookies: `qn_at` and `qn_rt` (HttpOnly), plus `qn_csrf`
  (readable, echoed as the `x-csrf-token` header). Secure on staging/production,
  `SameSite=Lax`, `Path=/` so the same cookies work through the website rewrite.
- Writes require an allowed `Origin` and a double-submitted CSRF token; bearer-token requests
  are exempt because browsers never attach them automatically.
- Google sign-in uses PKCE; the verifier travels in a short-lived HttpOnly cookie.
- Refresh rotates tokens and is single-flighted (server-side cache plus `navigator.locks` in
  the browser), so concurrent tabs cannot race a rotation.
- `Cache-Control: private, no-store` and an `x-request-id` are applied to every API response.

## Verification

- API unit tests: CSRF accept/reject, cookie attributes, session/`/me` identity, refresh
  rotation and single-flight, Google start/callback, error shapes, engine settings.
- CI applies the migrations to a Postgres service container and smoke-checks the schema,
  including the `auth.users` cascade and the runtime role's access.
- Deployed proof (M1): `docs/m1-auth-verification-report.md`.
