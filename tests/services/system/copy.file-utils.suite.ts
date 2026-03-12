import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  copyFile,
  isDirectory,
  isFileEmpty,
  join,
  mkdtemp,
  pathExists,
  rm,
  tmpdir,
  writeFile,
  existsSync,
} from "./copy.test-support.ts";

describe("isFileEmpty", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "atomic-copy-empty-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("should return true for non-existent file", async () => {
    await expect(isFileEmpty(join(tempDir, "does-not-exist.txt"))).resolves.toBe(true);
  });

  test("should return true for empty file (0 bytes)", async () => {
    const emptyFile = join(tempDir, "empty.txt");
    await writeFile(emptyFile, "", "utf-8");
    await expect(isFileEmpty(emptyFile)).resolves.toBe(true);
  });

  test("should return true for whitespace-only file", async () => {
    const whitespaceFile = join(tempDir, "whitespace.txt");
    await writeFile(whitespaceFile, "   \n\t  \n", "utf-8");
    await expect(isFileEmpty(whitespaceFile)).resolves.toBe(true);
  });

  test("should return true for file with only newlines", async () => {
    const newlinesFile = join(tempDir, "newlines.txt");
    await writeFile(newlinesFile, "\n\n\n", "utf-8");
    await expect(isFileEmpty(newlinesFile)).resolves.toBe(true);
  });

  test("should return false for file with actual content", async () => {
    const contentFile = join(tempDir, "content.txt");
    await writeFile(contentFile, "Hello, World!", "utf-8");
    await expect(isFileEmpty(contentFile)).resolves.toBe(false);
  });

  test("should return false for large file", async () => {
    const largeFile = join(tempDir, "large.txt");
    await writeFile(largeFile, "x".repeat(2048), "utf-8");
    await expect(isFileEmpty(largeFile)).resolves.toBe(false);
  });
});

describe("copyFile", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "atomic-copy-file-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("should copy file successfully", async () => {
    const srcFile = join(tempDir, "source.txt");
    const destFile = join(tempDir, "dest.txt");
    await writeFile(srcFile, "Hello, World!", "utf-8");

    await copyFile(srcFile, destFile);

    expect(existsSync(destFile)).toBe(true);
    expect(await Bun.file(destFile).text()).toBe("Hello, World!");
  });

  test("should throw error for non-existent source", async () => {
    await expect(
      copyFile(join(tempDir, "does-not-exist.txt"), join(tempDir, "dest.txt")),
    ).rejects.toThrow("Failed to copy");
  });

  test("should overwrite existing destination file", async () => {
    const srcFile = join(tempDir, "source.txt");
    const destFile = join(tempDir, "dest.txt");
    await writeFile(srcFile, "New content", "utf-8");
    await writeFile(destFile, "Old content", "utf-8");

    await copyFile(srcFile, destFile);
    expect(await Bun.file(destFile).text()).toBe("New content");
  });

  test("should no-op when source and destination are the same file", async () => {
    const filePath = join(tempDir, "same.txt");
    await writeFile(filePath, "Hello, World!", "utf-8");

    await copyFile(filePath, filePath);
    expect(await Bun.file(filePath).text()).toBe("Hello, World!");
  });
});

describe("pathExists", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "atomic-copy-exists-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("should return true for existing file", async () => {
    const filePath = join(tempDir, "file.txt");
    await writeFile(filePath, "content", "utf-8");
    await expect(pathExists(filePath)).resolves.toBe(true);
  });

  test("should return true for existing directory", async () => {
    await expect(pathExists(tempDir)).resolves.toBe(true);
  });

  test("should return false for non-existent path", async () => {
    await expect(pathExists(join(tempDir, "does-not-exist"))).resolves.toBe(false);
  });
});

describe("isDirectory", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "atomic-copy-isdir-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("should return true for directory", async () => {
    await expect(isDirectory(tempDir)).resolves.toBe(true);
  });

  test("should return false for file", async () => {
    const filePath = join(tempDir, "file.txt");
    await writeFile(filePath, "content", "utf-8");
    await expect(isDirectory(filePath)).resolves.toBe(false);
  });

  test("should return false for non-existent path", async () => {
    await expect(isDirectory(join(tempDir, "does-not-exist"))).resolves.toBe(false);
  });
});
