import { test, expect, describe } from "bun:test";
import { hexToRgb, rgbToHex, lerpColor } from "../../src/components/color-utils.ts";

describe("hexToRgb", () => {
  test("converts black", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
  });

  test("converts white", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
  });

  test("converts red", () => {
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
  });

  test("converts green", () => {
    expect(hexToRgb("#00ff00")).toEqual([0, 255, 0]);
  });

  test("converts blue", () => {
    expect(hexToRgb("#0000ff")).toEqual([0, 0, 255]);
  });

  test("converts arbitrary color", () => {
    expect(hexToRgb("#1e1e2e")).toEqual([30, 30, 46]);
  });

  test("handles uppercase hex", () => {
    expect(hexToRgb("#AABBCC")).toEqual([170, 187, 204]);
  });
});

describe("rgbToHex", () => {
  test("converts black", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
  });

  test("converts white", () => {
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
  });

  test("converts red", () => {
    expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
  });

  test("converts arbitrary color", () => {
    expect(rgbToHex(30, 30, 46)).toBe("#1e1e2e");
  });

  test("roundtrips with hexToRgb", () => {
    const hex = "#89b4fa";
    const [r, g, b] = hexToRgb(hex);
    expect(rgbToHex(r, g, b)).toBe(hex);
  });
});

describe("lerpColor", () => {
  test("returns first color at t=0", () => {
    expect(lerpColor("#000000", "#ffffff", 0)).toBe("#000000");
  });

  test("returns second color at t=1", () => {
    expect(lerpColor("#000000", "#ffffff", 1)).toBe("#ffffff");
  });

  test("returns midpoint at t=0.5", () => {
    // (0+255)/2 = 127.5 → rounds to 128 = 0x80
    expect(lerpColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  test("interpolates channels independently", () => {
    const result = lerpColor("#ff0000", "#00ff00", 0.5);
    const rgb = hexToRgb(result);
    expect(rgb[0]).toBe(128); // midpoint of 255 and 0
    expect(rgb[1]).toBe(128); // midpoint of 0 and 255
    expect(rgb[2]).toBe(0);   // both channels are 0
  });

  test("works with non-trivial colors", () => {
    // lerp between Catppuccin text (#cdd6f4) and bg (#1e1e2e) at t=0.3
    const result = lerpColor("#cdd6f4", "#1e1e2e", 0.3);
    const rgb = hexToRgb(result);
    // r: 205 + (30-205)*0.3 = 205 - 52.5 = 152.5 → 153
    expect(rgb[0]).toBe(153);
  });
});
