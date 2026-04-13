import {
  test,
  expect,
  describe,
  beforeAll,
  afterAll,
} from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isPathWithinRoot,
  assertPathWithinRoot,
  assertRealPathWithinRoot,
} from "../../src/lib/path-root-guard.ts";

// ---------------------------------------------------------------------------
// isPathWithinRoot
// ---------------------------------------------------------------------------

describe("isPathWithinRoot", () => {
  test("returns true when candidate equals root", () => {
    expect(isPathWithinRoot("/a/b", "/a/b")).toBe(true);
  });

  test("returns true for a direct child", () => {
    expect(isPathWithinRoot("/a/b", "/a/b/c")).toBe(true);
  });

  test("returns true for a deeply nested child", () => {
    expect(isPathWithinRoot("/a", "/a/b/c/d/e")).toBe(true);
  });

  test("returns false for a parent directory", () => {
    expect(isPathWithinRoot("/a/b/c", "/a/b")).toBe(false);
  });

  test("returns false for a sibling directory", () => {
    expect(isPathWithinRoot("/a/b", "/a/c")).toBe(false);
  });

  test("returns false when .. escapes root", () => {
    expect(isPathWithinRoot("/a/b", "/a/b/c/../../d")).toBe(false);
  });

  test("returns true when .. resolves within root", () => {
    expect(isPathWithinRoot("/a/b", "/a/b/c/../c/d")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assertPathWithinRoot
// ---------------------------------------------------------------------------

describe("assertPathWithinRoot", () => {
  test("does not throw for path within root", () => {
    expect(() =>
      assertPathWithinRoot("/a/b", "/a/b/c", "Source"),
    ).not.toThrow();
  });

  test("throws for path outside root", () => {
    expect(() =>
      assertPathWithinRoot("/a/b", "/a/c", "Source"),
    ).toThrow("Source escapes allowed root: /a/c");
  });

  test("includes the label and candidate in the error", () => {
    expect(() =>
      assertPathWithinRoot("/x", "/y/z", "CustomLabel"),
    ).toThrow(/CustomLabel escapes allowed root: \/y\/z/);
  });
});

// ---------------------------------------------------------------------------
// assertRealPathWithinRoot
// ---------------------------------------------------------------------------

describe("assertRealPathWithinRoot", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "prg-test-"));
    await mkdir(join(tmpDir, "sub"), { recursive: true });
    await writeFile(join(tmpDir, "sub", "file.txt"), "content");
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("resolves and returns the real path for a file within root", async () => {
    const result = await assertRealPathWithinRoot(
      tmpDir,
      join(tmpDir, "sub", "file.txt"),
      "Test",
    );
    expect(result).toEndWith("file.txt");
  });

  test("throws for a real path that resolves outside root", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "prg-outside-"));
    await writeFile(join(outsideDir, "out.txt"), "x");

    try {
      await expect(
        assertRealPathWithinRoot(
          tmpDir,
          join(outsideDir, "out.txt"),
          "Escape",
        ),
      ).rejects.toThrow(/Escape resolves outside allowed root/);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});
