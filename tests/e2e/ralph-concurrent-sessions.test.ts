/**
 * E2E tests for Concurrent sessions don't interfere
 *
 * These tests verify that when multiple Ralph sessions run concurrently:
 * 1. Start session 1 in terminal 1
 * 2. Start session 2 in terminal 2
 * 3. Both work on different features
 * 4. Verify no file conflicts
 * 5. Verify no state corruption
 * 6. Both complete independently
 *
 * Reference: Feature - E2E test: Concurrent sessions don't interfere
 */

import { test, expect, describe, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
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
    appendLog,
  appendProgress,
  type RalphSession,
  type TodoItem,
} from "../../src/workflows/index.ts";
import { createRalphWorkflow } from "../../src/workflows/index.ts";
import { isValidUUID } from "../../src/ui/commands/workflow-commands.ts";

// ============================================================================
// TERMINAL SIMULATION HELPERS
// ============================================================================

/**
 * Simulates a terminal session for testing concurrent Ralph sessions.
 * Each terminal has its own session and can perform operations independently.
 */
interface TerminalSimulator {
  id: string;
  sessionId: string | null;
  session: RalphSession | null;
  logs: string[];
  startTime: number | null;
  endTime: number | null;
  status: "idle" | "running" | "completed" | "failed";
  error: Error | null;
}

/**
 * Create a new terminal simulator instance.
 */
function createTerminalSimulator(terminalId: string): TerminalSimulator {
  return {
    id: terminalId,
    sessionId: null,
    session: null,
    logs: [],
    startTime: null,
    endTime: null,
    status: "idle",
    error: null,
  };
}

/**
 * Log a message to a terminal.
 */
function terminalLog(terminal: TerminalSimulator, message: string): void {
  terminal.logs.push(`[${terminal.id}] ${message}`);
}

/**
 * Start a Ralph session in a terminal.
 */
