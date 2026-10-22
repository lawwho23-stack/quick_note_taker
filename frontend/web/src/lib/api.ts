import {
  API_BASE_PATH,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  type ApiErrorDetail,
} from "@quick-note/shared";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: ApiErrorDetail | null };

const REFRESH_LOCK = "quick-note-refresh";
const REFRESH_PATH = `${API_BASE_PATH}/auth/refresh`;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const csrfToken = readCookie(CSRF_COOKIE_NAME);
  if (csrfToken) {
    headers.set(CSRF_HEADER_NAME, csrfToken);
  }
  return headers;
}

async function readError(response: Response): Promise<ApiErrorDetail | null> {
  try {
    const body = (await response.clone().json()) as { error?: ApiErrorDetail };
    return body.error ?? null;
  } catch {
    return null;
  }
}

let inMemoryRefresh: Promise<boolean> | null = null;

async function refreshInner(): Promise<boolean> {
  const response = await fetch(REFRESH_PATH, {
    method: "POST",
    headers: buildHeaders(),
    credentials: "same-origin",
    cache: "no-store",
  });
  return response.ok;
}

/**
 * Refresh the session once, coordinated across tabs.
 *
 * `navigator.locks` serializes the rotation so two tabs never race on the same
 * refresh token; the in-memory promise covers browsers without the Web Locks API.
 */
export async function refreshSession(): Promise<boolean> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks) {
    return locks.request(REFRESH_LOCK, refreshInner);
  }
  inMemoryRefresh ??= refreshInner().finally(() => {
    inMemoryRefresh = null;
  });
  return inMemoryRefresh;
}

/**
 * Fetch a website API path with CSRF headers, and retry once after a refresh
 * when the access token has expired. A failing refresh call itself is never
 * retried, so a dead refresh token cannot start a refresh loop.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = () =>
    fetch(path, {
      ...init,
      headers: buildHeaders(init),
      credentials: "same-origin",
      cache: "no-store",
    });

  let response = await send();
  const isRefresh = path.split("?")[0] === REFRESH_PATH;
  if (response.status === 401 && !isRefresh) {
    const error = await readError(response);
    if (error?.code === "session_expired") {
      if (await refreshSession()) {
        response = await send();
      }
    }
  }
  return response;
}

/** Fetch JSON and normalize failures into a result object. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    return { ok: false, status: response.status, error: await readError(response) };
  }
  if (response.status === 204) {
    return { ok: true, data: undefined as T };
  }
  return { ok: true, data: (await response.json()) as T };
}
