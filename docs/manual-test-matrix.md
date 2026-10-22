# Manual test matrix (V1 release)

Run this on staging after following `docs/deploy-runbook.md`. Mark each cell ✅, ❌ (add a note), or n/a.

## Environments
| | macOS + Chrome | macOS + Edge | Windows + Chrome | Windows + Edge |
|---|---|---|---|---|
| Tester / date | | | | |

## Capture (core flow)
| # | Case | Expected | Mac Chrome | Mac Edge | Win Chrome | Win Edge |
|---|---|---|---|---|---|---|
| 1 | Ctrl+Shift+7 on a normal web page | The card appears top center over a blurred page, with focus in the box | | | | |
| 2 | Type, then press Enter | "Saved", the card closes, and the note shows at the top of `/notes` | | | | |
| 3 | Shortcut on `chrome://` / new tab / PDF | A small pop-up window opens at the top center instead | | | | |
| 4 | Shortcut while another app is in front (Global) | The browser comes forward and the card opens | | | | |
| 5 | Shortcut over a fullscreen app | The card opens on the same screen | | | | |
| 6 | Two monitors | The card opens on the active screen | | | | |
| 7 | Browser running only in the background (no windows) | A capture window opens | | | | |
| 8 | Press the shortcut twice | The existing card is focused, with no second card | | | | |
| 9 | Esc with text typed, then reopen | The draft comes back | | | | |
| 10 | Burmese IME: Enter while composing | Enter picks the candidate and does **not** save | | | | |
| 11 | Shift+Enter | Adds a new line | | | | |
| 12 | Wi-Fi off, then Enter | An error appears, the text is kept, and Retry is offered | | | | |
| 13 | Wi-Fi back, then Retry | Saves **once**: no duplicate in `/notes` | | | | |
| 14 | Revoke the token in Settings, then capture | Shows "Not connected" with a link to the setup page | | | | |

## Space+N helper (macOS only)
| # | Case | Expected | Result |
|---|---|---|---|
| 15 | 10 presses of Space+N in Chrome, Notes, Finder and VS Code | 10 of 10 open the card | |
| 16 | Typing normal text with spaces | Spaces still type, with no lag | |
| 17 | Hold Space (key repeat) | Spaces repeat; the card does not open | |

## Website
| # | Case | Expected | Result |
|---|---|---|---|
| 18 | Sign up, confirm by email, sign in | Lands on `/notes` | |
| 19 | New note, then type | Autosaves (shows Saving → Saved) | |
| 20 | Edit the same note in two tabs | The second save shows Keep mine / Keep theirs / Save as new | |
| 21 | Search in English and Burmese | The matching notes are found | |
| 22 | Delete a note | It is gone from the list | |
| 23 | Quick Note page badge | Not installed → Installed → Connected | |
| 24 | Setup "Test" step | Passes when the shortcut is pressed | |
| 25 | Export JSON and Markdown | Files download with every note | |
| 26 | Delete account | Signed out; signing in again finds no account and no notes | |
| 27 | Phone-width layout | Usable, with no sideways scroll | |

## Security spot checks
| # | Case | Expected | Result |
|---|---|---|---|
| 28 | Use the extension token on `GET /v1/notes` | 403 `wrong_scope` | |
| 29 | Revoked token on `POST /v1/notes` | 401 | |
| 30 | 61 creates within a minute from one token | 429 with `Retry-After` | |
