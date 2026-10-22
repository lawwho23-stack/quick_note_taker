import { afterEach, describe, expect, it } from "vitest";
import { HOST_TAG, mountOverlay } from "../src/overlay/mount";

const opts = { captureUrl: "chrome-extension://abc/capture.html", extensionOrigin: "chrome-extension://abc" };

afterEach(() => {
  document.querySelectorAll(HOST_TAG).forEach((el) => el.remove());
  delete (globalThis as Record<string, unknown>).__quickNoteOverlay;
});

describe("overlay mount", () => {
  it("adds one fixed, frosted host at top 44px, 560px wide", () => {
    const h = mountOverlay(opts);
    const style = h.host.getAttribute("style") ?? "";
    expect(style).toContain("position: fixed !important");
    expect(style).toContain("top: 44px !important");
    expect(style).toContain("width: 560px !important");
    expect(style).toContain("backdrop-filter: blur(28px) saturate(180%) !important");
    expect(h.iframe.src).toBe("chrome-extension://abc/capture.html?mode=overlay");
    // closed shadow root: the page can't reach the iframe
    expect(h.host.shadowRoot).toBeNull();
  });

  it("does not open a second card; it focuses the existing one", () => {
    const a = mountOverlay(opts);
    const b = mountOverlay(opts);
    expect(b).toBe(a);
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1);
  });

  it("Esc on the page removes it, and a new mount works after", () => {
    const a = mountOverlay(opts);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(a.host.isConnected).toBe(false);
    const b = mountOverlay(opts);
    expect(b).not.toBe(a);
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1);
  });

  it("ignores close messages that don't come from its own iframe", () => {
    const h = mountOverlay(opts);
    window.dispatchEvent(
      new MessageEvent("message", { data: { source: "quick-note", type: "close" }, origin: "chrome-extension://abc", source: window }),
    );
    expect(h.host.isConnected).toBe(true);
  });
});
