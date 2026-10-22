// Build-time defaults. This file has no `import.meta` so the Vite config
// (which runs in Node) can import it too.

export const DEFAULT_API_BASE = "https://quick-note-api.vercel.app";
export const DEFAULT_WEB_BASE = "https://quick-note-web-one.vercel.app";

/** Local dev hosts that are always allowed next to the configured ones. */
export const LOCAL_API_ORIGIN = "http://localhost:8000";
export const LOCAL_WEB_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"] as const;

/** The server's limit (backend `NOTE_MAX_CHARS`). Checked before sending. */
export const NOTE_MAX_CHARS = 20_000;

/** Remove trailing slashes so `${base}/v1/notes` never has a double slash. */
export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** The origin part of a URL, e.g. "https://a.b" from "https://a.b/x/". */
export function originOf(url: string): string {
  return new URL(normalizeBase(url)).origin;
}
