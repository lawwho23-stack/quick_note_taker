// The capture card page (capture.html). Runs either inside the overlay
// iframe (?mode=overlay) or in the fallback popup window (?mode=popup).
// It never calls the API: it asks the background to save.
import "./capture.css";
import { NOTE_MAX_CHARS } from "../lib/defaults";
import {
  CHECKBOX,
  CHECKED,
  type TextEdit,
  isDoneLine,
  onBackspace,
  onBoxClick,
  onShiftEnter,
  onSpace,
  toggleAt,
} from "../lib/checklist";
import { shouldSubmitOnEnter } from "../lib/ime";
import { POPUP_WIDTH, topCenter } from "../lib/geometry";
import { type CaptureState, FRAME_MESSAGE_SOURCE, parseFrameMessage } from "../lib/messages";
import type { SaveResult } from "../lib/save";
import { SAVED_LINGER_MS, type ViewState, fromSaveResult, isLocked, primaryAction, statusText } from "./view-state";

const mode = new URLSearchParams(location.search).get("mode") === "popup" ? "popup" : "overlay";
document.documentElement.dataset.mode = mode;

const editor = document.getElementById("editor") as HTMLTextAreaElement;
const mirror = document.getElementById("mirror") as HTMLElement;
const card = document.getElementById("card") as HTMLElement;
const hints = document.getElementById("hints") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;
const statusMsg = document.getElementById("status-msg") as HTMLElement;
const setupLink = document.getElementById("setup-link") as HTMLAnchorElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;

let view: ViewState = { kind: "idle", connected: true };
let draftTimer: ReturnType<typeof setTimeout> | undefined;

function send<T>(msg: unknown): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

// Redraw the styled copy of the text that sits behind the transparent
// textarea. Built from text nodes only, so note text is never parsed as HTML.
function renderMirror() {
  const lines = editor.value.split("\n");
  mirror.replaceChildren(
    ...lines.flatMap((line, i) => {
      const nodes: Node[] = [];
      const marker = line.startsWith(CHECKBOX) || line.startsWith(CHECKED);
      if (marker) {
        const row = document.createElement("span");
        if (isDoneLine(line)) row.className = "done";
        const box = document.createElement("span");
        box.className = "box";
        box.textContent = line.slice(0, 1);
        row.append(box, line.slice(1));
        nodes.push(row);
      } else {
        nodes.push(document.createTextNode(line));
      }
      if (i < lines.length - 1) nodes.push(document.createTextNode("\n"));
      return nodes;
    }),
    // A trailing newline needs a character after it to take up height.
    document.createTextNode("​"),
  );
  mirror.scrollTop = editor.scrollTop;
}

function applyEdit(edit: TextEdit) {
  editor.value = edit.value;
  editor.setSelectionRange(edit.caret, edit.caret);
  editor.dispatchEvent(new Event("input")); // redraw + keep the draft save in step
}

function render() {
  editor.readOnly = isLocked(view);
  mirror.classList.toggle("locked", editor.readOnly);
  const text = statusText(view);
  const showStatus = text !== "";
  status.hidden = !showStatus;
  hints.hidden = showStatus;
  statusMsg.textContent = text;
  status.dataset.kind = view.kind;
  setupLink.hidden = !(view.kind === "not_connected" || (view.kind === "idle" && !view.connected));

  const action = primaryAction(view);
  saveBtn.hidden = action === "none";
  saveBtn.textContent = action === "retry" ? "Retry" : "Save";
  saveBtn.disabled = view.kind === "saving";
}

function setView(next: ViewState) {
  view = next;
  render();
}

function persistDraftNow() {
  clearTimeout(draftTimer);
  draftTimer = undefined;
  if (isLocked(view)) return; // locked text is the pending save, not a draft
  void send({ type: "draft", text: editor.value }).catch(() => undefined);
}

function close() {
  if (mode === "popup") {
    window.close();
  } else {
    // The parent page's origin is unknown; the message carries no data.
    window.parent.postMessage({ source: FRAME_MESSAGE_SOURCE, type: "close" }, "*");
  }
}

