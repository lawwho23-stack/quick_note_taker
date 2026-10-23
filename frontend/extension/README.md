# Quick Note — browser extension

Press a shortcut, type a thought, press Enter. The note is saved to your
Quick Note account. The card opens at the top center of the current page.

Workspace: `@quick-note/extension` (TypeScript + Vite, tests with Vitest + jsdom).

## Build

From the repo root:

```sh
npm install
npm run build --workspace @quick-note/extension
```

This writes the finished extension to `frontend/extension/dist/`, including
`manifest.json` and the icons. `dist/` is not committed.

The API and website addresses are fixed at build time:

| Variable | Default |
|---|---|
| `VITE_API_BASE` | `https://quick-note-api.vercel.app` |
| `VITE_WEB_BASE` | `https://quick-note-web-one.vercel.app` |

Local example: `VITE_API_BASE=http://localhost:8000 VITE_WEB_BASE=http://localhost:3000 npm run build --workspace @quick-note/extension`.
`http://localhost:8000` (API) and `http://localhost:3000` / `http://127.0.0.1:3000`
(website) are always allowed as well, so the staging build also works against local servers.

Other scripts: `typecheck`, `lint`, `test` (same `--workspace` flag).

## Package a zip for users

`npm run package --workspace @quick-note/extension` builds, then writes
`release/quick-note-extension.zip` (one folder, `quick-note-extension/`). It
refuses to zip if the manifest lost its `key`, does not allow the production API
and website (check your `.env` files), or its version does not match
`package.json` (or `RELEASE_TAG`, e.g. `ext-v0.2.0`).

Users get the zip from the website's setup page, which links to the latest
GitHub Release. Pushing a tag `ext-v<version>` runs
`.github/workflows/extension-release.yml`, which publishes it.

## Load it in Chrome (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick `frontend/extension/dist`.
3. The ID must be `mpnpdndkgajhjmlefflhemibjmkkcnha`. It comes from the `key`
   in the manifest (`src/lib/manifest.ts`). Do not change that key: the website
   and the API allowlist this ID.
4. After every rebuild, click the reload icon on the extension card.

## Set the shortcut to Global

1. Open `chrome://extensions/shortcuts`.
2. Find **Quick Note → Open Quick Note capture**. The default is `Ctrl+Shift+7`
   (on a Mac, the Control key, not Command).
3. Change the scope dropdown from **In Chrome** to **Global**. Then the shortcut
   works even when Chrome is not the front app. (The macOS helper turns Space+N
   into this shortcut.)

Then connect your account at `<website>/quick-note`.

## Permissions — what each one is for

| Permission | Why |
|---|---|
| `storage` | Keep the connection token, your unsent drafts, and the last-opened time on this device. Local storage is locked to the extension's own pages (`TRUSTED_CONTEXTS`), so the card injected into a web page cannot read it. |
| `activeTab` | When you press the shortcut (or click the icon), Chrome lets the extension touch **only the current tab, only at that moment**, to show the card. No page is read. |
| `scripting` | Insert the capture card into that tab. |
| Host: the API (`quick-note-api.vercel.app`, `localhost:8000`) | Send your note to the Quick Note server. No other site is contacted. |

There are no `content_scripts`, so the extension does not run on pages you visit.
`externally_connectable` lets only the Quick Note website (and localhost:3000 for dev)
send the `ping` / `connect` / `disconnect` messages. `capture.html` is a
web-accessible resource so it can be shown inside the card's iframe.

## How it works

- **Background service worker** (`src/background.ts`) owns the token and makes
  every API call. Pages never see the token.
  - Each shortcut press is logged to its console with a time stamp:
    `chrome://extensions` → Quick Note → *service worker* → Console.
- **Overlay** (`src/overlay.ts` → `dist/overlay.js`, one file with no imports)
  is injected into the active tab. It adds a fixed frosted card with an iframe
  of `capture.html` inside a closed shadow root.
- **Fallback:** where a page can't host the card (`chrome://` pages, the Web Store,
  PDFs, the new tab page) a small popup window opens at the top center instead.
- **Capture page** (`capture.html`, `src/capture/`): Enter saves, Shift+Enter is
  a new line, Esc closes and keeps the draft. While an input method (for example
  a Burmese keyboard) is composing, Enter does not save.
- **Safe retries** (`src/lib/save.ts`): each note gets its id before it is
  sent, and `{id, payload}` is stored first. If the answer is lost (offline,
  timeout after 15 s, server error, rate limit), Retry resends the same id and
  text, so a note can never be saved twice. While a save is unconfirmed, the
  text is locked.
- **Drafts** are kept per connected account (keyed by a short hash of the
  token, never the token itself) and cleared after a confirmed save or a
  disconnect.

## Tests

`npm run test --workspace @quick-note/extension` covers the IME guard, the
save state machine (a lost response retries with the same id), the
sender-origin check, draft scoping, the background message handlers with
`chrome.*` mocked, the overlay mount, and the manifest (exact permissions,
no beacon host, key present and matching the ID, global command).

## Check by hand in Chrome

These need a real browser and cannot run in the unit tests:

- Global shortcut while Chrome is in the background: the card appears. If
  Chrome does not grant `activeTab` in that case, the popup fallback opens instead.
- Card on a normal page, on a page with a strict Content-Security-Policy, and
  on a dark-mode site (the card should stay light and frosted).
- Fallback popup on `chrome://extensions`, the new tab page, and a PDF.
- Inside the card on a web page, `capture.js` and its CSS load (only
  `capture.html` is listed as web-accessible; its own sub-resources should load
  because the extension page requests them).
- On macOS, a global press while another app is in front brings Chrome forward.
- Burmese IME: Enter while composing does not save.
- Offline → Retry → online: one note on the website, not two.
