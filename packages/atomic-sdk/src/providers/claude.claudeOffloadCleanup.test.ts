/**
 * Tests for claudeOffloadCleanup.
 *
 * Each test uses a tmpdir and injects a custom dirs object so claudeHookDirs()
 * is never called with the real HOME (os.homedir() ignores runtime HOME changes).
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claudeOffloadCleanup } from "./claude.ts";

/** Minimal shape matching ReturnType<typeof claudeHookDirs>. */
type HookDirs = Parameters<typeof claudeOffloadCleanup>[1];

let tmpHome: string;

function makeDirs(base: string): NonNullable<HookDirs> {
  const inflightBase = join(base, "claude-inflight");
  return {
    marker: join(base, "claude-stop"),
    queue: join(base, "claude-queue"),
    release: join(base, "claude-release"),
    hil: join(base, "claude-hil"),
    pid: join(base, "claude-pid"),
    ready: join(base, "claude-ready"),
    inflight: inflightBase,
    inflightRoots: join(inflightBase, ".session-roots"),
  };
}

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "atomic-test-home-"));
});

afterEach(async () => {
  try {
    await rm(tmpHome, { recursive: true, force: true });
  } catch { /* ignore */ }
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("claudeOffloadCleanup()", () => {
  test("empty agentSessionId returns all cleared:false, no throw", async () => {
    const result = await claudeOffloadCleanup("");
    expect(result.readyCleared).toBe(false);
    expect(result.stopCleared).toBe(false);
    expect(result.pidCleared).toBe(false);
    expect(result.inflightCleared).toBe(false);
    expect(result.failures).toBe(0);
  });

  test("markers exist: all four removed, all cleared true, failures=0", async () => {
    const id = "test-session-abc";
    const dirs = makeDirs(tmpHome);

    // Create the marker files/dirs
    await mkdir(dirs.ready, { recursive: true });
    await mkdir(dirs.marker, { recursive: true });
    await mkdir(dirs.pid, { recursive: true });
    const inflightSessionDir = join(dirs.inflight, id);
    await mkdir(inflightSessionDir, { recursive: true });

    await writeFile(join(dirs.ready, id), "");
    await writeFile(join(dirs.marker, id), "");
    await writeFile(join(dirs.pid, id), "1234");
    await writeFile(join(inflightSessionDir, "some-agent"), "");

    const result = await claudeOffloadCleanup(id, dirs);

    expect(result.readyCleared).toBe(true);
    expect(result.stopCleared).toBe(true);
    expect(result.pidCleared).toBe(true);
    expect(result.inflightCleared).toBe(true);
    expect(result.failures).toBe(0);

    // Files/dirs are actually gone
    expect(await fileExists(join(dirs.ready, id))).toBe(false);
    expect(await fileExists(join(dirs.marker, id))).toBe(false);
    expect(await fileExists(join(dirs.pid, id))).toBe(false);
    expect(await fileExists(inflightSessionDir)).toBe(false);
  });

  test("ENOENT for all targets: no throw, all cleared true (post-condition: absent)", async () => {
    const id = "session-missing-files";
    const dirs = makeDirs(tmpHome);
    // Don't create any dirs/files — pure ENOENT path
    const result = await claudeOffloadCleanup(id, dirs);

    expect(result.readyCleared).toBe(true);
    expect(result.stopCleared).toBe(true);
    expect(result.pidCleared).toBe(true);
    expect(result.inflightCleared).toBe(true);
    expect(result.failures).toBe(0);
  });

  test("non-ENOENT error on one unlink: failures>0, no throw, others still attempted", async () => {
    const id = "session-partial-fail";
    const dirs = makeDirs(tmpHome);

    // Create all parent dirs and files
    await mkdir(dirs.ready, { recursive: true });
    await mkdir(dirs.marker, { recursive: true });
    await mkdir(dirs.pid, { recursive: true });

    await writeFile(join(dirs.marker, id), "");
    await writeFile(join(dirs.pid, id), "1234");

    // Replace the ready marker with a directory so unlink throws EISDIR (not ENOENT)
    await mkdir(join(dirs.ready, id), { recursive: true });
    // Put a file inside so rm --force won't silently succeed on the unlink path
    await writeFile(join(dirs.ready, id, "inner"), "");

    const result = await claudeOffloadCleanup(id, dirs);

    // The ready marker unlink should fail (EISDIR is not ENOENT)
    expect(result.failures).toBeGreaterThan(0);
    expect(result.readyCleared).toBe(false);
    // Other markers should still be attempted (stop and pid cleared)
    expect(result.stopCleared).toBe(true);
    expect(result.pidCleared).toBe(true);
    // No throw — function must return normally
  });
});
