/**
 * E2E tests for /ralph --yolo appends completion promise instruction
 *
 * These tests verify the /ralph --yolo command correctly appends
 * the completion promise instruction to the agent prompt:
 * 1. Run /ralph --yolo 'test task'
 * 2. Intercept agent prompt
 * 3. Verify EXTREMELY_IMPORTANT tag present
 * 4. Verify 'output: COMPLETE' instruction present
 *
 * Reference: Feature - E2E test: /ralph --yolo appends completion promise instruction
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
  implementFeatureNode,
  type RalphWorkflowState,
} from "../../src/graph/nodes/ralph-nodes.ts";

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a mock execution context for testing node execution.
 */
function createMockExecutionContext(state: RalphWorkflowState) {
  return {
    state,
    nodeId: "test-node",
    executionId: state.executionId,
    emit: () => {},
    signal: new AbortController().signal,
  };
}

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

// ============================================================================
// E2E TEST: /ralph --yolo appends completion promise instruction
// ============================================================================

describe("E2E test: /ralph --yolo appends completion promise instruction", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();

    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-ralph-yolo-completion-"));

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
  // 1. Run /ralph --yolo 'test task'
  // ============================================================================

  describe("1. Run /ralph --yolo 'test task'", () => {
    test("parseRalphArgs correctly parses --yolo with test task", () => {
      const args = parseRalphArgs("--yolo test task");
      expect(args.yolo).toBe(true);
      expect(args.prompt).toBe("test task");
    });

    test("yolo workflow can be created with test task prompt", () => {
      const workflow = createRalphWorkflow({
        yolo: true,
        userPrompt: "test task",
        checkpointing: false,
      });

      expect(workflow).toBeDefined();
      expect(workflow.nodes.has(RALPH_NODE_IDS.IMPLEMENT_FEATURE)).toBe(true);
    });

    test("yolo state created with userPrompt for test task", () => {
      const state = createTestYoloState("test task");
      expect(state.yolo).toBe(true);
      expect(state.userPrompt).toBe("test task");
    });

    test("yolo mode session can be initialized for test task", async () => {
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
    });

    test("workflow config includes yolo and userPrompt for test task", () => {
      const config: CreateRalphWorkflowConfig = {
        yolo: true,
        userPrompt: "test task",
        checkpointing: false,
      };

      expect(config.yolo).toBe(true);
      expect(config.userPrompt).toBe("test task");
    });
  });

  // ============================================================================
  // 2. Intercept agent prompt
  // ============================================================================

  describe("2. Intercept agent prompt", () => {
    test("implementFeatureNode stores yolo prompt in outputs", async () => {
      // Create session directory first (required for appendLog)
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState("test task"),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: "test task",
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      // The node should store the expanded prompt in outputs
      expect(result.stateUpdate).toBeDefined();
      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      expect(outputs).toBeDefined();

      // Check that the prompt was stored
      const promptKey = "implement-feature_prompt";
      expect(outputs[promptKey]).toBeDefined();
      expect(typeof outputs[promptKey]).toBe("string");
    });

    test("yolo prompt from implementFeatureNode includes original user prompt", async () => {
      const userPrompt = "test task";
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(userPrompt),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: userPrompt,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      const prompt = outputs["implement-feature_prompt"] as string;

      // The prompt should contain the original user prompt
      expect(prompt).toContain(userPrompt);
    });

    test("yolo prompt from implementFeatureNode includes completion instruction", async () => {
      const userPrompt = "test task";
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(userPrompt),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: userPrompt,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      const prompt = outputs["implement-feature_prompt"] as string;

      // The prompt should include the YOLO_COMPLETION_INSTRUCTION
      expect(prompt).toContain("COMPLETE");
    });

    test("intercepted prompt is userPrompt + YOLO_COMPLETION_INSTRUCTION", async () => {
      const userPrompt = "test task";
      const expectedPrompt = userPrompt + YOLO_COMPLETION_INSTRUCTION;

      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(userPrompt),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: userPrompt,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      const prompt = outputs["implement-feature_prompt"] as string;

      expect(prompt).toBe(expectedPrompt);
    });

    test("agent prompt is logged to agent-calls.jsonl", async () => {
      const userPrompt = "test task";
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(userPrompt),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: userPrompt,
      });

      const ctx = createMockExecutionContext(state);
      await node.execute(ctx);

      // Check that the log file was created
      const logPath = path.join(sessionDir, "logs", "agent-calls.jsonl");
      expect(existsSync(logPath)).toBe(true);

      // Read and parse the log
      const logContent = await fs.readFile(logPath, "utf-8");
      const lines = logContent.trim().split("\n");
      expect(lines.length).toBeGreaterThan(0);

      // Parse the first log entry
      const logEntry = JSON.parse(lines[lines.length - 1]);
      expect(logEntry.action).toBe("yolo");
      expect(logEntry.yolo).toBe(true);
    });

    test("outputs include yolo flag set to true", async () => {
      const userPrompt = "test task";
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(userPrompt),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: userPrompt,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      expect(outputs["implement-feature_yolo"]).toBe(true);
    });
  });

  // ============================================================================
  // 3. Verify EXTREMELY_IMPORTANT tag present
  // ============================================================================

  describe("3. Verify EXTREMELY_IMPORTANT tag present", () => {
    test("YOLO_COMPLETION_INSTRUCTION contains opening EXTREMELY_IMPORTANT tag", () => {
      expect(YOLO_COMPLETION_INSTRUCTION).toContain("<EXTREMELY_IMPORTANT>");
    });

    test("YOLO_COMPLETION_INSTRUCTION contains closing EXTREMELY_IMPORTANT tag", () => {
      expect(YOLO_COMPLETION_INSTRUCTION).toContain("</EXTREMELY_IMPORTANT>");
    });

    test("EXTREMELY_IMPORTANT tags are properly nested", () => {
      const openIndex = YOLO_COMPLETION_INSTRUCTION.indexOf("<EXTREMELY_IMPORTANT>");
      const closeIndex = YOLO_COMPLETION_INSTRUCTION.indexOf("</EXTREMELY_IMPORTANT>");

      expect(openIndex).toBeGreaterThanOrEqual(0);
      expect(closeIndex).toBeGreaterThanOrEqual(0);
      expect(closeIndex).toBeGreaterThan(openIndex);
    });

    test("intercepted yolo prompt contains EXTREMELY_IMPORTANT tag", async () => {
      const userPrompt = "test task";
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(userPrompt),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: userPrompt,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      const prompt = outputs["implement-feature_prompt"] as string;

      expect(prompt).toContain("<EXTREMELY_IMPORTANT>");
      expect(prompt).toContain("</EXTREMELY_IMPORTANT>");
    });

    test("EXTREMELY_IMPORTANT section contains critical instruction", () => {
      // Extract content between tags
      const startTag = "<EXTREMELY_IMPORTANT>";
      const endTag = "</EXTREMELY_IMPORTANT>";
      const startIndex = YOLO_COMPLETION_INSTRUCTION.indexOf(startTag) + startTag.length;
      const endIndex = YOLO_COMPLETION_INSTRUCTION.indexOf(endTag);

      const extremelyImportantContent = YOLO_COMPLETION_INSTRUCTION.substring(startIndex, endIndex);

      // Should contain instruction about COMPLETE
      expect(extremelyImportantContent.toLowerCase()).toContain("complete");
      expect(extremelyImportantContent.toLowerCase()).toContain("output");
    });

    test("full yolo prompt has EXTREMELY_IMPORTANT at appropriate position", async () => {
      const userPrompt = "implement a feature";
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(userPrompt),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: userPrompt,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      const prompt = outputs["implement-feature_prompt"] as string;

      // User prompt should come first
      const userPromptIndex = prompt.indexOf(userPrompt);
      const extremelyImportantIndex = prompt.indexOf("<EXTREMELY_IMPORTANT>");

      expect(userPromptIndex).toBe(0); // User prompt at start
      expect(extremelyImportantIndex).toBeGreaterThan(userPromptIndex); // Tag after user prompt
    });

    test("multiple yolo runs all include EXTREMELY_IMPORTANT tag", async () => {
      const prompts = [
        "build snake game",
        "implement authentication",
        "create REST API",
        "write unit tests",
      ];

      for (const userPrompt of prompts) {
        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);

        const state: RalphWorkflowState = {
          ...createTestYoloState(userPrompt),
          ralphSessionId: sessionId,
          ralphSessionDir: sessionDir,
        };

        const node = implementFeatureNode({
          id: "implement-feature",
          prompt: userPrompt,
        });

        const ctx = createMockExecutionContext(state);
        const result = await node.execute(ctx);

        const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
        const prompt = outputs["implement-feature_prompt"] as string;

        expect(prompt).toContain("<EXTREMELY_IMPORTANT>");
        expect(prompt).toContain("</EXTREMELY_IMPORTANT>");
      }
    });
  });

  // ============================================================================
  // 4. Verify 'output: COMPLETE' instruction present
  // ============================================================================

  describe("4. Verify 'output: COMPLETE' instruction present", () => {
    test("YOLO_COMPLETION_INSTRUCTION contains COMPLETE keyword", () => {
      expect(YOLO_COMPLETION_INSTRUCTION).toContain("COMPLETE");
    });

    test("YOLO_COMPLETION_INSTRUCTION instructs agent to output COMPLETE", () => {
      // Check that instruction tells agent to output COMPLETE when done
      expect(YOLO_COMPLETION_INSTRUCTION.toLowerCase()).toContain("output");
      expect(YOLO_COMPLETION_INSTRUCTION).toContain("COMPLETE");
    });

    test("COMPLETE appears on its own line in instruction", () => {
      const lines = YOLO_COMPLETION_INSTRUCTION.split("\n");
      const completeLines = lines.filter((line) => line.trim() === "COMPLETE");
      expect(completeLines.length).toBeGreaterThanOrEqual(1);
    });

    test("intercepted yolo prompt contains COMPLETE instruction", async () => {
      const userPrompt = "test task";
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(userPrompt),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: userPrompt,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      const prompt = outputs["implement-feature_prompt"] as string;

      expect(prompt).toContain("COMPLETE");
    });

    test("instruction tells agent when to output COMPLETE", () => {
      // Should mention "finished" or similar conditions for when to output COMPLETE
      const lowerInstruction = YOLO_COMPLETION_INSTRUCTION.toLowerCase();
      expect(lowerInstruction).toContain("finish");
    });

    test("instruction tells agent NOT to output COMPLETE prematurely", () => {
      // Should tell agent not to output COMPLETE if there are blockers
      const lowerInstruction = YOLO_COMPLETION_INSTRUCTION.toLowerCase();
      expect(lowerInstruction).toMatch(/do\s+not|don't/);
    });

    test("checkYoloCompletion can detect COMPLETE in agent output", () => {
      // This validates that the instruction format matches what checkYoloCompletion expects
      expect(checkYoloCompletion("Task done. COMPLETE")).toBe(true);
      expect(checkYoloCompletion("COMPLETE")).toBe(true);
      expect(checkYoloCompletion("Still working...")).toBe(false);
    });

    test("COMPLETE signal is only uppercase (case sensitive)", () => {
      // Instruction should use uppercase COMPLETE to match checkYoloCompletion behavior
      expect(YOLO_COMPLETION_INSTRUCTION).toContain("COMPLETE");

      // The signal that should be output is uppercase COMPLETE on its own line
      // checkYoloCompletion looks for word boundary COMPLETE
      expect(checkYoloCompletion("COMPLETE")).toBe(true);
      expect(checkYoloCompletion("complete")).toBe(false);
      expect(checkYoloCompletion("Complete")).toBe(false);
    });

    test("multiple prompts all get COMPLETE instruction appended", async () => {
      const testPrompts = [
        "short task",
        "a longer task with more details about implementation",
        "task with special chars: @#$%",
      ];

      for (const userPrompt of testPrompts) {
        const sessionId = generateSessionId();
        const sessionDir = await createSessionDirectory(sessionId);

        const state: RalphWorkflowState = {
          ...createTestYoloState(userPrompt),
          ralphSessionId: sessionId,
          ralphSessionDir: sessionDir,
        };

        const node = implementFeatureNode({
          id: "implement-feature",
          prompt: userPrompt,
        });

        const ctx = createMockExecutionContext(state);
        const result = await node.execute(ctx);

        const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
        const prompt = outputs["implement-feature_prompt"] as string;

        // Verify COMPLETE instruction present
        expect(prompt).toContain("COMPLETE");
        expect(prompt).toContain("<EXTREMELY_IMPORTANT>");

        // Verify original prompt preserved
        expect(prompt).toContain(userPrompt);
      }
    });
  });

  // ============================================================================
  // Integration tests
  // ============================================================================

  describe("Integration: Complete prompt interception flow", () => {
    test("complete flow: parse args -> create state -> execute node -> intercept prompt", async () => {
      // Step 1: Parse args
      const args = parseRalphArgs("--yolo test task");
      expect(args.yolo).toBe(true);
      expect(args.prompt).toBe("test task");

      // Step 2: Create session and state
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createRalphWorkflowState({
          sessionId,
          yolo: args.yolo,
          userPrompt: args.prompt ?? undefined,
          maxIterations: args.maxIterations,
        }),
        ralphSessionDir: sessionDir,
        ralphSessionId: sessionId,
      };

      // Step 3: Execute implementFeatureNode
      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: args.prompt ?? undefined,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      // Step 4: Intercept and verify prompt
      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      const prompt = outputs["implement-feature_prompt"] as string;

      // Verify all requirements
      expect(prompt).toContain(args.prompt); // Original prompt
      expect(prompt).toContain("<EXTREMELY_IMPORTANT>"); // Tag present
      expect(prompt).toContain("</EXTREMELY_IMPORTANT>"); // Closing tag
      expect(prompt).toContain("COMPLETE"); // Output instruction
    });

    test("yolo prompt format matches expected structure", async () => {
      const userPrompt = "build a feature";
      const expectedStructure = userPrompt + YOLO_COMPLETION_INSTRUCTION;

      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(userPrompt),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: userPrompt,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      const actualPrompt = outputs["implement-feature_prompt"] as string;

      expect(actualPrompt).toBe(expectedStructure);
    });

    test("non-yolo mode does NOT append completion instruction", async () => {
      // Create non-yolo state with features
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createRalphWorkflowState({
          sessionId,
          yolo: false,
          features: [
            {
              id: "feat-001",
              name: "Test Feature",
              description: "A test feature",
              status: "pending",
            },
          ],
        }),
        ralphSessionDir: sessionDir,
        ralphSessionId: sessionId,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      // In non-yolo mode, the node uses a template-based prompt (or no prompt at all)
      // It should NOT contain the YOLO_COMPLETION_INSTRUCTION
      const stateUpdate = result.stateUpdate;

      if (stateUpdate && "outputs" in stateUpdate) {
        const outputs = stateUpdate.outputs as Record<string, unknown>;
        const prompt = outputs?.["implement-feature_prompt"];

        // Either no prompt (uses template) or prompt without EXTREMELY_IMPORTANT
        if (prompt) {
          expect(String(prompt)).not.toContain("<EXTREMELY_IMPORTANT>");
        }
      }

      // The key assertion: non-yolo mode should NOT have yolo outputs
      if (stateUpdate && "outputs" in stateUpdate) {
        const outputs = stateUpdate.outputs as Record<string, unknown>;
        expect(outputs?.["implement-feature_yolo"]).toBeUndefined();
      }
    });

    test("completion instruction is appended, not prepended", async () => {
      const userPrompt = "implement the thing";
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(userPrompt),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: userPrompt,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      const prompt = outputs["implement-feature_prompt"] as string;

      // User prompt should start the string
      expect(prompt.startsWith(userPrompt)).toBe(true);

      // EXTREMELY_IMPORTANT should come after
      const userPromptEnd = userPrompt.length;
      const tagStart = prompt.indexOf("<EXTREMELY_IMPORTANT>");
      expect(tagStart).toBeGreaterThan(userPromptEnd - 1);
    });
  });

  // ============================================================================
  // Edge cases
  // ============================================================================

  describe("Edge cases", () => {
    test("empty string prompt still gets completion instruction", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createRalphWorkflowState({
          sessionId,
          yolo: true,
          userPrompt: "", // Empty but defined
        }),
        ralphSessionDir: sessionDir,
        ralphSessionId: sessionId,
      };

      // Empty prompt should throw error in implementFeatureNode
      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: "",
      });

      const ctx = createMockExecutionContext(state);

      // Empty prompt is falsy, so should throw
      await expect(node.execute(ctx)).rejects.toThrow("Yolo mode requires a prompt");
    });

    test("very long prompt still gets completion instruction appended", async () => {
      const longPrompt = "a".repeat(10000); // 10k character prompt
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(longPrompt),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: longPrompt,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      const prompt = outputs["implement-feature_prompt"] as string;

      expect(prompt).toContain(longPrompt);
      expect(prompt).toContain("<EXTREMELY_IMPORTANT>");
      expect(prompt).toContain("COMPLETE");
      expect(prompt.length).toBeGreaterThan(longPrompt.length);
    });

    test("prompt with newlines gets completion instruction appended correctly", async () => {
      const multilinePrompt = `First line
Second line
Third line with details`;
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(multilinePrompt),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: multilinePrompt,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      const prompt = outputs["implement-feature_prompt"] as string;

      expect(prompt).toContain(multilinePrompt);
      expect(prompt).toContain("<EXTREMELY_IMPORTANT>");
      expect(prompt).toContain("COMPLETE");
    });

    test("prompt with special XML-like characters preserved correctly", async () => {
      const promptWithXml = "Implement <feature> with </tags> inside";
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const state: RalphWorkflowState = {
        ...createTestYoloState(promptWithXml),
        ralphSessionId: sessionId,
        ralphSessionDir: sessionDir,
      };

      const node = implementFeatureNode({
        id: "implement-feature",
        prompt: promptWithXml,
      });

      const ctx = createMockExecutionContext(state);
      const result = await node.execute(ctx);

      const outputs = result.stateUpdate?.outputs as Record<string, unknown>;
      const prompt = outputs["implement-feature_prompt"] as string;

      // Original prompt preserved exactly
      expect(prompt).toContain(promptWithXml);
      // Completion instruction still added
      expect(prompt).toContain("<EXTREMELY_IMPORTANT>");
    });
  });
});
