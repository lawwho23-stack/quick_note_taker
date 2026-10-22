import { describe, expect, it } from "vitest";
import { shouldSubmitOnEnter } from "../src/lib/ime";

const key = (over: Partial<Parameters<typeof shouldSubmitOnEnter>[0]> = {}) => ({
  key: "Enter",
  shiftKey: false,
  isComposing: false,
  keyCode: 13,
  ...over,
});

describe("shouldSubmitOnEnter (IME guard)", () => {
  it("submits on a plain Enter", () => {
    expect(shouldSubmitOnEnter(key())).toBe(true);
  });

  it("does not submit while an IME is composing (isComposing)", () => {
    expect(shouldSubmitOnEnter(key({ isComposing: true }))).toBe(false);
  });

  it("does not submit on keyCode 229 even when isComposing is false (Burmese IME)", () => {
    expect(shouldSubmitOnEnter(key({ keyCode: 229 }))).toBe(false);
  });

  it("Shift+Enter is a new line, not a save", () => {
    expect(shouldSubmitOnEnter(key({ shiftKey: true }))).toBe(false);
  });

  it("ignores other keys", () => {
    expect(shouldSubmitOnEnter(key({ key: "a", keyCode: 65 }))).toBe(false);
  });

  it("works with a real jsdom KeyboardEvent", () => {
    expect(shouldSubmitOnEnter(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(true);
    expect(shouldSubmitOnEnter(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }))).toBe(false);
  });
});
