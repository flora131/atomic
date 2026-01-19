import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join, sep } from "path";
import { mkdir, rm, writeFile, readdir, symlink } from "fs/promises";
import { copyDir, pathExists } from "../src/utils/copy";

const TEST_DIR = join(import.meta.dir, ".test-copy-extended-temp");
const SRC_DIR = join(TEST_DIR, "src");
const DEST_DIR = join(TEST_DIR, "dest");

beforeEach(async () => {
  await mkdir(SRC_DIR, { recursive: true });
  await mkdir(DEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("copyDir with nested paths", () => {
  test("handles deeply nested directory structures", async () => {
    // Create a deeply nested structure
    const deepPath = join(SRC_DIR, "a", "b", "c", "d");
    await mkdir(deepPath, { recursive: true });
    await writeFile(join(deepPath, "deep.txt"), "deep content");

    await copyDir(SRC_DIR, DEST_DIR);

    expect(await pathExists(join(DEST_DIR, "a", "b", "c", "d", "deep.txt"))).toBe(true);
    const content = await Bun.file(join(DEST_DIR, "a", "b", "c", "d", "deep.txt")).text();
    expect(content).toBe("deep content");
  });

  test("excludes nested paths correctly", async () => {
    await mkdir(join(SRC_DIR, "keep", "nested"), { recursive: true });
    await mkdir(join(SRC_DIR, "skip", "nested"), { recursive: true });
    await writeFile(join(SRC_DIR, "keep", "nested", "file.txt"), "keep");
    await writeFile(join(SRC_DIR, "skip", "nested", "file.txt"), "skip");

    await copyDir(SRC_DIR, DEST_DIR, { exclude: ["skip"] });

    expect(await pathExists(join(DEST_DIR, "keep", "nested", "file.txt"))).toBe(true);
    expect(await pathExists(join(DEST_DIR, "skip"))).toBe(false);
  });

  test("handles paths with special characters", async () => {
    const specialDir = join(SRC_DIR, "folder-with-dash");
    await mkdir(specialDir, { recursive: true });
    await writeFile(join(specialDir, "file_underscore.txt"), "content");

    await copyDir(SRC_DIR, DEST_DIR);

    expect(await pathExists(join(DEST_DIR, "folder-with-dash", "file_underscore.txt"))).toBe(true);
  });

  test("handles empty directories", async () => {
    await mkdir(join(SRC_DIR, "empty-dir"), { recursive: true });
    await writeFile(join(SRC_DIR, "file.txt"), "content");

    await copyDir(SRC_DIR, DEST_DIR);

    expect(await pathExists(join(DEST_DIR, "empty-dir"))).toBe(true);
    expect(await pathExists(join(DEST_DIR, "file.txt"))).toBe(true);
  });

  test("handles multiple exclusions", async () => {
    await writeFile(join(SRC_DIR, "keep.txt"), "keep");
    await writeFile(join(SRC_DIR, "skip1.txt"), "skip");
    await writeFile(join(SRC_DIR, "skip2.txt"), "skip");

    await copyDir(SRC_DIR, DEST_DIR, { exclude: ["skip1.txt", "skip2.txt"] });

    expect(await pathExists(join(DEST_DIR, "keep.txt"))).toBe(true);
    expect(await pathExists(join(DEST_DIR, "skip1.txt"))).toBe(false);
    expect(await pathExists(join(DEST_DIR, "skip2.txt"))).toBe(false);
  });

  test("parallel copying completes all files", async () => {
    // Create many files to test parallel copying
    const fileCount = 20;
    for (let i = 0; i < fileCount; i++) {
      await writeFile(join(SRC_DIR, `file${i}.txt`), `content ${i}`);
    }

    await copyDir(SRC_DIR, DEST_DIR);

    const destFiles = await readdir(DEST_DIR);
    expect(destFiles.length).toBe(fileCount);

    // Verify each file has correct content
    for (let i = 0; i < fileCount; i++) {
      const content = await Bun.file(join(DEST_DIR, `file${i}.txt`)).text();
      expect(content).toBe(`content ${i}`);
    }
  });
});

describe("copyDir symlink handling", () => {
  test("dereferences symlinks and copies target content", async () => {
    // Create a target file
    await writeFile(join(SRC_DIR, "target.txt"), "target content");

    // Create a symlink pointing to the target
    await symlink("target.txt", join(SRC_DIR, "link.txt"));

    await copyDir(SRC_DIR, DEST_DIR);

    // Both files should exist in destination
    expect(await pathExists(join(DEST_DIR, "target.txt"))).toBe(true);
    expect(await pathExists(join(DEST_DIR, "link.txt"))).toBe(true);

    // Symlink should be copied as a regular file with the target's content
    const linkContent = await Bun.file(join(DEST_DIR, "link.txt")).text();
    expect(linkContent).toBe("target content");
  });
});

describe("copyDir error handling", () => {
  test("throws error when source does not exist", async () => {
    const nonExistentSrc = join(TEST_DIR, "non-existent");

    await expect(copyDir(nonExistentSrc, DEST_DIR)).rejects.toThrow();
  });
});
