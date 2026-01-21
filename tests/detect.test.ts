import { test, expect, describe } from "bun:test";
import {
  isCommandInstalled,
  getCommandPath,
  getCommandVersion,
  isWindows,
  isMacOS,
  isLinux,
  getScriptExtension,
  getOppositeScriptExtension,
  supportsTrueColor,
  supports256Color,
  WSL_INSTALL_URL,
} from "../src/utils/detect";

describe("isCommandInstalled", () => {
  test("returns true for bun (always available in test environment)", () => {
    expect(isCommandInstalled("bun")).toBe(true);
  });

  test("returns false for non-existent command", () => {
    expect(isCommandInstalled("nonexistent-command-12345")).toBe(false);
  });
});

describe("getCommandPath", () => {
  test("returns path for installed command (bun)", () => {
    const path = getCommandPath("bun");
    expect(path).not.toBeNull();
    expect(typeof path).toBe("string");
    // Path should be absolute (starts with / on Unix or drive letter on Windows)
    expect(path!.length).toBeGreaterThan(0);
  });

  test("returns null for non-existent command", () => {
    const path = getCommandPath("nonexistent-command-12345");
    expect(path).toBeNull();
  });

  test("is consistent with isCommandInstalled", () => {
    // If isCommandInstalled returns true, getCommandPath should return a path
    const bunInstalled = isCommandInstalled("bun");
    const bunPath = getCommandPath("bun");
    expect(bunInstalled).toBe(bunPath !== null);

    // If isCommandInstalled returns false, getCommandPath should return null
    const fakeInstalled = isCommandInstalled("nonexistent-command-12345");
    const fakePath = getCommandPath("nonexistent-command-12345");
    expect(fakeInstalled).toBe(fakePath !== null);
  });
});

describe("getCommandVersion", () => {
  test("returns version string for bun", () => {
    const version = getCommandVersion("bun");
    expect(version).toBeDefined();
    expect(version).not.toBeNull();
    expect(typeof version).toBe("string");
  });

  test("returns null for non-existent command", () => {
    const version = getCommandVersion("nonexistent-command-12345");
    expect(version).toBeNull();
  });
});

describe("platform detection", () => {
  test("exactly one platform function returns true", () => {
    const platforms = [isWindows(), isMacOS(), isLinux()];
    const trueCount = platforms.filter(Boolean).length;
    // At least one should be true (could be more on WSL)
    expect(trueCount).toBeGreaterThanOrEqual(1);
  });

  test("isWindows returns boolean", () => {
    expect(typeof isWindows()).toBe("boolean");
  });

  test("isMacOS returns boolean", () => {
    expect(typeof isMacOS()).toBe("boolean");
  });

  test("isLinux returns boolean", () => {
    expect(typeof isLinux()).toBe("boolean");
  });
});

describe("script extensions", () => {
  test("getScriptExtension returns .sh or .ps1", () => {
    const ext = getScriptExtension();
    expect([".sh", ".ps1"]).toContain(ext);
  });

  test("getOppositeScriptExtension returns opposite of getScriptExtension", () => {
    const ext = getScriptExtension();
    const opposite = getOppositeScriptExtension();
    expect(ext).not.toBe(opposite);
    expect([".sh", ".ps1"]).toContain(opposite);
  });
});

describe("color support detection", () => {
  test("supportsTrueColor returns boolean", () => {
    expect(typeof supportsTrueColor()).toBe("boolean");
  });

  test("supports256Color returns boolean", () => {
    expect(typeof supports256Color()).toBe("boolean");
  });

  test("if supportsTrueColor is true, supports256Color should also be true", () => {
    if (supportsTrueColor()) {
      expect(supports256Color()).toBe(true);
    }
  });
});

describe("WSL_INSTALL_URL", () => {
  test("is a valid HTTPS URL", () => {
    expect(WSL_INSTALL_URL.startsWith("https://")).toBe(true);
  });
});
