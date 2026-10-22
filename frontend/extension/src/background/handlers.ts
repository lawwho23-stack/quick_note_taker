// Message handlers for the background service worker. They take their
// dependencies as arguments (storage, fetch, config), so tests can run them
// without Chrome.
import { checkTokenStatus, type FetchLike } from "../lib/api";
import { adoptAnonDraft, clearAllDrafts, clearDraft, getDraft, setDraft } from "../lib/drafts";
import {
  type CaptureState,
  type ConnectReply,
  type DisconnectReply,
  type ExternalErrorReply,
  type PingReply,
  parseExternalMessage,
  parseInternalMessage,
} from "../lib/messages";
import { isAllowedOrigin, isTrustedCaptureSender } from "../lib/origin";
import { getPending, saveNote, type SaveResult } from "../lib/save";
import { KEYS, type KV, type StoredAuth, accountKeyFor } from "../lib/storage";

export interface HandlerDeps {
  kv: KV;
  fetch: FetchLike;
  apiBase: string;
  setupUrl: string;
  version: string;
  extensionId: string;
  captureUrl: string;
  allowedOrigins: ReadonlySet<string>;
  newId: () => string;
  timeoutMs?: number;
}

export interface SenderInfo {
  id?: string;
  origin?: string;
  url?: string;
  tab?: unknown;
}

export type ExternalReply = PingReply | ConnectReply | DisconnectReply | ExternalErrorReply;

/** Contract 2: messages from the website. */
export async function handleExternal(msg: unknown, sender: SenderInfo, deps: HandlerDeps): Promise<ExternalReply> {
  if (!isAllowedOrigin(sender.origin, deps.allowedOrigins)) return { ok: false, error: "forbidden_origin" };
  const m = parseExternalMessage(msg);
  if (!m) {
    // A connect with a malformed token is still "invalid_token" per the contract.
    const looksLikeConnect = typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === "connect";
    return looksLikeConnect ? { ok: false, error: "invalid_token" } : { ok: false, error: "bad_request" };
  }
  const { kv } = deps;

  switch (m.type) {
    case "ping": {
      const auth = await kv.get<StoredAuth>(KEYS.auth);
      const last = await kv.get<number>(KEYS.lastOpenedAt);
      return {
        ok: true,
        version: deps.version,
        connected: Boolean(auth?.token),
        lastOpenedAt: typeof last === "number" ? last : null,
      };
    }
    case "connect": {
      const valid = await checkTokenStatus(deps.fetch, deps.apiBase, m.token, deps.timeoutMs);
      if (!valid) return { ok: false, error: "invalid_token" };
      const accountKey = await accountKeyFor(m.token);
      const previous = await kv.get<StoredAuth>(KEYS.auth);
      if (previous && previous.accountKey !== accountKey) {
        // Switching to another token: drop the old account's unsent state.
        await kv.remove(KEYS.pending);
        await clearDraft(kv, previous.accountKey);
      }
      await kv.set(KEYS.auth, { token: m.token, accountKey } satisfies StoredAuth);
      await adoptAnonDraft(kv, accountKey);
      return { ok: true };
    }
    case "disconnect": {
      await kv.remove([KEYS.auth, KEYS.pending]);
      await clearAllDrafts(kv);
      return { ok: true };
    }
  }
}

export type InternalReply = CaptureState | SaveResult | { ok: true } | { ok: false; error: "forbidden" | "bad_request" };

/** Messages from our own capture page. */
export async function handleInternal(msg: unknown, sender: SenderInfo, deps: HandlerDeps): Promise<InternalReply> {
  if (!isTrustedCaptureSender(sender, deps.extensionId, deps.captureUrl)) return { ok: false, error: "forbidden" };
  const m = parseInternalMessage(msg);
  if (!m) return { ok: false, error: "bad_request" };
  const { kv } = deps;
  const auth = await kv.get<StoredAuth>(KEYS.auth);
  const accountKey = auth?.accountKey ?? null;

  switch (m.type) {
    case "getState": {
      const pending = await getPending(kv);
      const usablePending = pending && pending.accountKey === accountKey ? pending : null;
      return {
        connected: Boolean(auth?.token),
        draft: await getDraft(kv, accountKey),
        pendingBody: usablePending ? usablePending.payload.body : null,
        setupUrl: deps.setupUrl,
      } satisfies CaptureState;
    }
    case "draft": {
      await setDraft(kv, accountKey, m.text);
      return { ok: true };
    }
    case "save":
      return saveNote(m.body, deps);
  }
}
