# Quick Note V1 Implementation Plan

Date: 2026-10-19

Status: Planning complete; implementation has not started. Global `Space + N` on macOS requires an early feasibility test.

## 1. Goal and agreed decisions

Build a notes website and Chrome/Edge extension for capturing ideas without navigating away from the current activity. On macOS, a small native helper will detect `Space + N` globally and trigger the extension capture window.

The main flow is:

> Hold Space and press N → capture window opens → type a note → Enter → backend confirms save → capture window closes.

The website lets users register, sign in, read, search, edit, delete, and export their notes.

| Component | Decision |
|---|---|
| Repository | https://github.com/lawwho23-stack/quick_note_taker |
| Website | Next.js App Router, TypeScript |
| Website design | Light theme matching the supplied frosted popup and blue accents |
| Extension | Chrome/Edge Manifest V3, TypeScript, Vite |
| macOS shortcut helper | Small Swift menu-bar application using native keyboard event handling |
| User-facing global shortcut | `Space + N`, macOS first |
| Backend | Python, FastAPI |
| Database | Supabase PostgreSQL |
| Authentication | Supabase Auth: email/password and Google |
| Rate limiting | Upstash Redis |
| Hosting | Two Vercel projects from the same repository |
| Audience | Public registration; private notes per account |
| First acceptance | Deployed website, unpacked extension, locally installed macOS helper |
| Store distribution | Prepare Chrome/Edge submissions after beta acceptance |

References supplied by the user:

- `quick-note-v1-architecture.md`
- `A · Frosted light@1x.png`
- `docs/design/frosted-light/` — extracted popup mockup plus `popup-spec.md` (exact tokens and component values; the original zip stays local)

This plan resolves the original document's open stack and hosting choices. Its macOS helper requirement supersedes the original web-only capture boundary. Windows support for the exact `Space + N` shortcut is deferred.

## 2. Structure and deployment

Keep application code under two top-level folders: `frontend` and `backend`.

```text
quick_note_taker/
  frontend/
    web/                  # Next.js website
    extension/            # Browser command, capture window, account connection
    shared/               # Generated TypeScript API client and shared types
    macos-helper/         # Swift application for global Space + N
  backend/
    app/                  # FastAPI modules
    tests/
    supabase/             # Local configuration and versioned SQL migrations
  .spc/
    quick-note-v1-implementation-plan.md
  docs/
  .github/workflows/
  README.md
```

Use npm workspaces for the JavaScript packages and `uv` for Python dependencies. Keep a frontend workspace lockfile and a backend lockfile. The Swift helper has its own native build configuration inside `frontend/macos-helper`.

Deploy two Vercel projects:

| Project | Root directory | Responsibility |
|---|---|---|
| `quick-note-web` | `frontend/web` | Website and forwarding website API requests |
| `quick-note-api` | `backend` | FastAPI authentication integration and application logic |

Allow the website build to include the shared workspace package outside its root directory.

Website requests to `/api/v1/*` forward to the backend's `/v1/*`. Extension requests go directly to the configured backend using an extension token. The native helper runs on the user's Mac; Vercel does not host it.

```text
Website ── /api forwarding ───────────────┐
                                        ▼
macOS helper → extension capture ──── FastAPI ─── Supabase PostgreSQL
                                        │
                                        ├────── Supabase Auth
                                        └────── Upstash Redis: rate limits
```

Use separate local/staging and production resources. Configure exact website origins, extension IDs, backend URLs, and authentication callback URLs. Do not point arbitrary preview deployments at production data or allow wildcard authentication redirects.

Keep credentials in backend environment variables. The helper must not contain database credentials, authentication tokens, or Redis secrets.

## 3. Global Space + N on macOS

### Why the helper is necessary

Chrome/Edge extension commands cannot register `Space + N` as a global shortcut. Supported commands require a modifier such as Control, Alt, or Command. The helper provides the missing OS-level keyboard handling while the extension continues to own capture and save behavior.

### Proposed implementation

- Build a small Swift menu-bar application using a session-level Core Graphics event tap; do not require root access.
- Detect holding Space and then pressing N. This is a chord, not typing Space, releasing it, and then typing N.
- Translate a recognized chord into the extension's supported internal global command. Start the macOS bridge test with `MacCtrl+Shift+7` in the manifest; confirm assignment and delivery on the target macOS/browser versions before relying on it.
- Mark synthetic events and ignore them in the helper to prevent recursive handling.
- Keep the bridge shortcut configurable in the helper and extension setup instructions so conflicts can be resolved.
- Add menu-bar status, pause/resume, quit, and instructions for the macOS keyboard-control permissions required by the tested implementation.
- Run only when the user chooses to start it. Login launch is opt-in.
- Do not record keystrokes, read application text, collect note bodies, or send keyboard events to a server.

