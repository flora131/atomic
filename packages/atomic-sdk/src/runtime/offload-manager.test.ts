/**
 * Regression tests for offload-manager.ts Bug 1 (cascade) and Bug 2 (null-safe schema guard).
 * RFC: specs/2026-05-08-workflow-pane-offload-and-resume.md §5.1, §5.2
 */

import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MetadataJsonWithResume } from "./offload-types.ts";
import { persistResume } from "./offload-manager.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IMMUTABLES: Omit<MetadataJsonWithResume, "resume"> = {
  name: "regression",
  description: "regression test stage",
  agent: "claude" as const,
  paneId: "%1",
  serverUrl: "",
  port: 0,
  startedAt: new Date(1_717_804_800_000).toISOString(),
};

function makeStageDir(): string {
  return mkdtempSync(join(tmpdir(), "offload-mgr-"));
}

function writeMetadata(stageDir: string, data: object): void {
  writeFileSync(join(stageDir, "metadata.json"), JSON.stringify(data, null, 2));
}

function readMetadata(stageDir: string): MetadataJsonWithResume {
  const raw = readFileSync(join(stageDir, "metadata.json"), "utf8");
  return JSON.parse(raw) as MetadataJsonWithResume;
}

// ---------------------------------------------------------------------------
// Bug 1 — persistResume chain swallows queued writes
// ---------------------------------------------------------------------------

describe("Bug 1: cascade isolation", () => {
  /**
   * Cascade detection via Error object identity.
   *
   * With the old `.then()` chain: when p1 rejects, `_doPersist` for p2 is
   * NEVER called — p2's `next` promise inherits p1's rejection reason
   * (same Error object reference).
   *
   * With the fix (`.catch(() => undefined).then()`): p2 runs its own
   * `_doPersist` and creates a NEW Error object — different reference.
   *
   * Both p1 and p2 fail with the same message text ("not found"), but the
   * Error instances are distinct iff the fix is present.
   */
  test("persistResume rejection does not cascade to next queued caller", async () => {
    const dir = makeStageDir();
    // No metadata.json — both calls will fail with their own "not found" errors.

    const p1 = persistResume(dir, { lastSeenAt: 1 });
    // Enqueue p2 on the same mutex chain synchronously.
    const p2 = persistResume(dir, { lastSeenAt: 2 });

    let err1: Error | undefined;
    let err2: Error | undefined;
    await p1.catch((e: Error) => { err1 = e; });
    await p2.catch((e: Error) => { err2 = e; });

    // Both fail (file absent).
    expect(err1?.message).toMatch(/metadata\.json not found/);
    expect(err2?.message).toMatch(/metadata\.json not found/);

    // Key assertion: distinct Error instances prove p2 ran its own _doPersist.
    // With cascade bug: err1 === err2 (same object propagated).
    // With fix: err1 !== err2 (each call creates its own Error).
    expect(err1).not.toBe(err2);
  });

  /**
   * "Own outcome" variant: p1 rejects (schema mismatch); p2 also rejects
   * independently with its own schema-mismatch Error instance.
   * Asserts: p1 error !== p2 error (different objects, same message text).
   */
  test("persistResume in-flight caller observes only own outcome", async () => {
    const dir = makeStageDir();
    // Write a file with schemaVersion:99 — both callers fail schema check.
    writeFileSync(
      join(dir, "metadata.json"),
      JSON.stringify({ ...IMMUTABLES, resume: { schemaVersion: 99 } }),
    );

    const p1 = persistResume(dir, { lastSeenAt: 10 });
    const p2 = persistResume(dir, { lastSeenAt: 99 });

    let err1: Error | undefined;
    let err2: Error | undefined;
    await p1.catch((e: Error) => { err1 = e; });
    await p2.catch((e: Error) => { err2 = e; });

    // Both callers fail with schema mismatch.
    expect(err1?.message).toMatch(/unsupported resume schemaVersion/);
    expect(err2?.message).toMatch(/unsupported resume schemaVersion/);

    // Each caller created its own Error — not the same object (no cascade).
    expect(err1).not.toBe(err2);
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — _doPersist null-safe schema guard
// ---------------------------------------------------------------------------

describe("Bug 2: null-safe schema guard", () => {
  test("_doPersist throws schema-mismatch on resume === null", async () => {
    const dir = makeStageDir();
    // Write metadata.json with literal `"resume": null`
    writeFileSync(
      join(dir, "metadata.json"),
      JSON.stringify({ ...IMMUTABLES, resume: null }),
    );

    await expect(persistResume(dir, { lastSeenAt: 1 })).rejects.toThrow(
      /unsupported resume schemaVersion/,
    );
  });

  test.each([
    ["array", []],
    ["number", 42],
    ["string", "x"],
  ])("_doPersist throws schema-mismatch on resume === %s", async (_label, value) => {
    const dir = makeStageDir();
    // Write metadata with resume set to the invalid value.
    writeFileSync(
      join(dir, "metadata.json"),
      JSON.stringify({ ...IMMUTABLES, resume: value }),
    );

    await expect(persistResume(dir, { lastSeenAt: 1 })).rejects.toThrow(
      /unsupported resume schemaVersion/,
    );
  });

  test("_doPersist passes when resume === undefined (key absent)", async () => {
    const dir = makeStageDir();
    // Write metadata without any resume key.
    writeMetadata(dir, { ...IMMUTABLES });

    await expect(
      persistResume(dir, {
        agentSessionId: "sess-1",
        tmuxSessionName: "s",
        tmuxWindowName: "w",
        spawnEnv: {},
        spawnCwd: "/",
        lastPrompt: "p",
        lastSeenAt: 5,
        offloadedAt: null,
      }),
    ).resolves.toBeUndefined();

    const meta = readMetadata(dir);
    expect(meta.resume?.schemaVersion).toBe(1);
    expect(meta.resume?.agentSessionId).toBe("sess-1");
  });

  test("_doPersist passes when resume is valid schemaVersion:1 object", async () => {
    const dir = makeStageDir();
    writeMetadata(dir, {
      ...IMMUTABLES,
      resume: {
        schemaVersion: 1,
        agentSessionId: "old",
        tmuxSessionName: "s",
        tmuxWindowName: "w",
        spawnEnv: {},
        spawnCwd: "/",
        lastPrompt: "p",
        lastSeenAt: 0,
        offloadedAt: null,
      },
    });

    await expect(persistResume(dir, { lastSeenAt: 77 })).resolves.toBeUndefined();

    const meta = readMetadata(dir);
    expect(meta.resume?.lastSeenAt).toBe(77);
    expect(meta.resume?.schemaVersion).toBe(1);
  });

  test("_doPersist throws schema-mismatch when schemaVersion is 2", async () => {
    const dir = makeStageDir();
    writeFileSync(
      join(dir, "metadata.json"),
      JSON.stringify({
        ...IMMUTABLES,
        resume: {
          schemaVersion: 2,
          agentSessionId: "",
          tmuxSessionName: "",
          tmuxWindowName: "",
          spawnEnv: {},
          spawnCwd: "",
          lastPrompt: "",
          lastSeenAt: 0,
          offloadedAt: null,
        },
      }),
    );

    await expect(persistResume(dir, { lastSeenAt: 1 })).rejects.toThrow(
      /unsupported resume schemaVersion/,
    );
  });
});
