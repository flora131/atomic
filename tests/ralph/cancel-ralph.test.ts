import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Tests for .github/scripts/cancel-ralph.ts
 *
 * Tests the cancel script for Ralph loop functionality:
 * - Graceful handling when no loop is active
 * - State file archiving with cancellation metadata
 * - Cleanup of state file and continue flag
 * - Output messages
 */

const RALPH_STATE_FILE = ".github/ralph-loop.local.md";
const RALPH_CONTINUE_FILE = ".github/ralph-continue.flag";
const RALPH_LOG_DIR = ".github/logs";

// Helper to run the script
async function runCancelRalph(): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(["bun", "run", ".github/scripts/cancel-ralph.ts"], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

// Helper to create a test state file
function createTestStateFile(options: {
  iteration?: number;
  maxIterations?: number;
  completionPromise?: string | null;
  startedAt?: string;
  prompt?: string;
} = {}): void {
  const {
    iteration = 3,
    maxIterations = 10,
    completionPromise = null,
    startedAt = "2026-01-24T10:00:00Z",
    prompt = "Test prompt content.",
  } = options;

  const completionPromiseYaml = completionPromise === null ? "null" : `"${completionPromise}"`;

  const content = `---
active: true
iteration: ${iteration}
max_iterations: ${maxIterations}
completion_promise: ${completionPromiseYaml}
feature_list_path: research/feature-list.json
started_at: "${startedAt}"
---

${prompt}
`;

  writeFileSync(RALPH_STATE_FILE, content, "utf-8");
}

describe("cancel-ralph.ts", () => {
  beforeEach(() => {
    // Clean up state files before each test
    if (existsSync(RALPH_STATE_FILE)) {
      rmSync(RALPH_STATE_FILE);
    }
    if (existsSync(RALPH_CONTINUE_FILE)) {
      rmSync(RALPH_CONTINUE_FILE);
    }
  });

  afterEach(() => {
    // Clean up after tests
    if (existsSync(RALPH_STATE_FILE)) {
      rmSync(RALPH_STATE_FILE);
    }
    if (existsSync(RALPH_CONTINUE_FILE)) {
      rmSync(RALPH_CONTINUE_FILE);
    }
  });

  describe("no active loop", () => {
    test("reports no active loop when state file missing", async () => {
      const { stdout, exitCode } = await runCancelRalph();

      expect(exitCode).toBe(0);
      expect(stdout).toContain("No active Ralph loop found.");
      expect(stdout).toContain("Checking for orphaned Ralph processes...");
    });

    test("exits with code 0 when no loop active", async () => {
      const { exitCode } = await runCancelRalph();
      expect(exitCode).toBe(0);
    });
  });

  describe("active loop cancellation", () => {
    test("reports iteration count when cancelling", async () => {
      createTestStateFile({ iteration: 7 });

      const { stdout } = await runCancelRalph();

      expect(stdout).toContain("Cancelled Ralph loop (was at iteration 7)");
    });

    test("shows started at timestamp", async () => {
      createTestStateFile({ startedAt: "2026-01-24T08:30:00Z" });

      const { stdout } = await runCancelRalph();

      expect(stdout).toContain("Started at: 2026-01-24T08:30:00Z");
    });

    test("shows prompt in summary", async () => {
      createTestStateFile({ prompt: "My test prompt" });

      const { stdout } = await runCancelRalph();

      expect(stdout).toContain("Prompt: My test prompt");
    });

    test("truncates long prompts in summary", async () => {
      const longPrompt = "A".repeat(100);
      createTestStateFile({ prompt: longPrompt });

      const { stdout } = await runCancelRalph();

      // Should show truncated version (80 chars + ...)
      expect(stdout).toContain("A".repeat(80) + "...");
    });

    test("reports archive file location", async () => {
      createTestStateFile();

      const { stdout } = await runCancelRalph();

      expect(stdout).toContain("State archived to: .github/logs/ralph-loop-cancelled-");
      expect(stdout).toContain(".md");
    });

    test("reports all processes terminated", async () => {
      createTestStateFile();

      const { stdout } = await runCancelRalph();

      expect(stdout).toContain("All Ralph processes have been terminated.");
    });
  });

  describe("file cleanup", () => {
    test("deletes state file", async () => {
      createTestStateFile();
      expect(existsSync(RALPH_STATE_FILE)).toBe(true);

      await runCancelRalph();

      expect(existsSync(RALPH_STATE_FILE)).toBe(false);
    });

    test("deletes continue flag file", async () => {
      createTestStateFile();
      writeFileSync(RALPH_CONTINUE_FILE, "test content", "utf-8");
      expect(existsSync(RALPH_CONTINUE_FILE)).toBe(true);

      await runCancelRalph();

      expect(existsSync(RALPH_CONTINUE_FILE)).toBe(false);
    });

    test("handles missing continue flag gracefully", async () => {
      createTestStateFile();
      // Don't create continue flag

      const { exitCode } = await runCancelRalph();

      expect(exitCode).toBe(0);
    });
  });

  describe("state archiving", () => {
    test("creates archive file in logs directory", async () => {
      createTestStateFile();

      await runCancelRalph();

      // Check that an archive file was created
      const Glob = new Bun.Glob("ralph-loop-cancelled-*.md");
      const matches = [...Glob.scanSync(RALPH_LOG_DIR)];
      expect(matches.length).toBeGreaterThan(0);
    });

    test("archive contains cancellation metadata", async () => {
      createTestStateFile({ iteration: 5 });

      const { stdout } = await runCancelRalph();

      // Extract archive filename from output
      const archiveMatch = stdout.match(/State archived to: (.+\.md)/);
      expect(archiveMatch).not.toBeNull();

      const archiveFile = archiveMatch![1]!;
      const archiveContent = readFileSync(archiveFile, "utf-8");

      expect(archiveContent).toContain("active: false");
      expect(archiveContent).toContain("iteration: 5");
      expect(archiveContent).toContain("cancelled_at:");
      expect(archiveContent).toContain('stop_reason: "user_cancelled"');
    });

    test("archive preserves original prompt", async () => {
      createTestStateFile({ prompt: "Original prompt content" });

      const { stdout } = await runCancelRalph();

      const archiveMatch = stdout.match(/State archived to: (.+\.md)/);
      const archiveFile = archiveMatch![1]!;
      const archiveContent = readFileSync(archiveFile, "utf-8");

      expect(archiveContent).toContain("Original prompt content");
    });

    test("creates logs directory if missing", async () => {
      // Remove logs directory
      if (existsSync(RALPH_LOG_DIR)) {
        rmSync(RALPH_LOG_DIR, { recursive: true });
      }

      createTestStateFile();

      const { exitCode } = await runCancelRalph();

      expect(exitCode).toBe(0);
      expect(existsSync(RALPH_LOG_DIR)).toBe(true);
    });
  });
});
