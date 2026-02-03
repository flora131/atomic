/**
 * E2E tests for /ralph --yolo --max-iterations 0 runs until COMPLETE
 *
 * These tests verify the /ralph --yolo workflow with unlimited iterations:
 * 1. Run /ralph --yolo --max-iterations 0 'complex task'
 * 2. Verify no iteration limit enforced
 * 3. Verify workflow continues until COMPLETE
 * 4. Verify session tracks unlimited iterations
 *
 * Reference: Feature - E2E test: /ralph --yolo --max-iterations 0 runs until COMPLETE
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { existsSync } from "fs";

import {
  parseRalphArgs,
  isValidUUID,
} from "../../src/ui/commands/workflow-commands.ts";
import {
  generateSessionId,
  getSessionDir,
  createSessionDirectory,
  saveSession,
  loadSession,
  loadSessionIfExists,
  createRalphSession,
  appendLog,
  type RalphSession,
} from "../../src/workflows/ralph-session.ts";
import {
  createRalphWorkflow,
  RALPH_NODE_IDS,
  type CreateRalphWorkflowConfig,
} from "../../src/workflows/ralph.ts";
import {
  createRalphWorkflowState,
  YOLO_COMPLETION_INSTRUCTION,
  checkYoloCompletion,
  processYoloResult,
  workflowStateToSession,
  checkCompletionNode,
  type RalphWorkflowState,
} from "../../src/graph/nodes/ralph-nodes.ts";

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a test state in yolo mode with unlimited iterations.
 */
function createUnlimitedYoloState(userPrompt: string): RalphWorkflowState {
  return createRalphWorkflowState({
    yolo: true,
    userPrompt,
    maxIterations: 0, // Unlimited
  });
}

/**
 * Simulate agent output that signals COMPLETE.
 */
function createCompleteAgentOutput(taskDescription?: string): string {
  return `
I have finished implementing the ${taskDescription ?? "requested feature"}.

Summary of changes:
- Created main files
- Added dependencies
- Implemented core logic
- Tested the implementation

Everything is working as expected.

COMPLETE

The implementation is ready for review.
`;
}

/**
 * Simulate agent output that does NOT signal COMPLETE.
 */
function createInProgressAgentOutput(taskDescription?: string, iteration?: number): string {
  const iterInfo = iteration !== undefined ? ` (iteration ${iteration})` : "";
  return `
I'm still working on ${taskDescription ?? "the requested feature"}${iterInfo}.

Progress so far:
- Analyzed the requirements
- Started implementing the core logic
- Need to add more features

I'll continue working on this in the next iteration.
`;
}

// ============================================================================
// E2E TEST: /ralph --yolo --max-iterations 0 runs until COMPLETE
// ============================================================================

