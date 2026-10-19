# Handoff — M1 (Quick Note)

Date: 2026-10-19
Repo: `lawwho23-stack/quick_note_taker`, branch `main`, last commit `5cc6ceb`
(working tree also has the M1 verification report and plan update, committed below).

## Goal

M1: repo layout, CI, private schema, and a deployed staging proof of the authentication model —
email/password, Google callback, refresh, logout, CSRF, and cookie forwarding through the Vercel
rewrite. Deliverable: authenticated staging requests reach FastAPI with the correct account
identity and no cross-user session leakage.

## Where M1 stands

Deployed and wired. Hosted Supabase only — the local Docker stack was skipped by decision.

| Piece | URL / location |
|---|---|
| Website | https://quick-note-web-one.vercel.app |
| API | https://quick-note-api.vercel.app |
| Supabase project | `jfnxmsjqyzhqvusjghhe` (PostgreSQL 17) |
| Vercel team | `lawwho23-stacks-projects` |

Proven on staging: `/health` and `/ready` (database ok), the rewrite forwarding to the API, CSRF
rejection of a hostile origin / missing token / mismatched token, six `Set-Cookie` headers surviving
the rewrite with host-only + Secure + SameSite=Lax attributes, the `auth.users` → `app.users`
cascade on the hosted database, and 401 for unauthenticated `/me`. CI is green on both jobs.

Still open: the email/password session round trip, blocked on one dashboard toggle, and the Google
callback, deferred by decision. Details in `docs/m1-auth-verification-report.md`.

## Decisions worth remembering

- **One repository, two Vercel projects.** Both deploy from the repo root with `rootDirectory` set
  to `backend` and `frontend/web`. Deploying from inside a subdirectory fails: the configured root
  directory must exist inside the uploaded file set.
- **Framework presets are required.** The API needs `fastapi` plus
  `[tool.vercel] entrypoint = "app.main:app"`; the website needs `nextjs`. Without them Vercel
  looked for functions under `api/` and built the website as a static site.
- **The real website alias is `quick-note-web-one.vercel.app`.** `quick-note-web.vercel.app`
  belongs to an unrelated project and 404s on every route. Do not use it in config.
- **`qn_owner` owns the `app` schema itself.** Referential actions run with the table owner's
  privileges, so an owner without `USAGE` on the schema breaks the `auth.users` cascade. This was a
  real bug caught before it reached production.
- **No role password in a migration.** `qn_runtime` gets its password out of band via
  `backend/scripts/set_runtime_password.sh`.
- **Two connection strings.** Migrations use the session pooler (5432, owner); the running API uses
  the transaction pooler (6543, `qn_runtime`, prepared statements off, `NullPool`).
- **The staging owner password contains `@`.** `backend/scripts/build_staging_urls.py` percent-encodes
  it and derives both URLs into `backend/.env.staging` (git-ignored). Never hand-edit those URLs.
- **Hosted Supabase rejects `@example.com`** (`email_address_invalid`). The smoke script takes
  `EMAIL_DOMAIN`.
- **The CSRF dependency is origin-only when no CSRF cookie exists** — that is the first request of a
  session, by design, and covered by tests.
- **`.vercelignore` is load-bearing.** The Swift helper's `.build` directory is ~198 MB.

## Files touched

- `backend/app/` — FastAPI service: config, errors, request-id middleware, cookies, security
  (CSRF/PKCE/redirect sanitising), `supabase_auth.py` (GoTrue REST client), `accounts.py`,
  `single_flight.py`, routers (`auth`, `me`), `/health`, `/ready`.
- `backend/tests/` — 58 tests with fake provider and session fixtures.
- `backend/supabase/migrations/0001_init.sql` — schema, roles, cascade, trigger, grants.
- `backend/supabase/config.toml`, `seed.sql` — local Supabase configuration.
- `backend/scripts/check_migrations.sh` — applies migrations to a throwaway Postgres and checks the
  schema guarantees (mirrors the CI migration job).
- `backend/scripts/set_runtime_password.sh`, `build_staging_urls.py`.
- `backend/pyproject.toml` — dependencies, `[tool.vercel]`, ruff/mypy/pytest config.
- `frontend/web/` — Next 16 app: sign-in, sign-up, notes, `auth/confirm`, `auth/callback`, and
  `src/lib/api.ts` (CSRF-aware fetch with single-flight refresh via `navigator.locks`).
- `frontend/web/next.config.ts` — `/api/v1/:path*` → `${QUICK_NOTE_API_URL}/v1/:path*`.
- `.github/workflows/ci.yml` — web job and API job (migrations applied to `postgres:17`).
- `scripts/auth_smoke.sh` — repeatable end-to-end auth proof.
- `README.md`, `.spc/quick-note-v1-implementation-plan.md`, `docs/m1-auth-verification-report.md`.

## Next steps

1. **Unblock the email/password proof.** Supabase Dashboard → Authentication → Sign In / Providers →
   Email → turn **Confirm email** off. Then:
   ```bash
   EMAIL_DOMAIN=<domain you control> \
   BASE_URL=https://quick-note-web-one.vercel.app \
   ORIGIN=https://quick-note-web-one.vercel.app \
   scripts/auth_smoke.sh
   ```
   One clean run proves register → session → `/me` identity → CSRF → refresh rotation → logout, and
   closes the M1 deliverable.
2. **Google callback** (deferred): Google Cloud OAuth client, redirect URI
   `https://jfnxmsjqyzhqvusjghhe.supabase.co/auth/v1/callback`, add
   `https://quick-note-web-one.vercel.app/api/v1/auth/callback` and `.../auth/confirm` to the
   Supabase redirect allow list, then set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`_SECRET`.
3. **Two-user isolation check** — the last clause of the M1 deliverable. Needs the toggle off first:
   create two accounts, confirm each `/me` returns only its own identity, and confirm one user's
   cookies never resolve to the other account.
4. **Then M2** — notes CRUD with RLS and ownership protection.
5. **Local stack, when the connection recovers:** `cd backend && supabase start`, then
   `backend/scripts/check_migrations.sh` and the smoke script against `http://localhost:3000`.

## Environment notes

- The connection measured ~40 KB/s against Cloudflare, GitHub and Apple CDNs with normal latency
  (26–56 ms) and no packet loss. A ~2.5 GB Supabase image pull is not viable at that rate. Docker
  Desktop was restarted several times while diagnosing this; it is currently running.
- Local scratch secrets live in `backend/.env.staging` (git-ignored); staging values are also set in
  both Vercel projects. Nothing sensitive is committed.
- Staging env vars on `quick-note-api`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`,
  `RUNTIME_DATABASE_URL`, `APP_ENV=staging`, `COOKIES_SECURE=true`, `WEB_BASE_URL`,
  `WEB_ORIGIN_ALLOWLIST`, `LOG_LEVEL`.
- `quick-note-web` has `QUICK_NOTE_API_URL=https://quick-note-api.vercel.app`.
