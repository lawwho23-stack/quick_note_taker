# Handoff — M1 closed out, M2 next (Quick Note)

Date: 2026-10-19
Repo: `lawwho23-stack/quick_note_taker`, branch `main`
Environment: hosted Supabase only. Local Docker stack still skipped (see below).

## Goal

M1 was: repository layout, CI, private schema, and a deployed staging proof of the authentication
model — email/password, Google callback, refresh, logout, CSRF, cookie forwarding through the Vercel
rewrite. Deliverable: authenticated staging requests reach FastAPI with the correct account identity
and no cross-user session leakage.

## Where M1 stands

| Piece | URL / location |
|---|---|
| Website | https://quick-note-web-one.vercel.app |
| API | https://quick-note-api.vercel.app |
| Supabase project | `jfnxmsjqyzhqvusjghhe` (PostgreSQL 17) |
| Vercel team | `lawwho23-stacks-projects` |

Proven on staging, this session:

- **Email/password round trip** — login → `/v1/auth/session` → `/v1/me` → CSRF rejections →
  refresh rotation → logout → `/me` 401.
- **Confirmation link round trip** — Supabase `/auth/v1/verify` → 302 to
  `/auth/confirm#access_token=…` → `POST /v1/auth/exchange` → 200 → working session. Confirm email
  is still **on**, and an unconfirmed account signing in gets 403 `email_not_confirmed` with no
  `Set-Cookie` header at all.
- **Two-user isolation** — separate identities, distinct account ids, A's refresh token still
  resolves to A, A's logout leaves B signed in (`scripts/auth_isolation.sh`).
- **Resend** — `POST /v1/auth/resend` → 202 for unknown addresses, 403 for a hostile origin, 400
  for a malformed address.

Not proven, both blocked on credentials we do not have:

1. **Real mailbox delivery.** No SMTP configured. The built-in mailer is capped at 2 emails/hour
   (`rate_limit_email_sent: 2`) and is currently exhausted, so `POST /v1/auth/register` answers
   429 `rate_limited` instead of the 200 `confirmation_required` the code and tests produce.
2. **Google consent round trip.** `external_google_enabled: false`; no Google Cloud OAuth client.

M1's checkbox in the plan stays unticked for those two reasons. Everything else is verified.

## Two real defects found and fixed

- **Confirmation emails pointed at localhost.** `sign_up()` sent no `redirect_to`, and the project's
  `uri_allow_list` was empty, so Supabase rewrote the link to the Site URL
  (`http://localhost:3000`). Registration now sends the website's `/auth/confirm` route and
  `backend/scripts/configure_auth.sh` sets `site_url` + `uri_allow_list` repeatably. This would have
  broken every staging signup the moment SMTP was added.
- **There was no way to resend a confirmation email.** Added the endpoint and a button on the
  sign-up screen.

## Decisions worth remembering

- **Auth URLs are code, not dashboard clicks.** `backend/scripts/configure_auth.sh --project-ref
  <ref> --web-url <url>` sets only `site_url` and `uri_allow_list`. It deliberately never touches
  Confirm email, SMTP, or OAuth providers. `supabase config push` is **not** safe here: the local
  `config.toml` has `enable_confirmations = false` for local dev and pushing it would switch
  confirmation off on staging.
- **Resend is an enumeration-safe endpoint.** It always answers 202, and only re-raises 5xx. Do not
  “improve” it by returning 404 for unknown addresses.
- **Deploy the API from the repository root.** `cd backend && vercel --prod` fails with
  *“The specified Root Directory backend does not exist”*. Use
  `npx vercel --prod --project quick-note-api` from the repo root. Vercel is not wired to GitHub
  here; a push does **not** redeploy.
- **One repository, two Vercel projects**, both with `rootDirectory` set (`backend`,
  `frontend/web`). Framework presets: `fastapi` with `[tool.vercel] entrypoint = "app.main:app"`,
  and `nextjs`.
- **The real website alias is `quick-note-web-one.vercel.app`.** `quick-note-web.vercel.app`
  belongs to an unrelated project.
- **`qn_owner` owns the `app` schema itself**, because referential actions run with the table
  owner's privileges. Without that, deleting an `auth.users` row fails on the cascade.
- **Two connection strings.** Migrations use the session pooler (5432, owner); the API uses the
  transaction pooler (6543, `qn_runtime`, no prepared statements, `NullPool`).
- **Hosted Supabase rejects `@example.com`.** The smoke script takes `EMAIL_DOMAIN`.
- **Confirmation links are single-use credentials.** Pass them via `CONFIRM_URL`/stdin, never as a
  command-line argument.

## Files touched this session