The helper and the selected browser must be running. The extension must be installed, connected, and have its internal command registered globally. Browser termination, secure input, denied/revoked permissions, and shortcut conflicts can prevent capture; show clear setup guidance rather than claiming universal availability.

### Mandatory feasibility gate

Implement and test the shortcut bridge before investing in the complete UI.

- Normal Space presses must still produce spaces.
- Ordinary typing, especially a space followed by words beginning with N, must be tested for accidental activation or lost characters.
- Handle both key-down and key-up events, held-key repeats, cancellation, and pausing without leaving keys logically pressed.
- If a chord is not completed, preserve the original typing order when forwarding buffered events.
- Test input in text editors, browser forms, and terminal applications, plus another app in front of the browser.
- Confirm behavior when permissions are denied, the event tap is disabled, the browser is closed, and secure input prevents interception.
- Measure the impact of buffering Space on typing responsiveness.

There is a real ambiguity between an intentional `Space + N` chord and overlapping normal typing. Do not silently change the shortcut to another combination or add a hold delay. If testing cannot meet an acceptable typing experience with the exact chord, report the evidence and obtain a decision on a hold threshold or alternative before treating the shortcut requirement as complete.

Successful delivery of synthetic keyboard events to an extension global command is a hypothesis to verify on the deployed target setup, not an already-proven capability. (Verified locally in M0 with an intermittent delivery gap — see `docs/m0-shortcut-feasibility-report.md`; the deployed re-check remains an M4 gate.)

## 4. Website and capture behavior

### Website

Use pale backgrounds, rounded surfaces, subtle frosting, and blue accents from the supplied mockup. Provide a readable light notes workspace rather than applying heavy blur to all content.

| Route | Behavior |
|---|---|
| `/` | Small product introduction with registration and login links |
| Authentication routes | Registration, login, email confirmation, recovery, password reset, Google return states |
| `/notes` | Newest-first list, search, create, edit, soft delete |
| `/quick-note` | Extension installation, connection, helper setup, shortcut test |
| `/settings` | Account, extension tokens, export, account deletion |
| `/privacy` | Stored data, extension permissions, helper keyboard access |

Desktop uses a list beside the editor. Smaller screens show one pane at a time. Notes remain plain text.

Autosave after 600 ms without typing. Serialize saves for each note so slower responses cannot overwrite newer edits. Show Saving, Saved, and Failed states; keep unsaved text available after failures. Refetch notes when the website regains focus so extension captures appear.

Edits use an atomic server-side version check. On conflict, offer keep mine, keep theirs, or save mine as a new note. Do not overwrite a newer server version silently.

### Extension capture

- Show the capture card as an in-page overlay on top of the current page (real backdrop blur; decided in the M0 close-out); focus the existing capture if it is already open.
- Where the page cannot host the overlay (Chrome-internal pages, PDF viewer), fall back to one small browser popup window near the top-center; restore single-capture behavior after extension service-worker restarts.
- Reproduce the frosted card appearance in both the overlay and the fallback window (native window decorations remain in the fallback).
- Focus the textarea immediately.
- Enter saves; Shift+Enter inserts a line; Escape closes and preserves the draft.
- Do not trigger save while an input method is composing text.
- Close only after the backend confirms success.
- Keep text and a clear retry message after offline, authentication, or server errors.
- Persist drafts by connected account and clear them after confirmed success or disconnect.

Generate the note UUID before submission. Freeze the submitted ID and payload until the outcome is confirmed. A timeout keeps the pending snapshot; retries resend it unchanged. Do not generate a new ID or submit edited content automatically while the first save's outcome is unknown.

Use stable unpacked extension IDs and explicit website-origin allowlists for account connection. Validate external message senders and payloads. Request only storage and the configured backend host permission; page-reading and content-script permissions are unnecessary.

The setup page checks installation and connection separately, then guides the user through helper permissions and a real shortcut test. Do not infer that the helper is working merely because the extension is connected.

## 5. Backend, authentication, and persistence

### Authentication

FastAPI owns authentication integration and application authorization. Supabase Auth manages identity, passwords, and Google sign-in.

