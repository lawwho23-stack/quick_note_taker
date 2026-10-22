// Entry for overlay.js (injected into the active tab). Built as one IIFE.
import { mountOverlay } from "./overlay/mount";

mountOverlay({
  captureUrl: chrome.runtime.getURL("capture.html"),
  extensionOrigin: new URL(chrome.runtime.getURL("")).origin,
});
