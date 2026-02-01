/**
 * Integration tests for Copilot SDK hook handlers
 *
 * Tests cover:
 * - Session start handler functionality
 * - Session end handler with telemetry tracking
 * - User prompt handler for command extraction
 * - Ralph loop detection and continuation
 * - Default hook registration
 * - Error handling in hooks
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import {
  createSessionStartHandler,
  createSessionEndHandler,
  createUserPromptHandler,
  registerDefaultCopilotHooks,
  createDefaultCopilotHooks,
} from "../../src/sdk/copilot-hooks.ts";
import type { AgentEvent, EventType } from "../../src/sdk/types.ts";

// Type alias for hook events - uses our unified event type
type HookEvent = AgentEvent<EventType>;

// Test file paths
const TEST_RALPH_STATE = ".github/ralph-loop.local.md";
const TEST_RALPH_LOG_DIR = ".github/logs";
const TEST_TEMP_COMMANDS = ".github/telemetry-session-commands.tmp";

/**
 * Helper to create a mock HookEvent
 */
function createMockEvent(
  type: EventType,
  overrides: Partial<HookEvent> = {}
): HookEvent {
  return {
    type,
    sessionId: "test-session-123",
    timestamp: new Date().toISOString(),
    data: {},
    ...overrides,
  } as HookEvent;
}

/**
 * Helper to create a mock Ralph state file
 */
function createRalphState(state: {
  active: boolean;
  iteration: number;
  maxIterations: number;
  completionPromise: string | null;
  prompt: string;
}): void {
  const completionPromiseYaml =
    state.completionPromise === null ? "null" : `"${state.completionPromise}"`;

  const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseYaml}
feature_list_path: research/feature-list.json
started_at: "${new Date().toISOString()}"
---

