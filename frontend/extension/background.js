// Quick Note — M0 prototype service worker.
//
// Responsibilities (M0 scope only):
//   1. Receive the "open-capture" command (fired by Chrome shortcuts or by the
//      macOS helper's synthetic Ctrl+Shift+7) and open the capture window.
//   2. Focus the existing capture window instead of opening a second one.
//   3. Send a local diagnostic beacon so the M0 bridge test can prove that the
//      command actually fired. The beacon is dev-only and will be removed in M4.
//
// No network calls to any server, no note storage — this is a bridge test.

const BEACON_URL = "http://127.0.0.1:8787/qn-event";
const CAPTURE_PAGE = "capture.html";

// M0 diagnostic only: a local beacon so the test log shows "command fired"
// with a timestamp. It never sends note content. Removed in M4.
function beacon(event, trigger) {
  const url = `${BEACON_URL}?event=${encodeURIComponent(event)}&trigger=${encodeURIComponent(trigger)}&t=${Date.now()}`;
  fetch(url).catch(() => {
    /* Beacon server not running — harmless. */
  });
}

function captureUrl() {
  return chrome.runtime.getURL(CAPTURE_PAGE);
}

async function findExistingCaptureWindow() {
  const wins = await chrome.windows.getAll({ populate: true });
  for (const w of wins) {
    if ((w.tabs || []).some((t) => (t.url || "").startsWith(captureUrl()))) {
      return w;
    }
  }
  return null;
}

async function openCapture(trigger) {
  // Reuse an existing capture window if there is one (also covers service
  // worker restarts, where in-memory window ids are lost).
  const existing = await findExistingCaptureWindow();
  if (existing && existing.id !== undefined) {
    try {
      await chrome.windows.update(existing.id, { focused: true });
      beacon("window-focused", trigger);
      return;
    } catch (_) {
      /* Window vanished between listing and focusing — fall through. */
    }
  }

  const w = await chrome.windows.getLastFocused();
  const width = 560;
  const height = 260;
  const left = Math.round((w.left ?? 100) + ((w.width ?? width) - width) / 2);
  const top = Math.round((w.top ?? 0) + 80);

  await chrome.windows.create({
    url: `${captureUrl()}?trigger=${encodeURIComponent(trigger)}`,
    type: "popup",
    width,
    height,
    left,
    top,
    focused: true,
  });
  beacon("window-opened", trigger);
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-capture") return;
  beacon("command", "shortcut");
  openCapture("shortcut");
});

// Manual fallback: clicking the toolbar icon runs the same path, so the
// extension can be tested even before the helper is installed.
chrome.action.onClicked.addListener(() => {
  beacon("command", "manual");
  openCapture("manual");
});

chrome.runtime.onInstalled.addListener(() => {
  beacon("sw-installed", "startup");
});

chrome.runtime.onStartup.addListener(() => {
  beacon("sw-startup", "startup");
});
