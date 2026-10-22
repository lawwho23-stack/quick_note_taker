// Opening the capture card.
//
// 1. If the fallback popup window is already open, focus it (one capture at a time).
// 2. Otherwise focus the last normal Chrome window and inject the overlay
//    into its active tab (activeTab + scripting).
// 3. If injection fails (chrome:// pages, the Web Store, PDFs, the new tab
//    page, or no activeTab grant) open a small popup window, top center.
//
// The popup's window id lives in chrome.storage.session, so we still find
// it after the service worker restarts. (We have no "tabs" permission, so we
// cannot look for it by URL like the M0 prototype did.)
import { POPUP_HEIGHT, POPUP_WIDTH, topCenter } from "../lib/geometry";
import { KEYS } from "../lib/storage";

const POPUP_WINDOW_KEY = "captureWindowId";

export function captureUrl(): string {
  return chrome.runtime.getURL("capture.html");
}

/** Reuse logic from the M0 prototype, now keyed by a stored window id. */
export async function findExistingCaptureWindow(): Promise<chrome.windows.Window | null> {
  const stored = await chrome.storage.session.get(POPUP_WINDOW_KEY);
  const id = stored[POPUP_WINDOW_KEY];
  if (typeof id !== "number") return null;
  try {
    const w = await chrome.windows.get(id);
    if (w.type === "popup") return w;
  } catch {
    /* Window is gone. */
  }
  await chrome.storage.session.remove(POPUP_WINDOW_KEY);
  return null;
}

async function openPopup(anchor: chrome.windows.Window | null): Promise<void> {
  const { left, top } = topCenter({ left: anchor?.left, top: anchor?.top, width: anchor?.width }, POPUP_WIDTH);
  const w = await chrome.windows.create({
    url: `${captureUrl()}?mode=popup`,
    type: "popup",
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    left,
    top,
    focused: true,
  });
  if (w?.id !== undefined) await chrome.storage.session.set({ [POPUP_WINDOW_KEY]: w.id });
}

export async function openCapture(openedAt: number = Date.now()): Promise<void> {
  await chrome.storage.local.set({ [KEYS.lastOpenedAt]: openedAt });

  const existing = await findExistingCaptureWindow();
  if (existing?.id !== undefined) {
    try {
      await chrome.windows.update(existing.id, { focused: true });
      return;
    } catch {
      /* Vanished between get and focus: fall through and open a new one. */
    }
  }

  let win: chrome.windows.Window | null = null;
  try {
    win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch {
    win = null;
  }

  if (win?.id !== undefined) {
    // With a global shortcut Chrome may be in the background: bring it forward.
    await chrome.windows.update(win.id, { focused: true }).catch(() => undefined);
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
      if (tab?.id !== undefined) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["overlay.js"] });
        return;
      }
    } catch {
      /* Page can't host the overlay: use the popup. */
    }
  }

  await openPopup(win);
}

/** Forget the popup id when that window closes. */
export async function onWindowRemoved(windowId: number): Promise<void> {
  const stored = await chrome.storage.session.get(POPUP_WINDOW_KEY);
  if (stored[POPUP_WINDOW_KEY] === windowId) await chrome.storage.session.remove(POPUP_WINDOW_KEY);
}
