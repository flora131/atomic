import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicContentTempPath,
  atomicTempDir,
  atomicTempEnv,
  atomicTempPath,
  ensureAtomicTempDir,
  withAtomicTempEnv,
} from "./atomic-temp.ts";

const createdDirs: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "atomic-temp-test-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("atomic temp helpers", () => {
  test("uses a per-user directory under ~/.atomic/tmp", () => {
    expect(atomicTempDir("/home/alice")).toBe("/home/alice/.atomic/tmp");
  });

  test("creates the temp directory with owner-only permissions", () => {
    const dir = join(makeTempRoot(), "owned-tmp");

    expect(ensureAtomicTempDir(dir)).toBe(dir);
    expect(statSync(dir).isDirectory()).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
  });

  test("builds all Node temp env aliases from the same directory", () => {
    const dir = join(makeTempRoot(), "env-tmp");

    expect(atomicTempEnv(dir)).toEqual({
      TMPDIR: dir,
      TMP: dir,
      TEMP: dir,
    });
  });

  test("builds random and content-addressed paths inside the Atomic temp dir", () => {
    const dir = join(makeTempRoot(), "paths");

    expect(atomicTempPath("prompt", ".txt", "abc", dir)).toBe(
      join(dir, "prompt-abc.txt"),
    );
    expect(atomicContentTempPath("settings", ".json", "same", dir)).toBe(
      atomicContentTempPath("settings", ".json", "same", dir),
    );
    expect(atomicContentTempPath("settings", ".json", "same", dir)).not.toBe(
      atomicContentTempPath("settings", ".json", "different", dir),
    );
  });

  test("scopes process temp env while an async operation runs", async () => {
    const dir = join(makeTempRoot(), "scoped");
    const before = {
      TMPDIR: process.env.TMPDIR,
      TMP: process.env.TMP,
      TEMP: process.env.TEMP,
    };

    const seen = await withAtomicTempEnv(async () => ({
      TMPDIR: process.env.TMPDIR,
      TMP: process.env.TMP,
      TEMP: process.env.TEMP,
    }), dir);

    expect(seen).toEqual({ TMPDIR: dir, TMP: dir, TEMP: dir });
    expect(process.env.TMPDIR).toBe(before.TMPDIR);
    expect(process.env.TMP).toBe(before.TMP);
    expect(process.env.TEMP).toBe(before.TEMP);
  });
});
