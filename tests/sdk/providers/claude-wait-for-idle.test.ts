/**
 * Tests for the `waitForIdle` marker-file flow in claude.ts.
 *
 * `waitForIdle` watches ~/.atomic/claude-stop/ via fs.watch and returns when a
 * marker file named `<claudeSessionId>` appears. On marker appearance it reads
 * the session transcript, optionally polls it for mid-loop flush races, and
 * returns the sliced tail produced by the current turn.
 *
 * HIL detection is out of scope for this function — see `watchHILMarker`
 * and its own test file.
 *
 * Strategy:
 * - mock.module "@anthropic-ai/claude-agent-sdk" to control getSessionMessages
 * - Use real fs.watch on the actual markerDir (unique UUID session ids prevent collision)
 * - Write marker files directly with the sessionId filename (fs.watch generates
 *   events with the exact filename, unlike atomic rename which generates the .tmp name)
 * - Clean up marker files in afterEach
 */

import { mock, test, expect, describe, beforeEach, afterEach } from "bun:test";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------
// Module-level mock — must be declared before importing the module under test.
// We use a shared array that individual tests push session-message arrays onto.
// Each call to getSessionMessages pops from the front so tests can sequence
// multiple transcript states.
// ---------------------------------------------------------------------------

const sessionMessageQueue: SessionMessage[][] = [];

await mock.module("@anthropic-ai/claude-agent-sdk", () => {
  return {
    getSessionMessages: async (_sessionId: string): Promise<SessionMessage[]> => {
      const next = sessionMessageQueue.shift();
      return next ?? [];
    },
    // Provide stubs for other named exports used by claude.ts
    query: async function* () {},
  };
});

// Import AFTER mock.module is set up
import {
  waitForIdle,
  markerDir,
  markerPath,
} from "../../../src/sdk/providers/claude.ts";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write a marker file directly, causing fs.watch to generate a "rename" event
 * with `event.filename === sessionId`.
 *
 * Note: on Linux, atomic rename (tmp → sessionId) only generates an event with
 * the .tmp filename (the source). Direct write generates the correct event name.
 */
async function writeMarker(sessionId: string): Promise<void> {
  const dir = markerDir();
  await mkdir(dir, { recursive: true });
  const target = markerPath(sessionId);
  await writeFile(target, "");
}

