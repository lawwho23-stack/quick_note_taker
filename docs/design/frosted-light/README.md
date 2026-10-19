# A · Frosted light — design reference

This is a design mockup created in a visual design tool, exported as a
standalone page. Treat it as a REFERENCE MOCKUP, not production code:
the markup and inline styles carry the design's precise values — colors,
font sizes, spacing, radii, shadows, layout — which an implementation
should replicate faithfully in its own components and styling system
rather than copy wholesale.

## Contents

- `Main.dc.html` — the artboard (a Design Component: an `<x-dc>`
  template + a small logic class). The values to replicate live in its
  inline `style="…"` attributes and the `<helmet><style>` block.
- `popup-spec.md` — distilled tokens and component values from the
  artboard; use this when implementing. It also records what the mockup
  does not cover (backdrop reality, non-idle states).

Rendered preview of the same design:
`docs/frosted-popup-reference.png`.

## Viewing

The original export also shipped a runtime (`support.js`,
`vendor/react*.js`) that renders the component in a real browser; those
files are not committed. To view the mockup, extract the original zip
(kept locally at `.spc/A · Frosted light-html.zip`) into a temp folder
and serve it (e.g. `python3 -m http.server`) — some browsers block the
scripts over `file://`. Reading the values directly from `Main.dc.html`
or `popup-spec.md` works without the runtime.
