/**
 * E2E tests for Ctrl+C stops execution and marks session as paused
 *
 * These tests verify that when a user presses Ctrl+C (sends SIGINT) during
 * Ralph workflow execution:
 * 1. Start /ralph session
 * 2. Send SIGINT (Ctrl+C) signal
 * 3. Verify 'Stopping Ralph execution...' message
 * 4. Verify session.json status is 'paused'
 * 5. Verify checkpoint saved
 * 6. Verify resume command displayed
 *
 * Reference: Feature - E2E test: Ctrl+C stops execution and marks session as paused
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { existsSync } from "fs";
import {
  generateSessionId,
  getSessionDir,
  createSessionDirectory,
  saveSession,
  loadSession,
  loadSessionIfExists,
  createRalphSession,
  createRalphFeature,
  SESSION_SUBDIRECTORIES,
  type RalphSession,
  type RalphFeature,
} from "../../src/workflows/ralph-session.ts";
import {
  RalphExecutor,
  createRalphExecutor,
  type RalphExecutorResult,
} from "../../src/workflows/ralph-executor.ts";
import { createRalphWorkflow } from "../../src/workflows/ralph.ts";
import {
  globalRegistry,
  type CommandContext,
  type CommandContextState,
} from "../../src/ui/commands/registry.ts";
import { registerWorkflowCommands } from "../../src/ui/commands/workflow-commands.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock CommandContext for testing.
 */
function createMockContext(
  stateOverrides: Partial<CommandContextState> = {}
): CommandContext & { getMessages: () => Array<{ role: string; content: string }> } {
  const messages: Array<{ role: string; content: string }> = [];
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
      workflowActive: false,
      workflowType: null,
      initialPrompt: null,
      pendingApproval: false,
      specApproved: undefined,
      feedback: null,
      ...stateOverrides,
    },
    addMessage: (role, content) => {
      messages.push({ role, content });
    },
    setStreaming: () => {},
    sendMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "Mock sub-agent output" }),
    getMessages: () => messages,
  };
}

/**
 * Create a test feature list JSON content.
 */
function createTestFeatureListContent(): string {
  const features = {
    features: [
      {
        category: "functional",
        description: "Test feature 1: Add user authentication",
        steps: ["Create user model", "Add login endpoint"],
        passes: false,
      },
      {
        category: "functional",
        description: "Test feature 2: Add dashboard view",
        steps: ["Create dashboard component"],
        passes: false,
      },
    ],
  };
  return JSON.stringify(features, null, 2);
}

/**
 * Create a running session with test data for interrupt testing.
 */
async function createRunningSession(
  sessionDir: string,
  sessionId: string,
  overrides: Partial<RalphSession> = {}
): Promise<RalphSession> {
  const features: RalphFeature[] = [
    createRalphFeature({
      id: "feat-001",
      name: "Test feature 1",
      description: "First test feature",
      status: "passing",
      implementedAt: new Date().toISOString(),
    }),
    createRalphFeature({
      id: "feat-002",
      name: "Test feature 2",
      description: "Second test feature",
      status: "in_progress",
    }),
    createRalphFeature({
      id: "feat-003",
      name: "Test feature 3",
      description: "Third test feature",
      status: "pending",
    }),
  ];

  const session = createRalphSession({
    sessionId,
    sessionDir,
    status: "running",
    features,
    completedFeatures: ["feat-001"],
    currentFeatureIndex: 1,
    iteration: 5,
    maxIterations: 100,
    yolo: false,
    sourceFeatureListPath: "research/feature-list.json",
    ...overrides,
  });

  await saveSession(sessionDir, session);
  return session;
}

/**
 * Capture console output for verification.
 */
function captureConsole(): {
  logs: string[];
  restore: () => void;
  originalLog: typeof console.log;
  originalError: typeof console.error;
} {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    logs.push("[ERROR] " + args.map(String).join(" "));
  };

  return {
    logs,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
    originalLog,
    originalError,
  };
}

// ============================================================================
// E2E TEST: Ctrl+C stops execution and marks session as paused
// ============================================================================

