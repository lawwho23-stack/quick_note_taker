import { describe, expect, it } from "vitest";
import { adoptAnonDraft, clearAllDrafts, draftKey, getDraft, setDraft } from "../src/lib/drafts";
import { accountKeyFor, memoryKV } from "../src/lib/storage";

describe("draft scoping", () => {
  it("keeps drafts per account", async () => {
    const kv = memoryKV();
    await setDraft(kv, "acctA", "A's text");
    await setDraft(kv, "acctB", "B's text");
    expect(await getDraft(kv, "acctA")).toBe("A's text");
    expect(await getDraft(kv, "acctB")).toBe("B's text");
    expect(await getDraft(kv, "acctC")).toBe("");
    expect(await getDraft(kv, null)).toBe("");
  });

  it("uses distinct keys and never the raw token", async () => {
    const token = "qnx_secretsecretsecretsecret";
    const key = await accountKeyFor(token);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(draftKey(key)).not.toContain(token);
    expect(draftKey(null)).toBe("draft:anon");
    expect(await accountKeyFor("qnx_other_token_value_1234")).not.toBe(key);
  });

  it("empty text removes the draft", async () => {
    const kv = memoryKV();
    await setDraft(kv, "a", "x");
    await setDraft(kv, "a", "");
    expect(kv.data[draftKey("a")]).toBeUndefined();
  });

  it("disconnect clears every draft but nothing else", async () => {
    const kv = memoryKV({ other: 1 });
    await setDraft(kv, "a", "x");
    await setDraft(kv, null, "y");
    await clearAllDrafts(kv);
    expect(kv.data).toEqual({ other: 1 });
  });

  it("connecting adopts the anonymous draft", async () => {
    const kv = memoryKV();
    await setDraft(kv, null, "typed before connecting");
    await adoptAnonDraft(kv, "acct");
    expect(await getDraft(kv, "acct")).toBe("typed before connecting");
    expect(await getDraft(kv, null)).toBe("");
  });
});
