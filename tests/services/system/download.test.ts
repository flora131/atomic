/**
 * Tests for download utilities in download.ts
 *
 * Focuses on getBinaryFilename() and its __ATOMIC_BASELINE__ behavior.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  getBinaryFilename,
  parseChecksums,
  getDownloadUrl,
  getChecksumsUrl,
  getConfigArchiveFilename,
} from "@/services/system/download.ts";

declare global {
  var __ATOMIC_BASELINE__: boolean | undefined;
}

const originalBaseline = globalThis.__ATOMIC_BASELINE__;

afterEach(() => {
  globalThis.__ATOMIC_BASELINE__ = originalBaseline;
});

describe("getBinaryFilename", () => {
  test("should return a filename matching the current platform and architecture", () => {
    const filename = getBinaryFilename();

    // Should start with "atomic-"
    expect(filename.startsWith("atomic-")).toBe(true);

    // Should contain platform name
    const platform = process.platform;
    if (platform === "darwin") {
      expect(filename).toContain("darwin");
    } else if (platform === "linux") {
      expect(filename).toContain("linux");
    } else if (platform === "win32") {
      expect(filename).toContain("windows");
    }

    // Should contain architecture
    const arch = process.arch;
    if (arch === "x64") {
      expect(filename).toContain("x64");
    } else if (arch === "arm64") {
      expect(filename).toContain("arm64");
    }
  });

  test("should include .exe extension only on Windows", () => {
    const filename = getBinaryFilename();
    if (process.platform === "win32") {
      expect(filename.endsWith(".exe")).toBe(true);
    } else {
      expect(filename.endsWith(".exe")).toBe(false);
    }
  });

  test("should not include -baseline suffix in standard builds (no __ATOMIC_BASELINE__ defined)", () => {
    // In a standard build, __ATOMIC_BASELINE__ is not defined via build-time replacement,
    // so the typeof guard should prevent a ReferenceError and baselineSuffix should be ""
    const filename = getBinaryFilename();
    expect(filename).not.toContain("-baseline");
  });

  test("should map Windows baseline builds to the arm64 release asset name", () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
    if (!descriptor?.configurable) {
      return;
    }

    globalThis.__ATOMIC_BASELINE__ = true;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
      expect(getBinaryFilename()).toBe("atomic-windows-arm64.exe");
    } finally {
      Object.defineProperty(process, "platform", descriptor);
    }
  });

  test("should produce correct filename format for current platform", () => {
    const filename = getBinaryFilename();
    const platform = process.platform;
    const arch = process.arch;

    let expectedOs: string;
    if (platform === "linux") expectedOs = "linux";
    else if (platform === "darwin") expectedOs = "darwin";
    else if (platform === "win32") expectedOs = "windows";
    else throw new Error(`Test not configured for platform: ${platform}`);

    let expectedArch: string;
    if (arch === "x64") expectedArch = "x64";
    else if (arch === "arm64") expectedArch = "arm64";
    else throw new Error(`Test not configured for architecture: ${arch}`);

    const ext = platform === "win32" ? ".exe" : "";
    const expected = `atomic-${expectedOs}-${expectedArch}${ext}`;
    expect(filename).toBe(expected);
  });
});

describe("parseChecksums", () => {
  test("should parse standard checksums.txt format", () => {
    // SHA-256 hashes are exactly 64 hex characters
    const hash1 = "a".repeat(64);
    const hash2 = "b".repeat(64);
    const input = [`${hash1}  atomic-linux-x64`, `${hash2}  atomic-darwin-arm64`].join("\n");

    const checksums = parseChecksums(input);
    expect(checksums.size).toBe(2);
    expect(checksums.get("atomic-linux-x64")).toBe(hash1);
    expect(checksums.get("atomic-darwin-arm64")).toBe(hash2);
  });

  test("should return empty map for empty input", () => {
    const checksums = parseChecksums("");
    expect(checksums.size).toBe(0);
  });

  test("should handle single entry", () => {
    const hash = "abcdef01".repeat(8); // 64 hex chars
    const input = `${hash}  myfile.txt`;
    const checksums = parseChecksums(input);
    expect(checksums.size).toBe(1);
    expect(checksums.get("myfile.txt")).toBe(hash);
  });

  test("should skip malformed lines", () => {
    const validHash = "abcdef01".repeat(8); // 64 hex chars
    const input = [
      `${validHash}  valid-file`,
      "not-a-valid-line",
      "too-short  file.txt",
    ].join("\n");

    const checksums = parseChecksums(input);
    expect(checksums.size).toBe(1);
    expect(checksums.has("valid-file")).toBe(true);
  });
});

describe("getDownloadUrl", () => {
  test("should build correct URL with v prefix", () => {
    const url = getDownloadUrl("v0.2.0", "atomic-linux-x64");
    expect(url).toContain("/releases/download/v0.2.0/atomic-linux-x64");
  });

  test("should add v prefix if missing", () => {
    const url = getDownloadUrl("0.2.0", "atomic-linux-x64");
    expect(url).toContain("/releases/download/v0.2.0/atomic-linux-x64");
  });

  test("should not double the v prefix", () => {
    const url = getDownloadUrl("v0.2.0", "myfile");
    expect(url).not.toContain("vv0.2.0");
  });
});

describe("getChecksumsUrl", () => {
  test("should build correct checksums URL", () => {
    const url = getChecksumsUrl("v0.2.0");
    expect(url).toContain("/releases/download/v0.2.0/checksums.txt");
  });
});

describe("getConfigArchiveFilename", () => {
  test("should return zip for Windows and tar.gz for Unix", () => {
    const filename = getConfigArchiveFilename();
    if (process.platform === "win32") {
      expect(filename).toBe("atomic-config.zip");
    } else {
      expect(filename).toBe("atomic-config.tar.gz");
    }
  });
});
