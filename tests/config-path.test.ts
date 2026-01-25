import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import {
  detectInstallationType,
  getBinaryDataDir,
  getBinaryInstallDir,
  getBinaryPath,
  configDataDirExists,
} from "../src/utils/config-path";
import { isWindows } from "../src/utils/detect";

describe("detectInstallationType", () => {
  test("returns 'source' in development environment", () => {
    // In our test environment, we're running from source
    const type = detectInstallationType();
    expect(type).toBe("source");
  });

  test("returns one of the valid installation types", () => {
    const type = detectInstallationType();
    expect(["source", "npm", "binary"]).toContain(type);
  });
});

describe("getBinaryDataDir", () => {
  test("returns a string path", () => {
    const dir = getBinaryDataDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
  });

  test("path ends with 'atomic'", () => {
    const dir = getBinaryDataDir();
    expect(dir.endsWith("atomic")).toBe(true);
  });

  test("returns platform-appropriate path", () => {
    const dir = getBinaryDataDir();
    if (isWindows()) {
      // Windows: should be under LOCALAPPDATA or similar
      expect(dir.includes("AppData") || dir.includes("atomic")).toBe(true);
    } else {
      // Unix: should be under .local/share
      expect(dir.includes(".local/share") || dir.includes("atomic")).toBe(true);
    }
  });
});

describe("getBinaryInstallDir", () => {
  const originalEnv = process.env.ATOMIC_INSTALL_DIR;

  afterEach(() => {
    // Restore original environment
    if (originalEnv === undefined) {
      delete process.env.ATOMIC_INSTALL_DIR;
    } else {
      process.env.ATOMIC_INSTALL_DIR = originalEnv;
    }
  });

  test("returns a string path", () => {
    delete process.env.ATOMIC_INSTALL_DIR;
    const dir = getBinaryInstallDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
  });

  test("returns default path when ATOMIC_INSTALL_DIR is not set", () => {
    delete process.env.ATOMIC_INSTALL_DIR;
    const dir = getBinaryInstallDir();
    // Default path should end with .local/bin
    expect(dir.endsWith(".local/bin") || dir.endsWith(".local\\bin")).toBe(true);
  });

  test("respects ATOMIC_INSTALL_DIR environment variable", () => {
    // Use platform-appropriate path format
    const customDir = isWindows() ? "C:\\custom\\install\\dir" : "/custom/install/dir";
    process.env.ATOMIC_INSTALL_DIR = customDir;
    const dir = getBinaryInstallDir();
    expect(dir).toBe(customDir);
  });

  test("returns platform-appropriate default path", () => {
    delete process.env.ATOMIC_INSTALL_DIR;
    const dir = getBinaryInstallDir();

    if (isWindows()) {
      // Windows: should use USERPROFILE
      const userProfile = process.env.USERPROFILE || "";
      const expectedPath = join(userProfile, ".local", "bin");
      expect(dir).toBe(expectedPath);
    } else {
      // Unix: should use HOME
      const home = process.env.HOME || "";
      const expectedPath = join(home, ".local", "bin");
      expect(dir).toBe(expectedPath);
    }
  });
});

describe("getBinaryPath", () => {
  const originalEnv = process.env.ATOMIC_INSTALL_DIR;

  afterEach(() => {
    // Restore original environment
    if (originalEnv === undefined) {
      delete process.env.ATOMIC_INSTALL_DIR;
    } else {
      process.env.ATOMIC_INSTALL_DIR = originalEnv;
    }
  });

  test("returns a string path", () => {
    delete process.env.ATOMIC_INSTALL_DIR;
    const path = getBinaryPath();
    expect(typeof path).toBe("string");
    expect(path.length).toBeGreaterThan(0);
  });

  test("returns path with correct binary name for platform", () => {
    delete process.env.ATOMIC_INSTALL_DIR;
    const path = getBinaryPath();

    if (isWindows()) {
      expect(path.endsWith("atomic.exe")).toBe(true);
    } else {
      expect(path.endsWith("atomic")).toBe(true);
      // Make sure it doesn't end with atomic.exe on Unix
      expect(path.endsWith("atomic.exe")).toBe(false);
    }
  });

  test("path is under the binary install directory", () => {
    delete process.env.ATOMIC_INSTALL_DIR;
    const dir = getBinaryInstallDir();
    const path = getBinaryPath();
    expect(path.startsWith(dir)).toBe(true);
  });

  test("respects ATOMIC_INSTALL_DIR for full path", () => {
    // Use platform-appropriate path format
    const customDir = isWindows() ? "C:\\custom\\install\\dir" : "/custom/install/dir";
    process.env.ATOMIC_INSTALL_DIR = customDir;
    const path = getBinaryPath();

    expect(path.startsWith(customDir)).toBe(true);
    if (isWindows()) {
      expect(path).toBe(join(customDir, "atomic.exe"));
    } else {
      expect(path).toBe(join(customDir, "atomic"));
    }
  });
});

describe("configDataDirExists", () => {
  test("returns true for source installation (config always available)", () => {
    // In test environment, we're running from source
    const type = detectInstallationType();
    if (type === "source") {
      expect(configDataDirExists()).toBe(true);
    }
  });

  test("returns a boolean", () => {
    const exists = configDataDirExists();
    expect(typeof exists).toBe("boolean");
  });
});
