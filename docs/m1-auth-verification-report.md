# M1 — Authentication verification report

Status: **verified except two credential-gated items**. Email/password sign-in, the confirmation
link round trip, refresh rotation, logout, CSRF protection, cookie forwarding through the Vercel
rewrite, and two-user isolation are all proven against the deployed staging environment. Real
mailbox delivery and the Google consent round trip still need external credentials; both are listed
under [Remaining work](#remaining-work).

Date: 2026-10-19
Environment: hosted Supabase project `jfnxmsjqyzhqvusjghhe`, Vercel projects `quick-note-api`
and `quick-note-web` (both in `lawwho23-stacks-projects`).

## Deployed URLs

| Piece | URL |
|---|---|
| Website | https://quick-note-web-one.vercel.app |
| API | https://quick-note-api.vercel.app |

`quick-note-web.vercel.app` is **not ours** — it belongs to an unrelated project and returns 404
for every route. The real alias Vercel assigned is `quick-note-web-one.vercel.app`, and that is
the value used in `WEB_BASE_URL`, `WEB_ORIGIN_ALLOWLIST` and the Supabase redirect allow list.

## Verified

### Deployment and wiring

| Check | Result | Evidence |
|---|---|---|
| API health endpoint | PASS | `GET /health` → 200, `{"status":"ok","environment":"staging"}` |
| API readiness incl. database | PASS | `GET /ready` → 200, `{"status":"ready","checks":{"database":"ok"}}` |
| Website serves its routes | PASS | `/`, `/sign-in`, `/notes` → 200 |
| Rewrite forwards to the API | PASS | `GET /api/v1/auth/session` → 200 `{"authenticated":false}` |
| API is publicly reachable | PASS | `/health` 200 on the production alias, not behind deployment protection |

### Database

| Check | Result | Evidence |
|---|---|---|
| Migration applies to hosted Supabase | PASS | `0001_init.sql` applied through the session pooler |
| Runtime role connects through the transaction pooler | PASS | `psql "$RUNTIME_DATABASE_URL"` → `current_user = qn_runtime`, reads `app.users` |
| `auth.users` → `app.users` cascade | PASS | inserted an auth user + app row, deleted the auth user, row count went 1 → 0 (in a transaction, rolled back) |
| Schema is private | PASS | `anon`, `authenticated`, `service_role` and `PUBLIC` have no `USAGE` on `app` |
| Migration is idempotent | PASS | re-applied cleanly on a throwaway Postgres |
| Accounts provision on first sign-in | PASS | two admin-created users each received an `app.users` row on first successful login, linked by `auth_user_id` |

### CSRF protection

All against the deployed website, through the Vercel rewrite.

| Check | Result | Evidence |
|---|---|---|
| Hostile origin rejected | PASS | `POST /api/v1/auth/logout`, `Origin: https://evil.example` → 403 `csrf_origin_rejected` |
| Missing token rejected when the CSRF cookie exists | PASS | → 403 `csrf_token_missing` |
| Mismatched token rejected | PASS | → 403 `csrf_token_mismatch` |
| Matching token accepted | PASS | → 204 |
| First request of a session (no CSRF cookie yet) | PASS | origin check only, → 204, as designed |
| Hostile origin rejected on the new resend route | PASS | `POST /api/v1/auth/resend`, `Origin: https://evil.example` → 403 |

### Cookie forwarding through the rewrite

Six `Set-Cookie` headers survive the Vercel rewrite and keep their attributes: `qn_at`, `qn_rt`
(host-only, `Secure`, `SameSite=Lax`), `qn_csrf` (readable by page scripts, so the double-submit
header can be built), and the three expired copies emitted on logout.

### Unauthenticated access

| Check | Result | Evidence |
|---|---|---|
| `/api/v1/me` without a session | PASS | 401 `unauthenticated` |

### Confirmation links

This was a real defect, found by testing rather than by reading the code.

| Check | Result | Evidence |
|---|---|---|
| Redirect allow list was empty | FAIL → FIXED | `GET /v1/projects/{ref}/config/auth` returned `uri_allow_list: ""` and `site_url: "http://localhost:3000"` |
| Unknown `redirect_to` is rewritten | CONFIRMED | `admin/generate_link` produced `...&redirect_to=http://localhost:3000` even when asked for the staging URL |
| Site URL and allow list applied | PASS | `backend/scripts/configure_auth.sh` → `site_url=https://quick-note-web-one.vercel.app`, six allowed redirects |
| Confirmation link now targets our route | PASS | regenerated link carries `redirect_to=https://quick-note-web-one.vercel.app/auth/confirm` |
| Confirm email is still enforced | PASS | `mailer_autoconfirm=false`; an unconfirmed account signing in → 403 `email_not_confirmed` with **no** `Set-Cookie` header |
| Registration passes `redirect_to` | PASS | `test_register_sends_confirmation_back_to_the_website` |
| Link → fragments → session | PASS | `curl -D -` on the verify URL returns `302` to `/auth/confirm#access_token=…&refresh_token=…`; `POST /api/v1/auth/exchange` → 200 |
| Redeemed link yields a working session | PASS | `/v1/auth/session` `authenticated: true`, `/v1/me` returns the right email |

`scripts/auth_smoke.sh MODE=confirm` covers this path, including an assertion that the redirect
target is our own `/auth/confirm` route.

### Email/password session round trip

Run against the deployed website on 2026-10-19:

| Step | Result |
|---|---|
| `POST /api/v1/auth/login` | 200, session cookies set |
| `GET /api/v1/auth/session` | 200, `authenticated: true` |
| `GET /api/v1/me` | 200, correct account identity |
| CSRF: hostile origin / missing / mismatched | 403 / 403 / 403 |
| `POST /api/v1/auth/refresh` | 200, refresh token rotated to a new value |
| `GET /api/v1/me` after rotation | 200 |
| `POST /api/v1/auth/logout` | 204 |
| `GET /api/v1/auth/session` after logout | 200, `authenticated: false` |
| `GET /api/v1/me` after logout | 401 |

### Two-user isolation

`scripts/auth_isolation.sh` with two independent accounts:

| Check | Result |
|---|---|
| Both accounts sign in independently | PASS |
| A's `/me` contains A and not B (and the reverse) | PASS |
| The two accounts have distinct application ids | PASS |
| Refreshing with A's token still returns A | PASS |
| A's cookies never resolve to B | PASS |
| Signing A out leaves B signed in | PASS |

### Resend confirmation

| Check | Result | Evidence |
|---|---|---|
| Endpoint exists on staging | PASS | `POST /api/v1/auth/resend` → 202 |
| Unknown address is indistinguishable | PASS | unknown `@lawwho.dev` address → 202, empty body |
| Malformed address rejected | PASS | `{"email":"not-an-email"}` → 400 |
| Real outage is not swallowed | PASS | 5xx re-raised; covered by `test_resend_surfaces_a_real_outage` |

The endpoint answers 202 even when Supabase rejects the request, so it cannot be used to discover
which addresses have accounts.

### CI

Run `39236478681` on `main` is green: website lint/typecheck/build, and API
ruff/ruff-format/mypy/pytest (64 tests) plus applying the migrations to `postgres:17` with an
`auth.users` stub and smoke-checking the schema.

Two CI-only defects were found and fixed earlier because CI ran:
`astral-sh/setup-uv@v10` does not exist (setup-uv stopped publishing floating tags), and two ruff
violations in the staging helper.

## Remaining work

### 1. Real mailbox delivery (deferred by decision)

The confirmation **flow** is proven end to end using a genuinely issued Supabase link. What is not
proven is delivery to a human mailbox, because the project has no SMTP provider configured.

Two consequences are visible on staging today:

- The built-in mailer is capped at `rate_limit_email_sent: 2` per hour. It is currently exhausted,
  so `POST /v1/auth/register` answers 429 `rate_limited` instead of 200
  `confirmation_required`. The `confirmation_required` branch is covered by
  `test_register_with_confirmation_required`, but the live assertion is waiting on the cap.
- The built-in mailer only delivers to organization team members, so it is not usable for real
  signups.

**To close:** configure a custom SMTP provider (Brevo works with a verified sender and no domain
work: `smtp-relay.brevo.com:587`, SMTP key — not the API key), then raise
`rate_limit_email_sent` to the production value and run
`MODE=confirm scripts/auth_smoke.sh` with a link from a real inbox.

Until then, staging signup is limited to accounts created through the admin API with
`email_confirm: true`, which is how the isolation accounts were made.

### 2. Google callback (blocked on credentials)

Google is disabled on the staging project (`external_google_enabled: false`). Enabling it needs a
Google Cloud OAuth client plus the redirect URI
`https://jfnxmsjqyzhqvusjghhe.supabase.co/auth/v1/callback`, and the client id/secret stored in the
Supabase project.

The redirect allow list now contains `https://quick-note-web-one.vercel.app/api/v1/auth/callback`,
so the app side is ready. The PKCE start/callback/exchange code paths are covered by unit tests;
only the live round trip through Google's consent screen is unproven.

### 3. Local development stack

Docker could not pull the Supabase images: the connection measured ~40 KB/s against Cloudflare,
GitHub and Apple CDNs with normal latency and no packet loss, and a ~2.5 GB pull is not viable at
that rate. Local verification was therefore skipped by decision in favour of hosted Supabase.
Re-run `cd backend && supabase start` when the connection recovers, then
`backend/scripts/check_migrations.sh` and the smoke script against `http://localhost:3000`.

## Notes for the next milestone

- Both Vercel projects deploy from the **repository root** with `rootDirectory` set to `backend`
  and `frontend/web`. Deploying with `cd backend && vercel --prod` fails with
  *"The specified Root Directory backend does not exist"*. Use
  `npx vercel --prod --project quick-note-api` from the repository root instead.
- The API project needs the `fastapi` framework preset and `[tool.vercel] entrypoint =
  "app.main:app"`; the website needs the `nextjs` preset. Without them Vercel looked for functions
  under `api/` and built the website as a static site.
- `.vercelignore` matters: the Swift helper's `.build` directory is ~198 MB and was being uploaded.
- Secrets live only in `backend/.env.staging` (git-ignored) and in the Vercel project settings.
- Auth URLs are now repeatable: `backend/scripts/configure_auth.sh --project-ref <ref> --web-url
  <url>` sets `site_url` and `uri_allow_list` and deliberately leaves Confirm email, SMTP and OAuth
  providers untouched.
