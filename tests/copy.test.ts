import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdir, rm, writeFile, readdir } from "fs/promises";
import { copyFile, copyDir, pathExists, isDirectory } from "../src/utils/copy";

const TEST_DIR = join(import.meta.dir, ".test-copy-temp");
const SRC_DIR = join(TEST_DIR, "src");
const DEST_DIR = join(TEST_DIR, "dest");

beforeEach(async () => {
  // Create test directories
  await mkdir(SRC_DIR, { recursive: true });
  await mkdir(DEST_DIR, { recursive: true });
});

afterEach(async () => {
  // Clean up test directories
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("copyFile", () => {
  test("copies a file to destination", async () => {
    const srcFile = join(SRC_DIR, "test.txt");
    const destFile = join(DEST_DIR, "test.txt");

    await writeFile(srcFile, "hello world");
    await copyFile(srcFile, destFile);

    const content = await Bun.file(destFile).text();
    expect(content).toBe("hello world");
  });

  test("overwrites existing file", async () => {
    const srcFile = join(SRC_DIR, "test.txt");
    const destFile = join(DEST_DIR, "test.txt");

    await writeFile(srcFile, "new content");
    await writeFile(destFile, "old content");
    await copyFile(srcFile, destFile);

    const content = await Bun.file(destFile).text();
    expect(content).toBe("new content");
  });
});

describe("copyDir", () => {
  test("copies directory structure", async () => {
    // Create source structure
    await mkdir(join(SRC_DIR, "subdir"), { recursive: true });
    await writeFile(join(SRC_DIR, "file1.txt"), "content1");
    await writeFile(join(SRC_DIR, "subdir", "file2.txt"), "content2");

    await copyDir(SRC_DIR, DEST_DIR);

    expect(await pathExists(join(DEST_DIR, "file1.txt"))).toBe(true);
    expect(await pathExists(join(DEST_DIR, "subdir", "file2.txt"))).toBe(true);

    const content1 = await Bun.file(join(DEST_DIR, "file1.txt")).text();
    const content2 = await Bun.file(join(DEST_DIR, "subdir", "file2.txt")).text();
    expect(content1).toBe("content1");
    expect(content2).toBe("content2");
  });

  test("excludes specified files", async () => {
    await writeFile(join(SRC_DIR, "include.txt"), "include");
    await writeFile(join(SRC_DIR, "exclude.txt"), "exclude");

    await copyDir(SRC_DIR, DEST_DIR, { exclude: ["exclude.txt"] });

    expect(await pathExists(join(DEST_DIR, "include.txt"))).toBe(true);
    expect(await pathExists(join(DEST_DIR, "exclude.txt"))).toBe(false);
  });

  test("excludes specified directories", async () => {
    await mkdir(join(SRC_DIR, "include"), { recursive: true });
    await mkdir(join(SRC_DIR, "exclude"), { recursive: true });
    await writeFile(join(SRC_DIR, "include", "file.txt"), "content");
    await writeFile(join(SRC_DIR, "exclude", "file.txt"), "content");

    await copyDir(SRC_DIR, DEST_DIR, { exclude: ["exclude"] });

    expect(await pathExists(join(DEST_DIR, "include", "file.txt"))).toBe(true);
    expect(await pathExists(join(DEST_DIR, "exclude"))).toBe(false);
  });

  test("skips opposite platform scripts by default", async () => {
    await writeFile(join(SRC_DIR, "script.sh"), "#!/bin/bash");
    await writeFile(join(SRC_DIR, "script.ps1"), "# PowerShell");

    await copyDir(SRC_DIR, DEST_DIR);

    const files = await readdir(DEST_DIR);
    // Should only have one script file (the one matching current platform)
    expect(files.length).toBe(1);
  });

  test("copies both scripts when skipOppositeScripts is false", async () => {
    await writeFile(join(SRC_DIR, "script.sh"), "#!/bin/bash");
    await writeFile(join(SRC_DIR, "script.ps1"), "# PowerShell");

    await copyDir(SRC_DIR, DEST_DIR, { skipOppositeScripts: false });

    const files = await readdir(DEST_DIR);
    expect(files.length).toBe(2);
    expect(files).toContain("script.sh");
    expect(files).toContain("script.ps1");
  });
});

describe("pathExists", () => {
  test("returns true for existing file", async () => {
    const filePath = join(SRC_DIR, "exists.txt");
    await writeFile(filePath, "content");
    expect(await pathExists(filePath)).toBe(true);
  });

  test("returns true for existing directory", async () => {
    expect(await pathExists(SRC_DIR)).toBe(true);
  });

  test("returns false for non-existing path", async () => {
    expect(await pathExists(join(SRC_DIR, "nonexistent"))).toBe(false);
  });
});

describe("isDirectory", () => {
  test("returns true for directory", async () => {
    expect(await isDirectory(SRC_DIR)).toBe(true);
  });

  test("returns false for file", async () => {
    const filePath = join(SRC_DIR, "file.txt");
    await writeFile(filePath, "content");
    expect(await isDirectory(filePath)).toBe(false);
  });

  test("returns false for non-existing path", async () => {
    expect(await isDirectory(join(SRC_DIR, "nonexistent"))).toBe(false);
  });
});
