import { describe, expect, test } from "bun:test";
import { getClampedAutocompleteIndex } from "./autocomplete.tsx";

describe("getClampedAutocompleteIndex", () => {
  test("keeps index unchanged when already in range", () => {
    expect(getClampedAutocompleteIndex(1, 3)).toBe(1);
  });

  test("clamps to first suggestion when index is negative", () => {
    expect(getClampedAutocompleteIndex(-4, 3)).toBe(0);
  });

  test("clamps to last suggestion when list shrinks", () => {
    expect(getClampedAutocompleteIndex(5, 2)).toBe(1);
  });

  test("returns zero when there are no suggestions", () => {
    expect(getClampedAutocompleteIndex(3, 0)).toBe(0);
  });
});
