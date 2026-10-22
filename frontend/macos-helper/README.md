# macOS Helper

Two small Swift apps that sit between the `Space + N` gesture and the browser
extension:

| App | Purpose |
|---|---|
| **QuickNoteHelper** | Menu-bar app. Watches global key events, detects the `Space + N` chord, buffers the Space key so normal typing keeps working, and posts the internal bridge shortcut. |
| **BridgeProbe** | One-shot test app. Posts `Control+Shift+7` after a countdown to prove that a synthetic key event can trigger the Chrome extension command. |

This started as the M0 feasibility prototype (see
`.spc/quick-note-v1-implementation-plan.md`, milestone M0) and now carries
the Space+N delivery fix (Workstream H). It is still not the final helper: no
login launch, no packaged distribution.

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

## Code layout

| Target | What it is |
|---|---|
| `ChordCore` | Pure logic, no CoreGraphics: the Space+N state machine (`ChordStateMachine`), delivery variants, and the Control+Shift+7 event plan. Unit-tested. |
| `MacShared` | CoreGraphics glue: `BridgeDelivery` (async posting), `BridgeShortcut`, `Synthetic` marker, `EventLog`, `Permissions`. |
| `QuickNoteHelper` | Menu-bar app. `ChordTap` feeds key events to the state machine and does what it decides. |
| `BridgeProbe` | One-shot bridge test (synchronous post, no tap). |
| `Tests/ChordCoreChecks` | All test cases (shared). |
| `Tests/ChordCoreTestRunner` | Executable runner for those cases. |
| `Tests/ChordCoreTests` | Swift Testing wrapper for the same cases. |

## Tests

```bash
swift run ChordCoreTestRunner   # runs every check, exits 1 on any failure
swift test                      # builds the test target
```

Why two commands: this Mac has only the Command Line Tools (no full Xcode).
They have no XCTest, and SwiftPM does not execute Swift Testing suites there,
so `swift test` only compiles the tests. `ChordCoreTestRunner` runs the same
cases for real. With full Xcode installed, `swift test` runs them too.

## How the chord detection works

1. Space key-down is **swallowed** and buffered (not forwarded yet).
2. If `N` is pressed while Space is held (and the chord rule allows it), the
   chord fires and the Space press is dropped (no stray space in the text).
   The physical N and Space key-ups (and their autorepeats) are swallowed too.
3. If any other key arrives (or Space is released) before `N`, the buffered
   Space is replayed in the original order, so normal typing is preserved.
4. Autorepeat is read from the key event itself. Holding N never fires twice.
   A fresh (non-repeat) press always resets stale state, so a missed key-up
   (for example while macOS disabled the tap) cannot swallow the next Space.
5. Tapping N again while Space is still held is a deliberate new press and
   fires again (the extension only focuses the open capture card).

### Firing happens outside the tap callback

In M0 the shortcut was posted **inside** the event tap callback, with
`usleep` gaps, while the physical Space/N were being swallowed. That blocked
the main run loop that also services the tap. 5 of 14 chords never reached
Chrome (`docs/m0-shortcut-feasibility-report.md` §3.2). The cause is not
proven; blocking inside the callback is the **likely** cause, and this change
tests it. The 10-press run below confirms or rejects it.

Now the callback only decides. `BridgeDelivery` posts the shortcut on the
main queue **after** the callback returns: first a short delay (default
20 ms), then each of the 6 events (Control↓ Shift↓ 7↓ 7↑ Shift↑ Control↑) in
its own main-queue turn, 10 ms apart. Nothing blocks. Every posted event is
marked by `Synthetic`, so the tap ignores it. Two sequences never overlap
(a second fire during one is skipped and logged). On quit, any key still
held by an unfinished sequence is released, so Control/Shift cannot stick.
The helper also opts out of App Nap (a latency-critical activity), so macOS
does not delay these short timers. Check `schedule_delay_actual_ms` in the
log: if it is much larger than the configured 20 ms, timers are being delayed.

Chord modes (menu → “Chord mode”):

- `Plain chord` — any Space-hold with `N` counts. This is the exact requirement.
- `Hold ≥ 120 ms` / `Hold ≥ 200 ms` — the `N` must arrive after Space has been
  held for at least the threshold.

### Delivery variants (menu → “Delivery variant”)

