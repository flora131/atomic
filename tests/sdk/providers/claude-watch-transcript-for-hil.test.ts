/**
 * Tests for `watchTranscriptForHIL` in claude.ts.
 *
 * HIL detection is transcript-driven: whenever the JSONL is written, we
 * re-read the session and check `_hasUnresolvedHILTool`. State transitions
 * fire `onHIL(true|false)`; the watcher runs independently of the Stop hook
 * so it can surface `AskUserQuestion` while the agent loop is still blocked
 * on the deferred tool (needsFollowUp=true, Stop hook suppressed upstream).
 *
 * Strategy mirrors claude-wait-for-idle.test.ts:
 * - mock.module the SDK so getSessionMessages returns a test-controlled queue
 * - real fs.watch on the actual transcriptDir (unique UUID session ids avoid
 *   cross-test contamination)
 * - trigger transcript events by writing to the session's JSONL file
 * - cleanup in afterEach
 */

import { mock, test, expect, describe, beforeEach, afterEach } from "bun:test";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";

const sessionMessageQueue: SessionMessage[][] = [];

await mock.module("@anthropic-ai/claude-agent-sdk", () => {
  return {
    getSessionMessages: async (_sessionId: string): Promise<SessionMessage[]> => {
      const next = sessionMessageQueue.shift();
      return next ?? [];
    },
    query: async function* () {},
  };
});

import {
  watchTranscriptForHIL,
  transcriptDir,
  transcriptPath,
} from "../../../src/sdk/providers/claude.ts";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

/** Write a JSONL transcript file to trigger the filename-matching fs.watch event. */
async function writeTranscript(sessionId: string, body = ""): Promise<void> {
  await mkdir(transcriptDir(), { recursive: true });
  await writeFile(transcriptPath(sessionId), body);
}

async function cleanupTranscript(sessionId: string): Promise<void> {
  const target = transcriptPath(sessionId);
  if (existsSync(target)) {
    try {
      await unlink(target);
    } catch {
      // ENOENT is fine
    }
  }
}

describe("watchTranscriptForHIL", () => {
  let sessionId: string;

  beforeEach(() => {
    sessionId = randomUUID();
    sessionMessageQueue.length = 0;
  });

  afterEach(async () => {
    sessionMessageQueue.length = 0;
    await cleanupTranscript(sessionId);
  });

  test("fires onHIL(true) when AskUserQuestion tool_use appears, then onHIL(false) when tool_result resolves it", async () => {
    const toolUseId = randomUUID();

    const pending: SessionMessage[] = [
      {
        type: "assistant",
        uuid: "a1",
        session_id: sessionId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: toolUseId,
              name: "AskUserQuestion",
              input: { questions: [{ question: "pick?", options: [] }] },
            },
          ],
        },
        parent_tool_use_id: null,
      },
    ];

    const resolved: SessionMessage[] = [
      ...pending,
      {
        type: "user",
        uuid: "u1",
        session_id: sessionId,
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: toolUseId, content: "a" },
          ],
        },
        parent_tool_use_id: null,
      },
    ];

    // 1st call (initial check at attach): empty transcript, not HIL
    sessionMessageQueue.push([]);
    // 2nd call (after first transcript write): HIL pending
    sessionMessageQueue.push(pending);
    // 3rd call (after second write): HIL resolved
    sessionMessageQueue.push(resolved);

    const calls: boolean[] = [];
    const ac = new AbortController();

    const watchPromise = watchTranscriptForHIL(
      sessionId,
      (waiting) => calls.push(waiting),
      ac.signal,
    );

    // Let the watcher attach and run its initial check.
    await Bun.sleep(80);
    expect(calls).toEqual([]);

    // Simulate Claude writing the AskUserQuestion tool_use to the JSONL.
    await writeTranscript(sessionId, "{}\n");
    for (let i = 0; i < 100 && calls.length < 1; i++) await Bun.sleep(10);
    expect(calls).toEqual([true]);

    // Simulate user answering — tool_result appended, HIL resolved.
    await writeTranscript(sessionId, "{}\n{}\n");
    for (let i = 0; i < 100 && calls.length < 2; i++) await Bun.sleep(10);
    expect(calls).toEqual([true, false]);

    ac.abort();
    await watchPromise;
  });

  test("fires onHIL(true) on attach when the transcript already has unresolved HIL (resumed-session race)", async () => {
    const toolUseId = randomUUID();
    const pending: SessionMessage[] = [
      {
        type: "assistant",
        uuid: "a1",
        session_id: sessionId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: toolUseId,
              name: "AskUserQuestion",
              input: { questions: [] },
            },
          ],
        },
        parent_tool_use_id: null,
      },
    ];

    // Initial check sees HIL already present.
    sessionMessageQueue.push(pending);

    const calls: boolean[] = [];
    const ac = new AbortController();

    const watchPromise = watchTranscriptForHIL(
      sessionId,
      (waiting) => calls.push(waiting),
      ac.signal,
    );

    for (let i = 0; i < 100 && calls.length < 1; i++) await Bun.sleep(10);
    expect(calls).toEqual([true]);

    ac.abort();
    await watchPromise;
  });

  test("ignores transcript events from unrelated sessions (no spurious onHIL)", async () => {
    const otherSessionId = randomUUID();

    // getSessionMessages is keyed by OUR sessionId, so even though the
    // watcher re-checks on every event in the dir, writes from unrelated
    // sessions return an empty transcript → no HIL → no callback fires.
    // Queue enough empty reads to cover initial check + any stray events.
    for (let i = 0; i < 10; i++) sessionMessageQueue.push([]);

    const calls: boolean[] = [];
    const ac = new AbortController();

    const watchPromise = watchTranscriptForHIL(
      sessionId,
      (waiting) => calls.push(waiting),
      ac.signal,
    );

    await Bun.sleep(80);
    await writeTranscript(otherSessionId, "{}\n");
    await Bun.sleep(100);

    expect(calls).toEqual([]);

    ac.abort();
    await watchPromise;
    await cleanupTranscript(otherSessionId);
  });

  test("resolves cleanly when aborted before any events arrive", async () => {
    sessionMessageQueue.push([]);

    const calls: boolean[] = [];
    const ac = new AbortController();

    const watchPromise = watchTranscriptForHIL(
      sessionId,
      (waiting) => calls.push(waiting),
      ac.signal,
    );

    await Bun.sleep(50);
    ac.abort();

    await expect(watchPromise).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });
});
