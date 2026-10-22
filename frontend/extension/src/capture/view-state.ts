// What the capture card shows. Pure, so it is easy to test.
import type { SaveErrorCode, SaveResult } from "../lib/save";

export type ViewState =
  | { kind: "idle"; connected: boolean }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "not_connected" }
  | { kind: "error"; code: SaveErrorCode | "unsent"; retryable: boolean; retryAfterSec?: number };

/** How long "Saved" stays on screen before the card closes. */
export const SAVED_LINGER_MS = 600;

export function fromSaveResult(r: SaveResult): ViewState {
  if (r.status === "saved") return { kind: "saved" };
  if (r.status === "not_connected") return { kind: "not_connected" };
  return { kind: "error", code: r.code, retryable: r.retryable, retryAfterSec: r.retryAfterSec };
}

/**
 * The text is read-only while a save is in flight, after it succeeded, and
 * while an unconfirmed save is pending (Retry must resend the same text).
 */
export function isLocked(s: ViewState): boolean {
  return s.kind === "saving" || s.kind === "saved" || (s.kind === "error" && s.retryable);
}

export function statusText(s: ViewState): string {
  switch (s.kind) {
    case "idle":
      return s.connected ? "" : "Not connected.";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "not_connected":
      return "Not connected. Your text is kept.";
    case "error":
      switch (s.code) {
        case "unsent":
          return "Not sent yet. Your text is kept.";
        case "timeout":
          return "The server took too long. Your text is kept.";
        case "network":
          return "You seem to be offline. Your text is kept.";
        case "server":
          return "Server error. Your text is kept.";
        case "rate_limited":
          return s.retryAfterSec ? `Slow down — try again in ${s.retryAfterSec}s.` : "Slow down — try again shortly.";
        case "too_large":
          return "This note is too long (max 20,000 characters).";
        case "conflict":
          return "Could not save this note. Press Enter to try again.";
        case "rejected":
          return "The server refused this note.";
        case "empty":
          return "";
      }
  }
}

/** Which button the footer shows. */
export function primaryAction(s: ViewState): "save" | "retry" | "none" {
  if (s.kind === "error" && s.retryable) return "retry";
  if (s.kind === "saving" || s.kind === "saved") return "none";
  return "save";
}
