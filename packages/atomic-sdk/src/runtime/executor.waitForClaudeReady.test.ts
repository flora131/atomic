/**
 * Tests for waitForClaudeReady RFC §5.5 belt-and-suspenders mtime guard.
 *
 * Uses the _waitForClaudeReadyForTest seam (3rd param: markerBaseDir) to
 * exercise the function with a temp directory instead of ~/.atomic/claude-ready.
 *
 * Three behaviours under test:
 *  1. Stale marker (mtime < startMs) is skipped — wait does NOT resolve early.
 *  2. Fresh marker (mtime >= startMs) resolves immediately.
 *  3. No marker → eventually written → resolves after write.
 */

import { test, expect, describe } from "bun:test";
import { mkdtempSync, utimesSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _waitForClaudeReadyForTest } from "./executor.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempMarkerDir(): string {
  return mkdtempSync(join(tmpdir(), "claude-ready-test-"));
}

// ---------------------------------------------------------------------------
// Case 1: Stale marker — written before startMs — must NOT resolve
// ---------------------------------------------------------------------------

describe("waitForClaudeReady — stale marker rejected", () => {
  test("does not resolve within 1 s when marker mtime is in the past", async () => {
    const dir = makeTempMarkerDir();
    const id = "sess-stale-001";
    const markerPath = join(dir, id);

    // Write marker with mtime 10 seconds in the past.
    writeFileSync(markerPath, "");
    const pastTs = new Date(Date.now() - 10_000);
    utimesSync(markerPath, pastTs, pastTs);

    // startMs = now → marker is stale
    const startMs = Date.now();

    // Race: waitForClaudeReady against a 800 ms timer.
    // The timer should win (wait does NOT resolve for stale marker).
    const timerWon = await Promise.race([
      _waitForClaudeReadyForTest(id, startMs, dir).then(() => false),
      Bun.sleep(800).then(() => true),
    ]);

    expect(timerWon).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Case 2: Fresh marker — mtime >= startMs — must resolve immediately
// ---------------------------------------------------------------------------

describe("waitForClaudeReady — fresh marker accepted", () => {
  test("resolves quickly when marker mtime is after startMs", async () => {
    const dir = makeTempMarkerDir();
    const id = "sess-fresh-002";
    const markerPath = join(dir, id);

    // Write marker with current mtime.
    writeFileSync(markerPath, "");
    // startMs is 5 seconds before marker — marker is fresh.
    const startMs = Date.now() - 5_000;

    const start = Date.now();
    await _waitForClaudeReadyForTest(id, startMs, dir);
    const elapsed = Date.now() - start;

    // Should resolve well within 500 ms.
    expect(elapsed).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// Case 3: No marker → written after 200 ms → resolves
// ---------------------------------------------------------------------------

describe("waitForClaudeReady — marker written mid-wait", () => {
  test("resolves after marker is created post-start", async () => {
    const dir = makeTempMarkerDir();
    const id = "sess-late-003";
    const markerPath = join(dir, id);

    const startMs = Date.now();

    // Write marker after 250 ms with a fresh mtime.
    const writeHandle = Bun.sleep(250).then(() => {
      writeFileSync(markerPath, "");
      // mtime defaults to now — fresh relative to startMs.
    });

    const raceResult = await Promise.race([
      _waitForClaudeReadyForTest(id, startMs, dir).then(() => "resolved" as const),
      Bun.sleep(3_000).then(() => "timeout" as const),
    ]);

    await writeHandle; // ensure no dangling promise
    expect(raceResult).toBe("resolved");
  });
});
