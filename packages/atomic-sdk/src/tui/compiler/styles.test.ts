import { test, expect, describe } from "bun:test";
import { inlineStyle, styleAttributes } from "./styles.ts";

describe("styleAttributes", () => {
  test("returns empty string when no props are set", () => {
    expect(styleAttributes({})).toBe("");
  });

  test("emits bg and fg in order", () => {
    expect(styleAttributes({ bg: "#000", fg: "#fff" })).toBe("bg=#000 fg=#fff");
  });

  test("emits bold as a flag", () => {
    expect(styleAttributes({ bold: true })).toBe("bold");
  });

  test("omits bold when false", () => {
    expect(styleAttributes({ bold: false })).toBe("");
  });

  test("combines all three with spaces (no commas — psmux 3.3.3 conditional parser breaks on them)", () => {
    expect(styleAttributes({ bg: "blue", fg: "white", bold: true })).toBe(
      "bg=blue fg=white bold",
    );
  });
});

describe("inlineStyle", () => {
  test("returns empty string for empty props (no stray brackets)", () => {
    expect(inlineStyle({})).toBe("");
  });

  test("wraps non-empty attrs in brackets with #[ prefix", () => {
    expect(inlineStyle({ fg: "red" })).toBe("#[fg=red]");
  });
});
