// Plain-text checklist shortcuts for the capture textarea.
//
// Typing "-" then space at the start of a line turns it into "☐ ".
// Shift+Enter on a checklist line starts the next item; on an empty item it
// ends the list. Backspace right after the box turns it back into "- ".
// An item is ticked by swapping "☐ " for "☑ " (the web Notes page uses the
// same two markers).
//
// Each function returns the new text and caret, or null when the key should
// keep its normal browser behaviour.

export const CHECKBOX = "☐ ";
export const CHECKED = "☑ ";
const MARKER_LEN = 2;

export type TextState = { value: string; start: number; end: number };
export type TextEdit = { value: string; caret: number };

export function lineStart(value: string, pos: number): number {
  return value.lastIndexOf("\n", pos - 1) + 1;
}

function lineEnd(value: string, pos: number): number {
  const i = value.indexOf("\n", pos);
  return i === -1 ? value.length : i;
}

/** "☐ " / "☑ " when the line starting at `ls` is a checklist item, else null. */
function markerAt(value: string, ls: number): string | null {
  if (value.startsWith(CHECKBOX, ls)) return CHECKBOX;
  if (value.startsWith(CHECKED, ls)) return CHECKED;
  return null;
}

export function isDoneLine(line: string): boolean {
  return line.startsWith(CHECKED);
}

export function onSpace({ value, start, end }: TextState): TextEdit | null {
  if (start !== end) return null;
  const ls = lineStart(value, start);
  if (value.slice(ls, start) !== "-") return null;
  return { value: value.slice(0, ls) + CHECKBOX + value.slice(start), caret: ls + CHECKBOX.length };
}

export function onShiftEnter({ value, start, end }: TextState): TextEdit | null {
  if (start !== end) return null;
  const ls = lineStart(value, start);
  if (!markerAt(value, ls) || start < ls + MARKER_LEN) return null;
  const line = value.slice(ls, lineEnd(value, start));
  if (line.slice(MARKER_LEN).trim() === "") {
    // Empty item: drop the box and end the list.
    return { value: value.slice(0, ls) + value.slice(ls + line.length), caret: ls };
  }
  const insert = "\n" + CHECKBOX;
  return { value: value.slice(0, start) + insert + value.slice(start), caret: start + insert.length };
}

export function onBackspace({ value, start, end }: TextState): TextEdit | null {
  if (start !== end) return null;
  const ls = lineStart(value, start);
  if (start !== ls + MARKER_LEN || !markerAt(value, ls)) return null;
  return { value: value.slice(0, ls) + "- " + value.slice(start), caret: ls + 2 };
}

/** Tick or untick the item on the line holding `pos`. The caret stays put. */
export function toggleAt(value: string, pos: number): TextEdit | null {
  const ls = lineStart(value, pos);
  const marker = markerAt(value, ls);
  if (!marker) return null;
  const next = marker === CHECKBOX ? CHECKED : CHECKBOX;
  return { value: value.slice(0, ls) + next + value.slice(ls + MARKER_LEN), caret: pos };
}

/** A click that lands on the box itself (caret just before or after "☐"). */
export function onBoxClick({ value, start, end }: TextState): TextEdit | null {
  if (start !== end) return null;
  const ls = lineStart(value, start);
  if (start - ls > 1) return null;
  const edit = toggleAt(value, start);
  return edit && { ...edit, caret: ls + MARKER_LEN };
}