| Variant | Event source | Posted at | Fires on |
|---|---|---|---|
| **(a)** default | private state | HID tap (`cghidEventTap`) | N key-down |
| **(b)** | HID system state | HID tap | N key-down |
| **(c)** | private state | session tap (`cgSessionEventTap`) | N key-down |
| **(d)** | private state | HID tap | N **key-up** (after the physical keys settle) |

**“Retry once after 300 ms”** (off by default): posts the shortcut a second
time 300 ms after the first finishes. Safe because the extension focuses an
existing capture card instead of opening a second one.

Chord mode, variant and retry are saved (UserDefaults) and survive restarts.
Advanced timing has no menu item; set it in Terminal, then restart the helper:

```bash
defaults write com.laww.quicknote.helper scheduleDelayMs -float 20   # 0–500
defaults write com.laww.quicknote.helper gapMs -float 10             # 0–50
defaults write com.laww.quicknote.helper retryDelayMs -float 300     # 50–2000
defaults delete com.laww.quicknote.helper                            # back to defaults
```

## Event log (evidence)

```
~/Library/Application Support/QuickNoteHelper/events.jsonl
```

One JSON object per line, timing and state only — **never note text, never full
keystrokes**. Every line has `type`, `ts` (epoch seconds, to match the extension's
console log) and `mono_ms` (monotonic ms, for precise intervals).

Chord types: `space_down_buffered`, `space_replayed_down`, `n_pass_*` (normal
typing, with `held_ms`), `chord` / `chord_armed` (fired / armed for key-up,
with `held_ms`, `mode`, `variant`), `n_up_fire` (variant d), `other_key_replay`,
`tap_disabled`. Each tap decision has `callback_ms` (time spent in the callback).

Delivery types (all carry `fire_id`, `attempt`, `variant`):

| Type | Meaning |
|---|---|
| `post_scheduled` | fire queued; `delay_ms` |
| `post_start` | first event about to post; `schedule_delay_actual_ms`, `source`, `location`, `gap_ms` |
| `post_event` | one synthetic event; `key`, `down`, `cg_type` |
| `post_end` | all events posted; `events`, `duration_ms`, `since_request_ms` |
| `event_source_failed` / `event_create_failed` | CoreGraphics refused to create the source / an event |
| `post_skipped_busy` | a fire arrived while a sequence was still posting |
| `post_aborted_released` | quit during a sequence; held keys released |

Open the folder from the helper menu: **“Open log folder”**.

## Manual 10-press test (goal: 10/10)

Same protocol as M0 (`docs/m0-test-checklist.md` Part 6). Run it once per
variant you want to compare, starting with **(a)**.

1. Build: `./build.sh`. Rebuilding changes the ad-hoc signature, so re-grant
   **both** permissions: System Settings → Privacy & Security →
   **Accessibility** and **Input Monitoring** → Quick Note Helper (if it is
   already listed, toggle it off and on, or remove it with `−` and add
   `dist/QuickNoteHelper.app` again). Quit and reopen the helper afterwards.
2. Keep Chrome open with the unpacked extension loaded
   (`frontend/extension/dist`). Open `chrome://extensions` → Quick Note →
   "service worker" to see its console.
3. Helper menu: check both permissions show `granted ✓`, the status says
   `running`, and pick the variant (keep “Retry” **off** for a clean measure).
4. Note the time. Focus a Chrome window, then 10 times: hold `Space`, tap `N`,
   release both. Close the capture card with `Esc` between presses (so each
   press must open a new card). Wait about 2 seconds between presses.
5. Count how many presses opened a capture card: `__ / 10`.
6. Also type a normal sentence with spaces and words containing `n` to check
   typing is unaffected (no lost/doubled spaces, no stuck Control/Shift).
7. Evidence: each `post_end` in the helper log should have a matching
   `[quick-note] open-capture #N via shortcut at <time>` line in the extension's
   service-worker console within ~250 ms. A `post_end` with no console line =
   delivery drop.

If (a) is not 10/10, repeat steps 3–7 with (b), (c), (d), and then with
“Retry” on.

## Known M0 limitations

- Rebuilding changes the ad-hoc signature; macOS may ask you to re-enable the
  permissions after a rebuild.
- There is no login launch (opt-in later, M4+).
- Pause is not saved: the helper always starts unpaused.
- Secure input (password prompts) blocks both the tap and synthetic posting —
  that is macOS behavior and is reported in the helper menu.
