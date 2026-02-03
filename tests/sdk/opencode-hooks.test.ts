/**
 * Integration tests for OpenCode SDK hook handlers
 *
 * Tests cover:
 * - Session start handler functionality
 * - Session idle handler with telemetry tracking
 * - Session deleted handler for cleanup
 * - Command execute handler for telemetry
 * - Chat message handler for command extraction
 * - Ralph loop detection and continuation
 * - Ralph state file management
 * - Default hook registration
 * - Error handling in hooks
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import {
  createSessionStartHandler,
  createSessionIdleHandler,
  createSessionDeletedHandler,
  createCommandExecuteHandler,
  createChatMessageHandler,
  registerDefaultOpenCodeHooks,
  createDefaultOpenCodeHooks,
  parseRalphState,
  writeRalphState,
  deleteRalphState,
  checkFeaturesPassing,
  checkCompletionPromise,
  normalizeCommandName,
  extractCommandsFromText,
  appendCommandsToTemp,
  readAccumulatedCommands,
  clearTempFile,
  type OpenCodeHookHandlers,
} from "../../src/sdk/opencode-hooks.ts";
import type { OpenCodeSdkEvent } from "../../src/sdk/opencode-client.ts";

// Test directory (use temp dir to avoid polluting project)
const TEST_DIR = join(process.cwd(), ".test-opencode-hooks");
const TEST_RALPH_STATE = join(TEST_DIR, ".opencode/ralph-loop.local.md");
const TEST_RALPH_LOG_DIR = join(TEST_DIR, ".opencode/logs");
const TEST_TEMP_COMMANDS = join(TEST_DIR, ".opencode/telemetry-session-commands.tmp");
const TEST_FEATURE_LIST = join(TEST_DIR, "research/feature-list.json");

/**
 * Helper to create a mock OpenCodeSdkEvent
 */
function createMockEvent(
  type: string,
  overrides: Partial<OpenCodeSdkEvent> = {}
): OpenCodeSdkEvent {
  return {
    type: type as OpenCodeSdkEvent["type"],
    sessionId: "test-session-123",
    timestamp: new Date().toISOString(),
    data: {},
    ...overrides,
  };
}

/**
 * Helper to create a mock Ralph state file
 */
function createRalphState(
  state: {
    active: boolean;
    iteration: number;
    maxIterations: number;
    completionPromise: string | null;
    featureListPath?: string;
    prompt: string;
  },
  directory: string = TEST_DIR
): void {
  const completionPromiseYaml =
    state.completionPromise === null ? "null" : `"${state.completionPromise}"`;
  const featureListPath = state.featureListPath || "research/feature-list.json";

  const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseYaml}
feature_list_path: ${featureListPath}
started_at: "${new Date().toISOString()}"
---

