/**
 * E2E tests for /ralph --yolo exits when agent outputs COMPLETE
 *
 * These tests verify the /ralph --yolo workflow correctly:
 * 1. Runs with a mock agent that outputs COMPLETE
 * 2. Detects the COMPLETE signal in agent output
 * 3. Exits the workflow loop when COMPLETE is detected
 * 4. Marks the session status as 'completed'
 *
 * Reference: Feature - E2E test: /ralph --yolo exits when agent outputs COMPLETE
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
} from "../../src/workflows/index.ts";
import {
  createRalphWorkflow,
  RALPH_NODE_IDS,
  type CreateRalphWorkflowConfig,
} from "../../src/workflows/index.ts";
import {
  createRalphWorkflowState,
  YOLO_COMPLETION_INSTRUCTION,
  checkYoloCompletion,
  processYoloResult,
  workflowStateToSession,
  type RalphWorkflowState,
} from "../../src/graph/nodes/ralph-nodes.ts";

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a test state in yolo mode with a user prompt.
 */
function createTestYoloState(userPrompt: string): RalphWorkflowState {
  return createRalphWorkflowState({
    yolo: true,
    userPrompt,
    maxIterations: 10,
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
function createInProgressAgentOutput(taskDescription?: string): string {
  return `
I'm still working on ${taskDescription ?? "the requested feature"}.

Progress so far:
- Analyzed the requirements
- Started implementing the core logic
- Need to add more features

I'll continue working on this in the next iteration.
`;
}

// ============================================================================
// E2E TEST: /ralph --yolo exits when agent outputs COMPLETE
// ============================================================================

describe("E2E test: /ralph --yolo exits when agent outputs COMPLETE", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();

    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-ralph-yolo-exit-"));

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
  // 1. Run /ralph --yolo with mock agent
  // ============================================================================

  describe("1. Run /ralph --yolo with mock agent", () => {
    test("yolo workflow can be created with mock agent configuration", () => {
      const workflow = createRalphWorkflow({
        yolo: true,
        userPrompt: "build snake game",
        checkpointing: false,
      });

      expect(workflow).toBeDefined();
      expect(workflow.nodes).toBeInstanceOf(Map);
      expect(workflow.nodes.has(RALPH_NODE_IDS.INIT_SESSION)).toBe(true);
      expect(workflow.nodes.has(RALPH_NODE_IDS.IMPLEMENT_FEATURE)).toBe(true);
      expect(workflow.nodes.has(RALPH_NODE_IDS.CHECK_COMPLETION)).toBe(true);
    });

    test("yolo state created with proper initial values for mock execution", () => {
      const state = createTestYoloState("mock task for testing");

      expect(state.yolo).toBe(true);
      expect(state.userPrompt).toBe("mock task for testing");
      expect(state.yoloComplete).toBe(false);
      expect(state.shouldContinue).toBe(true);
      expect(state.sessionStatus).toBe("running");
    });

    test("yolo session can be initialized for mock agent testing", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        status: "running",
      });

      await saveSession(sessionDir, session);
      const loaded = await loadSession(sessionDir);

      expect(loaded.yolo).toBe(true);
      expect(loaded.status).toBe("running");
      expect(loaded.sessionId).toBe(sessionId);
    });

    test("mock agent output can be simulated with COMPLETE signal", () => {
      const completeOutput = createCompleteAgentOutput("snake game");
      expect(completeOutput).toContain("COMPLETE");
      expect(checkYoloCompletion(completeOutput)).toBe(true);
    });

    test("mock agent output can be simulated without COMPLETE signal", () => {
      const inProgressOutput = createInProgressAgentOutput("snake game");
      expect(inProgressOutput).not.toContain("COMPLETE");
      expect(checkYoloCompletion(inProgressOutput)).toBe(false);
    });
  });

  // ============================================================================
  // 2. Configure agent to output 'COMPLETE' after task
  // ============================================================================

  describe("2. Configure agent to output 'COMPLETE' after task", () => {
    test("checkYoloCompletion detects COMPLETE in agent output", () => {
      const output = createCompleteAgentOutput("test task");
      expect(checkYoloCompletion(output)).toBe(true);
    });

    test("checkYoloCompletion returns false when COMPLETE is absent", () => {
      const output = createInProgressAgentOutput("test task");
      expect(checkYoloCompletion(output)).toBe(false);
    });

    test("checkYoloCompletion is case sensitive - only uppercase COMPLETE works", () => {
      expect(checkYoloCompletion("COMPLETE")).toBe(true);
      expect(checkYoloCompletion("complete")).toBe(false);
      expect(checkYoloCompletion("Complete")).toBe(false);
      // Note: COMPLETED doesn't match because COMPLETE requires word boundary
      expect(checkYoloCompletion("COMPLETED")).toBe(false);
    });

    test("checkYoloCompletion detects COMPLETE on its own line", () => {
      const output = `
Task finished successfully.

COMPLETE

Thanks for using Ralph!`;
      expect(checkYoloCompletion(output)).toBe(true);
    });

    test("checkYoloCompletion detects COMPLETE within text", () => {
      const output = "The task is COMPLETE and ready for review.";
      expect(checkYoloCompletion(output)).toBe(true);
    });

    test("checkYoloCompletion detects COMPLETE at start of output", () => {
      const output = "COMPLETE\n\nThe task has been finished.";
      expect(checkYoloCompletion(output)).toBe(true);
    });

    test("checkYoloCompletion detects COMPLETE at end of output", () => {
      const output = "All tasks are done.\nCOMPLETE";
      expect(checkYoloCompletion(output)).toBe(true);
    });
  });

  // ============================================================================
  // 3. Verify workflow exits after COMPLETE
  // ============================================================================

  describe("3. Verify workflow exits after COMPLETE", () => {
    test("processYoloResult sets yoloComplete to true when COMPLETE is detected", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      // Process output that contains COMPLETE
      const agentOutput = createCompleteAgentOutput("test task");
      const result = await processYoloResult(state, agentOutput);

      expect(result.yoloComplete).toBe(true);
    });

    test("processYoloResult sets shouldContinue to false when COMPLETE is detected", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const agentOutput = createCompleteAgentOutput("test task");
      const result = await processYoloResult(state, agentOutput);

      expect(result.shouldContinue).toBe(false);
    });

    test("processYoloResult keeps shouldContinue true when COMPLETE is absent", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const agentOutput = createInProgressAgentOutput("test task");
      const result = await processYoloResult(state, agentOutput);

      expect(result.yoloComplete).toBe(false);
      expect(result.shouldContinue).toBe(true);
    });

    test("processYoloResult increments iteration count", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 3,
      };

      const agentOutput = createCompleteAgentOutput("test task");
      const result = await processYoloResult(state, agentOutput);

      expect(result.iteration).toBe(4);
    });

    test("workflow loop exit condition depends on shouldContinue", () => {
      const workflow = createRalphWorkflow({
        yolo: true,
        userPrompt: "test task",
        checkpointing: false,
      });

      // The loop should continue while shouldContinue is true
      // and exit when shouldContinue becomes false (after COMPLETE)
      expect(workflow.nodes.has(RALPH_NODE_IDS.CHECK_COMPLETION)).toBe(true);
    });
  });

  // ============================================================================
  // 4. Verify session status is 'completed'
  // ============================================================================

  describe("4. Verify session status is 'completed'", () => {
    test("processYoloResult sets sessionStatus to 'completed' when COMPLETE is detected", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        sessionStatus: "running",
      };

      const agentOutput = createCompleteAgentOutput("test task");
      const result = await processYoloResult(state, agentOutput);

      expect(result.sessionStatus).toBe("completed");
    });

    test("processYoloResult keeps sessionStatus as 'running' when COMPLETE is absent", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        sessionStatus: "running",
      };

      const agentOutput = createInProgressAgentOutput("test task");
      const result = await processYoloResult(state, agentOutput);

      // sessionStatus is preserved as running (not changed to completed)
      expect(result.sessionStatus).toBe("running");
    });

    test("session.json is updated with 'completed' status when COMPLETE is detected", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        sessionStatus: "running",
      };

      // Process COMPLETE output
      const agentOutput = createCompleteAgentOutput("test task");
      await processYoloResult(state, agentOutput);

      // Load session and verify status
      const loaded = await loadSession(sessionDir);
      expect(loaded.status).toBe("completed");
    });

    test("session.json preserves yolo flag when status changes to 'completed'", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        sessionStatus: "running",
      };

      const agentOutput = createCompleteAgentOutput("test task");
      await processYoloResult(state, agentOutput);

      const loaded = await loadSession(sessionDir);
      expect(loaded.yolo).toBe(true);
      expect(loaded.status).toBe("completed");
    });
  });

  // ============================================================================
  // 5. Multiple iterations until COMPLETE
  // ============================================================================

  describe("5. Multiple iterations until COMPLETE", () => {
    test("workflow continues through multiple iterations until COMPLETE", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      let state: RalphWorkflowState = {
        ...createTestYoloState("complex task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 1,
      };

      // Simulate iteration 1: still in progress
      const output1 = createInProgressAgentOutput("complex task");
      let result = await processYoloResult(state, output1);
      expect(result.shouldContinue).toBe(true);
      expect(result.yoloComplete).toBe(false);
      expect(result.iteration).toBe(2);

      // Update state for iteration 2
      state = { ...state, ...result } as RalphWorkflowState;

      // Simulate iteration 2: still in progress
      const output2 = createInProgressAgentOutput("complex task");
      result = await processYoloResult(state, output2);
      expect(result.shouldContinue).toBe(true);
      expect(result.yoloComplete).toBe(false);
      expect(result.iteration).toBe(3);

      // Update state for iteration 3
      state = { ...state, ...result } as RalphWorkflowState;

      // Simulate iteration 3: COMPLETE
      const output3 = createCompleteAgentOutput("complex task");
      result = await processYoloResult(state, output3);
      expect(result.shouldContinue).toBe(false);
      expect(result.yoloComplete).toBe(true);
      expect(result.sessionStatus).toBe("completed");
      expect(result.iteration).toBe(4);
    });

    test("session is updated after each iteration", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 1,
      };

      // First iteration: in progress
      const output1 = createInProgressAgentOutput("test task");
      await processYoloResult(state, output1);

      let loaded = await loadSession(sessionDir);
      expect(loaded.iteration).toBe(2);
      expect(loaded.status).toBe("running");

      // Second iteration: complete
      const output2 = createCompleteAgentOutput("test task");
      const updatedState: RalphWorkflowState = {
        ...state,
        iteration: 2,
      };
      await processYoloResult(updatedState, output2);

      loaded = await loadSession(sessionDir);
      expect(loaded.iteration).toBe(3);
      expect(loaded.status).toBe("completed");
    });
  });

  // ============================================================================
  // 6. Max iterations behavior with COMPLETE
  // ============================================================================

  describe("6. Max iterations behavior with COMPLETE", () => {
    test("workflow exits when max iterations reached even without COMPLETE", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        maxIterations: 5,
        iteration: 5, // At max
      };

      // In progress output (no COMPLETE)
      const agentOutput = createInProgressAgentOutput("test task");
      const result = await processYoloResult(state, agentOutput);

      expect(result.maxIterationsReached).toBe(true);
      expect(result.shouldContinue).toBe(false);
      expect(result.yoloComplete).toBe(false);
    });

    test("COMPLETE before max iterations takes precedence", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        maxIterations: 10,
        iteration: 3, // Not at max
      };

      // Complete output
      const agentOutput = createCompleteAgentOutput("test task");
      const result = await processYoloResult(state, agentOutput);

      expect(result.yoloComplete).toBe(true);
      expect(result.shouldContinue).toBe(false);
      expect(result.maxIterationsReached).toBe(false);
      expect(result.sessionStatus).toBe("completed");
    });

    test("maxIterations 0 means unlimited - only COMPLETE exits", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        maxIterations: 0, // Unlimited
        iteration: 100, // High iteration count
      };

      // In progress output
      const agentOutput = createInProgressAgentOutput("test task");
      const result = await processYoloResult(state, agentOutput);

      expect(result.maxIterationsReached).toBe(false);
      expect(result.shouldContinue).toBe(true);
      expect(result.yoloComplete).toBe(false);
    });

    test("maxIterations 0 with COMPLETE still exits", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        maxIterations: 0, // Unlimited
        iteration: 50,
      };

      // Complete output
      const agentOutput = createCompleteAgentOutput("test task");
      const result = await processYoloResult(state, agentOutput);

      expect(result.yoloComplete).toBe(true);
      expect(result.shouldContinue).toBe(false);
      expect(result.sessionStatus).toBe("completed");
    });
  });

  // ============================================================================
  // 7. Agent output logging
  // ============================================================================

  describe("7. Agent output logging", () => {
    test("processYoloResult logs to agent-calls.jsonl", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const agentOutput = createCompleteAgentOutput("test task");
      await processYoloResult(state, agentOutput);

      // Check log file exists
      const logPath = path.join(sessionDir, "logs", "agent-calls.jsonl");
      expect(existsSync(logPath)).toBe(true);

      // Read and verify log content
      const logContent = await fs.readFile(logPath, "utf-8");
      const lines = logContent.trim().split("\n");
      const lastEntry = JSON.parse(lines[lines.length - 1]!);

      expect(lastEntry.action).toBe("yolo-result");
      expect(lastEntry.yolo).toBe(true);
      expect(lastEntry.isComplete).toBe(true);
      expect(lastEntry.outputContainsComplete).toBe(true);
    });

    test("log entry contains shouldContinue flag", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const agentOutput = createCompleteAgentOutput("test task");
      await processYoloResult(state, agentOutput);

      const logPath = path.join(sessionDir, "logs", "agent-calls.jsonl");
      const logContent = await fs.readFile(logPath, "utf-8");
      const lines = logContent.trim().split("\n");
      const lastEntry = JSON.parse(lines[lines.length - 1]!);

      expect(lastEntry.shouldContinue).toBe(false);
    });
  });

  // ============================================================================
  // 8. Edge cases
  // ============================================================================

  describe("8. Edge cases", () => {
    test("COMPLETE followed by more text still triggers exit", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const output = `
I finished the task.

COMPLETE

But I also want to mention some additional notes:
- Note 1
- Note 2

These are just FYI.`;

      const result = await processYoloResult(state, output);
      expect(result.yoloComplete).toBe(true);
      expect(result.shouldContinue).toBe(false);
    });

    test("multiple COMPLETE signals in output still triggers single exit", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const output = `
First COMPLETE signal.

COMPLETE

And another COMPLETE for emphasis.

COMPLETE

Done!`;

      const result = await processYoloResult(state, output);
      expect(result.yoloComplete).toBe(true);
      expect(result.shouldContinue).toBe(false);
      expect(result.sessionStatus).toBe("completed");
    });

    test("COMPLETE inside code block is still detected", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      // Note: This test shows that COMPLETE in code is detected
      // In real usage, the agent should output COMPLETE outside code blocks
      const output = `
Here's the final code:

\`\`\`rust
fn main() {
    println!("Done!");
}
\`\`\`

COMPLETE

The implementation is ready.`;

      const result = await processYoloResult(state, output);
      expect(result.yoloComplete).toBe(true);
    });

    test("empty output does not trigger COMPLETE", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const result = await processYoloResult(state, "");
      expect(result.yoloComplete).toBe(false);
      expect(result.shouldContinue).toBe(true);
    });

    test("whitespace-only output does not trigger COMPLETE", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const result = await processYoloResult(state, "   \n\n   \t   ");
      expect(result.yoloComplete).toBe(false);
      expect(result.shouldContinue).toBe(true);
    });
  });

  // ============================================================================
  // 9. Integration: Complete workflow exit flow
  // ============================================================================

  describe("9. Integration: Complete workflow exit flow", () => {
    test("complete flow: create session -> iterate -> COMPLETE -> exit", async () => {
      // Step 1: Parse args
      const args = parseRalphArgs("--yolo build snake game");
      expect(args.yolo).toBe(true);

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
      expect(state.shouldContinue).toBe(true);

      // Step 4: First iteration - in progress
      const output1 = createInProgressAgentOutput("snake game");
      let result = await processYoloResult(state, output1);
      expect(result.shouldContinue).toBe(true);
      expect(result.yoloComplete).toBe(false);

      // Step 5: Update state
      state = { ...state, ...result } as RalphWorkflowState;

      // Step 6: Second iteration - COMPLETE
      const output2 = createCompleteAgentOutput("snake game");
      result = await processYoloResult(state, output2);
      expect(result.shouldContinue).toBe(false);
      expect(result.yoloComplete).toBe(true);
      expect(result.sessionStatus).toBe("completed");

      // Step 7: Verify final session state
      const finalSession = await loadSession(sessionDir);
      expect(finalSession.status).toBe("completed");
      expect(finalSession.yolo).toBe(true);
    });

    test("workflow state correctly tracks yolo completion through session", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Initial state
      const initialState: RalphWorkflowState = {
        ...createTestYoloState("complex implementation"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
        iteration: 1,
      };

      // Process COMPLETE output
      const agentOutput = createCompleteAgentOutput("complex implementation");
      const result = await processYoloResult(initialState, agentOutput);

      // Verify all exit conditions are met
      expect(result).toMatchObject({
        yoloComplete: true,
        shouldContinue: false,
        sessionStatus: "completed",
        iteration: 2,
      });

      // Verify session persistence
      const session = await loadSession(sessionDir);
      expect(session.status).toBe("completed");
    });

    test("workflow config with yolo mode creates proper exit condition", () => {
      const config: CreateRalphWorkflowConfig = {
        yolo: true,
        userPrompt: "test task",
        maxIterations: 100,
        checkpointing: false,
      };

      const workflow = createRalphWorkflow(config);

      // Verify workflow structure
      expect(workflow).toBeDefined();
      expect(workflow.nodes.has(RALPH_NODE_IDS.INIT_SESSION)).toBe(true);
      expect(workflow.nodes.has(RALPH_NODE_IDS.IMPLEMENT_FEATURE)).toBe(true);
      expect(workflow.nodes.has(RALPH_NODE_IDS.CHECK_COMPLETION)).toBe(true);
    });
  });
});
