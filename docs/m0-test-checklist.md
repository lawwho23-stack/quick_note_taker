# M0 Test Checklist — Space + N Shortcut Feasibility

Everything below runs on your Mac. It takes about 20 minutes. The goal of M0 is
to find out — with evidence — whether the `Space + N` gesture works, and whether
it interferes with normal typing.

**Golden rule while testing: nothing is saved anywhere and nothing leaves your Mac.**
The capture window is a prototype; the helper logs timing data only (no text content).

If anything fails, that is still a result — note what happened and move on.

---

## Part 0 — What is running (quick overview)

| Piece | What it is | Where |
|---|---|---|
| Bridge Probe | One-shot test: posts `Control+Shift+7` like a keyboard would | `frontend/macos-helper/dist/BridgeProbe.app` |
| Quick Note Helper | Menu-bar app that detects `Space + N` and fires the bridge shortcut | `frontend/macos-helper/dist/QuickNoteHelper.app` |
| Extension | MV3 prototype that opens the capture window when the command fires | loaded into Chrome from `frontend/extension/` |
| Beacon | Local-only diagnostic receiver (I keep it running) | `frontend/extension/dev/beacon.py` on `127.0.0.1:8787` |

---

## Part 1 — Grant permissions

macOS requires explicit permission before an app can watch or send key events.

1. Open **BridgeProbe**:
   - In Finder, go to `frontend/macos-helper/dist/` and double-click `BridgeProbe.app`
     (or run: `open /Users/pyaesoneaung/Quick-Note/frontend/macos-helper/dist/BridgeProbe.app`).
   - A macOS prompt will appear, or click **“Grant permission…”** in the app window.
   - In **System Settings → Privacy & Security → Accessibility**, enable
     **Quick Note Bridge Probe** (it appears in the list after the app asks).
   - The app window should now say: `✅ Permission to post key events: granted.`
     (If not, quit and reopen the app.)

2. Open **QuickNoteHelper**:
   - Go to `frontend/macos-helper/dist/` and double-click `QuickNoteHelper.app`.
   - Two permissions are needed. Use its menu (◔ QN in the menu bar) →
     **“Request permissions…”**, then in System Settings enable **both**:
     - Privacy & Security → **Accessibility** → Quick Note Helper
     - Privacy & Security → **Input Monitoring** → Quick Note Helper
   - Open the menu again; both lines should read `granted ✓`.
   - If they still show `not granted ✗`, quit the helper (menu → Quit) and open it again.

> Note: rebuilding the helper changes its signature, and macOS may ask you to
> re-enable the permissions after every rebuild. That is expected for now.

---

## Part 2 — Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder:
   `/Users/pyaesoneaung/Quick-Note/frontend/extension`
4. “Quick Note (M0 bridge test)” should appear. It is fine if Chrome shows no icon.
5. **Manual smoke test:** click the extension's toolbar icon (puzzle-piece → pin it first
   if you like) → a small **Quick Note capture window** should open near the top of
   the browser. Press `Esc` to close it.

Result: `manual icon click: PASS / FAIL`

---

## Part 3 — Bridge proof (the main hypothesis)

Question this answers: *does a synthetic key event trigger the Chrome command?*

1. Switch to Chrome. Click anywhere in a page (for example `about:blank`).
2. Switch to BridgeProbe and click **“Run 5-second test”**.
3. During the 5-second countdown, click back into **Chrome** so Chrome is the
   focused app.
4. After the countdown, BridgeProbe posts `Control+Shift+7`.

**Expected:** the Quick Note capture window opens.

Result: `bridge proof: PASS / FAIL`

- If it FAILS, note anything visible: does Chrome blink, nothing at all, etc.
- Also try it once more with Chrome focused on a normal page (not a blank tab).

---

## Part 4 — Set the shortcut scope to Global

(Needed for the shortcut to reach Chrome while another app is in front.)

1. Go to `chrome://extensions/shortcuts`
2. Find “Quick Note (M0 bridge test)” → “Open capture”.
3. Check the box / dropdown so the shortcut is set to **Global**.
   The suggested key is `Ctrl+Shift+7` (Control on macOS — not Command).
   If the field is empty, click it and press `Control+Shift+7` yourself.
