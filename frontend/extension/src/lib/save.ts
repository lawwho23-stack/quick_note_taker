// Saving a note, with safe retries.
//
// The rule: a note gets its id ONCE. Before the request goes out we persist
// `{id, payload}` as the "pending" entry. If we never learn the outcome
// (timeout, network drop, 5xx, 429), the pending entry stays, and the next
// save resends the exact same id and payload. The server treats an identical
// retry as the same note (200), so a lost response can never create a
// duplicate. While a pending entry exists, new text is NOT sent — the editor
// is locked to the pending text until its outcome is known.
import { NOTE_MAX_CHARS } from "./defaults";
import { type FetchLike, type NotePayload, TimeoutError, parseRetryAfter, postNote, readErrorCode } from "./api";
import { clearDraft, setDraft } from "./drafts";
import { KEYS, type KV, type StoredAuth } from "./storage";

export interface PendingSave {
  accountKey: string;
  payload: NotePayload;
}

export type SaveErrorCode =
  | "empty"
  | "too_large"
  | "timeout"
  | "network"
  | "server"
  | "rate_limited"
  | "conflict"
  | "rejected";

export type SaveResult =
  | { status: "saved"; id: string }
  | { status: "not_connected" }
  | {
      status: "error";
      code: SaveErrorCode;
      /** True when the pending entry was kept: Retry resends the same id. */
      retryable: boolean;
      retryAfterSec?: number;
    };

export interface SaveDeps {
  kv: KV;
  fetch: FetchLike;
  apiBase: string;
  newId: () => string;
  timeoutMs?: number;
}

export async function getPending(kv: KV): Promise<PendingSave | null> {
  const p = await kv.get<PendingSave>(KEYS.pending);
  return p && typeof p.payload?.id === "string" ? p : null;
}

export async function saveNote(text: string, deps: SaveDeps): Promise<SaveResult> {
  const { kv } = deps;
  const auth = await kv.get<StoredAuth>(KEYS.auth);
  if (!auth?.token) return { status: "not_connected" };

  let pending = await getPending(kv);
  if (pending && pending.accountKey !== auth.accountKey) {
    // A pending save from another account must never be sent with this token.
    await kv.remove(KEYS.pending);
    pending = null;
  }

  if (!pending) {
    const body = text.trim();
    if (body === "") return { status: "error", code: "empty", retryable: false };
    if (body.length > NOTE_MAX_CHARS) return { status: "error", code: "too_large", retryable: false };
    pending = {
      accountKey: auth.accountKey,
      payload: { id: deps.newId(), body, source: "extension", meta: {} },
    };
    // Persist BEFORE the request, so a crash or lost response keeps the id.
    await kv.set(KEYS.pending, pending);
  }
  // else: resend the frozen pending payload unchanged, ignoring `text`.

  let res: Response;
  try {
    res = await postNote(deps.fetch, deps.apiBase, auth.token, pending.payload, deps.timeoutMs);
  } catch (err) {
    return { status: "error", code: err instanceof TimeoutError ? "timeout" : "network", retryable: true };
  }

  if (res.status === 201 || res.status === 200) {
    await kv.remove(KEYS.pending);
    await clearDraft(kv, auth.accountKey);
    return { status: "saved", id: pending.payload.id };
  }

  if (res.status === 401) {
    // unauthenticated or token_revoked: the note was not created. Forget the
    // token, but keep the text as an anonymous draft so nothing is lost.
    await kv.remove([KEYS.auth, KEYS.pending]);
    await setDraft(kv, null, pending.payload.body);
    await clearDraft(kv, auth.accountKey);
    return { status: "not_connected" };
  }

  if (res.status === 429) {
    return {
      status: "error",
      code: "rate_limited",
      retryable: true,
      retryAfterSec: parseRetryAfter(res.headers.get("Retry-After")) ?? undefined,
    };
  }

  if (res.status >= 500) {
    return { status: "error", code: "server", retryable: true };
  }

  // Any other 4xx is a definite "no": the note was not created. Drop the
  // pending entry so the (still visible) text can be edited and sent fresh.
  const code = await readErrorCode(res);
  await kv.remove(KEYS.pending);
  if (res.status === 413 || code === "note_too_large") return { status: "error", code: "too_large", retryable: false };
  if (res.status === 409 || code === "note_id_conflict") return { status: "error", code: "conflict", retryable: false };
  return { status: "error", code: "rejected", retryable: false };
}
