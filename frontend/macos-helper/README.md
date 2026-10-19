# macOS Helper (M0 prototype)

Two small Swift apps that sit between the `Space + N` gesture and the browser
extension:

| App | Purpose |
|---|---|
| **QuickNoteHelper** | Menu-bar app. Watches global key events, detects the `Space + N` chord, buffers the Space key so normal typing keeps working, and posts the internal bridge shortcut. |
| **BridgeProbe** | One-shot test app. Posts `Control+Shift+7` after a countdown to prove that a synthetic key event can trigger the Chrome extension command. |

This is the M0 feasibility prototype (see `.spc/quick-note-v1-implementation-plan.md`,
milestone M0). It is not the final helper: no login launch, no configuration
file, no packaged distribution.

## Build

```bash
./build.sh
```

Outputs (ad-hoc signed for local testing):

```
dist/QuickNoteHelper.app
dist/BridgeProbe.app
```

## Required macOS permissions

| Permission | Needed for | Where |
|---|---|---|
| Accessibility | posting synthetic key events, and modifying (swallowing) events in the tap | System Settings → Privacy & Security → Accessibility |
| Input Monitoring | receiving key events in the event tap | System Settings → Privacy & Security → Input Monitoring |

Both apps request these with the system APIs on first launch and expose
buttons/menu items that open the right settings panes.

## How the chord detection works

1. Space key-down is **swallowed** and buffered (not forwarded yet).
2. If `N` is pressed while Space is held (and the chord rule allows it), the
   chord fires: the bridge shortcut `Control+Shift+7` is posted and the Space
   press is dropped (no stray space in the user's text).
3. If any other key arrives (or Space is released) before `N`, the buffered
   Space is replayed in the original order, so normal typing is preserved.

Chord modes (menu → “Chord mode”):

- `Plain chord` — any Space-hold with `N` counts. This is the exact requirement.
- `Hold ≥ 120 ms` / `Hold ≥ 200 ms` — the `N` must arrive after Space has been
  held for at least the threshold. Fallback options if plain chord produces
  false positives during typing.

Both intensities are measured in the event log, so the right choice can be made
from data rather than guessing.

## Event log (M0 evidence)

```
~/Library/Application Support/QuickNoteHelper/events.jsonl
```

One JSON object per line, timing and state only — **never note text, never full
keystrokes**. Key fields: `type`, `ts` (epoch seconds), `held_ms` (how long
Space was held before `N`), `mode`.

Useful types: `space_down_buffered`, `space_repeat_buffered`,
`space_replayed_down`, `n_pass` (normal typing — includes `held_ms`),
`chord` (fired — includes `held_ms`), `other_key_replay`, `tap_disabled`.

Open the folder from the helper menu: **“Open log folder”**.

## Known M0 limitations

- Rebuilding changes the ad-hoc signature; macOS may ask you to re-enable the
  permissions after a rebuild.
- There is no login launch (opt-in later, M4+).
- No settings persistence: mode/pause reset when the helper quits.
- Secure input (password prompts) blocks both the tap and synthetic posting —
  that is macOS behavior and is reported in the helper menu.