- Store website access/refresh credentials in host-only HttpOnly cookies, Secure in production and SameSite=Lax.
- Create Supabase authentication clients per request; never share a signed-in client between users.
- Implement explicit cookie storage and persist the verifier needed for Google's Proof Key for Code Exchange (PKCE) flow across requests.
- Validate callback state and allowlisted redirect destinations.
- Disable autonomous background session refresh; expose a backend refresh endpoint instead.
- Coordinate refresh calls within and across website tabs. Reject expired authentication before performing mutations, then safely retry after refresh.
- Protect cookie-authenticated writes against cross-site request forgery (CSRF) using origin validation and CSRF tokens.
- Use `Cache-Control: private, no-store` on authentication and personalized responses.
- Verify multiple `Set-Cookie` headers and cookie forwarding through the deployed Vercel rewrite.
- Sign-out ends the current website session by default. Extension connections remain separately revocable.
- Require recent authentication before account deletion.

Email registration includes confirmation, resend, recovery, and password reset. Public email delivery requires configured SMTP, meaning an external email-delivery service. Google requires its provider configuration and callback URLs. These are release prerequisites; do not disable email confirmation to bypass configuration problems.

### Database

Retain the original model's users, notes, and extension tokens, with these refinements:

- Link application users to Supabase Auth users through a foreign key with cascading deletion.
- Keep application tables in a private schema outside the Supabase Data API; revoke public/browser-role access.
- Use a dedicated backend runtime database role and a separate migration/owner role.
- Scope all application queries to the authenticated user.
- Add row-level security (RLS) to notes as defense in depth. The runtime role must neither own the table nor bypass RLS. Set authenticated identity transaction-locally before note operations, with ownership policies covering reads and writes.
- Keep token-hash lookup in a private backend-only table; resolving a token must not require disabling note RLS.
- Notes contain client-generated UUIDs, bodies limited to 20,000 characters, version, source, metadata, timestamps, and soft-delete state.
- Search English and Burmese text using parameterized substring search and a `pg_trgm` index. Treat wildcard characters as literal user text.
- List newest first using keyset pagination ordered by timestamp and UUID.

Use SQLAlchemy with Psycopg and Supabase's transaction pooler. Disable prepared statements and use `NullPool` at the application layer. Use a separate session/direct connection for migrations.

Manage versioned SQL migrations through the Supabase CLI under `backend/supabase`. Do not add a second migration system or execute migrations during application startup.

Deleting an account removes the Supabase Auth identity and cascades through application data and extension tokens. Resolve application users on protected requests so an old, unexpired access token cannot recreate or access a deleted account.

### Extension tokens

Generate long random tokens, return each secret once, and store only its SHA-256 hash in PostgreSQL. Tokens are individually revocable and limited to `notes:create`.

Store the token in extension-local storage restricted to trusted extension contexts. Keep the website's token handoff in memory only. Extension requests use bearer authentication with `credentials: "omit"`; never rely on website cookies.

A minimal extension-status endpoint may report validity of the presented token. It must not return account details or note content. Website `/me`, listing, editing, deletion, export, and token management require a website session.

### API contract

FastAPI's generated OpenAPI specification is the contract source. Generate the shared TypeScript client from it; do not maintain a separate handwritten contract that can drift.

| API group | Operations |
|---|---|
| `/v1/auth/*` | Registration, login, confirmation, Google login/callback, refresh, recovery, password reset, logout |
| `/v1/me` | Current account and authenticated account deletion |
| `/v1/notes` | Create, list/search, read, versioned edit, soft delete |
| `/v1/extension-tokens` | Create, list without secrets, revoke |
| `/v1/extension/status` | Minimal validity check for the presented extension token |
| `/v1/export` | JSON or Markdown download |
| `/health` | Process liveness |
| `/ready` | Database readiness; Redis degradation reported separately |

Preserve the original `/v1` conventions for UTC timestamps, structured errors, request IDs, and rate-limit headers. Define the authentication endpoints and generated request/response types before writing clients.

Required guarantees:

- Identical create retries with the same user, ID, and payload return the original acknowledgement.
- Reusing an ID with different content returns a conflict.
- An ID collision must never reveal another user's note.
- Extension create acknowledgements contain only minimal identifiers/save metadata, not existing note bodies.
- Version checks and updates occur atomically in PostgreSQL.
- Extension tokens cannot list, read, edit, delete, or export notes.

