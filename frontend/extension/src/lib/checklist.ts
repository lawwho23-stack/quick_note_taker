// Plain-text checklist shortcuts for the capture textarea.
//
// Typing "-" then space at the start of a line turns it into "☐ ".
// Shift+Enter on a checklist line starts the next item; on an empty item it
// ends the list. Backspace right after "☐ " turns it back into "- ".
//
// Each function returns the new text and caret, or null when the key should
// keep its normal browser behaviour.

export const CHECKBOX = "☐ ";

export type TextState = { value: string; start: number; end: number };
export type TextEdit = { value: string; caret: number };

export function lineStart(value: string, pos: number): number {
  return value.lastIndexOf("\n", pos - 1) + 1;
}

function lineEnd(value: string, pos: number): number {
  const i = value.indexOf("\n", pos);
  return i === -1 ? value.length : i;
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
  if (!value.startsWith(CHECKBOX, ls) || start < ls + CHECKBOX.length) return null;
  const line = value.slice(ls, lineEnd(value, start));
  if (line.trim() === CHECKBOX.trim()) {
    // Empty item: drop the box and end the list.
    return { value: value.slice(0, ls) + value.slice(ls + line.length), caret: ls };
  }
  const insert = "\n" + CHECKBOX;
  return { value: value.slice(0, start) + insert + value.slice(start), caret: start + insert.length };
}

export function onBackspace({ value, start, end }: TextState): TextEdit | null {
  if (start !== end) return null;
  const ls = lineStart(value, start);
  if (start !== ls + CHECKBOX.length || !value.startsWith(CHECKBOX, ls)) return null;
  return { value: value.slice(0, ls) + "- " + value.slice(start), caret: ls + 2 };
}
