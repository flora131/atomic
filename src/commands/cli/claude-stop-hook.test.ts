/**
 * Tests for claudeStopHookCommand.
 *
 * Strategy: monkey-patch `Bun.stdin.text` to return preset strings so we can
 * call the function directly without spawning subprocesses.  This is
 * consistent with how other CLI-command tests in this directory work.
 *
 * Filesystem isolation: we use `crypto.randomUUID()` for unique session IDs
 * and clean up in `afterEach` so test runs never collide with each other
 * or with real marker files.
 */

import { describe, test, expect, afterEach, mock, spyOn } from "bun:test";
import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { claudeStopHookCommand } from "./claude-stop-hook.ts";

// Paths we'll need in every test.
const markerDir = join(homedir(), ".atomic", "claude-stop");

/** Returns true when a file exists at `filePath`. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Patch `Bun.stdin.text` for the duration of one test. */
function mockStdin(text: string): void {
  // Bun.stdin is a readonly property on the global `Bun` object.
  // We reach it through the prototype chain the same way other tests
  // in this repo patch globals (e.g. process.stdout.write).
  (Bun.stdin as { text: () => Promise<string> }).text = () =>
    Promise.resolve(text);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const sessionIdsToClean: string[] = [];

afterEach(async () => {
  // Remove any marker files created during the test.
  for (const id of sessionIdsToClean) {
    await rm(join(markerDir, id), { force: true });
    await rm(join(markerDir, `${id}.tmp`), { force: true });
  }
  sessionIdsToClean.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("claudeStopHookCommand", () => {
  // 1. Valid payload → writes marker file
  test("valid payload writes marker file and returns 0", async () => {
    const sessionId = crypto.randomUUID();
    sessionIdsToClean.push(sessionId);

    mockStdin(JSON.stringify({ session_id: sessionId }));

    const code = await claudeStopHookCommand();

    expect(code).toBe(0);
    expect(await fileExists(join(markerDir, sessionId))).toBe(true);
    expect(await fileExists(join(markerDir, `${sessionId}.tmp`))).toBe(false);
  });

  // 2. stop_hook_active: true → no-op
  test("stop_hook_active:true is a no-op and returns 0", async () => {
    const sessionId = crypto.randomUUID();
    sessionIdsToClean.push(sessionId);

    mockStdin(
      JSON.stringify({ session_id: sessionId, stop_hook_active: true }),
    );

    const code = await claudeStopHookCommand();

    expect(code).toBe(0);
    expect(await fileExists(join(markerDir, sessionId))).toBe(false);
    expect(await fileExists(join(markerDir, `${sessionId}.tmp`))).toBe(false);
  });

  // 3. Malformed JSON → returns 0, logs to console.error
  test("malformed JSON returns 0 and logs an error", async () => {
    mockStdin("not json {{{");

    // Spy on console.error so the error doesn't bleed into test output.
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const code = await claudeStopHookCommand();

    expect(code).toBe(0);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  // 4. Missing session_id → returns 0, logs to console.error
  test("missing session_id returns 0 and logs an error", async () => {
    mockStdin(JSON.stringify({}));

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const code = await claudeStopHookCommand();

    expect(code).toBe(0);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  // 5. Extra payload fields are tolerated
  test("valid payload with optional fields writes marker and returns 0", async () => {
    const sessionId = crypto.randomUUID();
    sessionIdsToClean.push(sessionId);

    mockStdin(
      JSON.stringify({
        session_id: sessionId,
        transcript_path: "/tmp/transcript.json",
        cwd: "/home/user/project",
        stop_hook_active: false,
      }),
    );

    const code = await claudeStopHookCommand();

    expect(code).toBe(0);
    expect(await fileExists(join(markerDir, sessionId))).toBe(true);
    expect(await fileExists(join(markerDir, `${sessionId}.tmp`))).toBe(false);
  });
});