describe("E2E test: /ralph --yolo --max-iterations 0 runs until COMPLETE", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();

    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-ralph-unlimited-"));

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
  // 1. Run /ralph --yolo --max-iterations 0 'complex task'
  // ============================================================================

  describe("1. Run /ralph --yolo --max-iterations 0 'complex task'", () => {
    test("parseRalphArgs correctly parses --yolo --max-iterations 0 'complex task'", () => {
      const result = parseRalphArgs("--yolo --max-iterations 0 complex task");

      expect(result.yolo).toBe(true);
      expect(result.maxIterations).toBe(0);
      expect(result.prompt).toBe("complex task");
      expect(result.resumeSessionId).toBeNull();
    });

    test("parseRalphArgs handles --max-iterations 0 --yolo order", () => {
      const result = parseRalphArgs("--max-iterations 0 --yolo build complex feature");

      expect(result.yolo).toBe(true);
      expect(result.maxIterations).toBe(0);
      expect(result.prompt).toBe("build complex feature");
    });

    test("parseRalphArgs handles quoted complex prompts with --max-iterations 0", () => {
      const result = parseRalphArgs("--yolo --max-iterations 0 build a complex system with multiple components");

      expect(result.yolo).toBe(true);
      expect(result.maxIterations).toBe(0);
      expect(result.prompt).toBe("build a complex system with multiple components");
    });

    test("workflow can be created with yolo=true and maxIterations=0", () => {
      const config: CreateRalphWorkflowConfig = {
        yolo: true,
        userPrompt: "complex task",
        maxIterations: 0,
        checkpointing: false,
      };

      const workflow = createRalphWorkflow(config);

      expect(workflow).toBeDefined();
      expect(workflow.nodes).toBeInstanceOf(Map);
      expect(workflow.nodes.has(RALPH_NODE_IDS.INIT_SESSION)).toBe(true);
      expect(workflow.nodes.has(RALPH_NODE_IDS.IMPLEMENT_FEATURE)).toBe(true);
      expect(workflow.nodes.has(RALPH_NODE_IDS.CHECK_COMPLETION)).toBe(true);
    });

    test("state can be created with yolo=true and maxIterations=0", () => {
      const state = createUnlimitedYoloState("complex task");

      expect(state.yolo).toBe(true);
      expect(state.maxIterations).toBe(0);
      expect(state.userPrompt).toBe("complex task");
      expect(state.yoloComplete).toBe(false);
      expect(state.shouldContinue).toBe(true);
      expect(state.maxIterationsReached).toBe(false);
    });

    test("session can be created with yolo=true and maxIterations=0", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        maxIterations: 0,
        status: "running",
      });

      await saveSession(sessionDir, session);
      const loaded = await loadSession(sessionDir);

      expect(loaded.yolo).toBe(true);
      expect(loaded.maxIterations).toBe(0);
      expect(loaded.status).toBe("running");
    });
  });

  // ============================================================================
  // 2. Verify no iteration limit enforced
  // ============================================================================

  describe("2. Verify no iteration limit enforced", () => {
    test("maxIterations=0 does not trigger maxIterationsReached at low iteration count", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("complex task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 10,
      };

      const agentOutput = createInProgressAgentOutput("complex task", 10);
      const result = await processYoloResult(state, agentOutput);

      expect(result.maxIterationsReached).toBe(false);
      expect(result.shouldContinue).toBe(true);
    });

    test("maxIterations=0 does not trigger maxIterationsReached at iteration 100", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("complex task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 100,
      };

      const agentOutput = createInProgressAgentOutput("complex task", 100);
      const result = await processYoloResult(state, agentOutput);

      expect(result.maxIterationsReached).toBe(false);
      expect(result.shouldContinue).toBe(true);
    });

    test("maxIterations=0 does not trigger maxIterationsReached at iteration 1000", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("complex task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 1000,
      };

      const agentOutput = createInProgressAgentOutput("complex task", 1000);
      const result = await processYoloResult(state, agentOutput);

      expect(result.maxIterationsReached).toBe(false);
      expect(result.shouldContinue).toBe(true);
    });

    test("maxIterations=0 does not trigger maxIterationsReached at iteration 10000", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("complex task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 10000,
      };

      const agentOutput = createInProgressAgentOutput("complex task", 10000);
      const result = await processYoloResult(state, agentOutput);

      expect(result.maxIterationsReached).toBe(false);
      expect(result.shouldContinue).toBe(true);
    });

    test("maxIterationsReached check: 0 > 0 is false (unlimited)", () => {
      // The logic is: maxIterations > 0 && iteration >= maxIterations
      // With maxIterations = 0: 0 > 0 is false, so short-circuit prevents limit check
      const maxIterations = 0;
      const iteration = 100000;

      const maxIterationsReached = maxIterations > 0 && iteration >= maxIterations;

      expect(maxIterationsReached).toBe(false);
    });

    test("session with maxIterations=0 persists through save/load cycle", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        maxIterations: 0,
        iteration: 500,
        status: "running",
      });

      await saveSession(sessionDir, session);
      const loaded = await loadSession(sessionDir);

      expect(loaded.maxIterations).toBe(0);
      expect(loaded.iteration).toBe(500);
    });
  });

  // ============================================================================
  // 3. Verify workflow continues until COMPLETE
  // ============================================================================

  describe("3. Verify workflow continues until COMPLETE", () => {
    test("workflow continues at iteration 50 without COMPLETE", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("complex task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 50,
      };

      const agentOutput = createInProgressAgentOutput("complex task", 50);
      const result = await processYoloResult(state, agentOutput);

      expect(result.shouldContinue).toBe(true);
      expect(result.yoloComplete).toBe(false);
      expect(result.maxIterationsReached).toBe(false);
    });

    test("workflow continues at iteration 500 without COMPLETE", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("complex task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 500,
      };

      const agentOutput = createInProgressAgentOutput("complex task", 500);
      const result = await processYoloResult(state, agentOutput);

      expect(result.shouldContinue).toBe(true);
      expect(result.yoloComplete).toBe(false);
      expect(result.maxIterationsReached).toBe(false);
    });

    test("workflow exits when COMPLETE is detected at iteration 50", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("complex task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 50,
      };

      const agentOutput = createCompleteAgentOutput("complex task");
      const result = await processYoloResult(state, agentOutput);

      expect(result.shouldContinue).toBe(false);
      expect(result.yoloComplete).toBe(true);
      expect(result.sessionStatus).toBe("completed");
    });

    test("workflow exits when COMPLETE is detected at iteration 1000", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("complex task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 1000,
      };

      const agentOutput = createCompleteAgentOutput("complex task");
      const result = await processYoloResult(state, agentOutput);

      expect(result.shouldContinue).toBe(false);
      expect(result.yoloComplete).toBe(true);
      expect(result.sessionStatus).toBe("completed");
    });

    test("workflow simulates multiple iterations until COMPLETE", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      let state: RalphWorkflowState = {
        ...createUnlimitedYoloState("complex multi-step task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 1,
      };

      // Simulate 10 iterations without COMPLETE
      for (let i = 1; i <= 10; i++) {
        const agentOutput = createInProgressAgentOutput("complex multi-step task", i);
        const result = await processYoloResult(state, agentOutput);

        expect(result.shouldContinue).toBe(true);
        expect(result.yoloComplete).toBe(false);
        expect(result.maxIterationsReached).toBe(false);

        // Update state for next iteration
        state = {
          ...state,
          ...result,
          iteration: result.iteration ?? state.iteration + 1,
        } as RalphWorkflowState;
      }

      // Verify iteration incremented correctly
      expect(state.iteration).toBe(11);

      // Now signal COMPLETE
      const completeOutput = createCompleteAgentOutput("complex multi-step task");
      const finalResult = await processYoloResult(state, completeOutput);

      expect(finalResult.shouldContinue).toBe(false);
      expect(finalResult.yoloComplete).toBe(true);
      expect(finalResult.sessionStatus).toBe("completed");
    });
  });

  // ============================================================================
  // 4. Verify session tracks unlimited iterations
  // ============================================================================

  describe("4. Verify session tracks unlimited iterations", () => {
    test("session.json shows maxIterations: 0 for unlimited mode", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        maxIterations: 0,
        status: "running",
      });

      await saveSession(sessionDir, session);

      // Read raw JSON to verify
      const sessionPath = path.join(sessionDir, "session.json");
      const content = await fs.readFile(sessionPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.maxIterations).toBe(0);
    });

    test("session tracks high iteration count correctly", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        maxIterations: 0,
        iteration: 9999,
        status: "running",
      });

      await saveSession(sessionDir, session);
      const loaded = await loadSession(sessionDir);

      expect(loaded.iteration).toBe(9999);
      expect(loaded.maxIterations).toBe(0);
      expect(loaded.status).toBe("running");
    });

    test("session iteration increments correctly through processYoloResult", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 100,
      };

      const agentOutput = createInProgressAgentOutput("task", 100);
      const result = await processYoloResult(state, agentOutput);

      expect(result.iteration).toBe(101);

      // Verify session was saved with updated iteration
      const loaded = await loadSession(sessionDir);
      expect(loaded.iteration).toBe(101);
    });

    test("session logs agent calls with unlimited iteration tracking", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 500,
      };

      const agentOutput = createInProgressAgentOutput("task", 500);
      await processYoloResult(state, agentOutput);

      // Check log file
      const logPath = path.join(sessionDir, "logs", "agent-calls.jsonl");
      expect(existsSync(logPath)).toBe(true);

      const logContent = await fs.readFile(logPath, "utf-8");
      const lines = logContent.trim().split("\n");
      const lastEntry = JSON.parse(lines[lines.length - 1]);

      expect(lastEntry.action).toBe("yolo-result");
      expect(lastEntry.iteration).toBe(500);
      expect(lastEntry.maxIterationsReached).toBe(false);
      expect(lastEntry.shouldContinue).toBe(true);
    });

    test("progress.txt tracks iterations in unlimited mode", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 150,
      };

      const agentOutput = createInProgressAgentOutput("task", 150);
      await processYoloResult(state, agentOutput);

      // Check progress file
      const progressPath = path.join(sessionDir, "progress.txt");
      expect(existsSync(progressPath)).toBe(true);

      const progressContent = await fs.readFile(progressPath, "utf-8");
      expect(progressContent).toContain("Yolo Iteration 150");
    });
  });

  // ============================================================================
  // 5. Complete integration flow with unlimited iterations
  // ============================================================================

  describe("5. Complete integration flow with unlimited iterations", () => {
    test("complete flow: parse args -> create state -> iterate -> COMPLETE", async () => {
      // Step 1: Parse args
      const args = parseRalphArgs("--yolo --max-iterations 0 build complex system");

      expect(args.yolo).toBe(true);
      expect(args.maxIterations).toBe(0);
      expect(args.prompt).toBe("build complex system");

      // Step 2: Create session
      const sessionId = generateSessionId();
      expect(isValidUUID(sessionId)).toBe(true);

      const sessionDir = await createSessionDirectory(sessionId);
      expect(existsSync(sessionDir)).toBe(true);

      // Step 3: Create initial state
      let state: RalphWorkflowState = {
        ...createRalphWorkflowState({
          sessionId,
          yolo: args.yolo,
          userPrompt: args.prompt ?? undefined,
          maxIterations: args.maxIterations,
        }),
        ralphSessionDir: sessionDir,
        ralphSessionId: sessionId,
      };

      expect(state.yolo).toBe(true);
      expect(state.maxIterations).toBe(0);
      expect(state.shouldContinue).toBe(true);

      // Step 4: Simulate many iterations (100+) without COMPLETE
      for (let i = 1; i <= 100; i++) {
        const agentOutput = createInProgressAgentOutput("complex system", i);
        const result = await processYoloResult(state, agentOutput);

        expect(result.shouldContinue).toBe(true);
        expect(result.yoloComplete).toBe(false);
        expect(result.maxIterationsReached).toBe(false);

        // Update state for next iteration
        state = {
          ...state,
          ...result,
        } as RalphWorkflowState;
      }

      // Verify we're at iteration 101
      expect(state.iteration).toBe(101);

      // Step 5: Signal COMPLETE at iteration 101
      const completeOutput = createCompleteAgentOutput("complex system");
      const finalResult = await processYoloResult(state, completeOutput);

      expect(finalResult.shouldContinue).toBe(false);
      expect(finalResult.yoloComplete).toBe(true);
      expect(finalResult.sessionStatus).toBe("completed");

      // Step 6: Verify final session state
      const finalSession = await loadSession(sessionDir);
      expect(finalSession.status).toBe("completed");
      expect(finalSession.yolo).toBe(true);
      expect(finalSession.maxIterations).toBe(0);
      expect(finalSession.iteration).toBe(102);
    });

    test("workflow config correctly handles --max-iterations 0 --yolo", () => {
      const args = parseRalphArgs("--max-iterations 0 --yolo implement complex feature");

      const config: CreateRalphWorkflowConfig = {
        yolo: args.yolo,
        userPrompt: args.prompt ?? undefined,
        maxIterations: args.maxIterations,
        checkpointing: false,
      };

      const workflow = createRalphWorkflow(config);

      // Verify workflow was created with correct configuration
      expect(workflow).toBeDefined();
      expect(workflow.nodes.has(RALPH_NODE_IDS.INIT_SESSION)).toBe(true);
    });

    test("session persists unlimited mode through entire workflow", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Create initial session
      const initialSession = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        maxIterations: 0,
        iteration: 1,
        status: "running",
      });

      await saveSession(sessionDir, initialSession);

      // Simulate workflow updating iteration multiple times
      for (let iter = 1; iter <= 5; iter++) {
        const loaded = await loadSession(sessionDir);
        loaded.iteration = iter + 1;
        await saveSession(sessionDir, loaded);
      }

      // Verify final state
      const final = await loadSession(sessionDir);
      expect(final.maxIterations).toBe(0);
      expect(final.iteration).toBe(6);
      expect(final.yolo).toBe(true);
    });
  });

  // ============================================================================
  // 6. Edge cases for unlimited iterations
  // ============================================================================

  describe("6. Edge cases for unlimited iterations", () => {
    test("maxIterations 0 with very high iteration count (100000) still continues", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("long-running task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 100000,
      };

      const agentOutput = createInProgressAgentOutput("long-running task", 100000);
      const result = await processYoloResult(state, agentOutput);

      expect(result.shouldContinue).toBe(true);
      expect(result.maxIterationsReached).toBe(false);
    });

    test("empty prompt with --yolo --max-iterations 0 is parsed but returns null prompt", () => {
      const result = parseRalphArgs("--yolo --max-iterations 0");

      expect(result.yolo).toBe(true);
      expect(result.maxIterations).toBe(0);
      expect(result.prompt).toBeNull();
    });

    test("maxIterations 0 is distinct from maxIterations undefined", () => {
      const stateWithZero = createRalphWorkflowState({
        yolo: true,
        maxIterations: 0,
      });

      const stateWithDefault = createRalphWorkflowState({
        yolo: true,
        // maxIterations not specified - defaults to 50
      });

      expect(stateWithZero.maxIterations).toBe(0);
      expect(stateWithDefault.maxIterations).toBe(50);
    });

    test("COMPLETE signal exits even with maxIterations 0", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 1,
      };

      // First iteration - COMPLETE immediately
      const agentOutput = createCompleteAgentOutput("task");
      const result = await processYoloResult(state, agentOutput);

      expect(result.shouldContinue).toBe(false);
      expect(result.yoloComplete).toBe(true);
      expect(result.sessionStatus).toBe("completed");
    });

    test("session can be paused and resumed at high iteration with maxIterations 0", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Create session at high iteration, then pause
      const pausedSession = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        maxIterations: 0,
        iteration: 5000,
        status: "paused",
      });

      await saveSession(sessionDir, pausedSession);

      // Verify it can be loaded and resumed
      const loaded = await loadSessionIfExists(sessionDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.status).toBe("paused");
      expect(loaded!.iteration).toBe(5000);
      expect(loaded!.maxIterations).toBe(0);

      // Simulate resume
      loaded!.status = "running";
      await saveSession(sessionDir, loaded!);

      const resumed = await loadSession(sessionDir);
      expect(resumed.status).toBe("running");
      expect(resumed.iteration).toBe(5000);
    });
  });

  // ============================================================================
  // 7. Comparison with limited iterations
  // ============================================================================

  describe("7. Comparison with limited iterations", () => {
    test("maxIterations 100 stops at iteration 100", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createRalphWorkflowState({
          yolo: true,
          userPrompt: "task",
          maxIterations: 100,
        }),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 100,
      };

      const agentOutput = createInProgressAgentOutput("task", 100);
      const result = await processYoloResult(state, agentOutput);

      expect(result.maxIterationsReached).toBe(true);
      expect(result.shouldContinue).toBe(false);
    });

    test("maxIterations 0 continues at iteration 100", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 100,
      };

      const agentOutput = createInProgressAgentOutput("task", 100);
      const result = await processYoloResult(state, agentOutput);

      expect(result.maxIterationsReached).toBe(false);
      expect(result.shouldContinue).toBe(true);
    });

    test("maxIterations 50 stops at iteration 50, but 0 continues", async () => {
      const sessionId1 = generateSessionId();
      const sessionDir1 = await createSessionDirectory(sessionId1);

      const sessionId2 = generateSessionId();
      const sessionDir2 = await createSessionDirectory(sessionId2);

      // State with limit
      const limitedState: RalphWorkflowState = {
        ...createRalphWorkflowState({
          yolo: true,
          userPrompt: "task",
          maxIterations: 50,
        }),
        ralphSessionId: sessionId1,
        ralphSessionDir: sessionDir1,
        iteration: 50,
      };

      // State without limit
      const unlimitedState: RalphWorkflowState = {
        ...createUnlimitedYoloState("task"),
        ralphSessionId: sessionId2,
        ralphSessionDir: sessionDir2,
        iteration: 50,
      };

      const agentOutput = createInProgressAgentOutput("task", 50);

      const limitedResult = await processYoloResult(limitedState, agentOutput);
      const unlimitedResult = await processYoloResult(unlimitedState, agentOutput);

      // Limited stops
      expect(limitedResult.maxIterationsReached).toBe(true);
      expect(limitedResult.shouldContinue).toBe(false);

      // Unlimited continues
      expect(unlimitedResult.maxIterationsReached).toBe(false);
      expect(unlimitedResult.shouldContinue).toBe(true);
    });
  });

  // ============================================================================
  // 8. Logging and progress tracking with unlimited iterations
  // ============================================================================

  describe("8. Logging and progress tracking with unlimited iterations", () => {
    test("agent-calls.jsonl logs maxIterationsReached as false for unlimited", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createUnlimitedYoloState("task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 999,
      };

      const agentOutput = createInProgressAgentOutput("task", 999);
      await processYoloResult(state, agentOutput);

      // Read log
      const logPath = path.join(sessionDir, "logs", "agent-calls.jsonl");
      const logContent = await fs.readFile(logPath, "utf-8");
      const entries = logContent.trim().split("\n").map(line => JSON.parse(line));

      // Find the yolo-result entry
      const yoloEntry = entries.find(e => e.action === "yolo-result");
      expect(yoloEntry).toBeDefined();
      expect(yoloEntry.maxIterationsReached).toBe(false);
    });

    test("session.json preserves maxIterations: 0 through multiple updates", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      let state: RalphWorkflowState = {
        ...createUnlimitedYoloState("task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 1,
      };

      // Process multiple iterations
      for (let i = 0; i < 5; i++) {
        const agentOutput = createInProgressAgentOutput("task", state.iteration);
        const result = await processYoloResult(state, agentOutput);
        state = {
          ...state,
          ...result,
        } as RalphWorkflowState;
      }

      // Read raw JSON to verify maxIterations is still 0
      const sessionPath = path.join(sessionDir, "session.json");
      const content = await fs.readFile(sessionPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.maxIterations).toBe(0);
      expect(parsed.iteration).toBe(6);
    });
  });
});
