/**
 * Tests for `watchHILMarker` in claude.ts.
 *
 * HIL detection is hook-driven: the `_claude-ask-hook enter|exit` subcommand
 * writes/removes `~/.atomic/claude-hil/<session_id>` from Claude Code's
 * PreToolUse/PostToolUse/PostToolUseFailure hooks (matcher `AskUserQuestion`).
 * `watchHILMarker` does `fs.watch` on that dir and fires `onHIL(true|false)`
 * on create/unlink.
 *
 * Strategy:
 * - real fs.watch on the actual hil dir (unique UUID session ids prevent
 *   cross-test contamination)
 * - trigger events by writing/unlinking the session's marker file
 * - cleanup in afterEach
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { watchHILMarker } from "../../../src/sdk/providers/claude.ts";
import { claudeHookDirs } from "../../../src/commands/cli/claude-stop-hook.ts";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

function markerPathFor(sessionId: string): string {
  return join(claudeHookDirs().hil, sessionId);
}

async function writeMarker(sessionId: string): Promise<void> {
  await mkdir(claudeHookDirs().hil, { recursive: true });
  await writeFile(markerPathFor(sessionId), "{}");
}

async function removeMarker(sessionId: string): Promise<void> {
  const p = markerPathFor(sessionId);
  if (existsSync(p)) {
    try {
      await unlink(p);
    } catch {
      // ENOENT is fine
    }
  }
}

describe("watchHILMarker", () => {
  let sessionId: string;

  beforeEach(() => {
    sessionId = randomUUID();
  });

  afterEach(async () => {
    await removeMarker(sessionId);
  });

  test("fires onHIL(true) when marker is created, then onHIL(false) when it is removed", async () => {
    const calls: boolean[] = [];
    const ac = new AbortController();

    const watchPromise = watchHILMarker(
      sessionId,
      (waiting: boolean) => calls.push(waiting),
      ac.signal,
    );

    // Let the watcher attach and run its initial existsSync.
    await Bun.sleep(80);
    expect(calls).toEqual([]);

    // Simulate PreToolUse hook firing: marker appears.
    await writeMarker(sessionId);
    for (let i = 0; i < 100 && calls.length < 1; i++) await Bun.sleep(10);
    expect(calls).toEqual([true]);

    // Simulate PostToolUse hook firing: marker removed.
    await unlink(markerPathFor(sessionId));
    for (let i = 0; i < 100 && calls.length < 2; i++) await Bun.sleep(10);
    expect(calls).toEqual([true, false]);

    ac.abort();
    await watchPromise;
  });

  test("fires onHIL(true) on attach when marker already exists (resumed-session race)", async () => {
    await writeMarker(sessionId);

    const calls: boolean[] = [];
    const ac = new AbortController();

    const watchPromise = watchHILMarker(
      sessionId,
      (waiting: boolean) => calls.push(waiting),
      ac.signal,
    );

    for (let i = 0; i < 100 && calls.length < 1; i++) await Bun.sleep(10);
    expect(calls).toEqual([true]);

    ac.abort();
    await watchPromise;
  });

  test("ignores marker events for unrelated session ids", async () => {
    const otherSessionId = randomUUID();

    const calls: boolean[] = [];
    const ac = new AbortController();

    const watchPromise = watchHILMarker(
      sessionId,
      (waiting: boolean) => calls.push(waiting),
      ac.signal,
    );

    await Bun.sleep(80);
    await writeMarker(otherSessionId);
    await Bun.sleep(100);
    expect(calls).toEqual([]);

    ac.abort();
    await watchPromise;
    await removeMarker(otherSessionId);
  });

  test("resolves cleanly when aborted before any events arrive", async () => {
    const calls: boolean[] = [];
    const ac = new AbortController();

    const watchPromise = watchHILMarker(
      sessionId,
      (waiting: boolean) => calls.push(waiting),
      ac.signal,
    );

    await Bun.sleep(50);
    ac.abort();

    await expect(watchPromise).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("does not fire redundant callbacks on repeated events with the same HIL state", async () => {
    const calls: boolean[] = [];
    const ac = new AbortController();

    const watchPromise = watchHILMarker(
      sessionId,
      (waiting: boolean) => calls.push(waiting),
      ac.signal,
    );

    await Bun.sleep(80);

    // Write the marker twice — second write is a modify event, not a create.
    // The `wasHIL` guard should suppress the redundant callback.
    await writeMarker(sessionId);
    for (let i = 0; i < 100 && calls.length < 1; i++) await Bun.sleep(10);
    await writeMarker(sessionId);
    await Bun.sleep(100);

    expect(calls).toEqual([true]);

    ac.abort();
    await watchPromise;
  });
});
