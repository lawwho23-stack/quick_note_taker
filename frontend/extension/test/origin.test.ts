import { describe, expect, it } from "vitest";
import { buildAllowedOrigins, isAllowedOrigin, isTrustedCaptureSender } from "../src/lib/origin";

const allowed = buildAllowedOrigins("https://quick-note-web-one.vercel.app/");

describe("sender-origin check", () => {
  it("allows the staging web and local dev origins", () => {
    expect(isAllowedOrigin("https://quick-note-web-one.vercel.app", allowed)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000", allowed)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000", allowed)).toBe(true);
  });

  it("rejects look-alikes, other ports and schemes, and missing origins", () => {
    for (const o of [
      "https://quick-note-web-one.vercel.app.evil.com",
      "https://evil.com",
      "http://quick-note-web-one.vercel.app",
      "http://localhost:3001",
      "https://localhost:3000",
      "null",
      "",
      undefined,
    ]) {
      expect(isAllowedOrigin(o, allowed)).toBe(false);
    }
  });

  it("internal messages only from our capture page", () => {
    const id = "mpnpdndkgajhjmlefflhemibjmkkcnha";
    const url = `chrome-extension://${id}/capture.html`;
    expect(isTrustedCaptureSender({ id, url: `${url}?mode=overlay` }, id, url)).toBe(true);
    expect(isTrustedCaptureSender({ id, url }, id, url)).toBe(true);
    // a content script in a web page has our id but a web URL
    expect(isTrustedCaptureSender({ id, url: "https://evil.com/", tab: {} }, id, url)).toBe(false);
    expect(isTrustedCaptureSender({ id: "otherext", url }, id, url)).toBe(false);
    expect(isTrustedCaptureSender({ id, url: `${url}.evil` }, id, url)).toBe(false);
  });
});
