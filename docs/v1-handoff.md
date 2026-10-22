# V1 completion handoff

Date: 2026-10-22 · Branch: `feat/v1-complete` (based on `main` after PR #3) · Plan: `docs/v1-completion-plan.md`

## Goal
Finish everything left in `docs/quick-note-v1-architecture.md`: press a shortcut, a frosted card appears at the top center, type, press Enter, and the note is saved. Plus the website, export, account deletion, and hardening.

## What was built
| Area | Summary | Main files |
|---|---|---|
| Backend | Callers are a website session or an extension token. A `qnx_` token works only on `POST /v1/notes` and `/v1/extension/status`; everything else answers 403 `wrong_scope`. | `backend/app/deps.py` |
| | Token create, list and revoke, stored as sha-256 hashes | `backend/app/extension_tokens.py`, `routers/extension_tokens.py` |
| | `GET /v1/export` (JSON or Markdown) and `DELETE /v1/me` | `routers/export.py`, `routers/me.py` |
| | Upstash rate limits: notes fail open; sign-in endpoints fail closed | `app/rate_limit.py` |
| | CORS for the website and extension origins, and Sentry with no personal data | `app/main.py`, `app/error_tracking.py` |
| | `backend/openapi.json` export and a test that fails when it is out of date | `scripts/export_openapi.py` |
| Website | App shell with a sidebar and badge; `/notes` with list, search, autosave editor and the 3-choice conflict dialog | `frontend/web/src/app/(app)/notes` |
| | `/quick-note` setup: Connect, shortcut, test | `(app)/quick-note` |
| | `/settings`: tokens, export, delete account | `(app)/settings` |
| | `/privacy` | `src/app/privacy` |
| | Messaging with the extension | `src/lib/extension.ts` |
| Shared | Types generated from OpenAPI (`npm run gen:api`); CI checks they are current | `frontend/shared/src/api.gen.ts` |
| Extension | TypeScript + Vite + Vitest. The card at the top center sits in a closed shadow root with an iframe; there is a pop-up window fallback. Retries reuse the same id, Enter is safe with Burmese input, drafts are saved, and the token is never readable by web pages. | `frontend/extension/src/**` |
| macOS helper | Testable `ChordCore` state machine. The shortcut is now sent after the tap callback returns. Delivery variants are in the menu, plus timing logs. | `frontend/macos-helper/Sources/**` |
| CI | New jobs for the extension and the macOS helper, plus the generated-types check | `.github/workflows/ci.yml` |
| Docs | Deploy runbook, manual test matrix, store listing | `docs/deploy-runbook.md`, `docs/manual-test-matrix.md`, `docs/store-listing.md` |

## Decisions made during integration
- **Sign-in rate limit:** the per-IP limit covers only `register`, `resend`, `login` and `exchange`. `session`, `refresh`, `callback` and `logout` run on normal page loads. Behind the website's proxy many users may share one IP, so limiting them could lock everyone out.
- **Drafts in the extension:** they are keyed by a hash of the token, because the API never returns an account id to the extension.
- **Revoking a token in Settings** doesn't reach the extension until its next save. The separate "Disconnect this browser" button covers that case.

## Verified
- **Backend:** ruff, format and mypy are clean. pytest: 167 passed. `pytest -m db`: 22 passed, run as `qn_runtime` on Postgres 17.
- **Live API** (local, real Postgres), checked with curl:
  - token create gives 201, and an identical retry gives 200 with the same answer
  - the token on list, export or `/me` gives 403
  - a revoked token gives 401
  - the CORS preflight passes for the extension origin and fails for any other origin
  - no note text appears in the logs
- **Website:** lint, typecheck and build pass. A production server against the local API returned 200 for all pages. The `/api/v1` proxy worked (401 when signed out).
- **Extension:** lint, typecheck and build pass. 52 tests pass.
- **macOS helper:** `swift build` passes, and 35 of 35 chord checks pass.

## Not verified (needs Laww, in Chrome or on staging)
- Anything that needs a real Supabase session: Connect from the website, export download, account deletion.
- Chrome behaviour: `activeTab` when the shortcut fires from another app, the pop-up fallback, strict-CSP pages, Burmese IME.
- Space+N: the 10-press measurement (`frontend/macos-helper/README.md`).
- The client IP that the API sees through the Vercel rewrite.

Use `docs/manual-test-matrix.md` for all of this.

## Next steps
1. Review and merge the PR.
2. Follow `docs/deploy-runbook.md`: migrations, env vars, deploy both projects.
3. Run the manual test matrix, and record the Space+N score.
4. Store listing assets and submission (`docs/store-listing.md`).
