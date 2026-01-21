import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";

import {
  tryRemoveFile,
  cleanupLeftoverFilesAt,
  cleanupWindowsLeftoverFiles,
} from "../src/utils/cleanup";
import { isWindows } from "../src/utils/detect";

describe("tryRemoveFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `atomic-cleanup-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("returns true for non-existent file", async () => {
    const nonExistentFile = join(tempDir, "does-not-exist.txt");
    const result = await tryRemoveFile(nonExistentFile);
    expect(result).toBe(true);
  });

  test("removes existing file and returns true", async () => {
    const testFile = join(tempDir, "test-file.txt");
    writeFileSync(testFile, "test content");
    expect(existsSync(testFile)).toBe(true);

    const result = await tryRemoveFile(testFile);

    expect(result).toBe(true);
    expect(existsSync(testFile)).toBe(false);
  });

  test("handles errors gracefully", async () => {
    // Try to remove a file in a non-existent directory
    const badPath = join("/nonexistent-dir-12345", "file.txt");

    // Should not throw and should return true (file doesn't exist)
    const result = await tryRemoveFile(badPath);
    expect(result).toBe(true);
  });
});

describe("cleanupLeftoverFilesAt", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `atomic-cleanup-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("removes .delete file", async () => {
    const binaryPath = join(tempDir, "atomic");
    const deletePath = binaryPath + ".delete";

    writeFileSync(deletePath, "old binary content");
    expect(existsSync(deletePath)).toBe(true);

    await cleanupLeftoverFilesAt(binaryPath);

    expect(existsSync(deletePath)).toBe(false);
  });

  test("removes .old file", async () => {
    const binaryPath = join(tempDir, "atomic");
    const oldPath = binaryPath + ".old";

    writeFileSync(oldPath, "old binary content");
    expect(existsSync(oldPath)).toBe(true);

    await cleanupLeftoverFilesAt(binaryPath);

    expect(existsSync(oldPath)).toBe(false);
  });

  test("removes both .delete and .old files", async () => {
    const binaryPath = join(tempDir, "atomic");
    const deletePath = binaryPath + ".delete";
    const oldPath = binaryPath + ".old";

    writeFileSync(deletePath, "delete content");
    writeFileSync(oldPath, "old content");
    expect(existsSync(deletePath)).toBe(true);
    expect(existsSync(oldPath)).toBe(true);

    await cleanupLeftoverFilesAt(binaryPath);

    expect(existsSync(deletePath)).toBe(false);
    expect(existsSync(oldPath)).toBe(false);
  });

  test("does not throw when files do not exist", async () => {
    const binaryPath = join(tempDir, "atomic");

    // No files created - should not throw
    await expect(cleanupLeftoverFilesAt(binaryPath)).resolves.toBeUndefined();
  });

  test("does not affect other files", async () => {
    const binaryPath = join(tempDir, "atomic");
    const otherFile = join(tempDir, "other-file.txt");

    writeFileSync(otherFile, "should remain");

    await cleanupLeftoverFilesAt(binaryPath);

    expect(existsSync(otherFile)).toBe(true);
  });
});

describe("cleanupWindowsLeftoverFiles", () => {
  test("is a no-op on non-Windows platforms", async () => {
    if (!isWindows()) {
      // On non-Windows, this should complete without doing anything
      await expect(cleanupWindowsLeftoverFiles()).resolves.toBeUndefined();
    }
  });

  test("function is exported and callable", async () => {
    expect(typeof cleanupWindowsLeftoverFiles).toBe("function");
    // Should not throw regardless of platform
    await expect(cleanupWindowsLeftoverFiles()).resolves.toBeUndefined();
  });
});

describe("cleanup module exports", () => {
  test("tryRemoveFile is exported", () => {
    expect(typeof tryRemoveFile).toBe("function");
  });

  test("cleanupLeftoverFilesAt is exported", () => {
    expect(typeof cleanupLeftoverFilesAt).toBe("function");
  });

  test("cleanupWindowsLeftoverFiles is exported", () => {
    expect(typeof cleanupWindowsLeftoverFiles).toBe("function");
  });
});
