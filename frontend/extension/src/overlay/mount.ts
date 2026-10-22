// The in-page capture card.
//
// A fixed host element (top 44 px, centered, 560 px wide) holds the frosted
// card styles, including backdrop-filter, so the page behind it really blurs.
// Inside a CLOSED shadow root sits an iframe of capture.html. The page's own
// scripts and CSS cannot reach into either.
//
// This file must stay import-free at runtime: it is bundled into one IIFE
// file (overlay.js) and injected with chrome.scripting.executeScript.
import { FRAME_MESSAGE_SOURCE, parseFrameMessage } from "../lib/messages";

export const HOST_TAG = "quick-note-capture";
const INITIAL_HEIGHT = 196;
const MAX_HEIGHT = 420;

interface OverlayHandle {
  host: HTMLElement;
  iframe: HTMLIFrameElement;
  focus: () => void;
  close: () => void;
}

// One handle per page. Content scripts share one isolated world per
// extension and frame, so this survives repeated injections of overlay.js.
const REGISTRY = "__quickNoteOverlay";
type OverlayGlobal = typeof globalThis & { [REGISTRY]?: OverlayHandle };

const HOST_STYLE = [
  "all: initial",
  "position: fixed",
  "top: 44px",
  "left: 50%",
  "transform: translateX(-50%)",
  "width: 560px",
  "max-width: calc(100vw - 32px)",
  `height: ${INITIAL_HEIGHT}px`,
  "z-index: 2147483647",
  "display: block",
  "box-sizing: border-box",
  "border-radius: 18px",
  "border: 1px solid rgba(255, 255, 255, 0.8)",
  "background: rgba(255, 255, 255, 0.74)",
  "box-shadow: 0 24px 60px rgba(20, 30, 60, 0.28), 0 2px 6px rgba(20, 30, 60, 0.12)",
  "-webkit-backdrop-filter: blur(28px) saturate(180%)",
  "backdrop-filter: blur(28px) saturate(180%)",
  "overflow: hidden",
  "color-scheme: light",
]
  .map((rule) => `${rule} !important`)
  .join("; ");

const SHADOW_CSS = `
  :host { all: initial; }
  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    margin: 0;
    padding: 0;
    background: transparent;
    color-scheme: light;
  }
`;

export interface MountOptions {
  doc?: Document;
  captureUrl: string;
  /** chrome-extension://<id> — only messages from this origin are trusted. */
  extensionOrigin: string;
}

export function mountOverlay(opts: MountOptions): OverlayHandle {
  const doc = opts.doc ?? document;
  const g = globalThis as OverlayGlobal;
  const existing = g[REGISTRY];
  if (existing && existing.host.isConnected) {
    existing.focus();
    return existing;
  }

  const host = doc.createElement(HOST_TAG);
  host.setAttribute("style", HOST_STYLE);
  const root = host.attachShadow({ mode: "closed" });
  const style = doc.createElement("style");
  style.textContent = SHADOW_CSS;
  const iframe = doc.createElement("iframe");
  iframe.src = `${opts.captureUrl}?mode=overlay`;
  iframe.title = "Quick Note";
  iframe.setAttribute("allow", "clipboard-write");
  iframe.setAttribute("allowtransparency", "true");
  root.append(style, iframe);

  const focus = () => {
    iframe.focus();
    iframe.contentWindow?.postMessage({ source: FRAME_MESSAGE_SOURCE, type: "focus" }, opts.extensionOrigin);
  };

  const onMessage = (event: MessageEvent) => {
    // The page can post messages too: require our iframe AND our origin.
    if (event.source !== iframe.contentWindow || event.origin !== opts.extensionOrigin) return;
    const m = parseFrameMessage(event.data);
    if (!m) return;
    if (m.type === "close") close();
    else if (m.type === "resize") {
      const h = Math.max(120, Math.min(MAX_HEIGHT, Math.ceil(m.height)));
      host.style.setProperty("height", `${h}px`, "important");
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Esc while focus is on the page (outside the iframe) also closes.
    if (event.key === "Escape") close();
  };

  function close() {
    g.removeEventListener("message", onMessage);
    doc.removeEventListener("keydown", onKeyDown, true);
    host.remove();
    if (g[REGISTRY] === handle) delete g[REGISTRY];
  }

  const handle: OverlayHandle = { host, iframe, focus, close };
  g[REGISTRY] = handle;
  g.addEventListener("message", onMessage);
  doc.addEventListener("keydown", onKeyDown, true);
  iframe.addEventListener("load", focus);
  (doc.body ?? doc.documentElement).appendChild(host);
  return handle;
}
