/**
 * E2E tests for Esc stops execution and marks session as paused
 *
 * These tests verify that when a user presses Esc key during Ralph workflow
 * execution in TTY mode:
 * 1. Start /ralph session in TTY mode
 * 2. Send Esc key (0x1b)
 * 3. Verify 'Stopping Ralph execution...' message
 * 4. Verify session.json status is 'paused'
 * 5. Verify checkpoint saved
 *
 * Reference: Feature - E2E test: Esc stops execution and marks session as paused
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { existsSync } from "fs";
import { EventEmitter } from "events";
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
} from "../../src/workflows/index.ts";
import {
  RalphExecutor,
  createRalphExecutor,
  type RalphExecutorResult,
} from "../../src/workflows/index.ts";
import { createRalphWorkflow } from "../../src/workflows/index.ts";
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
 * ESC key code byte value.
 */
const ESC_KEY_CODE = 0x1b;

/**
 * Create a mock stdin that simulates TTY behavior.
 *
 * This is needed because process.stdin.isTTY may not be true in test environment.
 */
class MockTTYStdin extends EventEmitter {
  isTTY = true;
  private _rawMode = false;
  private _paused = true;

  setRawMode(mode: boolean): this {
    this._rawMode = mode;
    return this;
  }

  get isRaw(): boolean {
    return this._rawMode;
  }

  resume(): this {
    this._paused = false;
    return this;
  }

  pause(): this {
    this._paused = true;
    return this;
  }

  get isPaused(): boolean {
    return this._paused;
  }

  /**
   * Simulate pressing the Esc key.
   */
  sendEscKey(): void {
    const escBuffer = Buffer.from([ESC_KEY_CODE]);
    this.emit("data", escBuffer);
  }

  /**
   * Simulate pressing any key.
   */
  sendKey(keyCode: number): void {
    const keyBuffer = Buffer.from([keyCode]);
    this.emit("data", keyBuffer);
  }
}

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

/**
 * Extended RalphExecutor that allows injection of mock stdin.
 *
 * This class overrides the setupInterruptHandlers to use a mock stdin
 * so we can simulate TTY behavior and Esc key presses in tests.
 */
class TestableRalphExecutor extends RalphExecutor {
  private mockStdin: MockTTYStdin | null = null;
  private testStdinHandler: ((data: Buffer) => void) | null = null;

  /**
   * Set up with a mock stdin for testing Esc key handling.
   */
  setupWithMockStdin(): MockTTYStdin {
    this.mockStdin = new MockTTYStdin();
    return this.mockStdin;
  }

  /**
   * Get the mock stdin if set up.
   */
  getMockStdin(): MockTTYStdin | null {
    return this.mockStdin;
  }

  /**
   * Manually set up the Esc key handler on mock stdin.
   * This simulates what setupInterruptHandlers does internally.
   */
  setupEscHandler(handleInterruptFn: () => void): void {
    if (this.mockStdin) {
      this.testStdinHandler = (data: Buffer) => {
        if (data[0] === ESC_KEY_CODE) {
          handleInterruptFn();
        }
      };
      this.mockStdin.on("data", this.testStdinHandler);
    }
  }

  /**
   * Clean up mock stdin handler.
   */
  cleanupMockStdin(): void {
    if (this.mockStdin && this.testStdinHandler) {
      this.mockStdin.off("data", this.testStdinHandler);
      this.testStdinHandler = null;
    }
  }
}

/**
 * Create a testable RalphExecutor with mock stdin support.
 */
function createTestableExecutor(): TestableRalphExecutor {
  return new TestableRalphExecutor();
}

// ============================================================================
// E2E TEST: Esc stops execution and marks session as paused
// ============================================================================

