# M0 — Space + N Shortcut Feasibility Report

Date: 2026-10-19
Milestone gate: `.spc/quick-note-v1-implementation-plan.md` §3 (mandatory feasibility gate)

**Status: PASSED WITH LIMITATIONS.** The `Space + N` bridge is proven end-to-end on macOS:
the helper detects the chord, Chrome receives the internal command, and the capture window
opens or focuses. Gesture decision: **Plain chord (any overlap)**. One reliability item stays
open: intermittent synthetic-shortcut delivery drops (§3.2) — resolve at M4 before beta.

---

## 1. Question this milestone had to answer

Can a small native helper detect `Space + N` globally, translate it into a Chrome-supported
command, and open the capture window — without disturbing normal typing — and what are the
observed limitations? (Plan §3.)

## 2. Prototype under test

| Piece | What it is | Where |
|---|---|---|
| QuickNoteHelper | Menu-bar app; session-level event tap; buffers Space, detects the chord, posts synthetic `Control+Shift+7` | `frontend/macos-helper/` (`ChordTap.swift`, `BridgeShortcut.swift`) |
| Extension receiver | MV3 service worker; `open-capture` command opens or focuses one capture window; local beacon diagnostics (dev-only) | `frontend/extension/` (`background.js`) |
| BridgeProbe | One-shot tool that posts the same synthetic shortcut (bridge proof, before the helper existed) | `frontend/macos-helper/` (`BridgeProbe`) |
| Beacon | Local log receiver, `127.0.0.1:8787` → `frontend/extension/dev/beacon.log` (dev-only) | `frontend/extension/dev/beacon.py` |

Flow:

    Space down (helper swallows + buffers)
      → N pressed while Space held → chord
      → helper posts synthetic Control+Shift+7 (marked as ours; never re-processed)
      → Chrome fires the extension's open-capture command
      → capture window opens, or the existing one is focused
      → old Space/N key events are cleaned up (no stuck keys)
    If no chord follows, the buffered Space is replayed so typing is unaffected.

Environment: MacBook (Mac14,2), macOS 26.0.1 (25A362), Google Chrome 155.0.8059.80,
unpacked extension (dev id `mpnpdndkgajhjmlefflhemibjmkkcnha`), helper log
`~/Library/Application Support/QuickNoteHelper/events.jsonl` (416 events, 12:56–14:01),
beacon log 46 events (server up continuously from 12:52).

## 3. Evidence

### 3.1 End-to-end delivery (the core hypothesis)

- 14 chord detections were logged; **9 produced a Chrome command + window response**
  (opened or focused). 5 produced no Chrome-side trace (§3.2).
- 5 deliveries happened before the helper's tap was live (12:58:34, 12:58:43, 13:06:07,
  13:15:39, 13:33:43) via BridgeProbe / direct shortcut presses — the Chrome receiver and
  window behavior are proven independently of the helper.
- Latency, chord detection → beacon event: window opened 135–208 ms; existing window
  focused 56–63 ms (a focused window is cheaper than creating one).
- Duplicate handling: pressing the chord while the capture window is open focuses the
  existing window — no second window (2 focus events, 0 duplicates).

### 3.2 Delivery gap (open item — M4 gate)

5 of 14 chords left no Chrome-side trace:

| Chord time | Held | Chrome-side trace |
|---|---|---|
| 13:17:56.276 | 92 ms | none |
| 13:35:39.967 | 244 ms | none |
| 13:38:31.254 | 164 ms | none |
| 13:38:32.087 | 72 ms | none |
| 14:00:31.171 | 141 ms | none (Hold ≥ 120 ms mode) |

What we know:

- Each miss had a complete, normal helper sequence (buffer → chord → both key-ups) — the
  helper path has no conditional gate; it fires on every detected chord.
