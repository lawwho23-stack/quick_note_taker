# Frosted light popup — implementation spec

Design source: `Main.dc.html` in this folder (design-tool export
"A · Frosted light"). The PNG preview `docs/frosted-popup-reference.png`
renders the same design. This spec distills the exact values so
implementations do not need to read the raw artboard.

## What the mockup shows

- Canvas 880×400. The gray backdrop (`#DDE2EA`) with fake window bars and
  a video player is **scenery** — it stands for "the app on screen", not
  product UI.
- The product surface is one card, 560 px wide at (160, 44): a frosted
  white panel with a note textarea and a keyboard-hint footer.
- Only the **idle** state is designed. See "States" below.

## Tokens

### Colors

| Token | Value | Used for |
|---|---|---|
| Ink | `#14161C` | note text |
| Heading | `#3F4452` | "Quick Note" title |
| Muted | `#4A4F5C` | footer hint labels |
| Kbd ink | `#3A3F4C` | key-cap glyphs |
| Accent | `#1F5FE0` | pencil icon, Save button |
| Card background | `rgba(255,255,255,0.74)` | card fill |
| Card edge | `rgba(255,255,255,0.8)` | 1 px card border |
| Hairline | `rgba(20,22,28,0.1)` | footer top border, chip border |
| Chip background | `rgba(20,22,28,0.07)` | key-cap fill |
| Scenery backdrop | `#DDE2EA` | mockup only (see "Backdrop reality") |

### Radii and shadows

| Token | Value |
|---|---|
| Card radius | 18 px |
| Chip radius | 6 px |
| Button radius | 9 px |
| Card shadow | `0 24px 60px rgba(20,30,60,0.28), 0 2px 6px rgba(20,30,60,0.12)` |

### Type

Font stack (all elements):
`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`

| Element | Size / weight | Line height |
|---|---|---|
| Title ("Quick Note") | 13 px / 600 | default |
| Note textarea | 20 px / 400 | 1.4 |
| Footer hints and key caps | 12 px / 400 | 1 (chips) |
| Save button | 14 px / 600 | default |

## Components

- **Card** — padding `16px 20px 14px`; background, edge, radius, shadow
  from the table above; `backdrop-filter: blur(28px) saturate(180%)`.
- **Header** — 18 px pencil SVG (stroke = accent, round caps/joins) +
  title, 8 px gap, 8 px bottom margin.
- **Textarea** — plain text only; no border, no background, no resize;
  ~3 rows tall (84 px at 20 px/1.4); placeholder and note share the ink
  color (placeholder may be a lighter tint of ink).
- **Footer** — 1 px top hairline, 10 px gap above and below it; hints on
  the left, primary button on the right.
- **Hints** — 14 px gap between items; each item is a key cap + label:
  `↵ Save`, `⇧ ↵ New line`, `esc Close`.
- **Key cap (kbd)** — min-width 22 px, height 22 px, padding `0 6px`,
  chip radius, chip background, 1 px hairline border, 12 px kbd ink,
  6 px gap to its label.
- **Save button** — height 32 px, padding `0 16px`, accent background,
  white 14 px/600 text, button radius.

## Backdrop reality

A Chrome extension window is **opaque**. `backdrop-filter` on the card can
only blur what is behind the card *inside the same window* — never the
desktop or the page the user came from. So:

- Inside the extension window, paint a light neutral backdrop (a soft
  near-`#DDE2EA` gradient) that stands in for the scenery; the card's
  translucency and shadow then read correctly.
- The "desktop showing through" illusion of the mockup is not achievable
  in v1 by design. True vibrancy would require a native window, which
  moves capture out of the extension — out of scope.

## States

Only idle is designed. To spec before/with the M4 save flow:

- typing (with Input Method composing — save must not fire)
- saving (backend in flight; close waits for confirmation)
- saved (success acknowledgement, then close)
- error / offline (keep text, clear retry)
- restored draft after reopening
- Save disabled (M0 bridge test only — no backend)

## Where this is used

- `frontend/extension/capture.html` — M0+ capture window; card, header,
  textarea, footer hints, key caps, and Save button follow this spec.
- M3 website light theme — same token values, but as a normal readable
  light surface (no frosted-over-desktop illusion).
