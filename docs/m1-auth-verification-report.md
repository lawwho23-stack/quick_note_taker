# M1 — Authentication verification report

Status: **partially verified**. Everything except the email/password session round trip and the
Google callback is proven against the deployed staging environment. The remaining item is one
Supabase dashboard toggle, described in [Remaining work](#remaining-work).

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
the value used in `WEB_BASE_URL` and `WEB_ORIGIN_ALLOWLIST`.

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

The cascade check is the important one: before the fix, `app` was owned by the migration role
rather than `qn_owner`, so the referential action ran without `USAGE` on the schema and deleting a
Supabase Auth user failed with `permission denied for schema app`. Fixed in `0001_init.sql` and
covered by `backend/scripts/check_migrations.sh` and the CI schema check.

### CSRF protection

All against the deployed website, through the Vercel rewrite.

| Check | Result | Evidence |
|---|---|---|
| Hostile origin rejected | PASS | `POST /api/v1/auth/logout`, `Origin: https://evil.example` → 403 `csrf_origin_rejected` |
| Missing token rejected when the CSRF cookie exists | PASS | → 403 `csrf_token_missing` |
| Mismatched token rejected | PASS | → 403 `csrf_token_mismatch` |
| Matching token accepted | PASS | → 204 |
| First request of a session (no CSRF cookie yet) | PASS | origin check only, → 204, as designed |

### Cookie forwarding through the rewrite

A single response carried **six** `Set-Cookie` headers through the Vercel rewrite without
collapsing or dropping any of them:

```
qn_at, qn_rt, qn_csrf, qn_pkce, qn_oauth_state, qn_next
```

Attributes on every one of them: `Path=/`, `SameSite=lax`, `Secure`, and **no `Domain`**
(host-only). `qn_at` and `qn_rt` are `HttpOnly`; `qn_csrf` is readable so the browser can echo it.

This was the highest-risk unknown in M1 — Next.js rewrites merging multiple `Set-Cookie` headers —
and it works, so no route-handler fallback is needed.

### Unauthenticated access

| Check | Result | Evidence |
|---|---|---|
| `/api/v1/me` without a session | PASS | 401 `unauthenticated` |

### CI

Both jobs pass on `main` (`39229369323`): website lint/typecheck/build, and API
ruff/ruff-format/mypy/pytest plus applying the migrations to `postgres:17` with an `auth.users`
stub and smoke-checking the schema.

Two CI-only defects were found and fixed because CI ran:
`astral-sh/setup-uv@v10` does not exist (setup-uv stopped publishing floating tags), and two ruff
violations in the new staging helper.

## Remaining work

### 1. Email/password session round trip (blocked on one dashboard toggle)

`scripts/auth_smoke.sh` stops at registration:

```
POST /api/v1/auth/register → 400 auth_request_rejected
```

Direct calls to Supabase Auth show why:

- `mailer_autoconfirm` is **false**, so signup requires an email click and returns no session.
- Hosted Supabase rejects `@example.com` with `email_address_invalid`, so the smoke script now
  takes `EMAIL_DOMAIN`.
- Repeated signups hit `over_email_send_rate_limit` (2 per hour on the built-in mailer).

**To unblock:** Supabase Dashboard → Authentication → Sign In / Providers → Email →
turn **Confirm email** off. Then:

```bash
EMAIL_DOMAIN=<a domain you control> \
BASE_URL=https://quick-note-web-one.vercel.app \
ORIGIN=https://quick-note-web-one.vercel.app \
scripts/auth_smoke.sh
```

That one run covers register → session → `/me` identity → CSRF rejections → refresh rotation →
logout, and finishes the email/password half of the M1 deliverable.

### 2. Google callback (deferred by decision)

Google is disabled on the staging project. Enabling it needs a Google Cloud OAuth client plus the
redirect URI `https://jfnxmsjqyzhqvusjghhe.supabase.co/auth/v1/callback`, and adding
`https://quick-note-web-one.vercel.app/api/v1/auth/callback` and
`.../auth/confirm` to the Supabase redirect allow list.

The PKCE start/callback/exchange code paths are covered by unit tests; only the live round trip
with Google's consent screen is unproven.

### 3. Local development stack

Docker could not pull the Supabase images: the connection measured ~40 KB/s against Cloudflare,
GitHub and Apple CDNs with normal latency and no packet loss, and a ~2.5 GB pull is not viable at
that rate. Local verification was therefore skipped by decision in favour of hosted Supabase.
Re-run `cd backend && supabase start` when the connection recovers, then
`backend/scripts/check_migrations.sh` and the smoke script against `http://localhost:3000`.

## Notes for the next milestone

- Both Vercel projects deploy from the **repository root** with `rootDirectory` set to `backend`
  and `frontend/web`. Deploying from inside a subdirectory fails, because the configured root
  directory must exist inside the uploaded file set.
- The API project needs the `fastapi` framework preset and `[tool.vercel] entrypoint =
  "app.main:app"`; the website needs the `nextjs` preset. Without them Vercel looked for functions
  under `api/` and built the website as a static site.
- `.vercelignore` matters: the Swift helper's `.build` directory is ~198 MB and was being uploaded.
- Secrets live only in `backend/.env.staging` (git-ignored) and in the Vercel project settings.
