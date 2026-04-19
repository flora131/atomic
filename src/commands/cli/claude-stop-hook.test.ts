/**
 * Tests for claudeStopHookCommand.
 *
 * Strategy: monkey-patch `Bun.stdin.text` to return preset strings so we can
 * call the function directly without spawning subprocesses. This is
 * consistent with how other CLI-command tests in this directory work.
 *
 * Filesystem isolation: we use `crypto.randomUUID()` for unique session IDs
 * and clean up in `afterEach` so test runs never collide with each other
 * or with real marker/queue/release files.
 *
 * The hook's default wait for a queued follow-up prompt is 15 minutes.
 * Every test here passes a short `waitTimeoutMs` so the hook exits quickly
 * when no queue entry is present — we are testing the branching logic,
 * not the real-world wait budget.
 */

import { describe, test, expect, afterEach, spyOn } from "bun:test";
import { access, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { claudeStopHookCommand, claudeHookDirs } from "./claude-stop-hook.ts";

const { marker: markerDir, queue: queueDir, release: releaseDir } = claudeHookDirs();

const SHORT_TIMEOUT_MS = 300;

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
  (Bun.stdin as { text: () => Promise<string> }).text = () =>
    Promise.resolve(text);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const sessionIdsToClean: string[] = [];

afterEach(async () => {
  for (const id of sessionIdsToClean) {
    await Promise.all([
      rm(join(markerDir, id), { force: true }),
      rm(join(queueDir, id), { force: true }),
      rm(join(releaseDir, id), { force: true }),
    ]);
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

    const code = await claudeStopHookCommand({ waitTimeoutMs: SHORT_TIMEOUT_MS });

    expect(code).toBe(0);
    expect(await fileExists(join(markerDir, sessionId))).toBe(true);
    // No .tmp file should ever be created — we write directly to final path.
    expect(await fileExists(join(markerDir, `${sessionId}.tmp`))).toBe(false);
  });

  // 2. stop_hook_active: true still writes marker and polls the queue
  //
  // Claude Code sets `stopHookActive: true` on every Stop hook invocation
  // after a prior `{decision:"block"}` response (see `src/query.ts` →
  // `transition: { reason: 'stop_hook_blocking' }`). Multi-turn workflows
  // therefore see `stop_hook_active=true` on every turn past the first. The
  // hook must still write the marker so `waitForIdle` unblocks, and must
  // still poll for queued follow-ups so the next `s.session.query(...)` can
  // reach Claude.
  test("stop_hook_active:true still writes marker and polls the queue", async () => {
    const sessionId = crypto.randomUUID();
    sessionIdsToClean.push(sessionId);

    const queuedPrompt = "Third turn follow-up";
    await mkdir(queueDir, { recursive: true });
    await writeFile(join(queueDir, sessionId), queuedPrompt, "utf-8");

    mockStdin(
      JSON.stringify({ session_id: sessionId, stop_hook_active: true }),
    );

    const stdoutChunks: string[] = [];
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      (chunk: unknown) => {
        stdoutChunks.push(String(chunk));
        return true;
      },
    );

    const code = await claudeStopHookCommand({ waitTimeoutMs: SHORT_TIMEOUT_MS });

    stdoutSpy.mockRestore();

    expect(code).toBe(0);
    // Marker must be written so waitForIdle unblocks on every turn.
    expect(await fileExists(join(markerDir, sessionId))).toBe(true);
    // Queue entry consumed and emitted as a block decision.
    expect(await fileExists(join(queueDir, sessionId))).toBe(false);
    const parsed: unknown = JSON.parse(stdoutChunks.join(""));
    expect(parsed).toEqual({ decision: "block", reason: queuedPrompt });
  });

  // 3. Malformed JSON → returns 0, logs to console.error
  test("malformed JSON returns 0 and logs an error", async () => {
    mockStdin("not json {{{");

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const code = await claudeStopHookCommand({ waitTimeoutMs: SHORT_TIMEOUT_MS });

    expect(code).toBe(0);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  // 4. Missing session_id → returns 0, logs to console.error
  test("missing session_id returns 0 and logs an error", async () => {
    mockStdin(JSON.stringify({}));

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const code = await claudeStopHookCommand({ waitTimeoutMs: SHORT_TIMEOUT_MS });

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

    const code = await claudeStopHookCommand({ waitTimeoutMs: SHORT_TIMEOUT_MS });

    expect(code).toBe(0);
    expect(await fileExists(join(markerDir, sessionId))).toBe(true);
    expect(await fileExists(join(markerDir, `${sessionId}.tmp`))).toBe(false);
  });

  // 6. Queue file present at entry → emit block+reason, consume queue
  test("queued prompt is emitted as a block decision and the queue file is consumed", async () => {
    const sessionId = crypto.randomUUID();
    sessionIdsToClean.push(sessionId);

    const queuedPrompt = "Now translate your previous greeting into pig latin.";
    await mkdir(queueDir, { recursive: true });
    await writeFile(join(queueDir, sessionId), queuedPrompt, "utf-8");

    mockStdin(JSON.stringify({ session_id: sessionId }));

    const stdoutChunks: string[] = [];
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      (chunk: unknown) => {
        stdoutChunks.push(String(chunk));
        return true;
      },
    );

    const code = await claudeStopHookCommand({ waitTimeoutMs: SHORT_TIMEOUT_MS });

    stdoutSpy.mockRestore();

    expect(code).toBe(0);
    // Marker still written, since the workflow's waitForIdle depends on it.
    expect(await fileExists(join(markerDir, sessionId))).toBe(true);
    // Queue entry consumed.
    expect(await fileExists(join(queueDir, sessionId))).toBe(false);
    // Block decision emitted with the queued prompt as `reason`.
    const emitted = stdoutChunks.join("");
    const parsed: unknown = JSON.parse(emitted);
    expect(parsed).toEqual({ decision: "block", reason: queuedPrompt });
  });

  // 7. Queue file appears during wait → still consumed and emitted
  test("queue file written during the wait is consumed and emitted", async () => {
    const sessionId = crypto.randomUUID();
    sessionIdsToClean.push(sessionId);

    const queuedPrompt = "Follow-up written mid-wait";

    mockStdin(JSON.stringify({ session_id: sessionId }));

    const stdoutChunks: string[] = [];
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      (chunk: unknown) => {
        stdoutChunks.push(String(chunk));
        return true;
      },
    );

    // Kick the hook off, then write the queue file partway through its wait.
    const hookPromise = claudeStopHookCommand({
      waitTimeoutMs: 2_000,
      pollIntervalMs: 25,
    });

    await Bun.sleep(120);
    await mkdir(queueDir, { recursive: true });
    await writeFile(join(queueDir, sessionId), queuedPrompt, "utf-8");

    const code = await hookPromise;
    stdoutSpy.mockRestore();

    expect(code).toBe(0);
    expect(await fileExists(join(queueDir, sessionId))).toBe(false);
    const parsed: unknown = JSON.parse(stdoutChunks.join(""));
    expect(parsed).toEqual({ decision: "block", reason: queuedPrompt });
  });

  // 8. Release file present → exit 0, no stdout, consume release
  test("release file lets the hook exit promptly without a decision", async () => {
    const sessionId = crypto.randomUUID();
    sessionIdsToClean.push(sessionId);

    await mkdir(releaseDir, { recursive: true });
    await writeFile(join(releaseDir, sessionId), "", "utf-8");

    mockStdin(JSON.stringify({ session_id: sessionId }));

    const stdoutChunks: string[] = [];
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      (chunk: unknown) => {
        stdoutChunks.push(String(chunk));
        return true;
      },
    );

    const code = await claudeStopHookCommand({ waitTimeoutMs: SHORT_TIMEOUT_MS });

    stdoutSpy.mockRestore();

    expect(code).toBe(0);
    // Release consumed so it doesn't carry over.
    expect(await fileExists(join(releaseDir, sessionId))).toBe(false);
    // Marker still written.
    expect(await fileExists(join(markerDir, sessionId))).toBe(true);
    // No block decision emitted.
    expect(stdoutChunks.join("")).toBe("");
  });
});