Stream JSON/Markdown exports and test exports larger than Vercel's ordinary response-body limit through the complete deployed path. A passing local streaming test alone does not prove deployed export support.

### Upstash Redis

Use the asynchronous HTTP-based Python client for rate limiting. Redis stores counters, not notes or sessions.

Initial configurable limits:

- Extension capture: 60 requests/minute/token.
- Website API: 300 requests/minute/user.
- Authentication attempts: 10 requests/minute/IP.

Authenticated note operations continue during Redis outages and record a degradation event. Sensitive authentication and token-management operations return a temporary-unavailable response if their limiter is unavailable. Keep logs free of note bodies, passwords, and token secrets.

## 6. Implementation milestones

### M0 — Shortcut feasibility

- [x] Build the minimum macOS event-handling helper and extension command receiver.
- [x] Verify `Space + N` → internal browser command → capture window.
- [x] Test normal typing, permission failures, shortcut conflicts, and application focus.
- [x] Record observed limitations and resolve any typing-gesture conflict before marking the shortcut accepted.

Deliverable: a verified keyboard bridge, or a clear blocker requiring a gesture decision. Do not present a prototype as a completed capture product.

Result (2026-10-19): the bridge is verified with one open reliability item — intermittent synthetic-shortcut delivery drops (5 of 14 detected chords produced no Chrome-side trace) — to be fixed and re-measured at M4. Gesture decision: **Plain chord (any overlap)**. Evidence and limitations: `docs/m0-shortcut-feasibility-report.md`.

### M1 — Foundation and deployed authentication proof

- [x] Establish the repository layout while preserving the remote README and supplied local assets.
- [x] Add workspace configuration, backend dependencies, local Supabase, environment examples, and CI.
- [x] Create the initial private schema and migrations.
- [x] Deploy a thin staging website and FastAPI service.
- [ ] Prove email/password login, Google callback, refresh, logout, CSRF protection, and cookie forwarding through Vercel.

Deliverable: authenticated staging requests reach FastAPI with correct account identity and no cross-user session leakage.

Result (2026-10-19): staging is deployed and wired — website `https://quick-note-web-one.vercel.app`, API `https://quick-note-api.vercel.app`, migration applied to hosted Supabase, `/ready` reports the database as ok. Proven on staging: the email/password session round trip (login → `/me` → CSRF rejections → refresh rotation → logout), the confirmation link round trip (Supabase verify → `/auth/confirm` fragments → `/v1/auth/exchange` → session) with Confirm email still **on** and unconfirmed sign-in rejected with no cookies, two-user isolation, resend returning 202 without revealing whether an address exists, the `auth.users` cascade, and six `Set-Cookie` headers surviving the Vercel rewrite. Two defects were found and fixed: signup emails ignored `redirect_to` because the Supabase allow list was empty (now set by `backend/scripts/configure_auth.sh`), and there was no way to resend a confirmation link. Still open, both credential-gated: real mailbox delivery (no SMTP configured; the built-in mailer is capped at 2/hour and exhausted, so live registration currently answers 429) and the Google consent round trip (no OAuth client yet). Evidence: `docs/m1-auth-verification-report.md`.

### M2 — Backend notes

- [ ] Implement ownership protection, RLS, create/read/update/delete, pagination, and search.
- [ ] Add idempotency, atomic version conflicts, structured errors, and rate limiting.
- [ ] Generate the TypeScript contract/client.

Deliverable: API behavior verified against PostgreSQL, including two-user isolation and retries.

### M3 — Notes website

- [ ] Build the light workspace and authentication screens.
- [ ] Add responsive list/editor behavior, autosave, conflicts, unsaved-state recovery, and search.
- [ ] Add setup and settings pages.

Deliverable: a user can manage their own notes end to end through the deployed website.

### M4 — Complete extension and helper setup

- [ ] Implement the floating capture card (in-page overlay with popup-window fallback), persistent drafts, duplicate-capture prevention, and retry handling.
- [ ] Gate before beta: resolve the intermittent synthetic-delivery drops found in M0 (`docs/m0-shortcut-feasibility-report.md` §3.2) and re-verify delivery on the deployed setup.
- [ ] Add token handoff, connection/revocation handling, and stable development IDs.
- [ ] Finish helper controls, permission guidance, and the real shortcut test.

Deliverable: macOS `Space + N` captures a note that appears in the user's website account without duplicates or lost drafts.

### M5 — Beta acceptance