- No event-tap timeouts occurred (0 `tap_disabled` events in the whole log).
- The beacon server ran the entire session, and the extension beacons `command` before any
  async work — so the drop sits **between the helper's synthetic post and Chrome's
  dispatch** (or, less likely, a silent failure creating the post's event source).
- Retries succeed; in the evening session 8 of 12 presses delivered. Two misses were
  isolated single presses followed by a working retry (press does nothing → press again →
  works). The user did not report failures, which shows how easy silent drops are to miss.

**M4 actions (required before beta):**

1. Instrument the helper post path (log the attempt + event-source creation result).
2. Test larger gaps between the synthetic key events (10–15 ms instead of 5 ms).
3. Candidate mitigations: deliberate double-post ~250 ms apart (the receiver already
   de-duplicates to focus), or replace the synthetic-key bridge with Chrome native
   messaging (no key simulation; evaluate install cost at M4).
4. Re-run the same measurement protocol after the fix; target ≥ 10/10 presses.

### 3.3 Typing impact (the main product risk)

- 133 buffered Space presses = 117 plain replays + 14 chords + 2 passthrough key-ups.
  Zero anomalies, zero stuck keys, no lost or duplicated characters in the accounting.
- Added space latency (119 measurements): min 37 / p50 73 / p90 110 / p99 150 / max 152 ms.
  No replay exceeded 250 ms. In other words, a normal space appears 37–152 ms after the
  press — the user typed 3+ minutes of text at natural speed and reported it as normal.
- **Accidental activations: none.** Zero chords fired during the dense pure-typing
  stretches (13:45:42–13:47:06 with risky `space → n` phrases; 13:49–13:57). User report
  agrees: no accidental popups.
- Edge handling exercised in real data: buffered-space auto-repeat (1), other key while
  Space is buffered → preserved order (1), all 14 chords closed with complete key-up pairs.

### 3.4 Checklist results (docs/m0-test-checklist.md)

| Part | Result | Source |
|---|---|---|
| 1 Permissions | PASS after grants; 3 failed tap sessions recorded before granting; rebuild = re-grant | log + session notes |
| 2 Manual icon click | PASS (6 manual deliveries) | beacon |
| 3 Bridge proof (probe) | PASS (pre-helper deliveries) | beacon |
| 4 Shortcut scope Global | set | user |
| 5 Typing feel (~3 min) | PASS — numbers in §3.3 | log + user |
| 6 Intentional chord | PASS — 12 deliberate presses in the evening session, 8 window responses; held 68–523 ms; Esc close and top-center position confirmed | log + user |
| 7 Another app in front | PASS — Chrome comes to the front (accepted V1 limitation) | user |
| 8 Edge cases | pause/resume PASS; permission-off behavior PASS; secure input blocks capture (expected) | user |

## 4. Limitations and uncertainty

1. **Delivery gap (§3.2)** — the one item that must be fixed before beta.
2. The helper does not auto-start; after a restart (Mac or app) it must be started from
   the menu bar. Login launch is future opt-in work, not built.
3. Rebuilding the helper changes its signature, so macOS asks to re-grant permissions
   (TCC is tied to the exact build). Silent auto-updates and signing are M6 work.
4. Secure input (password prompts) blocks interception — expected; the setup page needs
   to explain it.
5. Global trigger brings Chrome to the front; focus is not restored to the previous app
   (accepted for V1).
6. Tested on one machine, one user, one day: Chrome only (Edge untested), single monitor,
   no fullscreen apps, input-method (Burmese) typing not yet tested — these stay on the
   milestone verification list.
7. Beacon and event logs are development instruments and will be removed from the product
   path before beta (M5).
8. The frosted look over real content is impossible inside an opaque Chrome popup window;
   the decided direction is an in-page overlay with a popup-window fallback (recorded in
   the plan §4 / M4).

## 5. Gesture decision

**Plain chord (any overlap) — accepted 2026-10-19.**

Rationale: zero accidental activations across ~150 buffered Space presses including the
risky `space → n` patterns; the fastest feel; every delivered chord fired from 68 ms held.
If later evidence (other apps, IME typing) shows a conflict, the helper menu offers
`Hold ≥ 120 ms` and `Hold ≥ 200 ms` — no rebuild needed (both modes were exercised in the
14:00 burst).

## 6. What M4 must re-verify (deployed setup)

- Fix + instrument the delivery gap; re-measure with the same protocol (target ≥ 10/10).
- Overlay-first capture + fallback window; real save path end-to-end on staging.
- Keyboard behavior in more apps (Terminal besides secure input), multi-monitor,
  fullscreen; IME composition must not trigger save.
- Remove beacon/dev logs from the product path.

## Appendix — reading the logs

    # helper events (timing/state only, never note text)
    tail -n 50 "$HOME/Library/Application Support/QuickNoteHelper/events.jsonl"
    # beacon events
    tail -n 50 frontend/extension/dev/beacon.log

Key event types: `space_down_buffered`, `space_replayed_down_up` (normal space),
`chord` (bridge fired), `space_up_after_chord` / `n_up_after_chord` (cleanup),
`n_pass_no_buffer` (N typed with no Space buffered).
