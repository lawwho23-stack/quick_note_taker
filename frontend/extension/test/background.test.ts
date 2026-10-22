// Contract 2 through the real service-worker wiring, with `chrome.*` mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftKey } from "../src/lib/drafts";
import { KEYS, memoryKV } from "../src/lib/storage";

const EXT_ID = "mpnpdndkgajhjmlefflhemibjmkkcnha";
const WEB = "https://quick-note-web-one.vercel.app";
const TOKEN = "qnx_valid_token_value_0123456789";

type Listener = (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void;

function fakeArea(data: Record<string, unknown>) {
  const kv = memoryKV();
  Object.assign(kv.data, data);
  return {
    data: kv.data,
    get: async (key: string | null) => (key === null ? kv.getAll() : { [key]: await kv.get(key) }),
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) await kv.set(k, v);
    },
    remove: async (keys: string | string[]) => kv.remove(keys),
  };
}

let external: Listener;
let internal: Listener;
let local: ReturnType<typeof fakeArea>;
let fetchMock: ReturnType<typeof vi.fn>;

async function loadBackground(initial: Record<string, unknown> = {}) {
  vi.resetModules();
  local = fakeArea(initial);
  const listen = () => ({ addListener: vi.fn() });
  const chromeMock = {
    runtime: {
      id: EXT_ID,
      getURL: (p: string) => `chrome-extension://${EXT_ID}/${p}`,
      getManifest: () => ({ version: "0.2.0" }),
      onMessageExternal: { addListener: (l: Listener) => (external = l) },
      onMessage: { addListener: (l: Listener) => (internal = l) },
    },
    storage: { local, session: fakeArea({}) },
    commands: { onCommand: listen() },
    action: { onClicked: listen() },
    windows: { onRemoved: listen() },
  };
  vi.stubGlobal("chrome", chromeMock);
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "connected" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await import("../src/background");
}

function call(l: Listener, msg: unknown, sender: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const keepOpen = l(msg, sender, resolve);
    expect(keepOpen).toBe(true); // async reply needs `return true`
  });
}

const web = { origin: WEB, url: `${WEB}/quick-note` };

describe("background: Contract 2 (onMessageExternal)", () => {
  beforeEach(async () => {
    await loadBackground({ [KEYS.lastOpenedAt]: 1234 });
  });

  it("ping reports version, connection and lastOpenedAt", async () => {
    expect(await call(external, { type: "ping" }, web)).toEqual({
      ok: true,
      version: "0.2.0",
      connected: false,
      lastOpenedAt: 1234,
    });
  });

  it("ignores senders outside the allowlist", async () => {
    const reply = await call(external, { type: "connect", token: TOKEN }, { origin: "https://evil.com" });
    expect(reply).toEqual({ ok: false, error: "forbidden_origin" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(local.data[KEYS.auth]).toBeUndefined();
  });

  it("connect checks the token with /v1/extension/status, then stores it", async () => {
    expect(await call(external, { type: "connect", token: TOKEN }, web)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://quick-note-api.vercel.app/v1/extension/status");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.credentials).toBe("omit");
    expect(local.data[KEYS.auth]).toMatchObject({ token: TOKEN });
    expect(await call(external, { type: "ping" }, web)).toMatchObject({ connected: true });
  });

  it("connect with a rejected or malformed token is invalid_token and stores nothing", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "token_revoked" } }), { status: 401 }));
    expect(await call(external, { type: "connect", token: TOKEN }, web)).toEqual({ ok: false, error: "invalid_token" });
    expect(await call(external, { type: "connect", token: "not-a-token" }, web)).toEqual({ ok: false, error: "invalid_token" });
    expect(local.data[KEYS.auth]).toBeUndefined();
  });

  it("disconnect forgets the token and clears drafts", async () => {
    await call(external, { type: "connect", token: TOKEN }, web);
    local.data[draftKey("x")] = "draft";
    expect(await call(external, { type: "disconnect" }, web)).toEqual({ ok: true });
    expect(local.data[KEYS.auth]).toBeUndefined();
    expect(local.data[draftKey("x")]).toBeUndefined();
  });

  it("rejects unknown message types", async () => {
    expect(await call(external, { type: "save", body: "x" }, web)).toEqual({ ok: false, error: "bad_request" });
    expect(await call(external, "ping", web)).toEqual({ ok: false, error: "bad_request" });
  });
});

describe("background: internal messages", () => {
  it("are refused from content scripts in web pages", async () => {
    await loadBackground();
    const reply = await call(internal, { type: "getState" }, { id: EXT_ID, url: "https://evil.com/", tab: {} });
    expect(reply).toEqual({ ok: false, error: "forbidden" });
  });

  it("getState returns the draft for the capture page", async () => {
    await loadBackground({ [draftKey(null)]: "hi" });
    const sender = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/capture.html?mode=popup` };
    expect(await call(internal, { type: "getState" }, sender)).toEqual({
      connected: false,
      draft: "hi",
      pendingBody: null,
      setupUrl: `${WEB}/quick-note`,
    });
  });
});