- `backend/app/supabase_auth.py` — `sign_up(..., redirect_to)` and `resend_confirmation()`.
- `backend/app/routers/auth.py` — `_confirmation_redirect()`, `POST /v1/auth/resend`.
- `backend/app/schemas.py` — `ResendRequest`.
- `backend/tests/` — fake provider records redirects/resends; 64 tests (was 58).
- `frontend/web/src/app/sign-up/page.tsx` — resend action with sending/sent/failed states.
- `scripts/auth_smoke.sh` — `MODE=register|login|confirm`, plus `SKIP_REGISTER=1` when the link
  already identifies the account.
- `scripts/auth_isolation.sh` — new two-user isolation proof.
- `backend/scripts/configure_auth.sh` — new; repeatable Supabase auth URL configuration.
- `docs/m1-auth-verification-report.md`, `.spc/quick-note-v1-implementation-plan.md`.

## Next: M2 — backend notes

Scope from the plan: ownership protection, RLS, create/read/update/delete, pagination, search,
idempotency, atomic version conflicts, structured errors, rate limiting, and a generated TypeScript
contract. Deliverable: API behaviour verified against PostgreSQL, including two-user isolation and
retries.

Three things to settle before writing code:

1. **RLS identity is transaction-local, so `ensure_account()` must stop committing.**
   `backend/app/accounts.py` currently calls `session.commit()`. In M2 `SET LOCAL app.user_id` is
   lost at commit, so the commit has to move to the request boundary and `ensure_account()` must
   `flush()` instead. Same for any other mid-request commit.
2. **Rate limiting is a real Upstash dependency, not a stub.** Use a thin `httpx` client (`INCR` +
   `EXPIRE NX` pipeline); the official client assumes long-lived connections Vercel does not have.
   The limiter must distinguish *not configured* (allow) from *configured but unreachable*
   (notes fail open and log; auth returns 503). Limits: extension 60/min/token, website 300/min/user,
   auth 10/min/IP.
3. **Search is `ILIKE` + `pg_trgm` GIN, not `tsvector`.** Postgres full-text search tokenises
   Burmese and Thai badly. The plan already chose this; do not revisit it.

Also unblocked by this session: `scripts/auth_isolation.sh` gives M2 a ready-made pattern for the
two-user isolation test, and staging now has two confirmed accounts usable for it (see
`backend/.env.staging`; admin-created accounts are the only live path until SMTP is configured).

## Optional close-out work, when credentials exist

1. **SMTP:** Brevo (verified sender, no domain work), `smtp-relay.brevo.com:587`, SMTP key — not the
   API key. Then raise `rate_limit_email_sent` and run
   `MODE=confirm scripts/auth_smoke.sh` with a link from a real inbox.
2. **Google:** OAuth client with redirect URI
   `https://jfnxmsjqyzhqvusjghhe.supabase.co/auth/v1/callback`; the allow list already contains our
   `/api/v1/auth/callback`.
3. **Local stack:** `cd backend && supabase start` when the network recovers, then
   `backend/scripts/check_migrations.sh` and the smoke script against `http://localhost:3000`.

## Environment notes

- Docker Desktop is running again, but the image pull was the blocker (~40 KB/s to Cloudflare,
  GitHub and Apple CDNs, normal latency, no packet loss). A ~2.5 GB pull was not viable.
- Local secrets live in `backend/.env.staging` (git-ignored). Staging `quick-note-api` env:
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`, `RUNTIME_DATABASE_URL`, `APP_ENV=staging`,
  `COOKIES_SECURE=true`, `WEB_BASE_URL`, `WEB_ORIGIN_ALLOWLIST`, `LOG_LEVEL`.
- CI run `39236478681` is green on both jobs.

## Code-review fixes (2026-10-22, branch `fix/m1-review-findings`)

Fixed before the redesign. Backend: 92 tests pass; ruff, ruff format and mypy are clean. Web:
lint, typecheck and build pass.

- Resend now returns 429 with `Retry-After` when rate-limited, instead of a false 202. The website
  shows a countdown, and sign-in offers a resend button for unconfirmed emails (`ResendButton`).
- New `app/rate_limit.py`: Upstash Redis limits on register (10/h per IP), login (10/5 min per
  IP+email) and resend (1/min and 5/h per email). It is off until `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN` are set on `quick-note-api`. If Redis is down, requests are allowed.
- A Supabase outage or 429 no longer signs users out (`get_user` returns 503; refresh keeps cookies
  unless the token is rejected). Network timeouts return 503 instead of 500.
- The Google callback requires the state cookie. `/exchange` bounds `expires_in` (60–3600 s) and
  token lengths. The website sends anti-framing and nosniff headers, and no longer shows raw
  error text from the URL.

**Verify on staging before trusting the IP limits:** the web project proxies `/api/v1/*` to the
API project. Confirm `x-forwarded-for` there holds the visitor's IP, not a Vercel proxy IP. If it
holds a proxy IP, every visitor shares one register bucket.
