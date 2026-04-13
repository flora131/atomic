import {
  test,
  expect,
  describe,
  beforeEach,
  afterEach,
} from "bun:test";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  stat,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureDir,
  ensureDirSync,
  normalizePath,
  isPathSafe,
  copyFile,
  shouldExclude,
  copyDir,
  copyDirNonDestructive,
  pathExists,
  isDirectory,
  isFileEmpty,
} from "../../../src/services/system/copy.ts";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "copy-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// normalizePath
// ---------------------------------------------------------------------------

describe("normalizePath", () => {
  test("converts backslashes to forward slashes", () => {
    expect(normalizePath("a\\b\\c")).toBe("a/b/c");
  });

  test("leaves forward slashes unchanged", () => {
    expect(normalizePath("a/b/c")).toBe("a/b/c");
  });

  test("handles empty string", () => {
    expect(normalizePath("")).toBe("");
  });

  test("handles mixed separators", () => {
    expect(normalizePath("a\\b/c\\d")).toBe("a/b/c/d");
  });
});

// ---------------------------------------------------------------------------
// isPathSafe
// ---------------------------------------------------------------------------

describe("isPathSafe", () => {
  test("returns true for a child path", () => {
    expect(isPathSafe("/base", "child")).toBe(true);
  });

  test("returns false for path traversal", () => {
    expect(isPathSafe("/base", "../escape")).toBe(false);
  });

  test("returns true for current directory", () => {
    expect(isPathSafe("/base", ".")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldExclude
// ---------------------------------------------------------------------------

describe("shouldExclude", () => {
  test("excludes by exact name match", () => {
    expect(shouldExclude("path/node_modules", "node_modules", ["node_modules"])).toBe(true);
  });

  test("excludes when relative path starts with exclusion", () => {
    expect(shouldExclude("vendor/lib", "lib", ["vendor"])).toBe(true);
  });

  test("excludes by exact relative path match", () => {
    expect(shouldExclude("vendor/lib", "lib", ["vendor/lib"])).toBe(true);
  });

  test("does not exclude non-matching paths", () => {
    expect(shouldExclude("src/utils", "utils", ["vendor"])).toBe(false);
  });

  test("normalizes Windows paths for comparison", () => {
    expect(shouldExclude("vendor\\lib", "lib", ["vendor"])).toBe(true);
  });

  test("returns false for empty exclude list", () => {
    expect(shouldExclude("any/path", "path", [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ensureDir
// ---------------------------------------------------------------------------

describe("ensureDir", () => {
  test("creates a new directory", async () => {
    const dir = join(tmpDir, "new-dir");
    await ensureDir(dir);
    const stats = await stat(dir);
    expect(stats.isDirectory()).toBe(true);
  });

  test("succeeds for an existing directory", async () => {
    const dir = join(tmpDir, "existing");
    await mkdir(dir);
    await expect(ensureDir(dir)).resolves.toBeUndefined();
  });

  test("creates nested directories", async () => {
    const dir = join(tmpDir, "a", "b", "c");
    await ensureDir(dir);
    const stats = await stat(dir);
    expect(stats.isDirectory()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ensureDirSync
// ---------------------------------------------------------------------------

describe("ensureDirSync", () => {
  test("creates a new directory synchronously", () => {
    const dir = join(tmpDir, "sync-dir");
    ensureDirSync(dir);
    expect(() => ensureDirSync(dir)).not.toThrow();
  });

  test("creates nested directories synchronously", () => {
    const dir = join(tmpDir, "sync-a", "sync-b");
    ensureDirSync(dir);
    expect(() => ensureDirSync(dir)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// copyFile
// ---------------------------------------------------------------------------

describe("copyFile", () => {
  test("copies file content to destination", async () => {
    const src = join(tmpDir, "source.txt");
    const dest = join(tmpDir, "dest.txt");
    await writeFile(src, "hello world");
    await copyFile(src, dest);
    expect(await readFile(dest, "utf-8")).toBe("hello world");
  });

  test("is a no-op when src and dest resolve to the same path", async () => {
    const file = join(tmpDir, "same.txt");
    await writeFile(file, "original");
    await copyFile(file, file);
    expect(await readFile(file, "utf-8")).toBe("original");
  });

  test("throws a descriptive error for non-existent source", async () => {
    const src = join(tmpDir, "missing.txt");
    const dest = join(tmpDir, "dest.txt");
    await expect(copyFile(src, dest)).rejects.toThrow(/Failed to copy/);
  });
});

// ---------------------------------------------------------------------------
// pathExists
// ---------------------------------------------------------------------------

describe("pathExists", () => {
  test("returns true for an existing file", async () => {
    const file = join(tmpDir, "exists.txt");
    await writeFile(file, "x");
    expect(await pathExists(file)).toBe(true);
  });

  test("returns true for an existing directory", async () => {
    expect(await pathExists(tmpDir)).toBe(true);
  });

  test("returns false for a non-existent path", async () => {
    expect(await pathExists(join(tmpDir, "nope"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDirectory
// ---------------------------------------------------------------------------

describe("isDirectory", () => {
  test("returns true for a directory", async () => {
    expect(await isDirectory(tmpDir)).toBe(true);
  });

  test("returns false for a file", async () => {
    const file = join(tmpDir, "file.txt");
    await writeFile(file, "x");
    expect(await isDirectory(file)).toBe(false);
  });

  test("returns false for a non-existent path", async () => {
    expect(await isDirectory(join(tmpDir, "nope"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isFileEmpty
// ---------------------------------------------------------------------------

describe("isFileEmpty", () => {
  test("returns true for a 0-byte file", async () => {
    const file = join(tmpDir, "empty.txt");
    await writeFile(file, "");
    expect(await isFileEmpty(file)).toBe(true);
  });

  test("returns true for a whitespace-only file", async () => {
    const file = join(tmpDir, "ws.txt");
    await writeFile(file, "   \n  \t  ");
    expect(await isFileEmpty(file)).toBe(true);
  });

  test("returns false for a file with content", async () => {
    const file = join(tmpDir, "content.txt");
    await writeFile(file, "hello");
    expect(await isFileEmpty(file)).toBe(false);
  });

  test("returns true for a non-existent file", async () => {
    expect(await isFileEmpty(join(tmpDir, "nope"))).toBe(true);
  });

  test("returns false for a large file with content", async () => {
    const file = join(tmpDir, "large.txt");
    await writeFile(file, "x".repeat(2048));
    expect(await isFileEmpty(file)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// copyDir
// ---------------------------------------------------------------------------

describe("copyDir", () => {
  test("copies a directory recursively", async () => {
    const src = join(tmpDir, "src");
    const dest = join(tmpDir, "dest");

    await mkdir(join(src, "sub"), { recursive: true });
    await writeFile(join(src, "a.txt"), "aaa");
    await writeFile(join(src, "sub", "b.txt"), "bbb");

    await copyDir(src, dest);

    expect(await readFile(join(dest, "a.txt"), "utf-8")).toBe("aaa");
    expect(await readFile(join(dest, "sub", "b.txt"), "utf-8")).toBe("bbb");
  });

  test("respects the exclude option", async () => {
    const src = join(tmpDir, "src");
    const dest = join(tmpDir, "dest");

    await mkdir(join(src, "keep"), { recursive: true });
    await mkdir(join(src, "skip"), { recursive: true });
    await writeFile(join(src, "keep", "a.txt"), "keep");
    await writeFile(join(src, "skip", "b.txt"), "skip");

    await copyDir(src, dest, { exclude: ["skip"] });

    expect(await pathExists(join(dest, "keep", "a.txt"))).toBe(true);
    expect(await pathExists(join(dest, "skip"))).toBe(false);
  });

  test("skips opposite-platform scripts by default", async () => {
    const src = join(tmpDir, "src");
    const dest = join(tmpDir, "dest");

    await mkdir(src, { recursive: true });
    await writeFile(join(src, "setup.sh"), "#!/bin/sh\necho hi");
    await writeFile(join(src, "setup.ps1"), "Write-Host hi");

    await copyDir(src, dest);

    if (process.platform !== "win32") {
      expect(await pathExists(join(dest, "setup.sh"))).toBe(true);
      expect(await pathExists(join(dest, "setup.ps1"))).toBe(false);
    }
  });

  test("can disable opposite-script skipping", async () => {
    const src = join(tmpDir, "src");
    const dest = join(tmpDir, "dest");

    await mkdir(src, { recursive: true });
    await writeFile(join(src, "setup.sh"), "#!/bin/sh");
    await writeFile(join(src, "setup.ps1"), "Write-Host");

    await copyDir(src, dest, { skipOppositeScripts: false });

    expect(await pathExists(join(dest, "setup.sh"))).toBe(true);
    expect(await pathExists(join(dest, "setup.ps1"))).toBe(true);
  });

  test("dereferences symlinks into regular files", async () => {
    const src = join(tmpDir, "src");
    const dest = join(tmpDir, "dest");

    await mkdir(src, { recursive: true });
    await writeFile(join(src, "real.txt"), "linked content");
    await symlink(join(src, "real.txt"), join(src, "link.txt"));

    await copyDir(src, dest);

    expect(await readFile(join(dest, "link.txt"), "utf-8")).toBe(
      "linked content",
    );
  });
});

// ---------------------------------------------------------------------------
// copyDirNonDestructive
// ---------------------------------------------------------------------------

describe("copyDirNonDestructive", () => {
  test("does not overwrite existing files", async () => {
    const src = join(tmpDir, "src");
    const dest = join(tmpDir, "dest");

    await mkdir(src, { recursive: true });
    await mkdir(dest, { recursive: true });
    await writeFile(join(src, "a.txt"), "new");
    await writeFile(join(dest, "a.txt"), "old");

    await copyDirNonDestructive(src, dest);

    expect(await readFile(join(dest, "a.txt"), "utf-8")).toBe("old");
  });

  test("copies files that do not exist at destination", async () => {
    const src = join(tmpDir, "src");
    const dest = join(tmpDir, "dest");

    await mkdir(src, { recursive: true });
    await mkdir(dest, { recursive: true });
    await writeFile(join(src, "new.txt"), "new content");

    await copyDirNonDestructive(src, dest);

    expect(await readFile(join(dest, "new.txt"), "utf-8")).toBe("new content");
  });
});
