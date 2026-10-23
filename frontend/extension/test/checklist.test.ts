import { describe, expect, it } from "vitest";
import { onBackspace, onBoxClick, onShiftEnter, onSpace, toggleAt } from "../src/lib/checklist";

// "|" marks the caret.
const at = (text: string) => {
  const i = text.indexOf("|");
  return { value: text.replace("|", ""), start: i, end: i };
};
const show = (r: { value: string; caret: number } | null) =>
  r && r.value.slice(0, r.caret) + "|" + r.value.slice(r.caret);

describe("onSpace", () => {
  it("turns a line-start dash into a checkbox", () => {
    expect(show(onSpace(at("-|")))).toBe("☐ |");
    expect(show(onSpace(at("note\n-|")))).toBe("note\n☐ |");
    expect(show(onSpace(at("-|rest")))).toBe("☐ |rest");
  });

  it("ignores a dash mid-line or a selection", () => {
    expect(onSpace(at("a -|"))).toBeNull();
    expect(onSpace(at("--|"))).toBeNull();
    expect(onSpace({ value: "-", start: 0, end: 1 })).toBeNull();
  });
});

describe("onShiftEnter", () => {
  it("starts the next item", () => {
    expect(show(onShiftEnter(at("☐ Buy milk|")))).toBe("☐ Buy milk\n☐ |");
    expect(show(onShiftEnter(at("☐ Buy| milk")))).toBe("☐ Buy\n☐ | milk");
  });

  it("ends the list on an empty item", () => {
    expect(show(onShiftEnter(at("☐ a\n☐ |")))).toBe("☐ a\n|");
  });

  it("leaves normal lines alone", () => {
    expect(onShiftEnter(at("plain|"))).toBeNull();
    expect(onShiftEnter(at("|☐ a"))).toBeNull();
  });
});

describe("onBackspace", () => {
  it("turns a fresh checkbox back into a dash", () => {
    expect(show(onBackspace(at("x\n☐ |")))).toBe("x\n- |");
  });

  it("leaves other backspaces alone", () => {
    expect(onBackspace(at("☐ a|"))).toBeNull();
    expect(onBackspace(at("ab|"))).toBeNull();
  });
});

describe("ticking items", () => {
  it("toggleAt swaps ☐ and ☑ on the caret's line", () => {
    expect(show(toggleAt("☐ a\n☐ b", 6))).toBe("☐ a\n☑ |b");
    expect(show(toggleAt("☑ a", 3))).toBe("☐ a|");
    expect(toggleAt("plain", 2)).toBeNull();
  });

  it("onBoxClick only fires when the click lands on the box", () => {
    expect(show(onBoxClick(at("x\n|☐ b")))).toBe("x\n☑ |b");
    expect(show(onBoxClick(at("☑| b")))).toBe("☐ |b");
    expect(onBoxClick(at("☐ b|"))).toBeNull();
    expect(onBoxClick(at("|plain"))).toBeNull();
  });

  it("done items still continue and end the list", () => {
    expect(show(onShiftEnter(at("☑ done|")))).toBe("☑ done\n☐ |");
    expect(show(onShiftEnter(at("☑ |")))).toBe("|");
    expect(show(onBackspace(at("☑ |")))).toBe("- |");
  });
});
