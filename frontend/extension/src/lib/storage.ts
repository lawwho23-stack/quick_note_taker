// A tiny key-value interface over chrome.storage. Logic modules depend on
// this interface, not on `chrome`, so tests can pass an in-memory version.

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  getAll(): Promise<Record<string, unknown>>;
  set(key: string, value: unknown): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/** Storage keys used in chrome.storage.local. */
export const KEYS = {
  auth: "auth",
  pending: "pending",
  lastOpenedAt: "lastOpenedAt",
} as const;

export interface StoredAuth {
  token: string;
  /** Short sha-256 of the token. Scopes drafts without storing the raw token in a key. */
  accountKey: string;
}

export function chromeKV(area: chrome.storage.StorageArea): KV {
  return {
    async get<T>(key: string) {
      const out = await area.get(key);
      return out[key] as T | undefined;
    },
    async getAll() {
      return (await area.get(null)) as Record<string, unknown>;
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(keys) {
      await area.remove(keys);
    },
  };
}

/** In-memory KV for tests and as a safe fallback. */
export function memoryKV(initial: Record<string, unknown> = {}): KV & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = structuredClone(initial);
  return {
    data,
    async get<T>(key: string) {
      return (key in data ? structuredClone(data[key]) : undefined) as T | undefined;
    },
    async getAll() {
      return structuredClone(data);
    },
    async set(key, value) {
      data[key] = structuredClone(value);
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

/** sha-256 of the token, first 16 hex chars. */
export async function accountKeyFor(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}
