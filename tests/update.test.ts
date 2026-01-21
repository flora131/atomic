import { test, expect, describe } from "bun:test";
import { isNewerVersion } from "../src/commands/update";

describe("isNewerVersion", () => {
  describe("major version differences", () => {
    test("returns true when major version is greater", () => {
      expect(isNewerVersion("2.0.0", "1.0.0")).toBe(true);
      expect(isNewerVersion("10.0.0", "9.0.0")).toBe(true);
    });

    test("returns false when major version is less", () => {
      expect(isNewerVersion("1.0.0", "2.0.0")).toBe(false);
      expect(isNewerVersion("9.0.0", "10.0.0")).toBe(false);
    });
  });

  describe("minor version differences", () => {
    test("returns true when minor version is greater (same major)", () => {
      expect(isNewerVersion("1.2.0", "1.1.0")).toBe(true);
      expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
    });

    test("returns false when minor version is less (same major)", () => {
      expect(isNewerVersion("1.1.0", "1.2.0")).toBe(false);
      expect(isNewerVersion("1.9.0", "1.10.0")).toBe(false);
    });
  });

  describe("patch version differences", () => {
    test("returns true when patch version is greater (same major.minor)", () => {
      expect(isNewerVersion("1.0.2", "1.0.1")).toBe(true);
      expect(isNewerVersion("1.0.10", "1.0.9")).toBe(true);
    });

    test("returns false when patch version is less (same major.minor)", () => {
      expect(isNewerVersion("1.0.1", "1.0.2")).toBe(false);
      expect(isNewerVersion("1.0.9", "1.0.10")).toBe(false);
    });
  });

  describe("equal versions", () => {
    test("returns false when versions are equal", () => {
      expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
      expect(isNewerVersion("2.5.3", "2.5.3")).toBe(false);
      expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    });
  });

  describe("v prefix handling", () => {
    test("handles v prefix on first version", () => {
      expect(isNewerVersion("v2.0.0", "1.0.0")).toBe(true);
      expect(isNewerVersion("v1.0.0", "2.0.0")).toBe(false);
    });

    test("handles v prefix on second version", () => {
      expect(isNewerVersion("2.0.0", "v1.0.0")).toBe(true);
      expect(isNewerVersion("1.0.0", "v2.0.0")).toBe(false);
    });

    test("handles v prefix on both versions", () => {
      expect(isNewerVersion("v2.0.0", "v1.0.0")).toBe(true);
      expect(isNewerVersion("v1.0.0", "v2.0.0")).toBe(false);
      expect(isNewerVersion("v1.0.0", "v1.0.0")).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("handles versions with leading zeros", () => {
      // "01" should be parsed as 1
      expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    });

    test("handles versions starting with 0", () => {
      expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
      expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
      expect(isNewerVersion("0.0.2", "0.0.1")).toBe(true);
    });

    test("handles typical atomic versions", () => {
      expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
      expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
      expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    });

    test("major version takes precedence over minor and patch", () => {
      expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
      expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
    });

    test("minor version takes precedence over patch", () => {
      expect(isNewerVersion("1.1.0", "1.0.99")).toBe(true);
    });
  });
});

describe("update command exports", () => {
  test("updateCommand is exported", async () => {
    const { updateCommand } = await import("../src/commands/update");
    expect(typeof updateCommand).toBe("function");
  });
});