async function submit() {
  if (view.kind === "saving" || view.kind === "saved") return;
  const pendingRetry = view.kind === "error" && view.retryable;
  if (!pendingRetry && editor.value.trim() === "") return;
  if (!pendingRetry && editor.value.trim().length > NOTE_MAX_CHARS) {
    setView({ kind: "error", code: "too_large", retryable: false });
    return;
  }

  // Do not race a draft write against the save (the save clears the draft).
  clearTimeout(draftTimer);
  draftTimer = undefined;
  setView({ kind: "saving" });

  let result: unknown;
  try {
    result = await send<unknown>({ type: "save", body: editor.value });
  } catch {
    result = { status: "error", code: "network", retryable: true } satisfies SaveResult;
  }
  const next = fromSaveResult(result);
  if (next.kind === "error" && next.code === "empty") {
    setView({ kind: "idle", connected: true });
    return;
  }
  setView(next);
  if (next.kind === "saved") {
    setTimeout(close, SAVED_LINGER_MS);
  } else if (!isLocked(next)) {
    persistDraftNow();
  }
}

// Checklist shortcuts ("- " → "☐ ", Shift+Enter → next item). Never while an
// IME is composing, so composed text is not rewritten.
function applyChecklistKey(e: KeyboardEvent): boolean {
  if (editor.readOnly || e.isComposing || e.keyCode === 229) return false;
  const s = { value: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
  let edit: TextEdit | null = null;
  if (e.key === " ") edit = onSpace(s);
  else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    // ⌘/Ctrl+Enter ticks the current item; never falls through to save.
    e.preventDefault();
    edit = toggleAt(s.value, s.start);
    if (edit) applyEdit(edit);
    return true;
  } else if (e.key === "Enter" && e.shiftKey) edit = onShiftEnter(s);
  else if (e.key === "Backspace") edit = onBackspace(s);
  if (!edit) return false;
  e.preventDefault();
  applyEdit(edit);
  return true;
}

// Clicking the ☐ / ☑ box ticks or unticks that item.
editor.addEventListener("click", () => {
  if (editor.readOnly) return;
  const edit = onBoxClick({ value: editor.value, start: editor.selectionStart, end: editor.selectionEnd });
  if (edit) applyEdit(edit);
});

editor.addEventListener("scroll", () => {
  mirror.scrollTop = editor.scrollTop;
});

editor.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    persistDraftNow();
    close();
    return;
  }
  if (applyChecklistKey(e)) return;
  if (shouldSubmitOnEnter(e)) {
    e.preventDefault();
    void submit();
  }
});

editor.addEventListener("input", () => {
  renderMirror();
  if (view.kind === "error" && !view.retryable) setView({ kind: "idle", connected: true });
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraftNow, 300);
});

saveBtn.addEventListener("click", () => void submit());

// Esc anywhere on the card (e.g. focus on the button).
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && e.target !== editor) {
    persistDraftNow();
    close();
  }
});

window.addEventListener("pagehide", () => {
  if (draftTimer !== undefined) persistDraftNow();
});

// The overlay asks us to take focus (first open, or shortcut pressed again).
window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const m = parseFrameMessage(event.data);
  if (m?.type === "focus") editor.focus();
});
window.addEventListener("focus", () => editor.focus());

// Tell the overlay how tall the card is, so error lines never get clipped.
if (mode === "overlay" && "ResizeObserver" in window) {
  new ResizeObserver(() => {
    const height = Math.ceil(card.getBoundingClientRect().height);
    window.parent.postMessage({ source: FRAME_MESSAGE_SOURCE, type: "resize", height }, "*");
  }).observe(card);
}

// The popup was placed using the browser window's bounds. Move it to the
// top center of the display it is on (needs no extra permission).
async function placePopup() {
  if (mode !== "popup") return;
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  const { left, top } = topCenter({ left: s.availLeft, top: s.availTop, width: s.availWidth }, POPUP_WIDTH);
  try {
    const w = await chrome.windows.getCurrent();
    if (w.id !== undefined) await chrome.windows.update(w.id, { left, top });
  } catch {
    /* Best effort. */
  }
}

async function init() {
  render();
  editor.focus();
  void placePopup();
  try {
    const state = await send<CaptureState>({ type: "getState" });
    setupLink.href = state.setupUrl;
    if (state.pendingBody !== null) {
      editor.value = state.pendingBody;
      setView({ kind: "error", code: "unsent", retryable: true });
    } else {
      if (!editor.value) editor.value = state.draft;
      setView({ kind: "idle", connected: state.connected });
    }
  } catch {
    setView({ kind: "idle", connected: true });
  }
  renderMirror();
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
}

void init();
