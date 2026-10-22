import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EXTENSION_ID, EXTENSION_KEY, buildManifest } from "../src/lib/manifest";

/** Chrome's rule: sha-256 of the DER public key, first 32 hex digits mapped 0-f → a-p. */
function idFromKey(key: string) {
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

describe("manifest", () => {
  const m = buildManifest();

  it("is MV3, named Quick Note 0.2.0", () => {
    expect(m.manifest_version).toBe(3);
    expect(m.name).toBe("Quick Note");
    expect(m.version).toBe("0.2.0");
    expect(m.background).toEqual({ service_worker: "background.js", type: "module" });
  });

  it("keeps the key, which pins the extension ID", () => {
    expect(m.key).toBe(EXTENSION_KEY);
    expect(idFromKey(m.key)).toBe(EXTENSION_ID);
    expect(EXTENSION_ID).toBe("mpnpdndkgajhjmlefflhemibjmkkcnha");
  });

  it("has exactly the permissions storage, activeTab, scripting", () => {
    expect(m.permissions).toEqual(["storage", "activeTab", "scripting"]);
  });

  it("only talks to the API hosts — no 127.0.0.1:8787 beacon", () => {
    expect(m.host_permissions).toEqual(["https://quick-note-api.vercel.app/*", "http://localhost:8000/*"]);
    expect(JSON.stringify(m)).not.toContain("8787");
  });

  it("has no content_scripts", () => {
    expect(m).not.toHaveProperty("content_scripts");
  });

  it("has the global open-capture command", () => {
    expect(m.commands["open-capture"]).toEqual({
      suggested_key: { default: "Ctrl+Shift+7", mac: "MacCtrl+Shift+7" },
      description: expect.any(String),
      global: true,
    });
  });

  it("lets only the website origins connect", () => {
    expect(m.externally_connectable.matches).toEqual([
      "https://quick-note-web-one.vercel.app/*",
      "http://localhost:3000/*",
      "http://127.0.0.1:3000/*",
    ]);
  });

  it("exposes capture.html for the overlay iframe", () => {
    expect(m.web_accessible_resources).toEqual([{ resources: ["capture.html"], matches: ["<all_urls>"] }]);
  });

  it("follows build-time API and web bases", () => {
    const local = buildManifest({ apiBase: "http://localhost:8000/", webBase: "http://localhost:3000" });
    expect(local.host_permissions).toEqual(["http://localhost:8000/*"]);
    expect(local.externally_connectable.matches).toEqual(["http://localhost:3000/*", "http://127.0.0.1:3000/*"]);
  });
});