${state.prompt}
`;

  // Ensure directory exists
  const dir = ".github";
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(TEST_RALPH_STATE, content, "utf-8");
}

/**
 * Helper to clean up test files
 */
function cleanupTestFiles(): void {
  const filesToClean = [
    TEST_RALPH_STATE,
    TEST_TEMP_COMMANDS,
    ".github/ralph-continue.flag",
  ];

  for (const file of filesToClean) {
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch {
        // Ignore
      }
    }
  }

  // Clean up log files (but keep directory)
  if (existsSync(TEST_RALPH_LOG_DIR)) {
    const logFile = join(TEST_RALPH_LOG_DIR, "ralph-sessions.jsonl");
    if (existsSync(logFile)) {
      try {
        unlinkSync(logFile);
      } catch {
        // Ignore
      }
    }
  }
}

describe("Copilot SDK Hook Handlers", () => {
  beforeEach(() => {
    cleanupTestFiles();
  });

  afterEach(() => {
    cleanupTestFiles();
  });

  describe("createSessionStartHandler", () => {
    test("returns a function", () => {
      const handler = createSessionStartHandler();
      expect(typeof handler).toBe("function");
    });

    test("handler completes without error when no Ralph state", async () => {
      const handler = createSessionStartHandler();
      const event = createMockEvent("session.start");

      // Should not throw
      await handler(event);
    });

    test("handler logs session start", async () => {
      const handler = createSessionStartHandler();
      const event = createMockEvent("session.start");

      await handler(event);

      // Check that log file was created
      const logFile = join(TEST_RALPH_LOG_DIR, "ralph-sessions.jsonl");
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

      const handler = createSessionStartHandler();
      const event = createMockEvent("session.start");

      // Should not throw and should output to stderr
      await handler(event);

      // Log should include session start
      const logFile = join(TEST_RALPH_LOG_DIR, "ralph-sessions.jsonl");
      expect(existsSync(logFile)).toBe(true);
    });

    test("handler handles inactive Ralph state", async () => {
      createRalphState({
        active: false,
        iteration: 1,
        maxIterations: 0,
        completionPromise: null,
        prompt: "Inactive prompt",
      });

      const handler = createSessionStartHandler();
      const event = createMockEvent("session.start");

      // Should not throw
      await handler(event);
    });
  });

  describe("createUserPromptHandler", () => {
    test("returns a function", () => {
      const handler = createUserPromptHandler();
      expect(typeof handler).toBe("function");
    });

    test("handler extracts single command", async () => {
      const handler = createUserPromptHandler();

      await handler("/commit this is a test");

      expect(existsSync(TEST_TEMP_COMMANDS)).toBe(true);
      const content = readFileSync(TEST_TEMP_COMMANDS, "utf-8");
      expect(content).toContain("/commit");
    });

    test("handler extracts multiple commands", async () => {
      const handler = createUserPromptHandler();

      await handler("Please /commit and then /create-gh-pr");

      const content = readFileSync(TEST_TEMP_COMMANDS, "utf-8");
      expect(content).toContain("/commit");
      expect(content).toContain("/create-gh-pr");
    });

    test("handler handles no commands", async () => {
      const handler = createUserPromptHandler();

      await handler("Just a regular message without commands");

      // Temp file should not exist or be empty
      const exists = existsSync(TEST_TEMP_COMMANDS);
      if (exists) {
        const content = readFileSync(TEST_TEMP_COMMANDS, "utf-8").trim();
        expect(content).toBe("");
      }
    });

    test("handler accumulates commands across calls", async () => {
      const handler = createUserPromptHandler();

      await handler("/commit first");
      await handler("/create-gh-pr second");

      const content = readFileSync(TEST_TEMP_COMMANDS, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      expect(lines.length).toBe(2);
    });

    test("handler extracts ralph commands", async () => {
      const handler = createUserPromptHandler();

      await handler("/ralph:ralph-loop start");

      const content = readFileSync(TEST_TEMP_COMMANDS, "utf-8");
      expect(content).toContain("/ralph:ralph-loop");
    });
  });

  describe("createSessionEndHandler", () => {
    test("returns a function", () => {
      const handler = createSessionEndHandler();
      expect(typeof handler).toBe("function");
    });

    test("handler completes without error", async () => {
      const handler = createSessionEndHandler();
      const event = createMockEvent("session.idle");

      // Should not throw
      await handler(event);
    });

    test("handler logs session end", async () => {
      const handler = createSessionEndHandler();
      const event = createMockEvent("session.idle");

      await handler(event);

      const logFile = join(TEST_RALPH_LOG_DIR, "ralph-sessions.jsonl");
      expect(existsSync(logFile)).toBe(true);

      const logContent = readFileSync(logFile, "utf-8");
      expect(logContent).toContain("session_end");
    });

    test("handler clears temp commands file", async () => {
      // Create temp commands file
      writeFileSync(TEST_TEMP_COMMANDS, "/commit\n/create-gh-pr\n", "utf-8");
      expect(existsSync(TEST_TEMP_COMMANDS)).toBe(true);

      const handler = createSessionEndHandler();
      const event = createMockEvent("session.idle");

      await handler(event);

      // Temp file should be cleared
      expect(existsSync(TEST_TEMP_COMMANDS)).toBe(false);
    });

    test("handler handles inactive Ralph state", async () => {
      createRalphState({
        active: false,
        iteration: 3,
        maxIterations: 10,
        completionPromise: null,
        prompt: "Test",
      });

      const handler = createSessionEndHandler();
      const event = createMockEvent("session.idle");

      await handler(event);

      // Should clean up continue flag
      expect(existsSync(".github/ralph-continue.flag")).toBe(false);
    });
  });

  describe("createDefaultCopilotHooks", () => {
    test("returns CopilotHookHandlers with all handlers", () => {
      const hooks = createDefaultCopilotHooks();

      expect(hooks).toBeDefined();
      expect(hooks.onSessionStart).toBeDefined();
      expect(hooks.onSessionEnd).toBeDefined();
      expect(hooks.onUserPrompt).toBeDefined();
    });

    test("all handlers are callable functions", () => {
      const hooks = createDefaultCopilotHooks();

      expect(typeof hooks.onSessionStart).toBe("function");
      expect(typeof hooks.onSessionEnd).toBe("function");
      expect(typeof hooks.onUserPrompt).toBe("function");
    });

    test("onSessionStart handler works", async () => {
      const hooks = createDefaultCopilotHooks();
      const event = createMockEvent("session.start");

      // Should not throw
      await hooks.onSessionStart!(event);
    });

    test("onUserPrompt handler works", async () => {
      const hooks = createDefaultCopilotHooks();

      // Should not throw
      await hooks.onUserPrompt!("/commit test");
    });
  });

  describe("registerDefaultCopilotHooks", () => {
    test("registers hooks with mock client", () => {
      const mockClient = {
        agentType: "copilot" as const,
        on: mock(() => () => {}),
        createSession: async () => ({} as never),
        resumeSession: async () => null,
        registerTool: () => {},
        start: async () => {},
        stop: async () => {},
        setPermissionHandler: () => {},
        setClientFactory: () => {},
      };

      const unsubscribers = registerDefaultCopilotHooks(mockClient as never);

      expect(mockClient.on).toHaveBeenCalled();
      expect(unsubscribers.length).toBeGreaterThan(0);
    });

    test("returns unsubscribe functions", () => {
      const mockClient = {
        agentType: "copilot" as const,
        on: mock(() => () => {}),
        createSession: async () => ({} as never),
        resumeSession: async () => null,
        registerTool: () => {},
        start: async () => {},
        stop: async () => {},
        setPermissionHandler: () => {},
        setClientFactory: () => {},
      };

      const unsubscribers = registerDefaultCopilotHooks(mockClient as never);

      expect(Array.isArray(unsubscribers)).toBe(true);
      for (const unsub of unsubscribers) {
        expect(typeof unsub).toBe("function");
      }
    });
  });

  describe("Error handling", () => {
    test("session start handler never throws", async () => {
      const handler = createSessionStartHandler();

      // Even with invalid event, should not throw
      await handler({} as never);
    });

    test("session end handler never throws", async () => {
      const handler = createSessionEndHandler();

      // Even with invalid event, should not throw
      await handler({} as never);
    });

    test("user prompt handler never throws", async () => {
      const handler = createUserPromptHandler();

      // Even with empty/invalid input, should not throw
      await handler("");
      await handler(null as never);
    });
  });
});
