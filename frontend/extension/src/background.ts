// Quick Note background service worker.
//
// It owns the extension token and makes every API call. Web pages and the
// capture card only send it messages; neither ever sees the token.
import { type HandlerDeps, handleExternal, handleInternal } from "./background/handlers";
import { captureUrl, onWindowRemoved, openCapture } from "./background/open-capture";
import { API_BASE, SETUP_URL, WEB_BASE } from "./lib/config";
import { buildAllowedOrigins } from "./lib/origin";
import { chromeKV } from "./lib/storage";

const deps: HandlerDeps = {
  kv: chromeKV(chrome.storage.local),
  fetch: (input, init) => fetch(input, init),
  apiBase: API_BASE,
  setupUrl: SETUP_URL,
  version: chrome.runtime.getManifest().version,
  extensionId: chrome.runtime.id,
  captureUrl: captureUrl(),
  allowedOrigins: buildAllowedOrigins(WEB_BASE),
  newId: () => crypto.randomUUID(),
};

function logError(err: unknown) {
  // Never log note text or tokens; the error message is enough.
  console.error("[quick-note]", err instanceof Error ? err.message : String(err));
}

// Each press is logged to the service-worker console (chrome://extensions →
// "service worker" → Console) so shortcut presses can be counted, e.g. for
// the macOS helper's 10-press test. Only the trigger and time are logged.
let triggerCount = 0;
function trigger(source: "shortcut" | "toolbar") {
  const at = Date.now();
  triggerCount += 1;
  console.info(`[quick-note] open-capture #${triggerCount} via ${source} at ${new Date(at).toISOString()} (lastOpenedAt=${at})`);
  openCapture(at).catch(logError);
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-capture") trigger("shortcut");
});

// Clicking the toolbar icon does the same thing (also grants activeTab).
chrome.action.onClicked.addListener(() => {
  trigger("toolbar");
});

chrome.windows.onRemoved.addListener((windowId) => {
  onWindowRemoved(windowId).catch(logError);
});

// Contract 2: the website. `return true` keeps the reply channel open for the async answer.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  handleExternal(msg, sender, deps)
    .then(sendResponse)
    .catch((err) => {
      logError(err);
      sendResponse({ ok: false, error: "bad_request" });
    });
  return true;
});

// The capture page (overlay iframe or popup window).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleInternal(msg, sender, deps)
    .then(sendResponse)
    .catch((err) => {
      logError(err);
      sendResponse({ ok: false, error: "bad_request" });
    });
  return true;
});
