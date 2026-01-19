import { test, expect, describe } from "bun:test";
import {
  parseRgb,
  rgbToAnsi,
  rgbToAnsiBg,
  colorize,
  htmlToAnsi,
  stripAnsi,
  visibleWidth,
} from "../src/utils/html-to-ansi";

describe("parseRgb", () => {
  test("parses valid rgb style", () => {
    expect(parseRgb("color: rgb(255, 128, 0)")).toEqual([255, 128, 0]);
  });

  test("parses rgb without spaces", () => {
    expect(parseRgb("color: rgb(0,0,0)")).toEqual([0, 0, 0]);
  });

  test("parses rgb with extra spaces", () => {
    expect(parseRgb("color: rgb(255,  128,   0)")).toEqual([255, 128, 0]);
  });

  test("returns null for invalid style", () => {
    expect(parseRgb("color: blue")).toBeNull();
    expect(parseRgb("")).toBeNull();
    expect(parseRgb(null)).toBeNull();
  });

  test("handles max values", () => {
    expect(parseRgb("color: rgb(255, 255, 255)")).toEqual([255, 255, 255]);
  });

  test("handles zero values", () => {
    expect(parseRgb("color: rgb(0, 0, 0)")).toEqual([0, 0, 0]);
  });
});

describe("rgbToAnsi", () => {
  test("converts to foreground ANSI code", () => {
    expect(rgbToAnsi(255, 0, 0)).toBe("\x1b[38;2;255;0;0m");
    expect(rgbToAnsi(0, 255, 0)).toBe("\x1b[38;2;0;255;0m");
    expect(rgbToAnsi(0, 0, 255)).toBe("\x1b[38;2;0;0;255m");
  });
});

describe("rgbToAnsiBg", () => {
  test("converts to background ANSI code", () => {
    expect(rgbToAnsiBg(255, 0, 0)).toBe("\x1b[48;2;255;0;0m");
    expect(rgbToAnsiBg(0, 255, 0)).toBe("\x1b[48;2;0;255;0m");
    expect(rgbToAnsiBg(0, 0, 255)).toBe("\x1b[48;2;0;0;255m");
  });
});

describe("colorize", () => {
  test("wraps text with ANSI codes", () => {
    const result = colorize("hello", 255, 0, 0);
    expect(result).toContain("hello");
    expect(result.startsWith("\x1b[38;2;255;0;0m")).toBe(true);
    expect(result.endsWith("\x1b[0m")).toBe(true);
  });
});

describe("htmlToAnsi", () => {
  test("converts span with color to ANSI", () => {
    const html = '<span style="color: rgb(255, 0, 0)">X</span>';
    const result = htmlToAnsi(html);
    expect(result).toContain("X");
    expect(result).toContain("\x1b[38;2;255;0;0m");
  });

  test("handles multiple spans", () => {
    const html =
      '<span style="color: rgb(255, 0, 0)">R</span><span style="color: rgb(0, 255, 0)">G</span>';
    const result = htmlToAnsi(html);
    expect(stripAnsi(result)).toBe("RG");
  });

  test("handles br tags as newlines", () => {
    const html = "A<br>B<br/>C";
    const result = htmlToAnsi(html);
    expect(result).toBe("A\nB\nC");
  });

  test("preserves plain text", () => {
    const html = "Hello World";
    const result = htmlToAnsi(html);
    expect(result).toBe("Hello World");
  });

  test("handles empty spans", () => {
    const html = '<span style="color: rgb(255, 0, 0)"></span>';
    const result = htmlToAnsi(html);
    expect(result).toBe("");
  });

  test("handles spans without style", () => {
    const html = "<span>text</span>";
    const result = htmlToAnsi(html);
    expect(result).toBe("text");
  });
});

describe("stripAnsi", () => {
  test("removes ANSI codes from string", () => {
    const colored = "\x1b[38;2;255;0;0mhello\x1b[0m";
    expect(stripAnsi(colored)).toBe("hello");
  });

  test("handles string without ANSI codes", () => {
    expect(stripAnsi("hello")).toBe("hello");
  });

  test("handles multiple ANSI codes", () => {
    const colored =
      "\x1b[38;2;255;0;0mred\x1b[0m \x1b[38;2;0;255;0mgreen\x1b[0m";
    expect(stripAnsi(colored)).toBe("red green");
  });
});

describe("visibleWidth", () => {
  test("returns length of plain string", () => {
    expect(visibleWidth("hello")).toBe(5);
  });

  test("ignores ANSI codes in length calculation", () => {
    const colored = "\x1b[38;2;255;0;0mhello\x1b[0m";
    expect(visibleWidth(colored)).toBe(5);
  });

  test("handles empty string", () => {
    expect(visibleWidth("")).toBe(0);
  });
});