/** Remove marker file if it exists — used in afterEach cleanup. */
async function cleanupMarker(sessionId: string): Promise<void> {
  const target = markerPath(sessionId);
  if (existsSync(target)) {
    try {
      await unlink(target);
    } catch {
      // ENOENT is fine
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("waitForIdle — marker-file flow", () => {
  let sessionId: string;

  beforeEach(() => {
    sessionId = randomUUID();
    // Clear any leftover queue entries
    sessionMessageQueue.length = 0;
  });

  afterEach(async () => {
    sessionMessageQueue.length = 0;
    await cleanupMarker(sessionId);
  });

  // -------------------------------------------------------------------------
  // 1. Resolves when marker appears, no HIL
  // -------------------------------------------------------------------------

  test("resolves and returns sliced messages when marker appears with no HIL", async () => {
    // Transcript BEFORE this turn has 2 messages; AFTER has 4 — so the new
    // turn produced messages at indices 2 and 3.
    const baseMessages: SessionMessage[] = [
      {
        type: "user",
        uuid: "u1",
        session_id: sessionId,
        message: { role: "user", content: "hello" },
        parent_tool_use_id: null,
      },
      {
        type: "assistant",
        uuid: "a1",
        session_id: sessionId,
        message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
        parent_tool_use_id: null,
      },
    ];
    const newMessages: SessionMessage[] = [
      ...baseMessages,
      {
        type: "user",
        uuid: "u2",
        session_id: sessionId,
        message: { role: "user", content: "second" },
        parent_tool_use_id: null,
      },
      {
        type: "assistant",
        uuid: "a2",
        session_id: sessionId,
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
        parent_tool_use_id: null,
      },
    ];

    // getSessionMessages will return newMessages (4 items) on first call
    sessionMessageQueue.push(newMessages);

    // Ensure marker directory exists
    await mkdir(markerDir(), { recursive: true });

    // Start waitForIdle watching; write the marker shortly after to simulate
    // the stop-hook firing.
    const idlePromise = waitForIdle(
      sessionId,       // claudeSessionId
      2,               // transcriptBeforeCount (2 messages existed before)
    );

    // Give the watcher a tick to set up, then write the marker
    await Bun.sleep(80);
    await writeMarker(sessionId);

    const result = await idlePromise;

    // Should return only the messages produced during this turn (indices 2 & 3)
    expect(result).toHaveLength(2);
    expect(result[0]?.uuid).toBe("u2");
    expect(result[1]?.uuid).toBe("a2");
  });

  // -------------------------------------------------------------------------
  // 4. Transcript slicing — transcriptBeforeCount applied correctly
  // -------------------------------------------------------------------------

  test("returns empty slice when transcript has no new messages beyond baseline", async () => {
    // Transcript read returns exactly as many messages as before — no new ones.
    // Baseline is 1, transcript has 1 (an assistant message with end_turn),
    // so the slice is empty. The assistant's stop_reason must be terminal
    // (not "tool_use") or `_isMidAgentLoop` would keep watching.
    const messages: SessionMessage[] = [
      {
        type: "assistant",
        uuid: "a1",
        session_id: sessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
          stop_reason: "end_turn",
        },
        parent_tool_use_id: null,
      },
    ];

    sessionMessageQueue.push(messages);

    await mkdir(markerDir(), { recursive: true });

    const idlePromise = waitForIdle(
      sessionId,
      1,    // same count as transcript length → nothing new
    );

    await Bun.sleep(80);
    await writeMarker(sessionId);

    const result = await idlePromise;

    expect(result).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 5b. Async-flush race — Claude Code buffers the final assistant message
  //     for ~100ms after firing the Stop hook. `waitForIdle` must poll the
  //     transcript on a single marker event rather than wait for a second
  //     one (Stop only fires once per agent loop).
  // -------------------------------------------------------------------------

  test("polls the transcript on one marker event when the final assistant message hasn't flushed yet", async () => {
    // First transcript read: mid-loop (last assistant stopped on tool_use
    // because the post-tool `assistant[text]` hasn't been flushed to disk).
    const midLoopMessages: SessionMessage[] = [
      {
        type: "assistant",
        uuid: "a-mid",
        session_id: sessionId,
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tu-x", name: "Read", input: { path: "/x" } },
          ],
          stop_reason: "tool_use",
        },
        parent_tool_use_id: null,
      },
    ];

    // Subsequent reads: the buffered `assistant[text]` has now hit disk.
    const finalMessages: SessionMessage[] = [
      ...midLoopMessages,
      {
        type: "user",
        uuid: "u-result",
        session_id: sessionId,
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu-x", content: "file body" },
          ],
        },
        parent_tool_use_id: null,
      },
      {
        type: "assistant",
        uuid: "a-final",
        session_id: sessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Here's what I found" }],
          stop_reason: "end_turn",
        },
        parent_tool_use_id: null,
      },
    ];

    // First poll sees mid-loop; every subsequent poll returns the full
    // transcript. `waitForIdle` should return the full one on retry.
    sessionMessageQueue.push(midLoopMessages);
    for (let i = 0; i < 20; i++) sessionMessageQueue.push(finalMessages);

    await mkdir(markerDir(), { recursive: true });

    const idlePromise = waitForIdle(sessionId, 0);

    // Fire the single Stop event. No second marker is ever written — the
    // mid-loop recovery must come from polling the transcript on disk.
    await Bun.sleep(80);
    await writeMarker(sessionId);

    const result = await idlePromise;

    expect(result.at(-1)?.uuid).toBe("a-final");
    expect(result).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // 6. Race fix — marker already on disk when waitForIdle is called.
  // -------------------------------------------------------------------------

  test("resolves immediately when the marker already exists at call time", async () => {
    // Simulates the race where the Stop hook fires between clearStaleMarker()
    // and waitForIdle()'s watcher attach: the marker is on disk but no
    // further fs.watch events will be emitted.
    const messages: SessionMessage[] = [
      {
        type: "assistant",
        uuid: "a1",
        session_id: sessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
        parent_tool_use_id: null,
      },
    ];

    sessionMessageQueue.push(messages);

    await mkdir(markerDir(), { recursive: true });
    // Write the marker BEFORE starting waitForIdle — no watch event will
    // fire for this file because it's already there.
    await writeMarker(sessionId);

    const result = await waitForIdle(sessionId, 0);

    expect(result).toHaveLength(1);
    expect(result[0]?.uuid).toBe("a1");
  });

  // -------------------------------------------------------------------------
  // 7. Cleanup — no unhandled rejection when watcher is aborted via return
  // -------------------------------------------------------------------------

  test("resolves cleanly without throwing when marker appears (abort path exercised)", async () => {
    const messages: SessionMessage[] = [
      {
        type: "assistant",
        uuid: "a1",
        session_id: sessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "response" }],
        },
        parent_tool_use_id: null,
      },
    ];

    sessionMessageQueue.push(messages);

    await mkdir(markerDir(), { recursive: true });

    const idlePromise = waitForIdle(sessionId, 0);

    await Bun.sleep(80);
    await writeMarker(sessionId);

    // Should not throw
    await expect(idlePromise).resolves.toBeDefined();
  });
});
