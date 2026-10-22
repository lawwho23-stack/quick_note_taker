// Who may talk to the background service worker.
import { LOCAL_WEB_ORIGINS, originOf } from "./defaults";

/** Exact web origins allowed to send Contract 2 messages. */
export function buildAllowedOrigins(webBase: string): ReadonlySet<string> {
  return new Set([originOf(webBase), ...LOCAL_WEB_ORIGINS]);
}

/**
 * True only for an exact origin match. No prefix or wildcard matching, so
 * "https://quick-note-web-one.vercel.app.evil.com" is rejected.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (typeof origin !== "string" || origin === "") return false;
  return allowed.has(origin);
}

interface SenderLike {
  id?: string;
  url?: string;
  tab?: unknown;
}

/**
 * Internal messages (save, draft, ...) are accepted only from our own
 * capture page, never from a content script running inside a web page.
 */
export function isTrustedCaptureSender(sender: SenderLike, extensionId: string, captureUrl: string): boolean {
  if (sender.id !== extensionId) return false;
  if (typeof sender.url !== "string") return false;
  return sender.url === captureUrl || sender.url.startsWith(`${captureUrl}?`) || sender.url.startsWith(`${captureUrl}#`);
}
