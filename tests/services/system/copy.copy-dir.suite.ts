import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  copyDir,
  existsSync,
  isDirectory,
  join,
  makeDirStructure,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  tmpdir,
  writeFile,
} from "./copy.test-support.ts";

describe("copyDir", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "atomic-copy-dir-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("should copy empty directory", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    await mkdir(srcDir, { recursive: true });

    await copyDir(srcDir, destDir);

    expect(existsSync(destDir)).toBe(true);
    await expect(isDirectory(destDir)).resolves.toBe(true);
  });

  test("should copy directory with files", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    await makeDirStructure(srcDir, {
      "file1.txt": "content1",
      "file2.txt": "content2",
      "subdir/file3.txt": "content3",
    });

    await copyDir(srcDir, destDir);

    expect(existsSync(join(destDir, "file1.txt"))).toBe(true);
    expect(existsSync(join(destDir, "file2.txt"))).toBe(true);
    expect(existsSync(join(destDir, "subdir/file3.txt"))).toBe(true);
    expect(await Bun.file(join(destDir, "file1.txt")).text()).toBe("content1");
  });

  test("should copy nested directory structure", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    await makeDirStructure(srcDir, {
      "a/b/c/deep.txt": "deep content",
      "x/y/file.txt": "another file",
    });

    await copyDir(srcDir, destDir);

    expect(existsSync(join(destDir, "a/b/c/deep.txt"))).toBe(true);
    expect(existsSync(join(destDir, "x/y/file.txt"))).toBe(true);
  });

  test("should exclude files by name", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    await makeDirStructure(srcDir, {
      "keep.txt": "keep this",
      "exclude.txt": "exclude this",
    });

    await copyDir(srcDir, destDir, { exclude: ["exclude.txt"] });

    expect(existsSync(join(destDir, "keep.txt"))).toBe(true);
    expect(existsSync(join(destDir, "exclude.txt"))).toBe(false);
  });

  test("should exclude directories by name", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    await makeDirStructure(srcDir, {
      "keep/file.txt": "keep this",
      "node_modules/package/file.txt": "exclude this",
    });

    await copyDir(srcDir, destDir, { exclude: ["node_modules"] });

    expect(existsSync(join(destDir, "keep/file.txt"))).toBe(true);
    expect(existsSync(join(destDir, "node_modules"))).toBe(false);
  });

  test("should exclude nested paths", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    await makeDirStructure(srcDir, {
      "src/a/keep.txt": "keep this",
      "src/a/excluded/file.txt": "exclude this",
    });

    await copyDir(srcDir, destDir, { exclude: ["src/a/excluded"] });

    expect(existsSync(join(destDir, "src/a/keep.txt"))).toBe(true);
    expect(existsSync(join(destDir, "src/a/excluded"))).toBe(false);
  });

  test("should handle multiple exclusions", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    await makeDirStructure(srcDir, {
      "keep.txt": "keep this",
      ".git/config": "git config",
      "node_modules/package/index.js": "node_modules",
      "dist/bundle.js": "dist",
    });

    await copyDir(srcDir, destDir, {
      exclude: [".git", "node_modules", "dist"],
    });

    expect(existsSync(join(destDir, "keep.txt"))).toBe(true);
    expect(existsSync(join(destDir, ".git"))).toBe(false);
    expect(existsSync(join(destDir, "node_modules"))).toBe(false);
    expect(existsSync(join(destDir, "dist"))).toBe(false);
  });

  test("should copy symlink as regular file (dereference)", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    const targetFile = join(srcDir, "target.txt");
    const symlinkFile = join(srcDir, "link.txt");

    await mkdir(srcDir, { recursive: true });
    await writeFile(targetFile, "symlink target", "utf-8");
    await symlink(targetFile, symlinkFile);

    await copyDir(srcDir, destDir);

    expect(existsSync(join(destDir, "link.txt"))).toBe(true);
    expect(await Bun.file(join(destDir, "link.txt")).text()).toBe("symlink target");
  });

  test("should block symlink targets that escape the source root", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    const outsideDir = join(tempDir, "outside");
    const outsideFile = join(outsideDir, "outside.txt");
    const symlinkFile = join(srcDir, "escape.txt");

    await mkdir(srcDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(outsideFile, "outside", "utf-8");
    await symlink(outsideFile, symlinkFile);

    await expect(copyDir(srcDir, destDir)).rejects.toThrow(
      "resolves outside allowed root",
    );
  });

  test("should throw error on path traversal attack", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    await mkdir(srcDir, { recursive: true });

    await expect(copyDir(srcDir, destDir)).resolves.toBeUndefined();
  });

  test("should handle empty exclude array", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    await makeDirStructure(srcDir, {
      "file1.txt": "content1",
      "file2.txt": "content2",
    });

    await copyDir(srcDir, destDir, { exclude: [] });

    expect(existsSync(join(destDir, "file1.txt"))).toBe(true);
    expect(existsSync(join(destDir, "file2.txt"))).toBe(true);
  });

  test("should create destination directory if it doesn't exist", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest", "nested", "path");
    await makeDirStructure(srcDir, { "file.txt": "content" });

    await copyDir(srcDir, destDir);
    expect(existsSync(join(destDir, "file.txt"))).toBe(true);
  });

  test("should throw error for non-existent source directory", async () => {
    await expect(
      copyDir(join(tempDir, "does-not-exist"), join(tempDir, "dest")),
    ).rejects.toThrow();
  });
});
