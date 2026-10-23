# Deploy runbook (staging)

Pushing to GitHub does not deploy production. Run these steps by hand, **in this order**.

## 1. Database migrations
```bash
cd backend
supabase db push --db-url "<owner session-pooler URL>"   # never `supabase config push`
```
This applies `0002_notes_tokens.sql` and any later migrations.

Every `app` table has row-level security on, with a policy for `qn_runtime`. If Supabase's security advisor suggests enabling RLS on a table, check that the table has a `qn_runtime` policy first. RLS without a policy blocks the API completely (this broke **Connect** once; see migration 0003). Deploying the API before this makes the notes routes return 500.

## 2. API environment (Vercel project `quick-note-api`)
| Variable | Value | Required |
|---|---|---|
| `RUNTIME_DATABASE_URL` | pooler URL whose user is `qn_runtime.<ref>` (must not be `postgres`) | yes (check it) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role | for **Delete account**. Without it, delete returns 503. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash console → database → REST API | for rate limiting. Without them, limits are off. |
| `EXTENSION_ORIGIN_ALLOWLIST` | `chrome-extension://mpnpdndkgajhjmlefflhemibjmkkcnha` | yes |
| `SENTRY_DSN` | Sentry project DSN | optional |

Set the server-only secrets with `npx vercel env add <NAME> production --project quick-note-api`. Never put them in the website or the extension.

## 3. Website environment (Vercel project `quick-note-web`)
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_EXTENSION_ID` | `mpnpdndkgajhjmlefflhemibjmkkcnha` |
| `QUICK_NOTE_API_URL` | `https://quick-note-api.vercel.app` (already set) |

## 4. Deploy, from the repo root
```bash
npx vercel --prod --project quick-note-api
npx vercel --prod --project quick-note-web
```

## 5. Smoke check
```bash
curl -s https://quick-note-api.vercel.app/health
curl -s -o /dev/null -w "%{http_code}\n" https://quick-note-api.vercel.app/v1/notes   # expect 401
```
Then sign in on the website, open **Quick Note**, and run the Connect and Test steps.

## 6. Extension (each computer)
```bash
npm ci && npm run build --workspace @quick-note/extension
```
1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and choose `frontend/extension/dist`.
2. The ID must be `mpnpdndkgajhjmlefflhemibjmkkcnha`.
3. Open `chrome://extensions/shortcuts` and set **Quick Note → Open capture** to **Global**.

### Publish the zip for users
Users don't build anything. The setup page links to the latest GitHub Release
file `quick-note-extension.zip`. To publish a new one:
1. Bump the version in `frontend/extension/package.json` and `src/lib/manifest.ts` (both must match).
2. Merge to `main`, then push a tag: `git tag ext-v0.2.0 && git push origin ext-v0.2.0`.
3. The **Extension release** workflow tests, builds, zips and attaches it to the release.

## 7. macOS helper (optional, for Space+N)
See `frontend/macos-helper/README.md`. Build it, then grant Accessibility and Input Monitoring.