async function startRalphSession(
  terminal: TerminalSimulator,
  options: {
    features?: TodoItem[];
    tasksPath?: string;
  } = {}
): Promise<void> {
  try {
    terminal.status = "running";
    terminal.startTime = Date.now();
    terminalLog(terminal, "Starting Ralph session...");

    // Generate session ID
    const sessionId = generateSessionId();
    terminal.sessionId = sessionId;
    terminalLog(terminal, `Generated session ID: ${sessionId}`);

    // Create session directory
    const sessionDir = await createSessionDirectory(sessionId);
    terminalLog(terminal, `Created session directory: ${sessionDir}`);

    // Create session
    const session = createRalphSession({
      sessionId,
      sessionDir,
      features: options.tasks ?? [],
      sourceFeatureListPath: options.tasksPath,
    });

    terminal.session = session;

    // Save session
    await saveSession(sessionDir, session);
    terminalLog(terminal, "Session saved to disk");

    // Create tasks.json in research directory if not prompt mode
    if (options.tasks && options.tasks.length > 0) {
      const tasksPath = path.join(sessionDir, "research", "tasks.json");
      const featureList = {
        features: options.tasks.map((f) => ({
          category: "functional",
          description: f.description,
          steps: f.acceptanceCriteria ?? [],
          passes: f.status === "passing",
        })),
      };
      await fs.writeFile(tasksPath, JSON.stringify(featureList, null, 2), "utf-8");
      terminalLog(terminal, "Feature list copied to session directory");
    }

    terminalLog(terminal, "Ralph session started successfully");
  } catch (error) {
    terminal.status = "failed";
    terminal.error = error as Error;
    terminalLog(terminal, `Error: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Simulate working on a feature in a terminal.
 *
 * NOTE: This function reloads the session from disk before updating to prevent
 * stale data overwrites when multiple features are worked on concurrently.
 * In real-world scenarios, each feature implementation is sequential within
 * a terminal, but for testing concurrent behavior we need to handle this.
 */
async function workOnFeature(
  terminal: TerminalSimulator,
  featureIndex: number,
  passed: boolean
): Promise<void> {
  if (!terminal.session) {
    throw new Error("No session in terminal");
  }

  const sessionDir = terminal.session.sessionDir;

  // Reload session from disk to get latest state (prevents stale data overwrites)
  let session = await loadSession(sessionDir);
  const feature = session.tasks[featureIndex];

  if (!feature) {
    throw new Error(`Feature at index ${featureIndex} not found`);
  }

  terminalLog(terminal, `Working on feature: ${feature.name}`);

  // Update feature status to in_progress
  feature.status = "in_progress";
  await saveSession(sessionDir, session);

  // Simulate some work time
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Reload session again to get any changes made during "work" (simulates real behavior)
  session = await loadSession(sessionDir);
  const updatedFeature = session.tasks[featureIndex];

  if (!updatedFeature) {
    throw new Error(`Feature at index ${featureIndex} not found`);
  }

  // Mark as passing or failing
  updatedFeature.status = passed ? "passing" : "failing";
  updatedFeature.implementedAt = passed ? new Date().toISOString() : undefined;
  updatedFeature.error = passed ? undefined : "Test failure";

  // Update completed features (only if not already present)
  if (passed && !session.completedTaskIds.includes(updatedFeature.id)) {
    session.completedTaskIds.push(updatedFeature.id);
  }

  // Increment iteration
  session.iteration++;

  // Save session
  await saveSession(sessionDir, session);

  // Update terminal's reference to the session
  terminal.session = session;

  // Append progress
  await appendProgress(sessionDir, updatedFeature, passed);

  // Append log
  await appendLog(sessionDir, "agent-calls", {
    action: passed ? "implement" : "fail",
    featureId: updatedFeature.id,
    featureName: updatedFeature.name,
    terminalId: terminal.id,
  });

  terminalLog(terminal, `Feature ${updatedFeature.name} ${passed ? "passed" : "failed"}`);
}

/**
 * Complete a Ralph session in a terminal.
 */
async function completeRalphSession(terminal: TerminalSimulator): Promise<void> {
  if (!terminal.session) {
    throw new Error("No session in terminal");
  }

  const session = terminal.session;
  session.status = "completed";
  await saveSession(session.sessionDir, session);

  terminal.status = "completed";
  terminal.endTime = Date.now();

  terminalLog(terminal, "Ralph session completed");
}

/**
 * Create test features for a specific terminal.
 */
function createTerminalFeatures(terminalId: string): TodoItem[] {
  return [
    createTodoItem({
      id: `${terminalId}-feat-001`,
      name: `${terminalId} Feature 1`,
      description: `First feature for ${terminalId}`,
      acceptanceCriteria: ["Criterion 1", "Criterion 2"],
      status: "pending",
    }),
    createTodoItem({
      id: `${terminalId}-feat-002`,
      name: `${terminalId} Feature 2`,
      description: `Second feature for ${terminalId}`,
      status: "pending",
    }),
    createTodoItem({
      id: `${terminalId}-feat-003`,
      name: `${terminalId} Feature 3`,
      description: `Third feature for ${terminalId}`,
      status: "pending",
    }),
  ];
}

// ============================================================================
// E2E TEST: Concurrent sessions don't interfere
// ============================================================================

describe("E2E test: Concurrent sessions don't interfere", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();

    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "atomic-ralph-concurrent-e2e-")
    );

    // Change to temp directory for testing
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    // Restore original cwd
    process.chdir(originalCwd);

    // Clean up the temporary directory
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // 1. Start session 1 in terminal 1
  // ============================================================================

  describe("1. Start session 1 in terminal 1", () => {
    test("terminal 1 can create a Ralph session", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const features1 = createTerminalFeatures("terminal-1");

      await startRalphSession(terminal1, { features: features1 });

      expect(terminal1.sessionId).not.toBeNull();
      expect(terminal1.session).not.toBeNull();
      expect(terminal1.status).toBe("running");
    });

    test("terminal 1 session has valid UUID", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const features1 = createTerminalFeatures("terminal-1");

      await startRalphSession(terminal1, { features: features1 });

      expect(isValidUUID(terminal1.sessionId!)).toBe(true);
    });

    test("terminal 1 session directory is created", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const features1 = createTerminalFeatures("terminal-1");

      await startRalphSession(terminal1, { features: features1 });

      expect(existsSync(terminal1.session!.sessionDir)).toBe(true);
    });

    test("terminal 1 logs show session start", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const features1 = createTerminalFeatures("terminal-1");

      await startRalphSession(terminal1, { features: features1 });

      expect(terminal1.logs.some((log) => log.includes("Starting Ralph session"))).toBe(true);
      expect(terminal1.logs.some((log) => log.includes("session started successfully"))).toBe(true);
    });
  });

  // ============================================================================
  // 2. Start session 2 in terminal 2
  // ============================================================================

  describe("2. Start session 2 in terminal 2", () => {
    test("terminal 2 can create a Ralph session concurrently with terminal 1", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      // Start both sessions concurrently
      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      expect(terminal1.sessionId).not.toBeNull();
      expect(terminal2.sessionId).not.toBeNull();
      expect(terminal1.status).toBe("running");
      expect(terminal2.status).toBe("running");
    });

    test("terminal 1 and terminal 2 have different session IDs", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      expect(terminal1.sessionId).not.toBe(terminal2.sessionId);
    });

    test("terminal 1 and terminal 2 have different session directories", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      expect(terminal1.session!.sessionDir).not.toBe(terminal2.session!.sessionDir);
    });

    test("both terminals have valid session data", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Verify session 1 data
      const loaded1 = await loadSession(terminal1.session!.sessionDir);
      expect(loaded1.sessionId).toBe(terminal1.sessionId!);
      expect(loaded1.tasks.length).toBe(3);

      // Verify session 2 data
      const loaded2 = await loadSession(terminal2.session!.sessionDir);
      expect(loaded2.sessionId).toBe(terminal2.sessionId!);
      expect(loaded2.tasks.length).toBe(3);
    });
  });

  // ============================================================================
  // 3. Both work on different features
  // ============================================================================

  describe("3. Both work on different features", () => {
    test("terminals can work on their features concurrently", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      // Start both sessions
      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Work on first feature in both terminals concurrently
      await Promise.all([
        workOnFeature(terminal1, 0, true),
        workOnFeature(terminal2, 0, true),
      ]);

      // Verify both features were marked as passing
      const loaded1 = await loadSession(terminal1.session!.sessionDir);
      const loaded2 = await loadSession(terminal2.session!.sessionDir);

      expect(loaded1.tasks[0]?.status).toBe("passing");
      expect(loaded2.tasks[0]?.status).toBe("passing");
    });

    test("terminals work on different feature sets", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Verify feature names are different
      expect(terminal1.session!.tasks[0]?.name).toContain("terminal-1");
      expect(terminal2.session!.tasks[0]?.name).toContain("terminal-2");
    });

    test("concurrent feature work across different sessions does not corrupt data", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Work on features in each terminal sequentially (as in real workflow),
      // but both terminals work in parallel with each other
      const terminal1Work = async () => {
        await workOnFeature(terminal1, 0, true);   // pass
        await workOnFeature(terminal1, 1, false);  // fail
        await workOnFeature(terminal1, 2, true);   // pass
      };

      const terminal2Work = async () => {
        await workOnFeature(terminal2, 0, false);  // fail
        await workOnFeature(terminal2, 1, true);   // pass
        await workOnFeature(terminal2, 2, false);  // fail
      };

      // Both terminals work concurrently
      await Promise.all([terminal1Work(), terminal2Work()]);

      // Verify data integrity
      const loaded1 = await loadSession(terminal1.session!.sessionDir);
      const loaded2 = await loadSession(terminal2.session!.sessionDir);

      // Terminal 1: features 0, 2 passed
      expect(loaded1.tasks[0]?.status).toBe("passing");
      expect(loaded1.tasks[1]?.status).toBe("failing");
      expect(loaded1.tasks[2]?.status).toBe("passing");

      // Terminal 2: feature 1 passed
      expect(loaded2.tasks[0]?.status).toBe("failing");
      expect(loaded2.tasks[1]?.status).toBe("passing");
      expect(loaded2.tasks[2]?.status).toBe("failing");
    });

    test("iteration counts are independent", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Terminal 1 works on 3 features, terminal 2 works on 1
      await workOnFeature(terminal1, 0, true);
      await workOnFeature(terminal1, 1, true);
      await workOnFeature(terminal1, 2, true);
      await workOnFeature(terminal2, 0, true);

      const loaded1 = await loadSession(terminal1.session!.sessionDir);
      const loaded2 = await loadSession(terminal2.session!.sessionDir);

      expect(loaded1.iteration).toBe(4); // 1 initial + 3 increments
      expect(loaded2.iteration).toBe(2); // 1 initial + 1 increment
    });
  });

  // ============================================================================
  // 4. Verify no file conflicts
  // ============================================================================

  describe("4. Verify no file conflicts", () => {
    test("session.json files are independent", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Modify terminal 1's session
      terminal1.session!.status = "paused";
      await saveSession(terminal1.session!.sessionDir, terminal1.session!);

      // Terminal 2's session should be unchanged
      const loaded2 = await loadSession(terminal2.session!.sessionDir);
      expect(loaded2.status).toBe("running");
    });

    test("progress.txt files are independent", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Work on features
      await workOnFeature(terminal1, 0, true);
      await workOnFeature(terminal2, 0, false);

      // Read progress files
      const progress1 = await fs.readFile(
        path.join(terminal1.session!.sessionDir, "progress.txt"),
        "utf-8"
      );
      const progress2 = await fs.readFile(
        path.join(terminal2.session!.sessionDir, "progress.txt"),
        "utf-8"
      );

      // Verify they contain their own feature data
      expect(progress1).toContain("terminal-1 Feature 1");
      expect(progress1).toContain("\u2713"); // checkmark
      expect(progress2).toContain("terminal-2 Feature 1");
      expect(progress2).toContain("\u2717"); // X mark
    });

    test("log files are independent", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Work on features (this creates log entries)
      await workOnFeature(terminal1, 0, true);
      await workOnFeature(terminal2, 0, true);

      // Read log files
      const log1Content = await fs.readFile(
        path.join(terminal1.session!.sessionDir, "logs", "agent-calls.jsonl"),
        "utf-8"
      );
      const log2Content = await fs.readFile(
        path.join(terminal2.session!.sessionDir, "logs", "agent-calls.jsonl"),
        "utf-8"
      );

      const log1Entry = JSON.parse(log1Content.trim());
      const log2Entry = JSON.parse(log2Content.trim());

      expect(log1Entry.terminalId).toBe("terminal-1");
      expect(log2Entry.terminalId).toBe("terminal-2");
    });

    test("tasks.json files are independent", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Read feature list files
      const featureList1Content = await fs.readFile(
        path.join(terminal1.session!.sessionDir, "research", "tasks.json"),
        "utf-8"
      );
      const featureList2Content = await fs.readFile(
        path.join(terminal2.session!.sessionDir, "research", "tasks.json"),
        "utf-8"
      );

      const featureList1 = JSON.parse(featureList1Content);
      const featureList2 = JSON.parse(featureList2Content);

      expect(featureList1.tasks[0].description).toContain("terminal-1");
      expect(featureList2.tasks[0].description).toContain("terminal-2");
    });

    test("concurrent file writes don't cause conflicts", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Perform many concurrent writes to both sessions
      const writePromises: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        writePromises.push(
          appendLog(terminal1.session!.sessionDir, "stress-test", {
            iteration: i,
            terminalId: "terminal-1",
          })
        );
        writePromises.push(
          appendLog(terminal2.session!.sessionDir, "stress-test", {
            iteration: i,
            terminalId: "terminal-2",
          })
        );
      }
      await Promise.all(writePromises);

      // Verify each log has exactly 20 entries with correct terminal IDs
      const log1Content = await fs.readFile(
        path.join(terminal1.session!.sessionDir, "logs", "stress-test.jsonl"),
        "utf-8"
      );
      const log2Content = await fs.readFile(
        path.join(terminal2.session!.sessionDir, "logs", "stress-test.jsonl"),
        "utf-8"
      );

      const log1Lines = log1Content.trim().split("\n");
      const log2Lines = log2Content.trim().split("\n");

      expect(log1Lines.length).toBe(20);
      expect(log2Lines.length).toBe(20);

      // All entries in terminal 1's log should reference terminal-1
      for (const line of log1Lines) {
        const entry = JSON.parse(line);
        expect(entry.terminalId).toBe("terminal-1");
      }

      // All entries in terminal 2's log should reference terminal-2
      for (const line of log2Lines) {
        const entry = JSON.parse(line);
        expect(entry.terminalId).toBe("terminal-2");
      }
    });
  });

  // ============================================================================
  // 5. Verify no state corruption
  // ============================================================================

  describe("5. Verify no state corruption", () => {
    test("session state remains valid after concurrent operations", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Work on features in each terminal sequentially (as in real workflow),
      // but both terminals work in parallel with each other
      const terminal1Work = async () => {
        await workOnFeature(terminal1, 0, true);
        await workOnFeature(terminal1, 1, true);
        await workOnFeature(terminal1, 2, false);
      };

      const terminal2Work = async () => {
        await workOnFeature(terminal2, 0, false);
        await workOnFeature(terminal2, 1, true);
        await workOnFeature(terminal2, 2, true);
      };

      // Both terminals work concurrently
      await Promise.all([terminal1Work(), terminal2Work()]);

      // Verify state integrity
      const loaded1 = await loadSession(terminal1.session!.sessionDir);
      const loaded2 = await loadSession(terminal2.session!.sessionDir);

      // Session 1 validation
      expect(loaded1.sessionId).toBe(terminal1.sessionId!);
      expect(loaded1.status).toBe("running");
      expect(loaded1.tasks).toHaveLength(3);
      expect(loaded1.completedTaskIds).toHaveLength(2);
      expect(loaded1.completedTaskIds).toContain("terminal-1-feat-001");
      expect(loaded1.completedTaskIds).toContain("terminal-1-feat-002");

      // Session 2 validation
      expect(loaded2.sessionId).toBe(terminal2.sessionId!);
      expect(loaded2.status).toBe("running");
      expect(loaded2.tasks).toHaveLength(3);
      expect(loaded2.completedTaskIds).toHaveLength(2);
      expect(loaded2.completedTaskIds).toContain("terminal-2-feat-002");
      expect(loaded2.completedTaskIds).toContain("terminal-2-feat-003");
    });

    test("feature status is correctly tracked per session", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Work on features in each terminal sequentially (as in real workflow),
      // but both terminals work in parallel with each other
      // Terminal 1: all pass, Terminal 2: all fail
      const terminal1Work = async () => {
        await workOnFeature(terminal1, 0, true);
        await workOnFeature(terminal1, 1, true);
        await workOnFeature(terminal1, 2, true);
      };

      const terminal2Work = async () => {
        await workOnFeature(terminal2, 0, false);
        await workOnFeature(terminal2, 1, false);
        await workOnFeature(terminal2, 2, false);
      };

      // Both terminals work concurrently
      await Promise.all([terminal1Work(), terminal2Work()]);

      const loaded1 = await loadSession(terminal1.session!.sessionDir);
      const loaded2 = await loadSession(terminal2.session!.sessionDir);

      // All terminal 1 features should be passing
      for (const feature of loaded1.tasks) {
        expect(feature.status).toBe("passing");
        expect(feature.implementedAt).toBeDefined();
        expect(feature.error).toBeUndefined();
      }

      // All terminal 2 features should be failing
      for (const feature of loaded2.tasks) {
        expect(feature.status).toBe("failing");
        expect(feature.implementedAt).toBeUndefined();
        expect(feature.error).toBe("Test failure");
      }
    });

    test("timestamps are independent per session", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      // Start terminal 1 first
      await startRalphSession(terminal1, { features: features1 });
      const session1CreatedAt = terminal1.session!.createdAt;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Start terminal 2
      await startRalphSession(terminal2, { features: features2 });
      const session2CreatedAt = terminal2.session!.createdAt;

      // Session 2 should have a later createdAt
      expect(new Date(session2CreatedAt).getTime()).toBeGreaterThan(
        new Date(session1CreatedAt).getTime()
      );
    });

    test("concurrent updates don't leak between sessions", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Update session 1 multiple times
      for (let i = 0; i < 10; i++) {
        terminal1.session!.iteration = i + 1;
        await saveSession(terminal1.session!.sessionDir, terminal1.session!);
      }

      // Session 2 should not be affected
      const loaded2 = await loadSession(terminal2.session!.sessionDir);
      expect(loaded2.iteration).toBe(1); // Still at initial value
    });
  });

  // ============================================================================
  // 6. Both complete independently
  // ============================================================================

  describe("6. Both complete independently", () => {
    test("terminal 1 can complete while terminal 2 is still running", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Complete terminal 1
      await workOnFeature(terminal1, 0, true);
      await workOnFeature(terminal1, 1, true);
      await workOnFeature(terminal1, 2, true);
      await completeRalphSession(terminal1);

      // Terminal 1 should be completed
      expect(terminal1.status).toBe("completed");
      const loaded1 = await loadSession(terminal1.session!.sessionDir);
      expect(loaded1.status).toBe("completed");

      // Terminal 2 should still be running
      expect(terminal2.status).toBe("running");
      const loaded2 = await loadSession(terminal2.session!.sessionDir);
      expect(loaded2.status).toBe("running");
    });

    test("both terminals can complete independently", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Work on and complete all features for both terminals
      const workPromises: Promise<void>[] = [];
      for (let i = 0; i < 3; i++) {
        workPromises.push(workOnFeature(terminal1, i, true));
        workPromises.push(workOnFeature(terminal2, i, true));
      }
      await Promise.all(workPromises);

      // Complete both
      await Promise.all([
        completeRalphSession(terminal1),
        completeRalphSession(terminal2),
      ]);

      // Both should be completed
      expect(terminal1.status).toBe("completed");
      expect(terminal2.status).toBe("completed");

      const loaded1 = await loadSession(terminal1.session!.sessionDir);
      const loaded2 = await loadSession(terminal2.session!.sessionDir);

      expect(loaded1.status).toBe("completed");
      expect(loaded2.status).toBe("completed");
    });

    test("completion times are tracked independently", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Complete terminal 1 first
      await workOnFeature(terminal1, 0, true);
      await completeRalphSession(terminal1);
      const terminal1EndTime = terminal1.endTime!;

      // Wait and then complete terminal 2
      await new Promise((resolve) => setTimeout(resolve, 50));
      await workOnFeature(terminal2, 0, true);
      await completeRalphSession(terminal2);
      const terminal2EndTime = terminal2.endTime!;

      expect(terminal2EndTime).toBeGreaterThan(terminal1EndTime);
    });

    test("completed session data is preserved independently", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Terminal 1: complete with 3 passing features
      for (let i = 0; i < 3; i++) {
        await workOnFeature(terminal1, i, true);
      }
      await completeRalphSession(terminal1);

      // Terminal 2: complete with 1 passing, 2 failing
      await workOnFeature(terminal2, 0, true);
      await workOnFeature(terminal2, 1, false);
      await workOnFeature(terminal2, 2, false);
      await completeRalphSession(terminal2);

      // Verify session 1 preserved data
      const loaded1 = await loadSession(terminal1.session!.sessionDir);
      expect(loaded1.completedTaskIds).toHaveLength(3);
      expect(loaded1.tasks.filter((f) => f.status === "passing")).toHaveLength(3);

      // Verify session 2 preserved data
      const loaded2 = await loadSession(terminal2.session!.sessionDir);
      expect(loaded2.completedTaskIds).toHaveLength(1);
      expect(loaded2.tasks.filter((f) => f.status === "passing")).toHaveLength(1);
      expect(loaded2.tasks.filter((f) => f.status === "failing")).toHaveLength(2);
    });
  });

  // ============================================================================
  // Integration: Full concurrent workflow simulation
  // ============================================================================

  describe("Integration: Full concurrent workflow simulation", () => {
    test("complete concurrent workflow: both terminals work and complete successfully", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      // Step 1: Start both sessions concurrently
      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Step 2: Both work on features concurrently
      // Features are processed sequentially within each terminal, but terminals work in parallel
      const terminal1Work = async () => {
        for (let i = 0; i < 3; i++) {
          await workOnFeature(terminal1, i, true);
        }
      };

      const terminal2Work = async () => {
        for (let i = 0; i < 3; i++) {
          await workOnFeature(terminal2, i, true);
        }
      };

      await Promise.all([terminal1Work(), terminal2Work()]);

      // Step 3: Both complete
      await Promise.all([
        completeRalphSession(terminal1),
        completeRalphSession(terminal2),
      ]);

      // Verify final state
      const loaded1 = await loadSession(terminal1.session!.sessionDir);
      const loaded2 = await loadSession(terminal2.session!.sessionDir);

      // Both completed
      expect(loaded1.status).toBe("completed");
      expect(loaded2.status).toBe("completed");

      // Both have all features passing
      expect(loaded1.completedTaskIds).toHaveLength(3);
      expect(loaded2.completedTaskIds).toHaveLength(3);

      // No data leakage
      expect(loaded1.sessionId).toBe(terminal1.sessionId!);
      expect(loaded2.sessionId).toBe(terminal2.sessionId!);
      expect(loaded1.sessionId).not.toBe(loaded2.sessionId);
    });

    test("five concurrent terminals all work independently", async () => {
      const terminals: TerminalSimulator[] = [];
      const terminalCount = 5;

      // Create terminals
      for (let i = 0; i < terminalCount; i++) {
        terminals.push(createTerminalSimulator(`terminal-${i + 1}`));
      }

      // Start all sessions concurrently
      await Promise.all(
        terminals.map((terminal) =>
          startRalphSession(terminal, {
            features: createTerminalFeatures(terminal.id),
          })
        )
      );

      // All work on features - each terminal processes features sequentially,
      // but all terminals work in parallel
      const terminalWorkFunctions = terminals.map((terminal) => async () => {
        for (let i = 0; i < 3; i++) {
          await workOnFeature(terminal, i, true);
        }
      });
      await Promise.all(terminalWorkFunctions.map((fn) => fn()));

      // All complete
      await Promise.all(terminals.map((terminal) => completeRalphSession(terminal)));

      // Verify all sessions
      for (const terminal of terminals) {
        const loaded = await loadSession(terminal.session!.sessionDir);
        expect(loaded.status).toBe("completed");
        expect(loaded.completedTaskIds).toHaveLength(3);
        expect(loaded.sessionId).toBe(terminal.sessionId!);
      }

      // Verify all session IDs are unique
      const sessionIds = terminals.map((t) => t.sessionId);
      const uniqueIds = new Set(sessionIds);
      expect(uniqueIds.size).toBe(terminalCount);
    });
  });

  // ============================================================================
  // Edge cases
  // ============================================================================

  describe("Edge cases", () => {
    test("session deletion doesn't affect other sessions", async () => {
      const terminal1 = createTerminalSimulator("terminal-1");
      const terminal2 = createTerminalSimulator("terminal-2");

      const features1 = createTerminalFeatures("terminal-1");
      const features2 = createTerminalFeatures("terminal-2");

      await Promise.all([
        startRalphSession(terminal1, { features: features1 }),
        startRalphSession(terminal2, { features: features2 }),
      ]);

      // Delete terminal 1's session directory
      await fs.rm(terminal1.session!.sessionDir, { recursive: true, force: true });

      // Terminal 2's session should still exist and be valid
      expect(existsSync(terminal2.session!.sessionDir)).toBe(true);
      const loaded2 = await loadSession(terminal2.session!.sessionDir);
      expect(loaded2.sessionId).toBe(terminal2.sessionId!);
    });

    test("rapid session creation and deletion doesn't cause issues", async () => {
      const sessionIds: string[] = [];

      // Create and delete 10 sessions rapidly
      for (let i = 0; i < 10; i++) {
        const terminal = createTerminalSimulator(`terminal-${i}`);
        await startRalphSession(terminal, {
          features: createTerminalFeatures(`terminal-${i}`),
        });
        sessionIds.push(terminal.sessionId!);

        // Delete every other session
        if (i % 2 === 0) {
          await fs.rm(terminal.session!.sessionDir, { recursive: true, force: true });
        }
      }

      // Verify odd-indexed sessions still exist
      for (let i = 0; i < 10; i++) {
        const sessionDir = getSessionDir(sessionIds[i]!);
        if (i % 2 === 0) {
          expect(existsSync(sessionDir)).toBe(false);
        } else {
          expect(existsSync(sessionDir)).toBe(true);
        }
      }
    });
  });
});
