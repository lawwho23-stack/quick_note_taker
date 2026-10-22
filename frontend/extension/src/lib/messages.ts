// Message shapes and validation. Every message that arrives at the
// background is untrusted input until it passes one of these parsers.

// ---- Contract 2: website -> extension (chrome.runtime.sendMessage(EXTENSION_ID, ...)) ----

export type ExternalMessage = { type: "ping" } | { type: "connect"; token: string } | { type: "disconnect" };

export interface PingReply {
  ok: true;
  version: string;
  connected: boolean;
  lastOpenedAt: number | null;
}
export type ConnectReply = { ok: true } | { ok: false; error: "invalid_token" };
export type DisconnectReply = { ok: true };
export type ExternalErrorReply = { ok: false; error: "forbidden_origin" | "bad_request" };

/** `qnx_` followed by URL-safe characters. Length is bounded so a page can't send megabytes. */
export const TOKEN_PATTERN = /^qnx_[A-Za-z0-9_-]{16,256}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseExternalMessage(msg: unknown): ExternalMessage | null {
  if (!isObject(msg)) return null;
  switch (msg.type) {
    case "ping":
      return { type: "ping" };
    case "disconnect":
      return { type: "disconnect" };
    case "connect":
      if (typeof msg.token !== "string" || !TOKEN_PATTERN.test(msg.token)) return null;
      return { type: "connect", token: msg.token };
    default:
      return null;
  }
}

// ---- Internal: capture page -> background ----

export type InternalMessage =
  | { type: "getState" }
  | { type: "save"; body: string }
  | { type: "draft"; text: string };

/** Longest text we accept in an internal message (a bit above the note limit). */
const MAX_INTERNAL_TEXT = 100_000;

export function parseInternalMessage(msg: unknown): InternalMessage | null {
  if (!isObject(msg)) return null;
  switch (msg.type) {
    case "getState":
      return { type: "getState" };
    case "save":
      if (typeof msg.body !== "string" || msg.body.length > MAX_INTERNAL_TEXT) return null;
      return { type: "save", body: msg.body };
    case "draft":
      if (typeof msg.text !== "string" || msg.text.length > MAX_INTERNAL_TEXT) return null;
      return { type: "draft", text: msg.text };
    default:
      return null;
  }
}

export interface CaptureState {
  connected: boolean;
  draft: string;
  /** Text of a save whose outcome is unknown. While set, the editor is locked to it. */
  pendingBody: string | null;
  setupUrl: string;
}

// ---- Overlay iframe <-> content script (window.postMessage) ----

export const FRAME_MESSAGE_SOURCE = "quick-note";
export type FrameMessage =
  | { source: typeof FRAME_MESSAGE_SOURCE; type: "close" }
  | { source: typeof FRAME_MESSAGE_SOURCE; type: "resize"; height: number }
  | { source: typeof FRAME_MESSAGE_SOURCE; type: "focus" };

export function parseFrameMessage(msg: unknown): FrameMessage | null {
  if (!isObject(msg) || msg.source !== FRAME_MESSAGE_SOURCE) return null;
  if (msg.type === "close") return { source: FRAME_MESSAGE_SOURCE, type: "close" };
  if (msg.type === "focus") return { source: FRAME_MESSAGE_SOURCE, type: "focus" };
  if (msg.type === "resize" && typeof msg.height === "number" && Number.isFinite(msg.height)) {
    return { source: FRAME_MESSAGE_SOURCE, type: "resize", height: msg.height };
  }
  return null;
}
