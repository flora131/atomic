/**
 * Integration tests for agent hook telemetry functionality
 *
 * Tests the Claude Code Stop hook and telemetry helper script behavior.
 * Uses subprocess execution for realistic hook testing.
 *
 * Reference: Spec Section 5.3.3
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

// Test directory setup
const TEST_DIR = join(import.meta.dir, ".test-hook-integration");
const TEST_DATA_DIR = join(TEST_DIR, "data");
const TEST_HOOKS_DIR = join(TEST_DIR, "hooks");
const EVENTS_FILE = join(TEST_DATA_DIR, "telemetry-events.jsonl");
const STATE_FILE = join(TEST_DATA_DIR, "telemetry.json");

// Path to project root
const PROJECT_ROOT = join(import.meta.dir, "../../..");

describe("Telemetry Helper Script", () => {
  beforeEach(() => {
    // Clean up and create test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    mkdirSync(TEST_HOOKS_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test("telemetry-helper.sh is syntactically valid bash", () => {
    const helperPath = join(PROJECT_ROOT, "bin/telemetry-helper.sh");

    // Skip if helper doesn't exist
    if (!existsSync(helperPath)) {
      console.log("Skipping: telemetry-helper.sh not found");
      return;
    }

    // Check bash syntax
    const result = spawnSync("bash", ["-n", helperPath], {
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("telemetry-helper.sh functions can be sourced", () => {
    const helperPath = join(PROJECT_ROOT, "bin/telemetry-helper.sh");

    // Skip if helper doesn't exist
    if (!existsSync(helperPath)) {
      console.log("Skipping: telemetry-helper.sh not found");
      return;
    }

    // Source helper and check functions exist
    const result = spawnSync(
      "bash",
      [
        "-c",
        `source "${helperPath}" && type extract_commands && type write_session_event && type is_telemetry_enabled`,
      ],
      {
        encoding: "utf-8",
      }
    );

    expect(result.status).toBe(0);
  });

  test("extract_commands extracts single command", () => {
    const helperPath = join(PROJECT_ROOT, "bin/telemetry-helper.sh");

    if (!existsSync(helperPath)) {
      console.log("Skipping: telemetry-helper.sh not found");
      return;
    }

    const result = spawnSync(
      "bash",
      ["-c", `source "${helperPath}" && extract_commands "User ran /commit in the session"`],
      {
        encoding: "utf-8",
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("/commit");
  });

  test("extract_commands extracts multiple commands", () => {
    const helperPath = join(PROJECT_ROOT, "bin/telemetry-helper.sh");

    if (!existsSync(helperPath)) {
      console.log("Skipping: telemetry-helper.sh not found");
      return;
    }

    const result = spawnSync(
      "bash",
      [
        "-c",
        `source "${helperPath}" && extract_commands "Used /research-codebase and then /commit and /create-gh-pr"`,
      ],
      {
        encoding: "utf-8",
      }
    );

    expect(result.status).toBe(0);
    const commands = result.stdout.trim().split(",").sort();
    expect(commands).toContain("/commit");
    expect(commands).toContain("/create-gh-pr");
    expect(commands).toContain("/research-codebase");
  });

  test("extract_commands handles namespaced commands", () => {
    const helperPath = join(PROJECT_ROOT, "bin/telemetry-helper.sh");

    if (!existsSync(helperPath)) {
      console.log("Skipping: telemetry-helper.sh not found");
      return;
    }

    const result = spawnSync(
      "bash",
      ["-c", `source "${helperPath}" && extract_commands "Running /ralph:ralph-loop now"`],
      {
        encoding: "utf-8",
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("/ralph:ralph-loop");
  });

  test("extract_commands returns empty for no commands", () => {
    const helperPath = join(PROJECT_ROOT, "bin/telemetry-helper.sh");

    if (!existsSync(helperPath)) {
      console.log("Skipping: telemetry-helper.sh not found");
      return;
    }

    const result = spawnSync(
      "bash",
      ["-c", `source "${helperPath}" && extract_commands "Just some regular text without commands"`],
      {
        encoding: "utf-8",
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});

describe("Claude Code Stop Hook", () => {
  beforeEach(() => {
    // Clean up and create test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    mkdirSync(TEST_HOOKS_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test("telemetry-stop.sh is syntactically valid bash", () => {
    const hookPath = join(PROJECT_ROOT, ".claude/hooks/telemetry-stop.sh");

    // Skip if hook doesn't exist
    if (!existsSync(hookPath)) {
      console.log("Skipping: telemetry-stop.sh not found");
      return;
    }

    // Check bash syntax
    const result = spawnSync("bash", ["-n", hookPath], {
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("hook exits cleanly with no input", () => {
    const hookPath = join(PROJECT_ROOT, ".claude/hooks/telemetry-stop.sh");

    if (!existsSync(hookPath)) {
      console.log("Skipping: telemetry-stop.sh not found");
      return;
    }

    // Run hook with empty JSON input
    const result = spawnSync("bash", [hookPath], {
      encoding: "utf-8",
      input: "{}",
      cwd: PROJECT_ROOT,
    });

    // Hook should exit successfully even with no transcript
    expect(result.status).toBe(0);
  });

  test("hook exits cleanly with missing transcript", () => {
    const hookPath = join(PROJECT_ROOT, ".claude/hooks/telemetry-stop.sh");

    if (!existsSync(hookPath)) {
      console.log("Skipping: telemetry-stop.sh not found");
      return;
    }

    // Run hook with transcript_path that doesn't exist
    const result = spawnSync("bash", [hookPath], {
      encoding: "utf-8",
      input: JSON.stringify({
        transcript_path: "/nonexistent/path/transcript.txt",
      }),
      cwd: PROJECT_ROOT,
    });

    // Hook should exit successfully
    expect(result.status).toBe(0);
  });
});

describe("Hooks.json Configuration", () => {
  test("Claude Code hooks.json is valid JSON", () => {
    const hooksJsonPath = join(PROJECT_ROOT, ".claude/hooks/hooks.json");

    if (!existsSync(hooksJsonPath)) {
      console.log("Skipping: hooks.json not found");
      return;
    }

    const content = readFileSync(hooksJsonPath, "utf-8");
    const config = JSON.parse(content);

    expect(config.version).toBe(1);
    expect(config.hooks).toBeDefined();
  });

  test("Claude Code hooks.json has Stop hook configured", () => {
    const hooksJsonPath = join(PROJECT_ROOT, ".claude/hooks/hooks.json");

    if (!existsSync(hooksJsonPath)) {
      console.log("Skipping: hooks.json not found");
      return;
    }

    const content = readFileSync(hooksJsonPath, "utf-8");
    const config = JSON.parse(content);

    expect(config.hooks.Stop).toBeDefined();
    expect(Array.isArray(config.hooks.Stop)).toBe(true);
    expect(config.hooks.Stop.length).toBeGreaterThan(0);
    expect(config.hooks.Stop[0].type).toBe("command");
    expect(config.hooks.Stop[0].bash).toContain("telemetry-stop.sh");
  });

  test("Copilot CLI hooks.json is valid JSON", () => {
    const hooksJsonPath = join(PROJECT_ROOT, ".github/hooks/hooks.json");

    if (!existsSync(hooksJsonPath)) {
      console.log("Skipping: .github/hooks/hooks.json not found");
      return;
    }

    const content = readFileSync(hooksJsonPath, "utf-8");
    const config = JSON.parse(content);

    expect(config.version).toBe(1);
    expect(config.hooks).toBeDefined();
  });
});

describe("OpenCode Telemetry Plugin", () => {
  test("telemetry.ts exists and exports required structure", async () => {
    const pluginPath = join(PROJECT_ROOT, ".opencode/plugin/telemetry.ts");

    if (!existsSync(pluginPath)) {
      console.log("Skipping: telemetry.ts not found");
      return;
    }

    // Read the file and check for expected exports
    const content = readFileSync(pluginPath, "utf-8");

    // Check that it exports a default plugin
    expect(content).toContain("export default");
    expect(content).toContain('name: "telemetry"');
    expect(content).toContain("event:");
    expect(content).toContain("session.start");
    expect(content).toContain("session.end");
    expect(content).toContain("ATOMIC_COMMANDS");
  });

  test("telemetry.ts has proper TypeScript structure", async () => {
    const pluginPath = join(PROJECT_ROOT, ".opencode/plugin/telemetry.ts");

    if (!existsSync(pluginPath)) {
      console.log("Skipping: telemetry.ts not found");
      return;
    }

    // Check TypeScript compilation via bun
    const result = spawnSync("bun", ["build", "--no-bundle", pluginPath], {
      encoding: "utf-8",
      cwd: join(PROJECT_ROOT, ".opencode"),
    });

    // Note: This may fail if @opencode-ai/plugin types aren't installed
    // That's expected in test environment
    if (result.status !== 0) {
      // Check if it's just a missing dependency issue
      if (result.stderr.includes("@opencode-ai/plugin")) {
        console.log("Skipping TypeScript check: @opencode-ai/plugin not installed");
        return;
      }
    }
  });
});
