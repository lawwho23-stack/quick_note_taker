import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../src/lib/api";
import { draftKey } from "../src/lib/drafts";
import { getPending, saveNote, type SaveDeps } from "../src/lib/save";
import { KEYS, memoryKV } from "../src/lib/storage";

const API = "https://api.test";
const TOKEN = "qnx_abcdefghijklmnopqrstuvwxyz";
const ACCOUNT = "acct1";

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function setup(fetchImpl: FetchLike, extra: Record<string, unknown> = {}) {
  const kv = memoryKV({ [KEYS.auth]: { token: TOKEN, accountKey: ACCOUNT }, ...extra });
  let n = 0;
  const deps: SaveDeps = { kv, fetch: fetchImpl, apiBase: API, newId: () => `id-${++n}` };
  return { kv, deps };
}

const ack = (id: string) => ({ id, version: 1, created_at: "2026-10-22T00:00:00Z" });

describe("saveNote state machine", () => {
  it("persists {pendingId, payload} BEFORE the fetch", async () => {
    let seenPending: unknown;
    const { kv, deps } = setup(async () => {
      seenPending = await getPending(kv);
      return json(201, ack("id-1"));
    });
    await saveNote("hello", deps);
    expect(seenPending).toMatchObject({ accountKey: ACCOUNT, payload: { id: "id-1", body: "hello", source: "extension", meta: {} } });
  });

  it("sends the contract request: bearer token, no cookies, JSON body", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(201, ack("id-1")));
    const { deps } = setup(fetchImpl);
    await saveNote("  hello  ", deps);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${API}/v1/notes`);
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init?.body as string)).toEqual({ id: "id-1", body: "hello", source: "extension", meta: {} });
  });

  it("lost response, then retry: the retry reuses the SAME id and payload", async () => {
    const calls: { id: string; body: string }[] = [];
    let attempt = 0;
    const { kv, deps } = setup(async (_url, init) => {
      calls.push(JSON.parse(init?.body as string));
      attempt++;
      if (attempt === 1) throw new TypeError("Failed to fetch"); // response lost
      return json(200, ack(calls[0].id)); // identical retry → 200
    });

    const first = await saveNote("my note", deps);
    expect(first).toEqual({ status: "error", code: "network", retryable: true });
    expect((await getPending(kv))?.payload.id).toBe("id-1");

    // Even if the UI passes different text, the frozen payload is resent.
    const second = await saveNote("edited text", deps);
    expect(second).toEqual({ status: "saved", id: "id-1" });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(await getPending(kv)).toBeNull();
  });

  it("201 clears the pending entry and the account's draft", async () => {
    const { kv, deps } = setup(async () => json(201, ack("id-1")), { [draftKey(ACCOUNT)]: "draft text" });
    expect(await saveNote("draft text", deps)).toEqual({ status: "saved", id: "id-1" });
    expect(kv.data[KEYS.pending]).toBeUndefined();
    expect(kv.data[draftKey(ACCOUNT)]).toBeUndefined();
  });

  it("a 15 s timeout counts as an error and keeps the pending entry", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const { kv, deps } = setup(hang);
    const r = await saveNote("slow", { ...deps, timeoutMs: 10 });
    expect(r).toEqual({ status: "error", code: "timeout", retryable: true });
    expect((await getPending(kv))?.payload.id).toBe("id-1");
  });

  it("5xx keeps the pending entry", async () => {
    const { kv, deps } = setup(async () => json(503, { error: { code: "unavailable" } }));
    expect(await saveNote("x", deps)).toEqual({ status: "error", code: "server", retryable: true });
    expect(await getPending(kv)).not.toBeNull();
  });

  it("429 means slow down, with Retry-After", async () => {
    const { kv, deps } = setup(async () => json(429, { error: { code: "rate_limited" } }, { "Retry-After": "12" }));
    expect(await saveNote("x", deps)).toEqual({ status: "error", code: "rate_limited", retryable: true, retryAfterSec: 12 });
    expect(await getPending(kv)).not.toBeNull();
  });

  it("401 token_revoked: disconnects, keeps the text as a draft, drops pending", async () => {
    const { kv, deps } = setup(async () => json(401, { error: { code: "token_revoked" } }));
    expect(await saveNote("keep me", deps)).toEqual({ status: "not_connected" });
    expect(kv.data[KEYS.auth]).toBeUndefined();
    expect(kv.data[KEYS.pending]).toBeUndefined();
    expect(kv.data[draftKey(null)]).toBe("keep me");
  });

  it("413 and 409 are final: pending is dropped so the next save gets a new id", async () => {
    const { kv, deps } = setup(async () => json(413, { error: { code: "note_too_large" } }));
    expect(await saveNote("x", deps)).toEqual({ status: "error", code: "too_large", retryable: false });
    expect(await getPending(kv)).toBeNull();

    const c = setup(async () => json(409, { error: { code: "note_id_conflict" } }));
    expect(await saveNote("x", c.deps)).toEqual({ status: "error", code: "conflict", retryable: false });
    expect(await getPending(c.kv)).toBeNull();
  });

  it("rejects empty and over-limit text without calling the API", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const { deps } = setup(fetchImpl);
    expect(await saveNote("   ", deps)).toMatchObject({ code: "empty" });
    expect(await saveNote("a".repeat(20_001), deps)).toMatchObject({ code: "too_large" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("not connected: no request", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const kv = memoryKV();
    expect(await saveNote("x", { kv, fetch: fetchImpl, apiBase: API, newId: () => "id" })).toEqual({ status: "not_connected" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never sends another account's pending save", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(201, ack("id-1")));
    const { deps } = setup(fetchImpl, {
      [KEYS.pending]: { accountKey: "other", payload: { id: "old", body: "theirs", source: "extension", meta: {} } },
    });
    await saveNote("mine", deps);
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)).toMatchObject({ id: "id-1", body: "mine" });
  });
});
