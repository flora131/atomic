/**
 * Tests for src/lib/path-root-guard.ts
 *
 * Path containment guards that prevent directory traversal:
 * - isPathWithinRoot: synchronous check
 * - assertPathWithinRoot: synchronous check that throws
 * - assertRealPathWithinRoot: async check resolving symlinks via realpath
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtemp, symlink, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  isPathWithinRoot,
  assertPathWithinRoot,
  assertRealPathWithinRoot,
} from "@/lib/path-root-guard.ts";

// --- isPathWithinRoot ---

describe("isPathWithinRoot", () => {
  test("returns true when candidate equals root", () => {
    expect(isPathWithinRoot("/home/user/project", "/home/user/project")).toBe(true);
  });

  test("returns true for a child path within root", () => {
    expect(isPathWithinRoot("/home/user/project", "/home/user/project/src/index.ts")).toBe(true);
  });

  test("returns true for a nested subdirectory", () => {
    expect(isPathWithinRoot("/home/user/project", "/home/user/project/a/b/c/d")).toBe(true);
  });

  test("returns false when path escapes root with ..", () => {
    expect(isPathWithinRoot("/home/user/project", "/home/user/project/../other")).toBe(false);
  });

  test("returns false for an absolute path outside root", () => {
    expect(isPathWithinRoot("/home/user/project", "/etc/passwd")).toBe(false);
  });

  test("returns false for sibling directory", () => {
    expect(isPathWithinRoot("/home/user/project", "/home/user/other-project")).toBe(false);
  });

  test("handles relative paths by resolving against cwd", () => {
    // Both relative paths resolve to the same place
    expect(isPathWithinRoot(".", "./src")).toBe(true);
  });
});

// --- assertPathWithinRoot ---

describe("assertPathWithinRoot", () => {
  test("does not throw for a valid path within root", () => {
    expect(() =>
      assertPathWithinRoot("/home/user/project", "/home/user/project/file.ts", "TestFile"),
    ).not.toThrow();
  });

  test("throws with correct message when path escapes root", () => {
    const candidate = "/home/user/project/../secret";
    expect(() =>
      assertPathWithinRoot("/home/user/project", candidate, "ConfigFile"),
    ).toThrow("ConfigFile escapes allowed root: /home/user/project/../secret");
  });

  test("throws with the label in the error message", () => {
    expect(() =>
      assertPathWithinRoot("/a", "/b", "MyLabel"),
    ).toThrow(/MyLabel/);
  });
});

// --- assertRealPathWithinRoot ---

describe("assertRealPathWithinRoot", () => {
  let tempRoot: string;
  let outsideDir: string;

  // Create real temp directories for realpath-based tests
  const setup = async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "guard-root-"));
    outsideDir = await mkdtemp(join(tmpdir(), "guard-outside-"));
    await mkdir(join(tempRoot, "subdir"), { recursive: true });
    await writeFile(join(tempRoot, "subdir", "file.txt"), "hello");
    await writeFile(join(outsideDir, "secret.txt"), "secret");
  };

  const cleanup = async () => {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  };

  test("resolves and returns path for a valid file within root", async () => {
    await setup();
    try {
      const result = await assertRealPathWithinRoot(
        tempRoot,
        join(tempRoot, "subdir", "file.txt"),
        "DataFile",
      );
      expect(result).toContain("file.txt");
      expect(result).toContain("subdir");
    } finally {
      await cleanup();
    }
  });

  test("throws when resolved path escapes root via symlink", async () => {
    await setup();
    try {
      // Create a symlink inside tempRoot that points outside
      const symlinkPath = join(tempRoot, "escape-link");
      await symlink(join(outsideDir, "secret.txt"), symlinkPath);

      await expect(
        assertRealPathWithinRoot(tempRoot, symlinkPath, "SymlinkFile"),
      ).rejects.toThrow("SymlinkFile resolves outside allowed root");
    } finally {
      await cleanup();
    }
  });

  test("returns the resolved real path on success", async () => {
    await setup();
    try {
      const filePath = join(tempRoot, "subdir", "file.txt");
      const result = await assertRealPathWithinRoot(tempRoot, filePath, "Test");
      // The returned path should be an absolute resolved path
      expect(result).toBe(filePath);
    } finally {
      await cleanup();
    }
  });

  test("throws when candidate path is completely outside root", async () => {
    await setup();
    try {
      await expect(
        assertRealPathWithinRoot(tempRoot, join(outsideDir, "secret.txt"), "External"),
      ).rejects.toThrow("External resolves outside allowed root");
    } finally {
      await cleanup();
    }
  });
});
