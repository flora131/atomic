import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Tests for .github/scripts/start-ralph-session.ts
 *
 * Tests the session start hook for Ralph loop functionality:
 * - JSONL logging of session start events
 * - YAML frontmatter parsing of Ralph state file
 * - Iteration increment on resume/startup sources
 * - Graceful handling of missing/invalid inputs
 */

const TEST_DIR = ".github-test";
const RALPH_STATE_FILE = join(TEST_DIR, "ralph-loop.local.md");
const RALPH_LOG_DIR = join(TEST_DIR, "logs");
const RALPH_LOG_FILE = join(RALPH_LOG_DIR, "ralph-sessions.jsonl");

// Helper to run the script with mocked paths
async function runStartRalphSession(
  input: object | string,
  stateDir = TEST_DIR
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const inputStr = typeof input === "string" ? input : JSON.stringify(input);

  // Use Bun.spawn to run the script with input
  const proc = Bun.spawn(["bun", "run", ".github/scripts/start-ralph-session.ts"], {
    stdin: new Response(inputStr).body,
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
    env: {
      ...process.env,
      // Could use env vars to override paths if needed
    },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

describe("start-ralph-session.ts", () => {
  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(RALPH_LOG_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    // Also clean up any state files created in actual .github dir during tests
    const actualStateFile = ".github/ralph-loop.local.md";
    if (existsSync(actualStateFile)) {
      rmSync(actualStateFile);
    }
  });

  describe("session logging", () => {
    test("creates log entry in JSONL format", async () => {
      const input = {
        timestamp: "2026-01-24T12:00:00Z",
        cwd: "/test/project",
        source: "manual",
        initialPrompt: "Test prompt",
      };

      await runStartRalphSession(input);

      // Check that log was created
      const logFile = ".github/logs/ralph-sessions.jsonl";
      expect(existsSync(logFile)).toBe(true);

      const logContent = readFileSync(logFile, "utf-8");
      const lastLine = logContent.trim().split("\n").pop()!;
      const parsed = JSON.parse(lastLine);

      expect(parsed.event).toBe("session_start");
      expect(parsed.timestamp).toBe("2026-01-24T12:00:00Z");
      expect(parsed.cwd).toBe("/test/project");
      expect(parsed.source).toBe("manual");
      expect(parsed.initialPrompt).toBe("Test prompt");
    });

    test("handles empty input gracefully", async () => {
      const { exitCode } = await runStartRalphSession("");
      expect(exitCode).toBe(0);
    });

    test("handles invalid JSON input gracefully", async () => {
      const { exitCode } = await runStartRalphSession("not valid json");
      expect(exitCode).toBe(0);
    });

    test("handles missing optional fields", async () => {
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

  describe("Ralph loop detection", () => {
    test("outputs status when loop is active", async () => {
      // Create state file
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

      // Clean up
      rmSync(".github/ralph-loop.local.md");
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

      rmSync(".github/ralph-loop.local.md");
    });

    test("silent when no loop is active", async () => {
      // No state file exists
      const { stderr, exitCode } = await runStartRalphSession({
        source: "manual",
      });

      expect(exitCode).toBe(0);
      expect(stderr).not.toContain("Ralph loop");
    });
  });

  describe("iteration increment", () => {
    test("increments iteration on resume source", async () => {
      const stateContent = `---
active: true
iteration: 5
max_iterations: 20
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Resume test.
`;
      writeFileSync(".github/ralph-loop.local.md", stateContent);

      const { stderr } = await runStartRalphSession({
        source: "resume",
      });

      expect(stderr).toContain("Ralph loop continuing at iteration 6");

      // Verify state was updated
      const updatedContent = readFileSync(".github/ralph-loop.local.md", "utf-8");
      expect(updatedContent).toContain("iteration: 6");

      rmSync(".github/ralph-loop.local.md");
    });

    test("increments iteration on startup source", async () => {
      const stateContent = `---
active: true
iteration: 7
max_iterations: 0
completion_promise: "DONE"
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Startup test.
`;
      writeFileSync(".github/ralph-loop.local.md", stateContent);

      const { stderr } = await runStartRalphSession({
        source: "startup",
      });

      expect(stderr).toContain("Ralph loop continuing at iteration 8");

      // Verify state was updated
      const updatedContent = readFileSync(".github/ralph-loop.local.md", "utf-8");
      expect(updatedContent).toContain("iteration: 8");

      rmSync(".github/ralph-loop.local.md");
    });

    test("does not increment on manual source", async () => {
      const stateContent = `---
active: true
iteration: 3
max_iterations: 10
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Manual test.
`;
      writeFileSync(".github/ralph-loop.local.md", stateContent);

      const { stderr } = await runStartRalphSession({
        source: "manual",
      });

      expect(stderr).not.toContain("continuing at iteration");

      // Verify state was NOT updated
      const updatedContent = readFileSync(".github/ralph-loop.local.md", "utf-8");
      expect(updatedContent).toContain("iteration: 3");

      rmSync(".github/ralph-loop.local.md");
    });
  });

  describe("YAML frontmatter parsing", () => {
    test("parses all fields correctly", async () => {
      const stateContent = `---
active: true
iteration: 10
max_iterations: 50
completion_promise: "All features implemented"
feature_list_path: custom/features.json
started_at: "2026-01-24T09:00:00Z"
---

Custom prompt content.
`;
      writeFileSync(".github/ralph-loop.local.md", stateContent);

      const { stderr } = await runStartRalphSession({
        source: "manual",
      });

      expect(stderr).toContain("Ralph loop active - Iteration 10");
      expect(stderr).toContain("Max iterations: 50");
      expect(stderr).toContain("Completion promise: All features implemented");
      expect(stderr).toContain("Prompt: Custom prompt content.");

      rmSync(".github/ralph-loop.local.md");
    });

    test("handles Windows line endings (CRLF)", async () => {
      const stateContent =
        "---\r\nactive: true\r\niteration: 2\r\nmax_iterations: 5\r\ncompletion_promise: null\r\nfeature_list_path: research/feature-list.json\r\nstarted_at: \"2026-01-24T10:00:00Z\"\r\n---\r\n\r\nWindows test.\r\n";
      writeFileSync(".github/ralph-loop.local.md", stateContent);

      const { stderr, exitCode } = await runStartRalphSession({
        source: "manual",
      });

      expect(exitCode).toBe(0);
      expect(stderr).toContain("Ralph loop active - Iteration 2");

      rmSync(".github/ralph-loop.local.md");
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

      // Should not output status or increment
      expect(stderr).not.toContain("Ralph loop");

      rmSync(".github/ralph-loop.local.md");
    });
  });
});
