/**
 * Tests for claudeAskHookCommand.
 *
 * Strategy mirrors claude-stop-hook.test.ts: monkey-patch `Bun.stdin.text`
 * so we can call the function directly without spawning subprocesses, and
 * use unique session IDs with `afterEach` cleanup to avoid cross-test
 * contamination.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { access, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  claudeAskHookCommand,
} from "./claude-ask-hook.ts";
import { claudeHookDirs } from "./claude-stop-hook.ts";

const { hil: hilDir } = claudeHookDirs();

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function mockStdin(text: string): void {
  (Bun.stdin as { text: () => Promise<string> }).text = () =>
    Promise.resolve(text);
}

const sessionIdsToClean: string[] = [];

afterEach(async () => {
  for (const id of sessionIdsToClean) {
    await rm(join(hilDir, id), { force: true });
  }
  sessionIdsToClean.length = 0;
});

describe("claudeAskHookCommand", () => {
  test("enter mode writes the marker file and returns 0", async () => {
    const sessionId = crypto.randomUUID();
    sessionIdsToClean.push(sessionId);

    mockStdin(JSON.stringify({
      session_id: sessionId,
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
    }));

    const code = await claudeAskHookCommand("enter");

    expect(code).toBe(0);
    expect(await fileExists(join(hilDir, sessionId))).toBe(true);
  });

  test("exit mode removes an existing marker and returns 0", async () => {
    const sessionId = crypto.randomUUID();
    sessionIdsToClean.push(sessionId);

    await mkdir(hilDir, { recursive: true });
    await writeFile(join(hilDir, sessionId), "stale");

    mockStdin(JSON.stringify({
      session_id: sessionId,
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
    }));

    const code = await claudeAskHookCommand("exit");

    expect(code).toBe(0);
    expect(await fileExists(join(hilDir, sessionId))).toBe(false);
  });

  test("exit mode with no existing marker is a no-op and returns 0", async () => {
    const sessionId = crypto.randomUUID();
    sessionIdsToClean.push(sessionId);

    mockStdin(JSON.stringify({ session_id: sessionId }));

    const code = await claudeAskHookCommand("exit");

    expect(code).toBe(0);
    expect(await fileExists(join(hilDir, sessionId))).toBe(false);
  });

  test("malformed JSON returns 0 and does not write a marker", async () => {
    const sessionId = crypto.randomUUID();
    sessionIdsToClean.push(sessionId);

    mockStdin("not json {");

    const code = await claudeAskHookCommand("enter");

    expect(code).toBe(0);
    expect(await fileExists(join(hilDir, sessionId))).toBe(false);
  });

  test("missing session_id returns 0 and does not write a marker", async () => {
    mockStdin(JSON.stringify({ hook_event_name: "PreToolUse" }));

    const code = await claudeAskHookCommand("enter");

    expect(code).toBe(0);
  });

  test("enter mode tolerates extra payload fields", async () => {
    const sessionId = crypto.randomUUID();
    sessionIdsToClean.push(sessionId);

    mockStdin(JSON.stringify({
      session_id: sessionId,
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      cwd: "/some/path",
      extraneous_field: 42,
    }));

    const code = await claudeAskHookCommand("enter");

    expect(code).toBe(0);
    expect(await fileExists(join(hilDir, sessionId))).toBe(true);
  });
});
