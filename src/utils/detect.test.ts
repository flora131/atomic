/**
 * Tests for platform detection utilities in detect.ts
 */
import { describe, expect, test } from "bun:test";
import {
  isWindows,
  isMacOS,
  isLinux,
  getScriptExtension,
  getOppositeScriptExtension,
} from "./detect.ts";

describe("Platform Detection", () => {
  test("should detect exactly one platform as true", () => {
    // Ensure mutual exclusivity - exactly one platform should be detected
    const platforms = [isWindows(), isMacOS(), isLinux()];
    const trueCount = platforms.filter((p) => p === true).length;
    
    expect(trueCount).toBe(1);
  });

  test("should detect Linux platform in this environment", () => {
    // We're running on Linux according to the environment context
    expect(isLinux()).toBe(true);
    expect(isWindows()).toBe(false);
    expect(isMacOS()).toBe(false);
  });

  test("should detect correct platform based on process.platform", () => {
    // Test that detection functions return correct values based on actual platform
    const platform = process.platform;

    if (platform === "linux") {
      expect(isLinux()).toBe(true);
      expect(isWindows()).toBe(false);
      expect(isMacOS()).toBe(false);
    } else if (platform === "win32") {
      expect(isWindows()).toBe(true);
      expect(isLinux()).toBe(false);
      expect(isMacOS()).toBe(false);
    } else if (platform === "darwin") {
      expect(isMacOS()).toBe(true);
      expect(isWindows()).toBe(false);
      expect(isLinux()).toBe(false);
    }
  });

  test("should return .sh extension on Linux", () => {
    // On Linux (current environment), script extension should be .sh
    expect(getScriptExtension()).toBe(".sh");
  });

  test("should return correct script extension for current platform", () => {
    const extension = getScriptExtension();
    
    if (isWindows()) {
      expect(extension).toBe(".ps1");
    } else {
      // Unix-like systems (Linux, macOS)
      expect(extension).toBe(".sh");
    }
  });

  test("should return opposite script extension", () => {
    const extension = getScriptExtension();
    const opposite = getOppositeScriptExtension();
    
    // Opposite should be different from the current
    expect(extension).not.toBe(opposite);
    
    // If current is .sh, opposite should be .ps1 and vice versa
    if (extension === ".sh") {
      expect(opposite).toBe(".ps1");
    } else {
      expect(opposite).toBe(".sh");
    }
  });
});
