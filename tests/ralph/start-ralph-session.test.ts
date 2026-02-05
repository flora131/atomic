import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Tests for .github/scripts/start-ralph-session.ts
 *
 * Covers ONLY unique behavior not tested by integration tests:
 * - Default field handling for missing input
 * - stderr status output display (active loop, unlimited, silent, inactive)
 */

const TEST_DIR = ".github-test";
const RALPH_LOG_DIR = join(TEST_DIR, "logs");

// Helper to run the script with mocked paths
async function runStartRalphSession(
  input: object | string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const inputStr = typeof input === "string" ? input : JSON.stringify(input);

  const proc = Bun.spawn(["bun", "run", ".github/scripts/start-ralph-session.ts"], {
    stdin: new Response(inputStr).body,
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

describe("start-ralph-session.ts", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(RALPH_LOG_DIR, { recursive: true });
    // Clean up any state files from prior tests
    const actualStateFile = ".github/ralph-loop.local.md";
    if (existsSync(actualStateFile)) {
      rmSync(actualStateFile);
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    const actualStateFile = ".github/ralph-loop.local.md";
    if (existsSync(actualStateFile)) {
      rmSync(actualStateFile);
    }
  });

  describe("default field handling", () => {
    test("handles missing optional fields with defaults", async () => {
      const { exitCode } = await runStartRalphSession({});
      expect(exitCode).toBe(0);

      const logFile = ".github/logs/ralph-sessions.jsonl";
      const logContent = readFileSync(logFile, "utf-8");
      const lastLine = logContent.trim().split("\n").pop()!;
      const parsed = JSON.parse(lastLine);

      expect(parsed.event).toBe("session_start");
      expect(parsed.source).toBe("unknown");
    });
  });

  describe("Ralph loop status output", () => {
    test("outputs status when loop is active", async () => {
      const stateContent = `---
active: true
iteration: 3
max_iterations: 10
completion_promise: "All tests pass"
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Test prompt.
`;
      writeFileSync(".github/ralph-loop.local.md", stateContent);

      const { stderr } = await runStartRalphSession({
        source: "manual",
      });

      expect(stderr).toContain("Ralph loop active - Iteration 3");
      expect(stderr).toContain("Max iterations: 10");
      expect(stderr).toContain("Completion promise: All tests pass");
    });

    test("shows unlimited when max_iterations is 0", async () => {
      const stateContent = `---
active: true
iteration: 5
max_iterations: 0
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Unlimited test.
`;
      writeFileSync(".github/ralph-loop.local.md", stateContent);

      const { stderr } = await runStartRalphSession({
        source: "manual",
      });

      expect(stderr).toContain("Max iterations: unlimited");
      expect(stderr).not.toContain("Completion promise:");
    });

    test("silent when no loop is active", async () => {
      const { stderr, exitCode } = await runStartRalphSession({
        source: "manual",
      });

      expect(exitCode).toBe(0);
      expect(stderr).not.toContain("Ralph loop");
    });

    test("handles inactive loop (active: false)", async () => {
      const stateContent = `---
active: false
iteration: 5
max_iterations: 10
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Inactive test.
`;
      writeFileSync(".github/ralph-loop.local.md", stateContent);

      const { stderr } = await runStartRalphSession({
        source: "resume",
      });

      expect(stderr).not.toContain("Ralph loop");
    });
  });
});
