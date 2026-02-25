/**
 * E2E tests for workflow inline mode
 *
 * These tests verify the complete lifecycle of the /ralph workflow in inline mode,
 * including teal border state, Ctrl+C user intervention, and task list persistence.
 */

import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile as fsWriteFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, existsSync, readFileSync } from "fs";
import type { CommandContext, CommandContextState } from "./registry.ts";
import { getWorkflowCommands } from "./workflow-commands.ts";

function createMockContext(overrides?: Partial<CommandContext>): CommandContext {
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
      workflowActive: false,
    },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "" }),
    spawnSubagentParallel: async (agents) =>
      agents.map((a) => ({
        agentId: a.agentId,
        success: true,
        output: "Done",
        toolUses: 1,
        durationMs: 100,
      })),
    streamAndWait: async () => ({ content: "", wasInterrupted: false }),
    waitForUserInput: async () => "",
    clearContext: async () => {},
    setTodoItems: () => {},
    setRalphSessionDir: () => {},
    setRalphSessionId: () => {},
    setRalphTaskIds: () => {},
    updateWorkflowState: () => {},
    ...overrides,
  };
}

describe("Workflow inline mode E2E", () => {
  test("teal border state tracks workflow lifecycle", async () => {
    // Track updateWorkflowState calls
    const workflowStateUpdates: Array<Partial<CommandContextState>> = [];
    let sessionDir: string | null = null;

    const context = createMockContext({
      updateWorkflowState: (update) => {
        workflowStateUpdates.push(update);
      },
      setRalphSessionDir: (dir) => {
        sessionDir = dir;
        if (dir && !existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      },
      streamAndWait: async (prompt: string) => {
        // Step 1: Return task JSON
        if (prompt.includes("task list")) {
          return {
            content: JSON.stringify([
              {
                id: "#1",
                content: "Task 1",
                status: "pending",
                activeForm: "Working on task 1",
              },
            ]),
            wasInterrupted: false,
          };
        }
        return { content: "", wasInterrupted: false };
      },
      spawnSubagent: async () => ({
        success: true,
        output: JSON.stringify({
          findings: [],
          overall_correctness: "correct",
          overall_explanation: "LGTM",
          overall_confidence_score: 1.0,
        }),
      }),
    });

    // Get the ralph command
    const commands = getWorkflowCommands();
    const ralphCommand = commands.find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    // Run workflow
    const result = await ralphCommand!.execute("Build feature", context);

    // Assert: updateWorkflowState was called with workflowActive: true at some point
    const hasWorkflowActive = workflowStateUpdates.some(
      (update) => update.workflowActive === true,
    );
    expect(hasWorkflowActive).toBe(true);

    // Assert: updateWorkflowState was called with workflowType containing a string
    const hasWorkflowType = workflowStateUpdates.some(
      (update) => typeof update.workflowType === "string" && update.workflowType.length > 0,
    );
    expect(hasWorkflowType).toBe(true);

    // Assert: result.stateUpdate.workflowActive is false
    expect(result.stateUpdate?.workflowActive).toBe(false);

    // Assert: result.stateUpdate.workflowType is null
    expect(result.stateUpdate?.workflowType).toBe(null);

    // Assert: result.stateUpdate.initialPrompt is null
    expect(result.stateUpdate?.initialPrompt).toBe(null);

    // Clean up temp dir
    if (sessionDir && existsSync(sessionDir)) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });



  test("review with findings triggers fixer and completes without freeze", async () => {
    // Track all spawnSubagentParallel calls
    const spawnCalls: Array<{ agentName: string }> = [];
    const workflowStateUpdates: Array<Partial<CommandContextState>> = [];
    let sessionDir: string | null = null;
    let todoItems: any[] = [];

    const context = createMockContext({
      updateWorkflowState: (update) => {
        workflowStateUpdates.push(update);
      },
      setRalphSessionDir: (dir) => {
        sessionDir = dir;
        if (dir && !existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
          // Create progress.txt file that reviewer needs
          const progressPath = join(dir, "progress.txt");
          fsWriteFile(progressPath, "Test workflow in progress\n", "utf-8").catch(() => {});
        }
      },
      setRalphSessionId: () => {},
      setRalphTaskIds: () => {},
      setTodoItems: (items) => {
        todoItems = items;
      },
      spawnSubagentParallel: async (agents) => {
        return agents.map((a) => {
          const agentName = a.agentName ?? a.agentId ?? "unknown";
          spawnCalls.push({ agentName });
          
          // Planner: return task list
          if (agentName === "planner") {
            return {
              agentId: a.agentId,
              success: true,
              output: JSON.stringify([
                { id: "#1", content: "Add auth module", status: "pending", activeForm: "Adding auth", blockedBy: [] },
              ]),
              toolUses: 1,
              durationMs: 100,
            };
          }
          
          // Worker: succeed
          if (agentName === "worker") {
            return {
              agentId: a.agentId,
              success: true,
              output: "Implemented auth module",
              toolUses: 3,
              durationMs: 500,
            };
          }
          
          // Reviewer: return findings that trigger fixes
          if (agentName === "reviewer") {
            return {
              agentId: a.agentId,
              success: true,
              output: JSON.stringify({
                findings: [
                  {
                    file: "src/auth.ts",
                    description: "Missing input validation",
                    severity: "high",
                    priority: 1,
                  },
                ],
                overall_correctness: "needs fixes",
                overall_explanation: "Missing input validation in auth handler",
              }),
              toolUses: 2,
              durationMs: 200,
            };
          }
          
          // Fixer: succeed (agentName is "debugger" in the graph)
          if (agentName === "debugger") {
            return {
              agentId: a.agentId,
              success: true,
              output: "Fixed input validation",
              toolUses: 2,
              durationMs: 300,
            };
          }
          
          // Default fallback
          return {
            agentId: a.agentId,
            success: true,
            output: "OK",
            toolUses: 0,
            durationMs: 10,
          };
        });
      },
    });

    // Get the ralph command
    const commands = getWorkflowCommands();
    const ralphCommand = commands.find((cmd) => cmd.name === "ralph");
    expect(ralphCommand).toBeDefined();

    // Run workflow — should complete without hanging
    const result = await ralphCommand!.execute("Build auth feature", context);

    // Assert: workflow completed successfully
    expect(result.success).toBe(true);
    expect(result.stateUpdate?.workflowActive).toBe(false);

    // Assert: workflowActive was set to true at start
    const hasWorkflowActive = workflowStateUpdates.some(
      (update) => update.workflowActive === true,
    );
    expect(hasWorkflowActive).toBe(true);

    // Assert: spawnSubagentParallel was called for planner, worker, reviewer, AND fixer
    const agentNames = spawnCalls.map((c) => c.agentName);
    expect(agentNames).toContain("planner");
    expect(agentNames).toContain("worker");
    expect(agentNames).toContain("reviewer");
    expect(agentNames).toContain("debugger"); // fixer uses "debugger" agentName

    // Assert: tasks were tracked
    expect(todoItems.length).toBeGreaterThan(0);

    // Assert: session dir was set
    expect(sessionDir).not.toBeNull();

    // Clean up temp dir
    if (sessionDir && existsSync(sessionDir)) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});
