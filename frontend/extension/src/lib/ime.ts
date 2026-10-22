// Enter-to-save guard.
//
// While an input method (IME) is composing text — for example a Burmese or
// Japanese keyboard — Enter confirms the composed characters. It must NOT
// save the note. Browsers report this two ways: `isComposing` is true, or the
// legacy `keyCode` is 229 ("IME is processing this key"). Some browsers only
// set one of them, so we check both.

export type EnterKeyEvent = Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing" | "keyCode">;

export function shouldSubmitOnEnter(e: EnterKeyEvent): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey) return false; // Shift+Enter = new line
  if (e.isComposing) return false;
  if (e.keyCode === 229) return false;
  return true;
}
