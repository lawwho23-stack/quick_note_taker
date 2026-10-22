// Thin HTTP helpers for the two endpoints the extension may call
// (Contract 1). Bearer token only; cookies are never sent.

export const REQUEST_TIMEOUT_MS = 15_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class TimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "TimeoutError";
  }
}

/** fetch with a hard timeout. A timeout rejects with TimeoutError. */
export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, credentials: "omit" });
  } catch (err) {
    if (timedOut) throw new TimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface NotePayload {
  id: string;
  body: string;
  source: "extension";
  meta: Record<string, never>;
}

export function postNote(fetchImpl: FetchLike, apiBase: string, token: string, payload: NotePayload, timeoutMs?: number) {
  return fetchWithTimeout(
    fetchImpl,
    `${apiBase}/v1/notes`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    timeoutMs,
  );
}

/** True only for `200 {"status": "connected"}`. Any failure is false. */
export async function checkTokenStatus(fetchImpl: FetchLike, apiBase: string, token: string, timeoutMs?: number) {
  try {
    const res = await fetchWithTimeout(
      fetchImpl,
      `${apiBase}/v1/extension/status`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
      timeoutMs,
    );
    if (res.status !== 200) return false;
    const data: unknown = await res.json();
    return typeof data === "object" && data !== null && (data as { status?: unknown }).status === "connected";
  } catch {
    return false;
  }
}

/** Read `error.code` from the API's `{"error": {"code", ...}}` shape. */
export async function readErrorCode(res: Response): Promise<string | null> {
  try {
    const data: unknown = await res.json();
    const code = (data as { error?: { code?: unknown } })?.error?.code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

/** Retry-After in seconds (only the delta-seconds form). */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
}