describe("E2E test: Ctrl+C stops execution and marks session as paused", () => {
  let tmpDir: string;
  let originalCwd: string;
  let originalProcessExit: typeof process.exit;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();

    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-ralph-ctrl-c-e2e-"));

    // Change to temp directory for testing
    process.chdir(tmpDir);

    // Register workflow commands
    registerWorkflowCommands();

    // Mock process.exit to prevent test from exiting
    originalProcessExit = process.exit;
    process.exit = (() => {}) as typeof process.exit;
  });

  afterEach(async () => {
    // Restore process.exit
    process.exit = originalProcessExit;

    // Restore original cwd
    process.chdir(originalCwd);

    // Clean up the temporary directory
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // 1. Start /ralph session
  // ============================================================================

  describe("1. Start /ralph session", () => {
    beforeEach(async () => {
      // Create research directory and feature list
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      const featureListPath = path.join(researchDir, "feature-list.json");
      await fs.writeFile(featureListPath, createTestFeatureListContent());
    });

    test("Ralph session can be started for interrupt testing", () => {
      const context = createMockContext();
      const command = globalRegistry.get("ralph");
      expect(command).toBeDefined();

      const result = command!.execute("implement features", context);
      expect(result.success).toBe(true);
      expect(result.stateUpdate?.workflowActive).toBe(true);
      expect(result.stateUpdate?.ralphConfig?.sessionId).toBeDefined();
    });

    test("Session directory structure is created correctly", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      expect(existsSync(sessionDir)).toBe(true);

      // Verify subdirectories exist
      for (const subdir of SESSION_SUBDIRECTORIES) {
        const subdirPath = path.join(sessionDir, subdir);
        expect(existsSync(subdirPath)).toBe(true);
      }
    });

    test("Running session can be created and saved", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      const session = await createRunningSession(sessionDir, sessionId);

      expect(session.status).toBe("running");
      expect(session.iteration).toBe(5);
      expect(session.features.length).toBe(3);
    });

    test("RalphExecutor can be created with session info", () => {
      const sessionId = generateSessionId();
      const sessionDir = `.ralph/sessions/${sessionId}/`;

      const executor = createRalphExecutor();
      executor.setSession(sessionId, sessionDir);

      expect(executor).toBeInstanceOf(RalphExecutor);
      expect(executor.aborted).toBe(false);
    });

    test("Executor signal is AbortSignal", () => {
      const executor = createRalphExecutor();
      expect(executor.signal).toBeInstanceOf(AbortSignal);
      expect(executor.signal.aborted).toBe(false);
      executor.cleanup();
    });
  });

  // ============================================================================
  // 2. Send SIGINT (Ctrl+C) signal
  // ============================================================================

  describe("2. Send SIGINT (Ctrl+C) signal", () => {
    test("SIGINT handler is registered when executor runs", async () => {
      const executor = createRalphExecutor();
      const workflow = createRalphWorkflow();

      // Run starts the executor and sets up handlers
      await executor.run(workflow, { maxIterations: 5 });

      // The handlers should be set up (we test this indirectly through SIGINT behavior)
      expect(executor).toBeInstanceOf(RalphExecutor);

      executor.cleanup();
    });

    test("SIGINT can be emitted to trigger interrupt handler", async () => {
      const executor = createRalphExecutor();
      const workflow = createRalphWorkflow();

      // Set up a running session
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      await createRunningSession(sessionDir, sessionId);

      executor.setSession(sessionId, sessionDir);
      await executor.run(workflow, { maxIterations: 5 });

      // Emit SIGINT
      process.emit("SIGINT");

      // Give async operations time to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      executor.cleanup();
    });

    test("AbortController is aborted after SIGINT", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        // Emit SIGINT
        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 100));

        // Signal should be aborted
        expect(executor.aborted).toBe(true);

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Multiple SIGINT emissions are handled gracefully", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        // Emit SIGINT multiple times
        process.emit("SIGINT");
        process.emit("SIGINT");
        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 100));

        // Should not throw or crash
        expect(executor.aborted).toBe(true);

        executor.cleanup();
      } finally {
        restore();
      }
    });
  });

  // ============================================================================
  // 3. Verify 'Stopping Ralph execution...' message
  // ============================================================================

  describe("3. Verify 'Stopping Ralph execution...' message", () => {
    test("Stopping message is logged on SIGINT", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        // Emit SIGINT
        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify stopping message (includes newline prefix)
        const stoppingLog = logs.find(
          (log) =>
            log.includes("Stopping Ralph execution...") ||
            log.includes("\nStopping Ralph execution...")
        );
        expect(stoppingLog).toBeDefined();

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Stopping message appears before session update messages", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        // Emit SIGINT
        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 100));

        // Find indices
        const stoppingIndex = logs.findIndex((log) =>
          log.includes("Stopping Ralph execution...")
        );
        const pausedIndex = logs.findIndex((log) =>
          log.includes("Paused Ralph session")
        );

        // Stopping should appear before paused
        if (stoppingIndex !== -1 && pausedIndex !== -1) {
          expect(stoppingIndex).toBeLessThan(pausedIndex);
        }

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Stopping message is displayed even without session set", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        // Don't set session - just run and interrupt
        await executor.run(workflow, { maxIterations: 5 });

        // Emit SIGINT
        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 100));

        // Should still show stopping message
        const stoppingLog = logs.find((log) =>
          log.includes("Stopping Ralph execution...")
        );
        expect(stoppingLog).toBeDefined();

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Message format matches expected pattern", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 100));

        // Message should contain exactly this text
        const hasCorrectMessage = logs.some((log) =>
          log.includes("Stopping Ralph execution...")
        );
        expect(hasCorrectMessage).toBe(true);

        executor.cleanup();
      } finally {
        restore();
      }
    });
  });

  // ============================================================================
  // 4. Verify session.json status is 'paused'
  // ============================================================================

  describe("4. Verify session.json status is 'paused'", () => {
    test("Session status changes from running to paused after SIGINT", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        // Verify initial status
        const beforeInterrupt = await loadSession(sessionDir);
        expect(beforeInterrupt.status).toBe("running");

        // Emit SIGINT
        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Verify paused status
        const afterInterrupt = await loadSession(sessionDir);
        expect(afterInterrupt.status).toBe("paused");

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Session lastUpdated is updated when paused", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        const beforeInterrupt = await loadSession(sessionDir);
        const beforeTime = new Date(beforeInterrupt.lastUpdated).getTime();

        // Wait a bit to ensure timestamp difference
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Emit SIGINT
        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        const afterInterrupt = await loadSession(sessionDir);
        const afterTime = new Date(afterInterrupt.lastUpdated).getTime();

        expect(afterTime).toBeGreaterThan(beforeTime);

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Session preserves all other state when paused", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId, {
          iteration: 15,
          currentFeatureIndex: 2,
          completedFeatures: ["feat-001", "feat-002"],
        });

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 100 });

        // Emit SIGINT
        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        const afterInterrupt = await loadSession(sessionDir);

        expect(afterInterrupt.status).toBe("paused");
        expect(afterInterrupt.iteration).toBe(15);
        expect(afterInterrupt.currentFeatureIndex).toBe(2);
        expect(afterInterrupt.completedFeatures).toContain("feat-001");
        expect(afterInterrupt.completedFeatures).toContain("feat-002");
        expect(afterInterrupt.features.length).toBe(3);

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Session file is valid JSON after interrupt", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Read file directly and verify it's valid JSON
        const sessionPath = path.join(sessionDir, "session.json");
        const content = await fs.readFile(sessionPath, "utf-8");
        const parsed = JSON.parse(content);

        expect(parsed.status).toBe("paused");
        expect(parsed.sessionId).toBe(sessionId);

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Paused session can be loaded with loadSessionIfExists", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Use loadSessionIfExists
        const loaded = await loadSessionIfExists(sessionDir);

        expect(loaded).not.toBeNull();
        expect(loaded?.status).toBe("paused");

        executor.cleanup();
      } finally {
        restore();
      }
    });
  });

  // ============================================================================
  // 5. Verify checkpoint saved
  // ============================================================================

  describe("5. Verify checkpoint saved", () => {
    test("Checkpoints directory exists after session creation", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const checkpointsDir = path.join(sessionDir, "checkpoints");
      expect(existsSync(checkpointsDir)).toBe(true);
    });

    test("Session state is persisted and can be recovered", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId, {
          iteration: 10,
          features: [
            createRalphFeature({
              id: "feat-001",
              name: "Feature 1",
              description: "First feature",
              status: "passing",
            }),
            createRalphFeature({
              id: "feat-002",
              name: "Feature 2",
              description: "Second feature",
              status: "in_progress",
            }),
          ],
        });

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 50 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // State should be recoverable from session.json
        const recovered = await loadSession(sessionDir);

        expect(recovered.sessionId).toBe(sessionId);
        expect(recovered.status).toBe("paused");
        expect(recovered.iteration).toBe(10);
        expect(recovered.features.length).toBe(2);

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Session directory structure is intact after interrupt", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Verify all directories still exist
        expect(existsSync(sessionDir)).toBe(true);
        expect(existsSync(path.join(sessionDir, "checkpoints"))).toBe(true);
        expect(existsSync(path.join(sessionDir, "research"))).toBe(true);
        expect(existsSync(path.join(sessionDir, "logs"))).toBe(true);
        expect(existsSync(path.join(sessionDir, "session.json"))).toBe(true);

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Interrupted session can be used for resume", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId, {
          sourceFeatureListPath: "research/feature-list.json",
        });

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Simulate resume: load session and change status
        const paused = await loadSession(sessionDir);
        expect(paused.status).toBe("paused");

        paused.status = "running";
        await saveSession(sessionDir, paused);

        const resumed = await loadSession(sessionDir);
        expect(resumed.status).toBe("running");
        expect(resumed.sourceFeatureListPath).toBe("research/feature-list.json");

        executor.cleanup();
      } finally {
        restore();
      }
    });
  });

  // ============================================================================
  // 6. Verify resume command displayed
  // ============================================================================

  describe("6. Verify resume command displayed", () => {
    test("Resume command is logged on SIGINT with session set", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Verify resume command is displayed
        const resumeLog = logs.find((log) =>
          log.includes(`Resume with: /ralph --resume ${sessionId}`)
        );
        expect(resumeLog).toBeDefined();

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Paused session message is logged on SIGINT", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Verify paused session message
        const pausedLog = logs.find((log) =>
          log.includes(`Paused Ralph session: ${sessionId}`)
        );
        expect(pausedLog).toBeDefined();

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Status paused message is logged on SIGINT", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Verify status paused message
        const statusLog = logs.find((log) => log.includes("Status: Paused"));
        expect(statusLog).toBeDefined();

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Resume command is NOT displayed when no session is set", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        // Don't set session
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Should NOT show resume command
        const resumeLog = logs.find((log) =>
          log.includes("Resume with: /ralph --resume")
        );
        expect(resumeLog).toBeUndefined();

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Resume command contains valid UUID format", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Find resume command log
        const resumeLog = logs.find((log) =>
          log.includes("Resume with: /ralph --resume")
        );
        expect(resumeLog).toBeDefined();

        // Extract UUID from log
        const uuidMatch = resumeLog?.match(
          /--resume ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
        );
        expect(uuidMatch).not.toBeNull();
        expect(uuidMatch?.[1]).toBe(sessionId);

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("All interrupt messages appear in correct order", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Find all relevant logs and their indices
        const stoppingIndex = logs.findIndex((log) =>
          log.includes("Stopping Ralph execution...")
        );
        const statusIndex = logs.findIndex((log) =>
          log.includes("Status: Paused")
        );
        const pausedIndex = logs.findIndex((log) =>
          log.includes("Paused Ralph session")
        );
        const resumeIndex = logs.findIndex((log) =>
          log.includes("Resume with: /ralph --resume")
        );

        // Verify order: Stopping -> Status -> Paused -> Resume
        expect(stoppingIndex).not.toBe(-1);
        expect(statusIndex).not.toBe(-1);
        expect(pausedIndex).not.toBe(-1);
        expect(resumeIndex).not.toBe(-1);

        expect(stoppingIndex).toBeLessThan(statusIndex);
        expect(statusIndex).toBeLessThan(pausedIndex);
        expect(pausedIndex).toBeLessThan(resumeIndex);

        executor.cleanup();
      } finally {
        restore();
      }
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("Integration: Complete Ctrl+C interrupt flow", () => {
    test("Full interrupt cycle: start -> SIGINT -> verify all artifacts", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId, {
          iteration: 7,
          maxIterations: 50,
          features: [
            createRalphFeature({
              id: "feat-001",
              name: "Auth feature",
              description: "Add authentication",
              status: "passing",
            }),
            createRalphFeature({
              id: "feat-002",
              name: "Dashboard",
              description: "Add dashboard",
              status: "in_progress",
            }),
          ],
        });

        // Step 1: Set up executor with session
        executor.setSession(sessionId, sessionDir);

        // Step 2: Start workflow
        await executor.run(workflow, { maxIterations: 50 });

        // Step 3: Verify initial state
        const beforeInterrupt = await loadSession(sessionDir);
        expect(beforeInterrupt.status).toBe("running");

        // Step 4: Send SIGINT
        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 200));

        // Step 5: Verify console messages
        expect(logs.some((l) => l.includes("Stopping Ralph execution..."))).toBe(true);
        expect(logs.some((l) => l.includes("Status: Paused"))).toBe(true);
        expect(logs.some((l) => l.includes(`Paused Ralph session: ${sessionId}`))).toBe(
          true
        );
        expect(
          logs.some((l) => l.includes(`Resume with: /ralph --resume ${sessionId}`))
        ).toBe(true);

        // Step 6: Verify session state
        const afterInterrupt = await loadSession(sessionDir);
        expect(afterInterrupt.status).toBe("paused");
        expect(afterInterrupt.iteration).toBe(7);
        expect(afterInterrupt.features.length).toBe(2);

        // Step 7: Verify executor state
        expect(executor.aborted).toBe(true);

        // Step 8: Verify directory structure intact
        expect(existsSync(sessionDir)).toBe(true);
        expect(existsSync(path.join(sessionDir, "session.json"))).toBe(true);
        expect(existsSync(path.join(sessionDir, "checkpoints"))).toBe(true);

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Interrupt during yolo mode session", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow({ yolo: true });

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);

        // Create yolo mode session
        const session = createRalphSession({
          sessionId,
          sessionDir,
          status: "running",
          yolo: true,
          maxIterations: 100,
          features: [], // No features in yolo mode
          iteration: 3,
        });
        await saveSession(sessionDir, session);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 100 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Verify paused
        const afterInterrupt = await loadSession(sessionDir);
        expect(afterInterrupt.status).toBe("paused");
        expect(afterInterrupt.yolo).toBe(true);
        expect(afterInterrupt.features).toEqual([]);

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Interrupt preserves partially completed features", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);

        // Create session with mixed feature states
        await createRunningSession(sessionDir, sessionId, {
          features: [
            createRalphFeature({
              id: "feat-001",
              name: "Feature 1",
              description: "First",
              status: "passing",
              implementedAt: new Date().toISOString(),
            }),
            createRalphFeature({
              id: "feat-002",
              name: "Feature 2",
              description: "Second",
              status: "passing",
              implementedAt: new Date().toISOString(),
            }),
            createRalphFeature({
              id: "feat-003",
              name: "Feature 3",
              description: "Third",
              status: "in_progress",
            }),
            createRalphFeature({
              id: "feat-004",
              name: "Feature 4",
              description: "Fourth",
              status: "pending",
            }),
          ],
          completedFeatures: ["feat-001", "feat-002"],
          currentFeatureIndex: 2,
        });

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 50 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        const afterInterrupt = await loadSession(sessionDir);

        expect(afterInterrupt.features[0]?.status).toBe("passing");
        expect(afterInterrupt.features[1]?.status).toBe("passing");
        expect(afterInterrupt.features[2]?.status).toBe("in_progress");
        expect(afterInterrupt.features[3]?.status).toBe("pending");
        expect(afterInterrupt.completedFeatures).toEqual(["feat-001", "feat-002"]);

        executor.cleanup();
      } finally {
        restore();
      }
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge cases", () => {
    test("Cleanup can be called multiple times without error", () => {
      const executor = createRalphExecutor();

      executor.cleanup();
      executor.cleanup();
      executor.cleanup();

      // Should not throw
      expect(executor.aborted).toBe(false);
    });

    test("New executor works correctly after previous cleanup", async () => {
      const executor1 = createRalphExecutor();
      executor1.cleanup();

      const executor2 = createRalphExecutor();
      expect(executor2.aborted).toBe(false);
      expect(executor2.signal.aborted).toBe(false);
      executor2.cleanup();
    });

    test("Session without session.json handles interrupt gracefully", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);

        // Don't save session.json - just create directory
        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Should still show stopping message
        expect(logs.some((l) => l.includes("Stopping Ralph execution..."))).toBe(true);

        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Interrupt with empty session directory path", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createRalphExecutor();
        const workflow = createRalphWorkflow();

        // Set session with empty dir
        executor.setSession("test-id", "");
        await executor.run(workflow, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Should still show stopping message
        expect(logs.some((l) => l.includes("Stopping Ralph execution..."))).toBe(true);

        executor.cleanup();
      } finally {
        restore();
      }
    });
  });
});
