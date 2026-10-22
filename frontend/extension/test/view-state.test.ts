import { describe, expect, it } from "vitest";
import { fromSaveResult, isLocked, primaryAction, statusText } from "../src/capture/view-state";

describe("capture view state", () => {
  it("saving and saved lock the text; retryable errors lock it to the pending save", () => {
    expect(isLocked({ kind: "saving" })).toBe(true);
    expect(isLocked({ kind: "saved" })).toBe(true);
    const offline = fromSaveResult({ status: "error", code: "network", retryable: true });
    expect(isLocked(offline)).toBe(true);
    expect(primaryAction(offline)).toBe("retry");
    expect(statusText(offline)).toMatch(/text is kept/);
  });

  it("final errors and not-connected leave the text editable", () => {
    const tooBig = fromSaveResult({ status: "error", code: "too_large", retryable: false });
    expect(isLocked(tooBig)).toBe(false);
    expect(primaryAction(tooBig)).toBe("save");
    expect(isLocked(fromSaveResult({ status: "not_connected" }))).toBe(false);
  });

  it("429 says slow down", () => {
    expect(statusText(fromSaveResult({ status: "error", code: "rate_limited", retryable: true, retryAfterSec: 5 }))).toBe(
      "Slow down — try again in 5s.",
    );
  });

  it("a malformed reply never leaves the editor locked", () => {
    for (const reply of [{ ok: false, error: "bad_request" }, undefined, null, { status: "error", code: "weird" }]) {
      const v = fromSaveResult(reply);
      expect(v).toEqual({ kind: "error", code: "rejected", retryable: false });
      expect(isLocked(v)).toBe(false);
      expect(statusText(v)).not.toBe("");
    }
  });
});