- [ ] Complete export, account deletion, privacy documentation, and operational logs.
- [ ] Run automated and manual acceptance checks on staging.
- [ ] Configure production prerequisites and verify production separately.

Deliverable: deployed website plus unpacked extension and local helper, with explicit verified-platform and limitation notes.

### M6 — Store preparation

- [ ] Prepare Chrome/Edge bundles, screenshots, descriptions, and privacy disclosures.
- [ ] Document native-helper installation and permission requirements alongside extension installation.
- [ ] Prepare distribution/signing requirements before offering the helper to general public users.

Store submission/approval and public native-helper distribution are separate from the initial local beta acceptance. Do not purchase signing services, publish listings, or install the helper into login items automatically.

## 7. Verification and acceptance

Use Python integration tests with PostgreSQL, backend lint/type checks, frontend lint/type/build checks, and browser automation for critical flows. Do not substitute SQLite for PostgreSQL behavior tests.

Required scenarios:

- [ ] Two users cannot access or mutate one another's notes or extension tokens, including guessed IDs.
- [ ] Email confirmation, Google callbacks, password recovery, expired sessions, simultaneous refresh, logout, and account deletion behave correctly.
- [ ] Tokens in cookies, OAuth state, logs, cache headers, and proxy responses do not leak between users.
- [ ] Lost create response → reopen → retry produces one note.
- [ ] Overlapping editor saves cannot silently overwrite a newer version.
- [ ] Token revocation and account deletion stop extension saves immediately when checked by the backend.
- [ ] Drafts do not leak when disconnecting or switching accounts.
- [ ] English/Burmese input and search work; input-method composition does not accidentally submit.
- [ ] Redis failure preserves authenticated capture while sensitive endpoints follow the defined failure policy.
- [ ] Exports above 4.5 MB work through FastAPI → Vercel rewrite → browser, including interrupted-download behavior.
- [ ] macOS helper preserves ordinary typing, handles repeats/key release, and does not recursively process synthetic events.
- [ ] Chrome and Edge on macOS work with another application in front, multiple monitors, and fullscreen applications, with limitations recorded.
- [ ] Browser closed, helper stopped, denied permissions, and secure-input restrictions produce understandable behavior.

Automated browser tests cover registration → note creation → editing → extension connection → capture. Real global keyboard behavior requires manual OS-level checks; browser automation alone is insufficient.

For each milestone, report what changed, why, the input → processing → output flow, checks actually run, and remaining uncertainty. Keep coaching notes short and relevant.

## 8. Defaults, boundaries, and release prerequisites

- V1 has no AI, folders, rich text, sharing, offline synchronization, end-to-end encryption, or mobile application.
- The macOS application is a shortcut helper, not a full native notes client. Windows global `Space + N` is later work.
- Local drafts preserve text; they do not automatically submit offline notes.
- The capture card cannot render on Chrome-internal pages (the fallback window applies) or over every fullscreen application, and it does not restore focus to the previous app.
- The website and API may serve Windows browsers, but V1 acceptance for the exact global shortcut is macOS only.
- Public email registration requires configured SMTP and verified sender settings. Google login requires provider credentials and exact callback URLs.
- Review actual hosting-plan suitability and costs before enabling a public production launch; no paid resources are approved merely by this plan.
- Production migrations, deployment, publishing, signing, and system permission changes are separate implementation actions.
- Creating this plan does not implement the application, validate the proposed shortcut bridge, or change any hosted resources.

## 9. Technical references

- FastAPI on Vercel: https://vercel.com/docs/frameworks/backend/fastapi
- Vercel monorepos: https://vercel.com/docs/monorepos
- External API rewrites: https://vercel.com/docs/routing/rewrites
- Chrome command restrictions: https://developer.chrome.com/docs/extensions/reference/api/commands
- Stable extension IDs: https://developer.chrome.com/docs/extensions/reference/manifest/key
- macOS event taps: https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate(tap:place:options:eventsofinterest:callback:userinfo:)
- Supabase server-side authentication: https://supabase.com/docs/guides/auth/server-side/advanced-guide
- Supabase PostgreSQL connections: https://supabase.com/docs/guides/database/connecting-to-postgres
- Public authentication email delivery: https://supabase.com/docs/guides/auth/auth-smtp
- Upstash Python rate limiting: https://upstash.com/docs/redis/sdks/ratelimit-py/gettingstarted
- Vercel response-size and streaming guidance: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