4. Note whether Chrome accepted the key: `shortcut assigned: YES / NO`

---

## Part 5 — Typing feel test (most important part)

This measures whether detecting the chord disturbs normal typing.

1. Check the helper menu (◔ QN): it should say
   `running — mode: Plain chord (any overlap)` with both permissions granted.
2. Open **TextEdit** (or Notes) and create a new document.
3. Type **normally, at your natural speed**, for about 3 minutes. Include these
   kinds of phrases — they are the risky patterns (`…space → next word starts with n`):

   ```
   The new note is an idea in November. One night an owl can notice a name in
   the new note, then next an answer in one more new note.
   ```

   Type that paragraph 2–3 times, then write whatever you like for a bit
   (a real message, a to-do list — real typing is the best test).

4. While typing, watch for these symptoms:
   - Did the **capture window pop open and steal focus** while you were just typing?
     Roughly how many times?
   - Did any **letters or spaces go missing / duplicate**? (e.g. `an note` becomes `anote`)
   - Anything else odd?

Result:
```
popup while typing (count, roughly): ____
lost or duplicated characters:       yes/no  (example: ____)
other weirdness:                     ____
```

5. Optional if popups happened a lot: switch the helper to
   **Chord mode → “Hold ≥ 120 ms”** (menu → Chord mode) and type for one more
   minute. Does it feel better? `better / worse / same: ____`
   Then switch back to Plain chord for the next part.

---

## Part 6 — Intentional chord test

Now use the gesture on purpose. **10 attempts.**

Method: press and hold `Space`, and while still holding it, tap `N`. Then release both.

For each attempt note whether the capture window opened. Also tell me how you
naturally did it (did you press N immediately after holding space, or hold a
moment first?).

Result:
```
opened: ____ / 10
how it felt / your natural timing: ____
```

Also check inside the capture window:
- `Esc` closes it: PASS / FAIL
- window appears near the top-center of the browser: PASS / FAIL

---

## Part 7 — Shortcut with another app in front (needs Part 4)

1. Keep Chrome **running** but switch to Finder or TextEdit (another app on top).
2. Press and hold `Space`, tap `N`.

**Expected:** Chrome comes to the front with the capture window open.
(Known V1 limitation: Chrome will take focus. That is accepted for now.)

Result: `background chord: PASS / FAIL — notes: ____`

---

## Part 8 — Edge cases (quick)

1. **Pause works:** helper menu → **Pause capture** → try the chord → nothing should
   happen, typing still normal. Then **Resume capture** → chord works again.
   Result: `pause/resume: PASS / FAIL`
2. **Permission off is understandable:** helper menu → “Open Accessibility settings”
   → toggle **Quick Note Helper OFF** → try the chord → nothing happens and the
   helper menu shows `Accessibility: not granted ✗`. Turn it back ON afterwards
   (if the chord doesn't work again, quit + reopen the helper).
   Result: `permission-off behavior: PASS / FAIL`
3. **Secure input (expected to block):** open Terminal and start a password prompt
   (for example type `sudo -k; sudo true` and wait at the password prompt). Try the
   chord. Expected: capture does **NOT** open, and the helper menu shows
   `Secure input: active — macOS blocks capture`. Cancel the Terminal prompt after.
   Result: `secure input observed: ____`

---

## Part 9 — Report back

Reply in chat with:

```
Part 2 manual click:     PASS/FAIL
Part 3 bridge proof:     PASS/FAIL
Part 4 shortcut scope:   global set? key assigned?
Part 5 typing:           popups ____, lost chars? ____, notes ____
Part 6 chord:            ____/10 opened, feel notes ____
Part 7 background:       PASS/FAIL
Part 8 edge cases:       pause ____, permission-off ____, secure input ____
Anything else:
```

I will then read both logs (helper event log + beacon log), write the M0
feasibility report, and we decide the final gesture together.

To stop everything after testing: Quit Quick Note Helper from its menu, close
BridgeProbe, and remove the extension from `chrome://extensions` if you want.