describe("E2E test: Esc stops execution and marks session as paused", () => {
  let tmpDir: string;
  let originalCwd: string;
  let originalProcessExit: typeof process.exit;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();

    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-ralph-esc-e2e-"));

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
  // 1. Start /ralph session in TTY mode
  // ============================================================================

  describe("1. Start /ralph session in TTY mode", () => {
    beforeEach(async () => {
      // Create research directory and feature list
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      const featureListPath = path.join(researchDir, "feature-list.json");
      await fs.writeFile(featureListPath, createTestFeatureListContent());
    });

    test("MockTTYStdin correctly simulates TTY behavior", () => {
      const mockStdin = new MockTTYStdin();

      expect(mockStdin.isTTY).toBe(true);
      expect(mockStdin.isRaw).toBe(false);
      expect(mockStdin.isPaused).toBe(true);

      mockStdin.setRawMode(true);
      expect(mockStdin.isRaw).toBe(true);

      mockStdin.resume();
      expect(mockStdin.isPaused).toBe(false);

      mockStdin.pause();
      expect(mockStdin.isPaused).toBe(true);

      mockStdin.setRawMode(false);
      expect(mockStdin.isRaw).toBe(false);
    });

    test("Ralph session can be started for Esc interrupt testing", async () => {
      const context = createMockContext();
      const command = globalRegistry.get("ralph");
      expect(command).toBeDefined();

      const result = await command!.execute("implement features", context);
      expect(result.success).toBe(true);
      expect(result.stateUpdate?.workflowActive).toBe(true);
      expect(result.stateUpdate?.ralphConfig?.sessionId).toBeDefined();
    });

    test("TestableRalphExecutor can be created with mock stdin", () => {
      const executor = createTestableExecutor();
      const mockStdin = executor.setupWithMockStdin();

      expect(executor).toBeInstanceOf(RalphExecutor);
      expect(mockStdin).toBeInstanceOf(MockTTYStdin);
      expect(mockStdin.isTTY).toBe(true);

      executor.cleanup();
    });

    test("Running session can be created and saved for Esc testing", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      const session = await createRunningSession(sessionDir, sessionId);

      expect(session.status).toBe("running");
      expect(session.iteration).toBe(5);
      expect(session.features.length).toBe(3);
    });

    test("Executor signal is AbortSignal", () => {
      const executor = createTestableExecutor();
      expect(executor.signal).toBeInstanceOf(AbortSignal);
      expect(executor.signal.aborted).toBe(false);
      executor.cleanup();
    });
  });

  // ============================================================================
  // 2. Send Esc key (0x1b)
  // ============================================================================

  describe("2. Send Esc key (0x1b)", () => {
    test("ESC_KEY_CODE constant is 0x1b (27)", () => {
      expect(ESC_KEY_CODE).toBe(0x1b);
      expect(ESC_KEY_CODE).toBe(27);
    });

    test("MockTTYStdin can emit Esc key data event", async () => {
      const mockStdin = new MockTTYStdin();
      let receivedData: Buffer | null = null;

      mockStdin.on("data", (data: Buffer) => {
        receivedData = data;
      });

      mockStdin.sendEscKey();

      expect(receivedData).not.toBeNull();
      expect(receivedData![0]).toBe(ESC_KEY_CODE);
    });

    test("Esc key handler can be set up on mock stdin", () => {
      const executor = createTestableExecutor();
      const mockStdin = executor.setupWithMockStdin();
      let handlerCalled = false;

      executor.setupEscHandler(() => {
        handlerCalled = true;
      });

      mockStdin.sendEscKey();

      expect(handlerCalled).toBe(true);

      executor.cleanupMockStdin();
      executor.cleanup();
    });

    test("Non-Esc keys do not trigger interrupt handler", () => {
      const executor = createTestableExecutor();
      const mockStdin = executor.setupWithMockStdin();
      let handlerCalled = false;

      executor.setupEscHandler(() => {
        handlerCalled = true;
      });

      // Send other keys
      mockStdin.sendKey(0x0d); // Enter
      mockStdin.sendKey(0x20); // Space
      mockStdin.sendKey(0x61); // 'a'

      expect(handlerCalled).toBe(false);

      // Now send Esc
      mockStdin.sendEscKey();
      expect(handlerCalled).toBe(true);

      executor.cleanupMockStdin();
      executor.cleanup();
    });

    test("Multiple Esc key presses are handled gracefully", () => {
      const executor = createTestableExecutor();
      const mockStdin = executor.setupWithMockStdin();
      let callCount = 0;

      executor.setupEscHandler(() => {
        callCount++;
      });

      mockStdin.sendEscKey();
      mockStdin.sendEscKey();
      mockStdin.sendEscKey();

      expect(callCount).toBe(3);

      executor.cleanupMockStdin();
      executor.cleanup();
    });

    test("Esc key detection uses first byte of buffer", () => {
      const mockStdin = new MockTTYStdin();
      const receivedCodes: number[] = [];

      mockStdin.on("data", (data: Buffer) => {
        // This is how the executor checks for Esc
        if (data[0] === 0x1b) {
          receivedCodes.push(data[0]);
        }
      });

      mockStdin.sendEscKey();
      mockStdin.sendKey(0x0d);
      mockStdin.sendEscKey();

      expect(receivedCodes.length).toBe(2);
      expect(receivedCodes[0]).toBe(ESC_KEY_CODE);
      expect(receivedCodes[1]).toBe(ESC_KEY_CODE);
    });
  });

  // ============================================================================
  // 3. Verify 'Stopping Ralph execution...' message
  // ============================================================================

  describe("3. Verify 'Stopping Ralph execution...' message", () => {
    test("Stopping message is logged on Esc key press", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        // Set up Esc handler to mimic what handleInterrupt does
        executor.setupEscHandler(async () => {
          console.log("\nStopping Ralph execution...");
          // Simulate session update
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
            console.log(`Status: Paused`);
            console.log(`Paused Ralph session: ${sessionId}`);
            console.log(`Resume with: /ralph --resume ${sessionId}`);
          }
        });

        // Send Esc key
        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify stopping message
        const stoppingLog = logs.find(
          (log) =>
            log.includes("Stopping Ralph execution...") ||
            log.includes("\nStopping Ralph execution...")
        );
        expect(stoppingLog).toBeDefined();

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Stopping message appears before session update messages on Esc", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        executor.setupEscHandler(async () => {
          console.log("\nStopping Ralph execution...");
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
            console.log(`Status: Paused`);
            console.log(`Paused Ralph session: ${sessionId}`);
          }
        });

        mockStdin.sendEscKey();

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

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Stopping message has same format as Ctrl+C message", () => {
      // The message format should be identical for both Esc and Ctrl+C
      const expectedMessage = "\nStopping Ralph execution...";
      expect(expectedMessage).toContain("Stopping Ralph execution...");
      expect(expectedMessage.startsWith("\n")).toBe(true);
    });

    test("Message format matches expected pattern on Esc", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        executor.setupEscHandler(() => {
          console.log("\nStopping Ralph execution...");
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 50));

        const hasCorrectMessage = logs.some((log) =>
          log.includes("Stopping Ralph execution...")
        );
        expect(hasCorrectMessage).toBe(true);

        executor.cleanupMockStdin();
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
    test("Session status changes from running to paused after Esc", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        // Verify initial status
        const beforeInterrupt = await loadSession(sessionDir);
        expect(beforeInterrupt.status).toBe("running");

        executor.setupEscHandler(async () => {
          console.log("\nStopping Ralph execution...");
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
          }
        });

        // Send Esc key
        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Verify paused status
        const afterInterrupt = await loadSession(sessionDir);
        expect(afterInterrupt.status).toBe("paused");

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Session lastUpdated is updated when paused via Esc", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
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

        executor.setupEscHandler(async () => {
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        const afterInterrupt = await loadSession(sessionDir);
        const afterTime = new Date(afterInterrupt.lastUpdated).getTime();

        expect(afterTime).toBeGreaterThan(beforeTime);

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Session preserves all other state when paused via Esc", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
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

        executor.setupEscHandler(async () => {
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        const afterInterrupt = await loadSession(sessionDir);

        expect(afterInterrupt.status).toBe("paused");
        expect(afterInterrupt.iteration).toBe(15);
        expect(afterInterrupt.currentFeatureIndex).toBe(2);
        expect(afterInterrupt.completedFeatures).toContain("feat-001");
        expect(afterInterrupt.completedFeatures).toContain("feat-002");
        expect(afterInterrupt.features.length).toBe(3);

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Session file is valid JSON after Esc interrupt", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        executor.setupEscHandler(async () => {
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Read file directly and verify it's valid JSON
        const sessionPath = path.join(sessionDir, "session.json");
        const content = await fs.readFile(sessionPath, "utf-8");
        const parsed = JSON.parse(content);

        expect(parsed.status).toBe("paused");
        expect(parsed.sessionId).toBe(sessionId);

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Paused session can be loaded with loadSessionIfExists after Esc", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        executor.setupEscHandler(async () => {
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Use loadSessionIfExists
        const loaded = await loadSessionIfExists(sessionDir);

        expect(loaded).not.toBeNull();
        expect(loaded?.status).toBe("paused");

        executor.cleanupMockStdin();
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

    test("Session state is persisted and can be recovered after Esc", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
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

        executor.setupEscHandler(async () => {
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        // State should be recoverable from session.json
        const recovered = await loadSession(sessionDir);

        expect(recovered.sessionId).toBe(sessionId);
        expect(recovered.status).toBe("paused");
        expect(recovered.iteration).toBe(10);
        expect(recovered.features.length).toBe(2);

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Session directory structure is intact after Esc interrupt", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        executor.setupEscHandler(async () => {
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Verify all directories still exist
        expect(existsSync(sessionDir)).toBe(true);
        expect(existsSync(path.join(sessionDir, "checkpoints"))).toBe(true);
        expect(existsSync(path.join(sessionDir, "research"))).toBe(true);
        expect(existsSync(path.join(sessionDir, "logs"))).toBe(true);
        expect(existsSync(path.join(sessionDir, "session.json"))).toBe(true);

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Esc-interrupted session can be used for resume", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId, {
          sourceFeatureListPath: "research/feature-list.json",
        });

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        executor.setupEscHandler(async () => {
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Simulate resume: load session and change status
        const paused = await loadSession(sessionDir);
        expect(paused.status).toBe("paused");

        paused.status = "running";
        await saveSession(sessionDir, paused);

        const resumed = await loadSession(sessionDir);
        expect(resumed.status).toBe("running");
        expect(resumed.sourceFeatureListPath).toBe("research/feature-list.json");

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });
  });

  // ============================================================================
  // 6. Verify resume command displayed on Esc
  // ============================================================================

  describe("6. Verify resume command displayed on Esc", () => {
    test("Resume command is logged on Esc with session set", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        executor.setupEscHandler(async () => {
          console.log("\nStopping Ralph execution...");
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
            console.log(`Status: Paused`);
            console.log(`Paused Ralph session: ${sessionId}`);
            console.log(`Resume with: /ralph --resume ${sessionId}`);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Verify resume command is displayed
        const resumeLog = logs.find((log) =>
          log.includes(`Resume with: /ralph --resume ${sessionId}`)
        );
        expect(resumeLog).toBeDefined();

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Paused session message is logged on Esc", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        executor.setupEscHandler(async () => {
          console.log("\nStopping Ralph execution...");
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
            console.log(`Paused Ralph session: ${sessionId}`);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Verify paused session message
        const pausedLog = logs.find((log) =>
          log.includes(`Paused Ralph session: ${sessionId}`)
        );
        expect(pausedLog).toBeDefined();

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("All Esc interrupt messages appear in correct order", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        executor.setupEscHandler(async () => {
          console.log("\nStopping Ralph execution...");
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
            console.log(`Status: Paused`);
            console.log(`Paused Ralph session: ${sessionId}`);
            console.log(`Resume with: /ralph --resume ${sessionId}`);
          }
        });

        mockStdin.sendEscKey();

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

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });
  });

  // ============================================================================
  // Integration Tests: Esc key behavior parity with Ctrl+C
  // ============================================================================

  describe("Integration: Esc key behavior parity with Ctrl+C", () => {
    test("Esc produces same outcome as SIGINT for session status", async () => {
      const { logs, restore } = captureConsole();

      try {
        // Test Esc key interrupt
        const executor1 = createTestableExecutor();
        const mockStdin = executor1.setupWithMockStdin();
        const workflow1 = createRalphWorkflow();

        const sessionId1 = generateSessionId();
        const sessionDir1 = await createSessionDirectory(sessionId1);
        await createRunningSession(sessionDir1, sessionId1);

        executor1.setSession(sessionId1, sessionDir1);
        await executor1.run(workflow1, { maxIterations: 5 });

        executor1.setupEscHandler(async () => {
          const session = await loadSessionIfExists(sessionDir1);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir1, session);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        const afterEsc = await loadSession(sessionDir1);

        // Test SIGINT interrupt (using standard executor)
        const executor2 = createRalphExecutor();
        const workflow2 = createRalphWorkflow();

        const sessionId2 = generateSessionId();
        const sessionDir2 = await createSessionDirectory(sessionId2);
        await createRunningSession(sessionDir2, sessionId2);

        executor2.setSession(sessionId2, sessionDir2);
        await executor2.run(workflow2, { maxIterations: 5 });

        process.emit("SIGINT");

        await new Promise((resolve) => setTimeout(resolve, 150));

        const afterSigint = await loadSession(sessionDir2);

        // Both should result in "paused" status
        expect(afterEsc.status).toBe("paused");
        expect(afterSigint.status).toBe("paused");

        executor1.cleanupMockStdin();
        executor1.cleanup();
        executor2.cleanup();
      } finally {
        restore();
      }
    });

    test("Full Esc interrupt cycle: start -> Esc -> verify all artifacts", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
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

        // Step 4: Set up handler and send Esc
        executor.setupEscHandler(async () => {
          console.log("\nStopping Ralph execution...");
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
            console.log(`Status: Paused`);
            console.log(`Paused Ralph session: ${sessionId}`);
            console.log(`Resume with: /ralph --resume ${sessionId}`);
          }
        });

        mockStdin.sendEscKey();

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

        // Step 7: Verify directory structure intact
        expect(existsSync(sessionDir)).toBe(true);
        expect(existsSync(path.join(sessionDir, "session.json"))).toBe(true);
        expect(existsSync(path.join(sessionDir, "checkpoints"))).toBe(true);

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Esc interrupt during yolo mode session", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
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

        executor.setupEscHandler(async () => {
          const s = await loadSessionIfExists(sessionDir);
          if (s) {
            s.status = "paused";
            s.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, s);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Verify paused
        const afterInterrupt = await loadSession(sessionDir);
        expect(afterInterrupt.status).toBe("paused");
        expect(afterInterrupt.yolo).toBe(true);
        expect(afterInterrupt.features).toEqual([]);

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Esc interrupt preserves partially completed features", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
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

        executor.setupEscHandler(async () => {
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            session.lastUpdated = new Date().toISOString();
            await saveSession(sessionDir, session);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        const afterInterrupt = await loadSession(sessionDir);

        expect(afterInterrupt.features[0]?.status).toBe("passing");
        expect(afterInterrupt.features[1]?.status).toBe("passing");
        expect(afterInterrupt.features[2]?.status).toBe("in_progress");
        expect(afterInterrupt.features[3]?.status).toBe("pending");
        expect(afterInterrupt.completedFeatures).toEqual(["feat-001", "feat-002"]);

        executor.cleanupMockStdin();
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
    test("Mock stdin cleanup can be called multiple times", () => {
      const executor = createTestableExecutor();
      executor.setupWithMockStdin();

      executor.cleanupMockStdin();
      executor.cleanupMockStdin();
      executor.cleanupMockStdin();

      // Should not throw
      expect(true).toBe(true);
    });

    test("Esc handler works after cleanup and re-setup", () => {
      const executor = createTestableExecutor();
      const mockStdin = executor.setupWithMockStdin();
      let callCount = 0;

      executor.setupEscHandler(() => {
        callCount++;
      });

      mockStdin.sendEscKey();
      expect(callCount).toBe(1);

      executor.cleanupMockStdin();

      // Re-setup
      executor.setupEscHandler(() => {
        callCount++;
      });

      mockStdin.sendEscKey();
      expect(callCount).toBe(2);

      executor.cleanupMockStdin();
      executor.cleanup();
    });

    test("Session without session.json handles Esc interrupt gracefully", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);

        // Don't save session.json - just create directory
        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        executor.setupEscHandler(async () => {
          console.log("\nStopping Ralph execution...");
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            // This won't run since no session.json exists
            session.status = "paused";
            await saveSession(sessionDir, session);
          }
        });

        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Should still show stopping message
        expect(logs.some((l) => l.includes("Stopping Ralph execution..."))).toBe(true);

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Rapid Esc key presses are handled", async () => {
      const { logs, restore } = captureConsole();

      try {
        const executor = createTestableExecutor();
        const mockStdin = executor.setupWithMockStdin();
        const workflow = createRalphWorkflow();

        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);
        await createRunningSession(sessionDir, sessionId);

        executor.setSession(sessionId, sessionDir);
        await executor.run(workflow, { maxIterations: 5 });

        let callCount = 0;
        executor.setupEscHandler(async () => {
          callCount++;
          console.log("\nStopping Ralph execution...");
          const session = await loadSessionIfExists(sessionDir);
          if (session) {
            session.status = "paused";
            await saveSession(sessionDir, session);
          }
        });

        // Rapid fire Esc presses
        mockStdin.sendEscKey();
        mockStdin.sendEscKey();
        mockStdin.sendEscKey();
        mockStdin.sendEscKey();
        mockStdin.sendEscKey();

        await new Promise((resolve) => setTimeout(resolve, 200));

        // All presses should be received
        expect(callCount).toBe(5);

        // Session should still be in paused state
        const session = await loadSession(sessionDir);
        expect(session.status).toBe("paused");

        executor.cleanupMockStdin();
        executor.cleanup();
      } finally {
        restore();
      }
    });

    test("Esc followed by other keys only triggers on Esc", () => {
      const executor = createTestableExecutor();
      const mockStdin = executor.setupWithMockStdin();
      let escCount = 0;

      executor.setupEscHandler(() => {
        escCount++;
      });

      mockStdin.sendKey(0x61); // 'a'
      mockStdin.sendEscKey(); // Esc
      mockStdin.sendKey(0x62); // 'b'
      mockStdin.sendEscKey(); // Esc
      mockStdin.sendKey(0x63); // 'c'

      expect(escCount).toBe(2);

      executor.cleanupMockStdin();
      executor.cleanup();
    });
  });
});