${state.prompt}
`;

  const dir = join(directory, ".opencode");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(join(directory, ".opencode/ralph-loop.local.md"), content, "utf-8");
}

/**
 * Helper to create test feature list
 */
function createFeatureList(
  features: Array<{ passes: boolean }>,
  directory: string = TEST_DIR
): void {
  const dir = join(directory, "research");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(
    features.map((f, i) => ({
      category: "test",
      description: `Feature ${i + 1}`,
      steps: [`Step ${i + 1}`],
      passes: f.passes,
    }))
  );

  writeFileSync(TEST_FEATURE_LIST, content, "utf-8");
}

/**
 * Helper to set up test directory
 */
function setupTestDir(): void {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
  
  // Create necessary subdirectories
  const dirs = [
    join(TEST_DIR, ".opencode"),
    join(TEST_DIR, ".opencode/logs"),
    join(TEST_DIR, "research"),
  ];
  
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Helper to clean up test directory
 */
function cleanupTestDir(): void {
  if (existsSync(TEST_DIR)) {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

describe("OpenCode SDK Hook Handlers", () => {
  beforeEach(() => {
    cleanupTestDir();
    setupTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  // ============================================================================
  // Ralph State Management Tests
  // ============================================================================

  describe("parseRalphState", () => {
    test("returns null when file does not exist", () => {
      const state = parseRalphState(TEST_DIR);
      expect(state).toBeNull();
    });

    test("parses valid Ralph state", () => {
      createRalphState({
        active: true,
        iteration: 5,
        maxIterations: 10,
        completionPromise: "Test promise",
        prompt: "Test prompt",
      });

      const state = parseRalphState(TEST_DIR);
      expect(state).not.toBeNull();
      expect(state!.active).toBe(true);
      expect(state!.iteration).toBe(5);
      expect(state!.maxIterations).toBe(10);
      expect(state!.completionPromise).toBe("Test promise");
      expect(state!.prompt).toBe("Test prompt");
    });

    test("parses state with null completion promise", () => {
      createRalphState({
        active: true,
        iteration: 1,
        maxIterations: 0,
        completionPromise: null,
        prompt: "Test",
      });

      const state = parseRalphState(TEST_DIR);
      expect(state!.completionPromise).toBeNull();
    });

    test("handles malformed YAML gracefully", () => {
      const dir = join(TEST_DIR, ".opencode");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(
        join(TEST_DIR, ".opencode/ralph-loop.local.md"),
        "not valid yaml frontmatter",
        "utf-8"
      );

      const state = parseRalphState(TEST_DIR);
      expect(state).toBeNull();
    });
  });

  describe("writeRalphState", () => {
    test("creates state file with correct content", () => {
      const state = {
        active: true,
        iteration: 3,
        maxIterations: 20,
        completionPromise: "All done",
        featureListPath: "research/feature-list.json",
        startedAt: "2026-01-31T00:00:00Z",
        prompt: "Test prompt content",
      };

      writeRalphState(state, TEST_DIR);

      expect(existsSync(join(TEST_DIR, ".opencode/ralph-loop.local.md"))).toBe(true);

      const parsed = parseRalphState(TEST_DIR);
      expect(parsed!.active).toBe(true);
      expect(parsed!.iteration).toBe(3);
      expect(parsed!.maxIterations).toBe(20);
      expect(parsed!.completionPromise).toBe("All done");
    });

    test("creates directory if it does not exist", () => {
      const newDir = join(TEST_DIR, "new-subdir");
      
      writeRalphState(
        {
          active: true,
          iteration: 1,
          maxIterations: 0,
          completionPromise: null,
          featureListPath: "research/feature-list.json",
          startedAt: new Date().toISOString(),
          prompt: "Test",
        },
        newDir
      );

      expect(existsSync(join(newDir, ".opencode/ralph-loop.local.md"))).toBe(true);
    });
  });

  describe("deleteRalphState", () => {
    test("deletes existing state file", () => {
      createRalphState({
        active: true,
        iteration: 1,
        maxIterations: 0,
        completionPromise: null,
        prompt: "Test",
      });

      expect(existsSync(join(TEST_DIR, ".opencode/ralph-loop.local.md"))).toBe(true);

      const result = deleteRalphState(TEST_DIR);

      expect(result).toBe(true);
      expect(existsSync(join(TEST_DIR, ".opencode/ralph-loop.local.md"))).toBe(false);
    });

    test("returns false when file does not exist", () => {
      const result = deleteRalphState(TEST_DIR);
      expect(result).toBe(false);
    });
  });

  describe("checkFeaturesPassing", () => {
    test("returns null for non-existent file", () => {
      const result = checkFeaturesPassing(TEST_DIR, "nonexistent.json");
      expect(result).toBeNull();
    });

    test("returns correct counts for mixed features", () => {
      createFeatureList([
        { passes: true },
        { passes: true },
        { passes: false },
        { passes: false },
        { passes: true },
      ]);

      const result = checkFeaturesPassing(TEST_DIR, "research/feature-list.json");
      expect(result).not.toBeNull();
      expect(result!.total).toBe(5);
      expect(result!.passing).toBe(3);
      expect(result!.failing).toBe(2);
      expect(result!.allPassing).toBe(false);
    });

    test("returns allPassing true when all features pass", () => {
      createFeatureList([{ passes: true }, { passes: true }, { passes: true }]);

      const result = checkFeaturesPassing(TEST_DIR, "research/feature-list.json");
      expect(result!.allPassing).toBe(true);
    });

    test("returns null for empty array", () => {
      createFeatureList([]);

      const result = checkFeaturesPassing(TEST_DIR, "research/feature-list.json");
      expect(result).toBeNull();
    });
  });

  describe("checkCompletionPromise", () => {
    test("returns true when promise matches", () => {
      const text = "Some text <promise>All tests pass</promise> more text";
      const result = checkCompletionPromise(text, "All tests pass");
      expect(result).toBe(true);
    });

    test("returns false when promise does not match", () => {
      const text = "Some text <promise>Different promise</promise> more text";
      const result = checkCompletionPromise(text, "All tests pass");
      expect(result).toBe(false);
    });

    test("returns false when no promise tags", () => {
      const text = "Some text without promise tags";
      const result = checkCompletionPromise(text, "All tests pass");
      expect(result).toBe(false);
    });

    test("handles whitespace normalization", () => {
      const text = "<promise>All   tests\n  pass</promise>";
      const result = checkCompletionPromise(text, "All tests pass");
      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // Telemetry Helper Tests
  // ============================================================================

  describe("normalizeCommandName", () => {
    test("normalizes command without slash", () => {
      expect(normalizeCommandName("commit")).toBe("/commit");
    });

    test("returns command with slash unchanged", () => {
      expect(normalizeCommandName("/commit")).toBe("/commit");
    });

    test("returns null for unrecognized command", () => {
      expect(normalizeCommandName("unknown-command")).toBeNull();
    });

    test("recognizes all atomic commands", () => {
      // Note: ralph:ralph-help removed - replaced by SDK-native /ralph workflow
      const commands = [
        "research-codebase",
        "create-spec",
        "create-feature-list",
        "implement-feature",
        "commit",
        "create-gh-pr",
        "explain-code",
        "ralph",
      ];

      for (const cmd of commands) {
        expect(normalizeCommandName(cmd)).toBe(`/${cmd}`);
      }
    });
  });

  describe("extractCommandsFromText", () => {
    test("extracts single command", () => {
      const result = extractCommandsFromText("Please /commit the changes");
      expect(result).toContain("/commit");
    });

    test("extracts multiple commands", () => {
      const result = extractCommandsFromText(
        "First /research-codebase then /create-spec"
      );
      expect(result).toContain("/research-codebase");
      expect(result).toContain("/create-spec");
    });

    test("returns empty array for no commands", () => {
      const result = extractCommandsFromText("Just a regular message");
      expect(result).toEqual([]);
    });

    test("counts duplicate commands", () => {
      const result = extractCommandsFromText("/commit first /commit second");
      expect(result.filter((c) => c === "/commit").length).toBe(2);
    });
  });

  describe("appendCommandsToTemp / readAccumulatedCommands / clearTempFile", () => {
    test("appends commands to temp file", () => {
      appendCommandsToTemp(["/commit", "/create-gh-pr"], TEST_DIR);

      const commands = readAccumulatedCommands(TEST_DIR);
      expect(commands).toContain("/commit");
      expect(commands).toContain("/create-gh-pr");
    });

    test("accumulates commands across calls", () => {
      appendCommandsToTemp(["/commit"], TEST_DIR);
      appendCommandsToTemp(["/create-gh-pr"], TEST_DIR);

      const commands = readAccumulatedCommands(TEST_DIR);
      expect(commands.length).toBe(2);
    });

    test("clears temp file", () => {
      appendCommandsToTemp(["/commit"], TEST_DIR);
      expect(readAccumulatedCommands(TEST_DIR).length).toBe(1);

      clearTempFile(TEST_DIR);
      expect(readAccumulatedCommands(TEST_DIR).length).toBe(0);
    });

    test("handles empty commands array", () => {
      appendCommandsToTemp([], TEST_DIR);
      expect(readAccumulatedCommands(TEST_DIR).length).toBe(0);
    });
  });

  // ============================================================================
  // Handler Tests
  // ============================================================================

  describe("createSessionStartHandler", () => {
    test("returns a function", () => {
      const handler = createSessionStartHandler(TEST_DIR);
      expect(typeof handler).toBe("function");
    });

    test("handler completes without error when no Ralph state", async () => {
      const handler = createSessionStartHandler(TEST_DIR);
      const event = createMockEvent("session.created");

      // Should not throw
      await handler(event);
    });

    test("handler clears temp commands on session start", async () => {
      appendCommandsToTemp(["/commit"], TEST_DIR);
      expect(readAccumulatedCommands(TEST_DIR).length).toBe(1);

      const handler = createSessionStartHandler(TEST_DIR);
      const event = createMockEvent("session.created");

      await handler(event);

      expect(readAccumulatedCommands(TEST_DIR).length).toBe(0);
    });

    test("handler logs session start", async () => {
      const handler = createSessionStartHandler(TEST_DIR);
      const event = createMockEvent("session.created");

      await handler(event);

      const logFile = join(TEST_DIR, ".opencode/logs/opencode-sessions.jsonl");
      expect(existsSync(logFile)).toBe(true);

      const logContent = readFileSync(logFile, "utf-8");
      expect(logContent).toContain("session_start");
      expect(logContent).toContain("test-session-123");
    });

    test("handler detects active Ralph loop", async () => {
      createRalphState({
        active: true,
        iteration: 5,
        maxIterations: 10,
        completionPromise: "Test promise",
        prompt: "Test prompt for Ralph loop",
      });

      const handler = createSessionStartHandler(TEST_DIR);
      const event = createMockEvent("session.created");

      // Should not throw
      await handler(event);
    });
  });

  describe("createCommandExecuteHandler", () => {
    test("returns a function", () => {
      const handler = createCommandExecuteHandler(TEST_DIR);
      expect(typeof handler).toBe("function");
    });

    test("handler tracks recognized command", async () => {
      const handler = createCommandExecuteHandler(TEST_DIR);

      await handler("commit");

      const commands = readAccumulatedCommands(TEST_DIR);
      expect(commands).toContain("/commit");
    });

    test("handler ignores unrecognized command", async () => {
      const handler = createCommandExecuteHandler(TEST_DIR);

      await handler("unknown-command");

      const commands = readAccumulatedCommands(TEST_DIR);
      expect(commands.length).toBe(0);
    });
  });

  describe("createChatMessageHandler", () => {
    test("returns a function", () => {
      const handler = createChatMessageHandler(TEST_DIR);
      expect(typeof handler).toBe("function");
    });

    test("handler extracts commands from message", async () => {
      const handler = createChatMessageHandler(TEST_DIR);

      await handler("I will use /commit and /create-gh-pr");

      const commands = readAccumulatedCommands(TEST_DIR);
      expect(commands).toContain("/commit");
      expect(commands).toContain("/create-gh-pr");
    });

    test("handler handles message without commands", async () => {
      const handler = createChatMessageHandler(TEST_DIR);

      await handler("Just a regular message");

      const commands = readAccumulatedCommands(TEST_DIR);
      expect(commands.length).toBe(0);
    });
  });

  describe("createSessionIdleHandler", () => {
    test("returns a function", () => {
      const handler = createSessionIdleHandler(TEST_DIR);
      expect(typeof handler).toBe("function");
    });

    test("handler completes without error", async () => {
      const handler = createSessionIdleHandler(TEST_DIR);
      const event = createMockEvent("session.idle");

      // Should not throw
      await handler(event);
    });

    test("handler logs session idle", async () => {
      const handler = createSessionIdleHandler(TEST_DIR);
      const event = createMockEvent("session.idle");

      await handler(event);

      const logFile = join(TEST_DIR, ".opencode/logs/opencode-sessions.jsonl");
      expect(existsSync(logFile)).toBe(true);

      const logContent = readFileSync(logFile, "utf-8");
      expect(logContent).toContain("session_idle");
    });

    test("handler clears accumulated commands", async () => {
      appendCommandsToTemp(["/commit"], TEST_DIR);
      expect(readAccumulatedCommands(TEST_DIR).length).toBe(1);

      const handler = createSessionIdleHandler(TEST_DIR);
      const event = createMockEvent("session.idle");

      await handler(event);

      expect(readAccumulatedCommands(TEST_DIR).length).toBe(0);
    });
  });

  describe("createSessionDeletedHandler", () => {
    test("returns a function", () => {
      const handler = createSessionDeletedHandler(TEST_DIR);
      expect(typeof handler).toBe("function");
    });

    test("handler completes without error", async () => {
      const handler = createSessionDeletedHandler(TEST_DIR);
      const event = createMockEvent("session.deleted");

      await handler(event);
    });

    test("handler logs session deleted", async () => {
      const handler = createSessionDeletedHandler(TEST_DIR);
      const event = createMockEvent("session.deleted");

      await handler(event);

      const logFile = join(TEST_DIR, ".opencode/logs/opencode-sessions.jsonl");
      expect(existsSync(logFile)).toBe(true);

      const logContent = readFileSync(logFile, "utf-8");
      expect(logContent).toContain("session_deleted");
    });

    test("handler clears temp commands", async () => {
      appendCommandsToTemp(["/commit"], TEST_DIR);

      const handler = createSessionDeletedHandler(TEST_DIR);
      const event = createMockEvent("session.deleted");

      await handler(event);

      expect(readAccumulatedCommands(TEST_DIR).length).toBe(0);
    });
  });

  // ============================================================================
  // Factory Function Tests
  // ============================================================================

  describe("createDefaultOpenCodeHooks", () => {
    test("returns OpenCodeHookHandlers with all handlers", () => {
      const hooks = createDefaultOpenCodeHooks(TEST_DIR);

      expect(hooks).toBeDefined();
      expect(hooks.onSessionStart).toBeDefined();
      expect(hooks.onSessionIdle).toBeDefined();
      expect(hooks.onSessionDeleted).toBeDefined();
      expect(hooks.onCommandExecute).toBeDefined();
      expect(hooks.onChatMessage).toBeDefined();
    });

    test("all handlers are callable functions", () => {
      const hooks = createDefaultOpenCodeHooks(TEST_DIR);

      expect(typeof hooks.onSessionStart).toBe("function");
      expect(typeof hooks.onSessionIdle).toBe("function");
      expect(typeof hooks.onSessionDeleted).toBe("function");
      expect(typeof hooks.onCommandExecute).toBe("function");
      expect(typeof hooks.onChatMessage).toBe("function");
    });

    test("onSessionStart handler works", async () => {
      const hooks = createDefaultOpenCodeHooks(TEST_DIR);
      const event = createMockEvent("session.created");

      await hooks.onSessionStart!(event);
    });

    test("onCommandExecute handler works", async () => {
      const hooks = createDefaultOpenCodeHooks(TEST_DIR);

      await hooks.onCommandExecute!("commit");

      const commands = readAccumulatedCommands(TEST_DIR);
      expect(commands).toContain("/commit");
    });
  });

  describe("registerDefaultOpenCodeHooks", () => {
    test("registers hooks with mock client", () => {
      const mockClient = {
        agentType: "opencode" as const,
        on: mock(() => () => {}),
        createSession: async () => ({} as never),
        resumeSession: async () => null,
        registerTool: () => {},
        start: async () => {},
        stop: async () => {},
        setClientFactory: () => {},
      };

      const unsubscribers = registerDefaultOpenCodeHooks(mockClient as never, TEST_DIR);

      expect(mockClient.on).toHaveBeenCalled();
      expect(unsubscribers.length).toBeGreaterThan(0);
    });

    test("returns unsubscribe functions", () => {
      const mockClient = {
        agentType: "opencode" as const,
        on: mock(() => () => {}),
        createSession: async () => ({} as never),
        resumeSession: async () => null,
        registerTool: () => {},
        start: async () => {},
        stop: async () => {},
        setClientFactory: () => {},
      };

      const unsubscribers = registerDefaultOpenCodeHooks(mockClient as never, TEST_DIR);

      expect(Array.isArray(unsubscribers)).toBe(true);
      for (const unsub of unsubscribers) {
        expect(typeof unsub).toBe("function");
      }
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("Error handling", () => {
    test("session start handler never throws", async () => {
      const handler = createSessionStartHandler(TEST_DIR);

      // Even with invalid event, should not throw
      await handler({} as never);
    });

    test("session idle handler never throws", async () => {
      const handler = createSessionIdleHandler(TEST_DIR);

      // Even with invalid event, should not throw
      await handler({} as never);
    });

    test("session deleted handler never throws", async () => {
      const handler = createSessionDeletedHandler(TEST_DIR);

      // Even with invalid event, should not throw
      await handler({} as never);
    });

    test("command execute handler never throws", async () => {
      const handler = createCommandExecuteHandler(TEST_DIR);

      // Even with invalid input, should not throw
      await handler("");
      await handler(null as never);
    });

    test("chat message handler never throws", async () => {
      const handler = createChatMessageHandler(TEST_DIR);

      // Even with invalid input, should not throw
      await handler("");
      await handler(null as never);
    });
  });
});
