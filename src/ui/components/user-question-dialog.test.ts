import { describe, expect, it } from "bun:test";
import { isMultiSelectSubmitKey, toggleSelection } from "./user-question-dialog.tsx";

describe("toggleSelection", () => {
  it("adds values that are not selected", () => {
    expect(toggleSelection([], "alpha")).toEqual(["alpha"]);
  });

  it("removes values that are already selected", () => {
    expect(toggleSelection(["alpha", "beta"], "alpha")).toEqual(["beta"]);
  });
});

describe("isMultiSelectSubmitKey", () => {
  it("returns true for Ctrl+Enter", () => {
    expect(isMultiSelectSubmitKey("return", true, false)).toBe(true);
  });

  it("returns true for Cmd+Enter", () => {
    expect(isMultiSelectSubmitKey("return", false, true)).toBe(true);
  });

  it("returns false for Enter without modifier", () => {
    expect(isMultiSelectSubmitKey("return", false, false)).toBe(false);
  });

  it("returns false for non-enter keys", () => {
    expect(isMultiSelectSubmitKey("space", true, false)).toBe(false);
  });
});
