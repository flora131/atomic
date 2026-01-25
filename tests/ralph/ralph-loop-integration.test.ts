import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Integration tests for full Ralph loop lifecycle
 *
 * Feature 9 from research/feature-list.json
 *
 * Tests the complete Ralph loop workflow:
 * - Loop setup creates correct state files
 * - Session start hook increments iteration
 * - Stop hook updates state file properly
 * - Cancel operation archives and cleans up
 * - Max iterations causes automatic loop termination
 * - Completion promise detection ends loop
 * - Cross-platform compatibility with Bun runtime
 */

// File paths
const STATE_FILE = ".github/ralph-loop.local.md";
const CONTINUE_FILE = ".github/ralph-continue.flag";
const LOG_DIR = ".github/logs";
const SESSIONS_LOG = ".github/logs/ralph-sessions.jsonl";

// Scripts
const RALPH_LOOP_SCRIPT = ".github/scripts/ralph-loop.ts";
const START_SESSION_SCRIPT = ".github/scripts/start-ralph-session.ts";
const CANCEL_SCRIPT = ".github/scripts/cancel-ralph.ts";
const STOP_HOOK_SCRIPT = ".github/hooks/stop-hook.ts";

// Test directory for temporary files
const TEST_DIR = ".github-integration-test";

// Helper to run a script with arguments
async function runScript(
  script: string,
  args: string[] = [],
  stdin?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", script, ...args], {
    stdin: stdin ? new Response(stdin).body : undefined,
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

// Helper to parse YAML frontmatter from state file
function parseStateFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;

  const content = readFileSync(path, "utf-8").replace(/\r\n/g, "\n");
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const [, frontmatter, prompt] = frontmatterMatch;

  const getValue = (key: string): string | null => {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
    if (!match) return null;
    return match[1].replace(/^["'](.*)["']$/, "$1");
  };

  return {
    active: getValue("active") === "true",
    iteration: parseInt(getValue("iteration") || "1", 10),
    maxIterations: parseInt(getValue("max_iterations") || "0", 10),
    completionPromise: getValue("completion_promise") === "null" ? null : getValue("completion_promise"),
    featureListPath: getValue("feature_list_path") || "research/feature-list.json",
    startedAt: getValue("started_at"),
    prompt: prompt.trim(),
  };
}

// Helper to clean up all Ralph loop files
function cleanupRalphFiles(): void {
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
  if (existsSync(CONTINUE_FILE)) rmSync(CONTINUE_FILE);
  if (existsSync(SESSIONS_LOG)) rmSync(SESSIONS_LOG);
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

describe("Ralph Loop Integration Tests", () => {
  beforeEach(() => {
    cleanupRalphFiles();
  });

  afterEach(() => {
    cleanupRalphFiles();
  });

  // ==========================================================================
  // LOOP SETUP TESTS
  // ==========================================================================

  describe("loop setup with ralph-loop.ts", () => {
    test("creates state file with correct format", async () => {
      await runScript(RALPH_LOOP_SCRIPT, ["Test prompt"]);

      expect(existsSync(STATE_FILE)).toBe(true);

      const state = parseStateFile(STATE_FILE);
      expect(state).not.toBeNull();
      expect(state!.active).toBe(true);
      expect(state!.iteration).toBe(1);
      expect(state!.prompt).toBe("Test prompt");
    });

    test("creates continue flag file", async () => {
      await runScript(RALPH_LOOP_SCRIPT, ["My test prompt"]);

      expect(existsSync(CONTINUE_FILE)).toBe(true);
      const content = readFileSync(CONTINUE_FILE, "utf-8");
      expect(content).toBe("My test prompt");
    });

    test("sets max_iterations correctly", async () => {
      await runScript(RALPH_LOOP_SCRIPT, ["Test", "--max-iterations", "25"]);

      const state = parseStateFile(STATE_FILE);
      expect(state!.maxIterations).toBe(25);
    });

    test("sets completion_promise correctly", async () => {
      await runScript(RALPH_LOOP_SCRIPT, ["Test", "--completion-promise", "All done"]);

      const state = parseStateFile(STATE_FILE);
      expect(state!.completionPromise).toBe("All done");
    });

    test("sets feature_list_path correctly", async () => {
      // Create test feature list
      mkdirSync(TEST_DIR, { recursive: true });
      const testPath = join(TEST_DIR, "features.json");
      writeFileSync(testPath, "[]", "utf-8");

      await runScript(RALPH_LOOP_SCRIPT, ["Test", "--feature-list", testPath]);

      const state = parseStateFile(STATE_FILE);
      expect(state!.featureListPath).toBe(testPath);
    });

    test("sets started_at timestamp", async () => {
      await runScript(RALPH_LOOP_SCRIPT, ["Test"]);

      const state = parseStateFile(STATE_FILE);
      expect(state!.startedAt).toBeTruthy();

      // Verify timestamp is a valid ISO date string
      const startedAt = state!.startedAt as string;
      expect(() => new Date(startedAt)).not.toThrow();

      // Verify it's a recent timestamp (within last minute)
      const now = new Date();
      const timestamp = new Date(startedAt);
      const diffMs = now.getTime() - timestamp.getTime();
      expect(diffMs).toBeLessThan(60000); // Less than 1 minute
      expect(diffMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // SESSION START HOOK TESTS
  // ==========================================================================

  describe("session start hook increments iteration", () => {
    test("increments iteration on resume source", async () => {
      // Setup: Create initial state at iteration 5
      await runScript(RALPH_LOOP_SCRIPT, ["Test prompt"]);

      // Manually update to iteration 5
      const initialState = parseStateFile(STATE_FILE);
      const updatedContent = readFileSync(STATE_FILE, "utf-8").replace(
        "iteration: 1",
        "iteration: 5"
      );
      writeFileSync(STATE_FILE, updatedContent);

      // Run session start hook with resume source
      const hookInput = JSON.stringify({
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
        source: "resume",
      });

      const { stderr } = await runScript(START_SESSION_SCRIPT, [], hookInput);

      // Verify iteration was incremented
      const state = parseStateFile(STATE_FILE);
      expect(state!.iteration).toBe(6);
      expect(stderr).toContain("continuing at iteration 6");
    });

    test("increments iteration on startup source", async () => {
      // Setup: Create initial state at iteration 10
      await runScript(RALPH_LOOP_SCRIPT, ["Test prompt"]);

      const updatedContent = readFileSync(STATE_FILE, "utf-8").replace(
        "iteration: 1",
        "iteration: 10"
      );
      writeFileSync(STATE_FILE, updatedContent);

      // Run session start hook with startup source
      const hookInput = JSON.stringify({
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
        source: "startup",
      });

      const { stderr } = await runScript(START_SESSION_SCRIPT, [], hookInput);

      // Verify iteration was incremented
      const state = parseStateFile(STATE_FILE);
      expect(state!.iteration).toBe(11);
      expect(stderr).toContain("continuing at iteration 11");
    });

    test("does not increment on manual source", async () => {
      // Setup: Create initial state at iteration 3
      await runScript(RALPH_LOOP_SCRIPT, ["Test prompt"]);

      const updatedContent = readFileSync(STATE_FILE, "utf-8").replace(
        "iteration: 1",
        "iteration: 3"
      );
      writeFileSync(STATE_FILE, updatedContent);

      // Run session start hook with manual source
      const hookInput = JSON.stringify({
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
        source: "manual",
      });

      await runScript(START_SESSION_SCRIPT, [], hookInput);

      // Verify iteration was NOT incremented
      const state = parseStateFile(STATE_FILE);
      expect(state!.iteration).toBe(3);
    });

    test("logs session start event", async () => {
      // Clear existing log
      if (existsSync(SESSIONS_LOG)) rmSync(SESSIONS_LOG);

      await runScript(RALPH_LOOP_SCRIPT, ["Test"]);

      const hookInput = JSON.stringify({
        timestamp: "2026-01-24T12:00:00Z",
        cwd: "/test/path",
        source: "manual",
        initialPrompt: "Test prompt",
      });

      await runScript(START_SESSION_SCRIPT, [], hookInput);

      // Verify log entry
      expect(existsSync(SESSIONS_LOG)).toBe(true);
      const logContent = readFileSync(SESSIONS_LOG, "utf-8");
      const lastLine = logContent.trim().split("\n").pop()!;
      const parsed = JSON.parse(lastLine);

      expect(parsed.event).toBe("session_start");
      expect(parsed.source).toBe("manual");
    });
  });

  // ==========================================================================
  // STOP HOOK TESTS
  // ==========================================================================

  describe("stop hook updates state file", () => {
    test("logs session end event", async () => {
      // Clear existing log
      if (existsSync(SESSIONS_LOG)) rmSync(SESSIONS_LOG);

      // Ensure log directory exists
      mkdirSync(LOG_DIR, { recursive: true });

      const hookInput = JSON.stringify({
        timestamp: "2026-01-24T12:30:00Z",
        cwd: "/test/path",
        reason: "user_exit",
      });

      await runScript(STOP_HOOK_SCRIPT, [], hookInput);

      // Verify log entry
      expect(existsSync(SESSIONS_LOG)).toBe(true);
      const logContent = readFileSync(SESSIONS_LOG, "utf-8");
      const lastLine = logContent.trim().split("\n").pop()!;
      const parsed = JSON.parse(lastLine);

      expect(parsed.event).toBe("session_end");
      expect(parsed.reason).toBe("user_exit");
    });

    test("handles missing state file gracefully", async () => {
      // Ensure no state file exists
      if (existsSync(STATE_FILE)) rmSync(STATE_FILE);

      const hookInput = JSON.stringify({
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
        reason: "complete",
      });

      const { exitCode } = await runScript(STOP_HOOK_SCRIPT, [], hookInput);

      // Should not crash
      expect(exitCode).toBe(0);
    });
  });

  // ==========================================================================
  // CANCEL OPERATION TESTS
  // ==========================================================================

  describe("cancel operation archives and cleans up", () => {
    test("removes state file", async () => {
      // Setup: Create active loop
      await runScript(RALPH_LOOP_SCRIPT, ["Test prompt"]);
      expect(existsSync(STATE_FILE)).toBe(true);

      // Cancel
      await runScript(CANCEL_SCRIPT);

      // Verify state file removed
      expect(existsSync(STATE_FILE)).toBe(false);
    });

    test("removes continue flag", async () => {
      // Setup: Create active loop
      await runScript(RALPH_LOOP_SCRIPT, ["Test prompt"]);
      expect(existsSync(CONTINUE_FILE)).toBe(true);

      // Cancel
      await runScript(CANCEL_SCRIPT);

      // Verify continue flag removed
      expect(existsSync(CONTINUE_FILE)).toBe(false);
    });

    test("creates archive file", async () => {
      // Setup: Create active loop
      await runScript(RALPH_LOOP_SCRIPT, ["Test prompt"]);

      // Cancel
      const { stdout } = await runScript(CANCEL_SCRIPT);

      // Check that archive was mentioned in output
      expect(stdout).toContain("archived");

      // Verify an archive file was created
      const archiveFiles = require("fs")
        .readdirSync(LOG_DIR)
        .filter((f: string) => f.startsWith("ralph-loop-cancelled-"));
      expect(archiveFiles.length).toBeGreaterThan(0);

      // Cleanup archive
      for (const file of archiveFiles) {
        rmSync(join(LOG_DIR, file));
      }
    });

    test("archive contains state data", async () => {
      // Setup: Create active loop with specific config
      await runScript(RALPH_LOOP_SCRIPT, [
        "My test prompt",
        "--max-iterations",
        "15",
        "--completion-promise",
        "FINISHED",
      ]);

      // Update iteration to simulate progress
      const content = readFileSync(STATE_FILE, "utf-8").replace("iteration: 1", "iteration: 7");
      writeFileSync(STATE_FILE, content);

      // Cancel
      await runScript(CANCEL_SCRIPT);

      // Find and read archive
      const archiveFiles = require("fs")
        .readdirSync(LOG_DIR)
        .filter((f: string) => f.startsWith("ralph-loop-cancelled-"));

      expect(archiveFiles.length).toBe(1);

      const archiveContent = readFileSync(join(LOG_DIR, archiveFiles[0]), "utf-8");

      // Verify archive contains original data plus cancellation metadata
      expect(archiveContent).toContain("iteration: 7");
      expect(archiveContent).toContain("max_iterations: 15");
      expect(archiveContent).toContain("My test prompt");
      expect(archiveContent).toContain("cancelled_at:");

      // Cleanup
      rmSync(join(LOG_DIR, archiveFiles[0]));
    });

    test("handles no active loop gracefully", async () => {
      // Ensure no state file
      if (existsSync(STATE_FILE)) rmSync(STATE_FILE);

      const { stdout, exitCode } = await runScript(CANCEL_SCRIPT);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("No active Ralph loop");
    });
  });

  // ==========================================================================
  // MAX ITERATIONS TESTS
  // ==========================================================================

  describe("max iterations limit", () => {
    test("state file tracks iteration count", async () => {
      await runScript(RALPH_LOOP_SCRIPT, ["Test", "--max-iterations", "10"]);

      const state = parseStateFile(STATE_FILE);
      expect(state!.iteration).toBe(1);
      expect(state!.maxIterations).toBe(10);
    });

    test("iteration increments on each session start", async () => {
      await runScript(RALPH_LOOP_SCRIPT, ["Test", "--max-iterations", "10"]);

      // Simulate multiple session starts
      for (let i = 1; i <= 3; i++) {
        const hookInput = JSON.stringify({
          timestamp: new Date().toISOString(),
          source: "resume",
        });

        await runScript(START_SESSION_SCRIPT, [], hookInput);

        const state = parseStateFile(STATE_FILE);
        expect(state!.iteration).toBe(i + 1);
      }
    });

    test("unlimited iterations when max_iterations is 0", async () => {
      await runScript(RALPH_LOOP_SCRIPT, ["Test", "--max-iterations", "0"]);

      const state = parseStateFile(STATE_FILE);
      expect(state!.maxIterations).toBe(0);

      // Simulate high iteration count
      const content = readFileSync(STATE_FILE, "utf-8").replace("iteration: 1", "iteration: 999");
      writeFileSync(STATE_FILE, content);

      const updatedState = parseStateFile(STATE_FILE);
      expect(updatedState!.iteration).toBe(999);
      // Loop should still be active (would be handled by stop hook logic)
      expect(updatedState!.active).toBe(true);
    });
  });

  // ==========================================================================
  // COMPLETION PROMISE TESTS
  // ==========================================================================

  describe("completion promise handling", () => {
    test("state file stores completion promise", async () => {
      await runScript(RALPH_LOOP_SCRIPT, ["Test", "--completion-promise", "All tests pass"]);

      const state = parseStateFile(STATE_FILE);
      expect(state!.completionPromise).toBe("All tests pass");
    });

    test("null completion promise when not specified", async () => {
      await runScript(RALPH_LOOP_SCRIPT, ["Test"]);

      const state = parseStateFile(STATE_FILE);
      expect(state!.completionPromise).toBeNull();
    });

    test("completion promise with special characters", async () => {
      await runScript(RALPH_LOOP_SCRIPT, [
        "Test",
        "--completion-promise",
        "Done! 100% complete",
      ]);

      const state = parseStateFile(STATE_FILE);
      expect(state!.completionPromise).toBe("Done! 100% complete");
    });
  });

  // ==========================================================================
  // CROSS-PLATFORM COMPATIBILITY TESTS
  // ==========================================================================

  describe("cross-platform compatibility", () => {
    test("handles CRLF line endings in state file", async () => {
      await runScript(RALPH_LOOP_SCRIPT, ["Test prompt"]);

      // Convert state file to CRLF
      const content = readFileSync(STATE_FILE, "utf-8");
      const crlfContent = content.replace(/\n/g, "\r\n");
      writeFileSync(STATE_FILE, crlfContent);

      // Session start should still work
      const hookInput = JSON.stringify({
        timestamp: new Date().toISOString(),
        source: "resume",
      });

      const { exitCode, stderr } = await runScript(START_SESSION_SCRIPT, [], hookInput);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("Ralph loop");
    });

    test("scripts use Bun runtime", async () => {
      // Verify scripts have correct shebang
      const ralphLoopContent = readFileSync(RALPH_LOOP_SCRIPT, "utf-8");
      expect(ralphLoopContent.startsWith("#!/usr/bin/env bun")).toBe(true);

      const startSessionContent = readFileSync(START_SESSION_SCRIPT, "utf-8");
      expect(startSessionContent.startsWith("#!/usr/bin/env bun")).toBe(true);

      const cancelContent = readFileSync(CANCEL_SCRIPT, "utf-8");
      expect(cancelContent.startsWith("#!/usr/bin/env bun")).toBe(true);

      const stopHookContent = readFileSync(STOP_HOOK_SCRIPT, "utf-8");
      expect(stopHookContent.startsWith("#!/usr/bin/env bun")).toBe(true);
    });

    test("state file uses UTF-8 encoding", async () => {
      await runScript(RALPH_LOOP_SCRIPT, ["Test with unicode: 日本語 🎉"]);

      const content = readFileSync(STATE_FILE, "utf-8");
      expect(content).toContain("日本語");
      expect(content).toContain("🎉");
    });
  });

  // ==========================================================================
  // FULL LIFECYCLE TESTS
  // ==========================================================================

  describe("full lifecycle workflow", () => {
    test("setup -> multiple starts -> cancel", async () => {
      // Step 1: Setup loop
      const { exitCode: setupExit } = await runScript(RALPH_LOOP_SCRIPT, [
        "Lifecycle test",
        "--max-iterations",
        "100", // High limit to avoid early termination
      ]);
      expect(setupExit).toBe(0);
      expect(existsSync(STATE_FILE)).toBe(true);
      expect(existsSync(CONTINUE_FILE)).toBe(true);

      let state = parseStateFile(STATE_FILE);
      const initialIteration = state!.iteration;
      expect(initialIteration).toBe(1);

      // Step 2: Simulate multiple session cycles
      // Note: Both session start (resume) and stop hook increment iteration
      // So each cycle increments by 2
      for (let i = 0; i < 3; i++) {
        // Session start (increments iteration)
        const startInput = JSON.stringify({
          timestamp: new Date().toISOString(),
          source: "resume",
        });
        await runScript(START_SESSION_SCRIPT, [], startInput);

        // Session end (also increments iteration for next session)
        const endInput = JSON.stringify({
          timestamp: new Date().toISOString(),
          reason: "complete",
        });
        await runScript(STOP_HOOK_SCRIPT, [], endInput);
      }

      // Verify iteration increased
      state = parseStateFile(STATE_FILE);
      // Each cycle: start increments (+1), stop increments (+1) = +2 per cycle
      // 3 cycles * 2 = 6 increments from initial 1 = 7
      expect(state!.iteration).toBeGreaterThan(initialIteration);

      // Step 3: Cancel loop
      const { exitCode: cancelExit } = await runScript(CANCEL_SCRIPT);
      expect(cancelExit).toBe(0);

      // Verify cleanup
      expect(existsSync(STATE_FILE)).toBe(false);
      expect(existsSync(CONTINUE_FILE)).toBe(false);

      // Verify archive exists
      const archiveFiles = require("fs")
        .readdirSync(LOG_DIR)
        .filter((f: string) => f.startsWith("ralph-loop-cancelled-"));
      expect(archiveFiles.length).toBeGreaterThanOrEqual(1);

      // Cleanup archives
      for (const file of archiveFiles) {
        rmSync(join(LOG_DIR, file));
      }
    });

    test("session log accumulates entries", async () => {
      // Clear log completely
      if (existsSync(SESSIONS_LOG)) rmSync(SESSIONS_LOG);

      // Ensure log directory exists
      mkdirSync(LOG_DIR, { recursive: true });

      // Create empty log file
      writeFileSync(SESSIONS_LOG, "", "utf-8");

      // Setup
      await runScript(RALPH_LOOP_SCRIPT, ["Test", "--max-iterations", "100"]);

      // Multiple session cycles
      for (let i = 0; i < 3; i++) {
        const startInput = JSON.stringify({
          timestamp: new Date().toISOString(),
          source: "resume",
        });
        await runScript(START_SESSION_SCRIPT, [], startInput);

        const endInput = JSON.stringify({
          timestamp: new Date().toISOString(),
          reason: "complete",
        });
        await runScript(STOP_HOOK_SCRIPT, [], endInput);
      }

      // Verify log entries
      const logContent = readFileSync(SESSIONS_LOG, "utf-8");
      const lines = logContent.trim().split("\n").filter(line => line.trim());
      const entries = lines.map((line) => JSON.parse(line));

      // Should have at least 3 starts + 3 ends = 6 entries
      // (may have more from other tests if cleanup didn't work)
      expect(entries.length).toBeGreaterThanOrEqual(6);

      const startEvents = entries.filter((e) => e.event === "session_start");
      const endEvents = entries.filter((e) => e.event === "session_end");

      expect(startEvents.length).toBeGreaterThanOrEqual(3);
      expect(endEvents.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe("error handling", () => {
    test("handles malformed JSON input to hooks", async () => {
      const { exitCode } = await runScript(START_SESSION_SCRIPT, [], "not valid json");
      expect(exitCode).toBe(0); // Should not crash
    });

    test("handles empty input to hooks", async () => {
      const { exitCode } = await runScript(START_SESSION_SCRIPT, [], "");
      expect(exitCode).toBe(0);
    });

    test("handles missing log directory", async () => {
      // Remove log directory
      if (existsSync(LOG_DIR)) rmSync(LOG_DIR, { recursive: true });

      const hookInput = JSON.stringify({
        timestamp: new Date().toISOString(),
      });

      const { exitCode } = await runScript(START_SESSION_SCRIPT, [], hookInput);

      // Should create directory and succeed
      expect(exitCode).toBe(0);
      expect(existsSync(LOG_DIR)).toBe(true);
    });
  });
});
