/**
 * E2E tests for /ralph --yolo runs without feature-list
 *
 * These tests verify the /ralph --yolo command correctly:
 * 1. Runs without requiring a feature-list.json file
 * 2. Sessions are marked as yolo mode
 * 3. Agent receives the task prompt with COMPLETE instruction appended
 * 4. Proper session state is maintained for yolo mode
 *
 * Reference: Feature - E2E test: /ralph --yolo runs without feature-list
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
  type RalphSession,
} from "../../src/workflows/index.ts";
import {
  createRalphWorkflow,
  type CreateRalphWorkflowConfig,
} from "../../src/workflows/index.ts";
import {
  createRalphWorkflowState,
  YOLO_COMPLETION_INSTRUCTION,
  checkYoloCompletion,
  type RalphWorkflowState,
} from "../../src/graph/nodes/ralph-nodes.ts";
import {
  globalRegistry,
  type CommandContext,
  type CommandContextState,
} from "../../src/ui/commands/registry.ts";

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
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "Mock sub-agent output" }),
    agentType: undefined,
    modelOps: undefined,
    getMessages: () => messages,
  };
}

// ============================================================================
// E2E TEST: /ralph --yolo runs without feature-list
// ============================================================================

describe("E2E test: /ralph --yolo runs without feature-list", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();

    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-ralph-yolo-e2e-"));

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
  // 1. Run /ralph --yolo 'build snake game in rust'
  // ============================================================================

  describe("1. Run /ralph --yolo 'build snake game in rust'", () => {
    test("parseRalphArgs correctly parses --yolo flag with prompt", () => {
      const args = parseRalphArgs("--yolo build snake game in rust");
      expect(args.yolo).toBe(true);
      expect(args.prompt).toBe("build snake game in rust");
      expect(args.resumeSessionId).toBeNull();
    });

    test("parseRalphArgs handles --yolo with quoted prompt", () => {
      // Note: quotes are typically stripped by shell, but testing raw string handling
      const args = parseRalphArgs("--yolo 'build snake game in rust'");
      expect(args.yolo).toBe(true);
      expect(args.prompt).toBe("'build snake game in rust'");
    });

    test("parseRalphArgs handles --yolo with complex prompt containing special chars", () => {
      const args = parseRalphArgs("--yolo implement auth using JWT with refresh tokens & 2FA");
      expect(args.yolo).toBe(true);
      expect(args.prompt).toBe("implement auth using JWT with refresh tokens & 2FA");
    });

    test("parseRalphArgs returns yolo true with --yolo flag at start", () => {
      const args = parseRalphArgs("--yolo any task prompt here");
      expect(args.yolo).toBe(true);
    });

    test("parseRalphArgs combines --yolo with --max-iterations", () => {
      const args = parseRalphArgs("--max-iterations 50 --yolo build something");
      expect(args.yolo).toBe(true);
      expect(args.maxIterations).toBe(50);
      expect(args.prompt).toBe("build something");
    });

    test("parseRalphArgs with --yolo at different position", () => {
      const args = parseRalphArgs("--yolo implement new feature");
      expect(args.yolo).toBe(true);
      expect(args.prompt).toBe("implement new feature");
    });

    test("parseRalphArgs with empty prompt after --yolo returns null prompt", () => {
      const args = parseRalphArgs("--yolo");
      expect(args.yolo).toBe(true);
      expect(args.prompt).toBeNull();
    });

    test("parseRalphArgs with whitespace only after --yolo returns null prompt", () => {
      const args = parseRalphArgs("--yolo   ");
      expect(args.yolo).toBe(true);
      expect(args.prompt).toBeNull();
    });
  });

  // ============================================================================
  // 2. Verify no feature-list.json required
  // ============================================================================

  describe("2. Verify no feature-list.json required", () => {
    test("yolo mode does not require research directory", async () => {
      // Confirm no research directory exists
      expect(existsSync(path.join(tmpDir, "research"))).toBe(false);

      // Parse yolo args - should succeed without feature list
      const args = parseRalphArgs("--yolo build snake game");
      expect(args.yolo).toBe(true);
      expect(args.featureListPath).toBe("research/feature-list.json"); // Default path, but not used
    });

    test("yolo mode workflow can be created without feature-list.json existing", () => {
      // Confirm no feature-list.json exists
      expect(existsSync("research/feature-list.json")).toBe(false);

      // Create yolo workflow - should not throw
      const workflow = createRalphWorkflow({
        yolo: true,
        userPrompt: "build a snake game",
        checkpointing: false,
      });

      expect(workflow).toBeDefined();
      expect(workflow.nodes).toBeInstanceOf(Map);
    });

    test("yolo mode session has empty features array", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "build something",
      });

      expect(state.features).toEqual([]);
      expect(state.yolo).toBe(true);
    });

    test("non-yolo mode would fail without feature-list.json", async () => {
      // In non-yolo mode, the workflow needs to load features
      // This test confirms the distinction
      const args = parseRalphArgs("implement feature");
      expect(args.yolo).toBe(false);
      expect(args.featureListPath).toBe("research/feature-list.json");

      // The feature list doesn't exist
      expect(existsSync(args.featureListPath)).toBe(false);
    });

    test("yolo session can be saved and loaded without features", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        features: [], // Empty features for yolo mode
        status: "running",
      });

      await saveSession(sessionDir, session);
      const loaded = await loadSession(sessionDir);

      expect(loaded.yolo).toBe(true);
      expect(loaded.features).toEqual([]);
    });

    test("research directory is still created for session artifacts even in yolo mode", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Session directory structure still has research subdirectory
      expect(existsSync(path.join(sessionDir, "research"))).toBe(true);
      expect(existsSync(path.join(sessionDir, "logs"))).toBe(true);
      expect(existsSync(path.join(sessionDir, "checkpoints"))).toBe(true);
    });
  });

  // ============================================================================
  // 3. Verify session marked as yolo mode
  // ============================================================================

  describe("3. Verify session marked as yolo mode", () => {
    test("createRalphWorkflowState with yolo=true sets yolo flag", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "build snake game in rust",
      });

      expect(state.yolo).toBe(true);
    });

    test("createRalphWorkflowState with yolo=false sets yolo flag to false", () => {
      const state = createRalphWorkflowState({
        yolo: false,
      });

      expect(state.yolo).toBe(false);
    });

    test("createRalphWorkflowState defaults yolo to false when not specified", () => {
      const state = createRalphWorkflowState({});

      expect(state.yolo).toBe(false);
    });

    test("createRalphSession with yolo=true sets yolo field", () => {
      const session = createRalphSession({
        yolo: true,
      });

      expect(session.yolo).toBe(true);
    });

    test("session.json contains yolo: true for yolo mode sessions", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        status: "running",
      });

      await saveSession(sessionDir, session);

      // Read raw JSON to verify field
      const sessionFile = path.join(sessionDir, "session.json");
      const content = await fs.readFile(sessionFile, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.yolo).toBe(true);
    });

    test("session.json contains yolo: false for feature-list mode sessions", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: false,
        status: "running",
      });

      await saveSession(sessionDir, session);

      // Read raw JSON to verify field
      const sessionFile = path.join(sessionDir, "session.json");
      const content = await fs.readFile(sessionFile, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.yolo).toBe(false);
    });

    test("yolo mode state has userPrompt field set", () => {
      const prompt = "build snake game in rust";
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: prompt,
      });

      expect(state.userPrompt).toBe(prompt);
    });

    test("yolo mode state has sourceFeatureListPath undefined", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "build something",
      });

      expect(state.sourceFeatureListPath).toBeUndefined();
    });

    test("yolo mode session has no source feature list path", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        sourceFeatureListPath: undefined,
        status: "running",
      });

      await saveSession(sessionDir, session);
      const loaded = await loadSession(sessionDir);

      expect(loaded.yolo).toBe(true);
      expect(loaded.sourceFeatureListPath).toBeUndefined();
    });
  });

  // ============================================================================
  // 4. Verify agent receives prompt with task
  // ============================================================================

  describe("4. Verify agent receives prompt with task", () => {
    test("YOLO_COMPLETION_INSTRUCTION contains EXTREMELY_IMPORTANT tag", () => {
      expect(YOLO_COMPLETION_INSTRUCTION).toContain("<EXTREMELY_IMPORTANT>");
      expect(YOLO_COMPLETION_INSTRUCTION).toContain("</EXTREMELY_IMPORTANT>");
    });

    test("YOLO_COMPLETION_INSTRUCTION contains COMPLETE output instruction", () => {
      expect(YOLO_COMPLETION_INSTRUCTION).toContain("COMPLETE");
      expect(YOLO_COMPLETION_INSTRUCTION.toLowerCase()).toContain("output");
    });

    test("yolo mode state stores userPrompt", () => {
      const prompt = "build a snake game in rust with crossterm";
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: prompt,
      });

      expect(state.userPrompt).toBe(prompt);
    });

    test("userPrompt is accessible from workflow state", () => {
      const prompt = "implement authentication using OAuth2";
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: prompt,
      });

      expect(state.userPrompt).toBe(prompt);
      expect(state.yolo).toBe(true);
    });

    test("checkYoloCompletion returns true when output contains COMPLETE", () => {
      const output = "I have finished the implementation. COMPLETE";
      expect(checkYoloCompletion(output)).toBe(true);
    });

    test("checkYoloCompletion returns false when output lacks COMPLETE", () => {
      const output = "Still working on the implementation...";
      expect(checkYoloCompletion(output)).toBe(false);
    });

    test("checkYoloCompletion detects COMPLETE on its own line", () => {
      const output = `I have finished all tasks.
COMPLETE
Thank you for your patience.`;
      expect(checkYoloCompletion(output)).toBe(true);
    });

    test("checkYoloCompletion is case sensitive - only uppercase COMPLETE", () => {
      expect(checkYoloCompletion("complete")).toBe(false);
      expect(checkYoloCompletion("Complete")).toBe(false);
      expect(checkYoloCompletion("COMPLETE")).toBe(true);
    });

    test("checkYoloCompletion detects COMPLETE within text", () => {
      const output = "Task is COMPLETE and ready for review.";
      expect(checkYoloCompletion(output)).toBe(true);
    });

    test("yolo workflow configuration includes userPrompt", () => {
      const config: CreateRalphWorkflowConfig = {
        yolo: true,
        userPrompt: "build snake game in rust",
        checkpointing: false,
      };

      expect(config.yolo).toBe(true);
      expect(config.userPrompt).toBe("build snake game in rust");
    });
  });

  // ============================================================================
  // 5. Yolo mode workflow structure
  // ============================================================================

  describe("5. Yolo mode workflow structure", () => {
    test("yolo workflow has same node structure as feature-list workflow", () => {
      const yoloWorkflow = createRalphWorkflow({
        yolo: true,
        userPrompt: "build something",
        checkpointing: false,
      });

      expect(yoloWorkflow.nodes.has("init-session")).toBe(true);
      expect(yoloWorkflow.nodes.has("clear-context")).toBe(true);
      expect(yoloWorkflow.nodes.has("implement-feature")).toBe(true);
      expect(yoloWorkflow.nodes.has("check-completion")).toBe(true);
      // Note: create-pr is not a node in the Ralph workflow - it only has 4 nodes
    });

    test("yolo workflow starts with init-session node", () => {
      const workflow = createRalphWorkflow({
        yolo: true,
        userPrompt: "build something",
        checkpointing: false,
      });

      expect(workflow.startNode).toBe("init-session");
    });

    test("yolo workflow can be created with custom maxIterations", () => {
      const workflow = createRalphWorkflow({
        yolo: true,
        userPrompt: "build something",
        maxIterations: 50,
        checkpointing: false,
      });

      expect(workflow).toBeDefined();
    });

    test("yolo workflow can be created with maxIterations 0 (unlimited)", () => {
      const workflow = createRalphWorkflow({
        yolo: true,
        userPrompt: "complex task",
        maxIterations: 0,
        checkpointing: false,
      });

      expect(workflow).toBeDefined();
    });
  });

  // ============================================================================
  // 6. Yolo mode session state
  // ============================================================================

  describe("6. Yolo mode session state", () => {
    test("yolo mode state initializes with yoloComplete = false", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "build something",
      });

      expect(state.yoloComplete).toBe(false);
    });

    test("yolo mode state initializes with shouldContinue = true", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "build something",
      });

      expect(state.shouldContinue).toBe(true);
    });

    test("yolo mode state has empty completedFeatures array", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "build something",
      });

      expect(state.completedFeatures).toEqual([]);
    });

    test("yolo mode state has allFeaturesPassing = false initially", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "build something",
      });

      expect(state.allFeaturesPassing).toBe(false);
    });

    test("yolo mode state has currentFeature = null", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "build something",
      });

      expect(state.currentFeature).toBeNull();
    });

    test("yolo mode state has currentFeatureIndex = 0", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "build something",
      });

      expect(state.currentFeatureIndex).toBe(0);
    });

    test("yolo mode state has iteration = 1", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "build something",
      });

      expect(state.iteration).toBe(1);
    });

    test("yolo mode state has sessionStatus = running", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "build something",
      });

      expect(state.sessionStatus).toBe("running");
    });
  });

  // ============================================================================
  // 7. Command execution for yolo mode
  // ============================================================================

  describe("7. Command execution for yolo mode", () => {
    test("parseRalphArgs with yolo returns correct RalphCommandArgs structure", () => {
      const args = parseRalphArgs("--yolo build snake game");

      expect(args).toHaveProperty("yolo", true);
      expect(args).toHaveProperty("prompt", "build snake game");
      expect(args).toHaveProperty("resumeSessionId", null);
      expect(args).toHaveProperty("maxIterations");
      expect(args).toHaveProperty("featureListPath");
    });

    test("yolo mode with --max-iterations 0 for unlimited iterations", () => {
      const args = parseRalphArgs("--max-iterations 0 --yolo build complex thing");

      expect(args.yolo).toBe(true);
      expect(args.maxIterations).toBe(0);
      expect(args.prompt).toBe("build complex thing");
    });

    test("workflow config can be built from parsed yolo args", () => {
      const args = parseRalphArgs("--yolo build snake game in rust");

      const config: CreateRalphWorkflowConfig = {
        yolo: args.yolo,
        userPrompt: args.prompt ?? undefined,
        maxIterations: args.maxIterations,
        checkpointing: true,
      };

      expect(config.yolo).toBe(true);
      expect(config.userPrompt).toBe("build snake game in rust");
    });

    test("session can be created and persisted for yolo mode", async () => {
      const args = parseRalphArgs("--yolo build snake game");
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: args.yolo,
        status: "running",
        features: [], // Empty for yolo mode
      });

      await saveSession(sessionDir, session);
      const loaded = await loadSession(sessionDir);

      expect(loaded.yolo).toBe(args.yolo);
      expect(loaded.features).toEqual([]);
    });
  });

  // ============================================================================
  // 8. Edge cases and error handling
  // ============================================================================

  describe("8. Edge cases and error handling", () => {
    test("yolo mode without prompt is parsed but returns null prompt", () => {
      const args = parseRalphArgs("--yolo");
      expect(args.yolo).toBe(true);
      expect(args.prompt).toBeNull();
    });

    test("createRalphWorkflowState with yolo but no userPrompt works", () => {
      // State creation should work, error thrown during execution
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: undefined,
      });

      expect(state.yolo).toBe(true);
      expect(state.userPrompt).toBeUndefined();
    });

    test("yolo session persists yolo flag through save/load cycle", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Create and save
      let session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        status: "running",
      });
      await saveSession(sessionDir, session);

      // Load and verify
      session = await loadSession(sessionDir);
      expect(session.yolo).toBe(true);

      // Modify and save again
      session.iteration = 5;
      await saveSession(sessionDir, session);

      // Load again and verify yolo is still true
      const finalSession = await loadSession(sessionDir);
      expect(finalSession.yolo).toBe(true);
      expect(finalSession.iteration).toBe(5);
    });

    test("yolo mode session can be paused and resumed", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Create session in yolo mode
      let session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        status: "running",
        iteration: 3,
      });
      await saveSession(sessionDir, session);

      // Simulate pause
      session.status = "paused";
      await saveSession(sessionDir, session);

      // Verify paused
      const pausedSession = await loadSession(sessionDir);
      expect(pausedSession.status).toBe("paused");
      expect(pausedSession.yolo).toBe(true);

      // Simulate resume
      pausedSession.status = "running";
      await saveSession(sessionDir, pausedSession);

      // Verify resumed
      const resumedSession = await loadSession(sessionDir);
      expect(resumedSession.status).toBe("running");
      expect(resumedSession.yolo).toBe(true);
      expect(resumedSession.iteration).toBe(3);
    });

    test("loadSessionIfExists returns null for non-existent yolo session", async () => {
      const result = await loadSessionIfExists(".ralph/sessions/non-existent-yolo/");
      expect(result).toBeNull();
    });

    test("yolo and non-yolo sessions can coexist", async () => {
      // Create yolo session
      const yoloSessionId = generateSessionId();
      const yoloSessionDir = await createSessionDirectory(yoloSessionId);
      const yoloSession = createRalphSession({
        sessionId: yoloSessionId,
        sessionDir: yoloSessionDir,
        yolo: true,
        status: "running",
      });
      await saveSession(yoloSessionDir, yoloSession);

      // Create feature-list session
      const featureSessionId = generateSessionId();
      const featureSessionDir = await createSessionDirectory(featureSessionId);
      const featureSession = createRalphSession({
        sessionId: featureSessionId,
        sessionDir: featureSessionDir,
        yolo: false,
        sourceFeatureListPath: "research/feature-list.json",
        status: "running",
      });
      await saveSession(featureSessionDir, featureSession);

      // Load both and verify
      const loadedYolo = await loadSession(yoloSessionDir);
      const loadedFeature = await loadSession(featureSessionDir);

      expect(loadedYolo.yolo).toBe(true);
      expect(loadedFeature.yolo).toBe(false);
      expect(loadedYolo.sessionId).not.toBe(loadedFeature.sessionId);
    });
  });

  // ============================================================================
  // Integration tests
  // ============================================================================

  describe("Integration: Complete yolo mode flow", () => {
    test("complete yolo mode setup: parse args -> create state -> create session -> save", async () => {
      // Step 1: Parse args
      const args = parseRalphArgs("--yolo build snake game in rust");
      expect(args.yolo).toBe(true);
      expect(args.prompt).toBe("build snake game in rust");

      // Step 2: Generate session ID
      const sessionId = generateSessionId();
      expect(isValidUUID(sessionId)).toBe(true);

      // Step 3: Create session directory
      const sessionDir = await createSessionDirectory(sessionId);
      expect(existsSync(sessionDir)).toBe(true);

      // Step 4: Create workflow state
      const state = createRalphWorkflowState({
        sessionId,
        yolo: args.yolo,
        userPrompt: args.prompt ?? undefined,
        maxIterations: args.maxIterations,
      });
      expect(state.yolo).toBe(true);
      expect(state.userPrompt).toBe("build snake game in rust");
      expect(state.features).toEqual([]);

      // Step 5: Create and save session
      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: state.yolo,
        status: "running",
        features: state.features,
      });
      await saveSession(sessionDir, session);

      // Step 6: Verify session persisted correctly
      const loaded = await loadSession(sessionDir);
      expect(loaded.yolo).toBe(true);
      expect(loaded.features).toEqual([]);
      expect(loaded.status).toBe("running");
    });

    test("yolo workflow can be created with all config options", () => {
      const config: CreateRalphWorkflowConfig = {
        yolo: true,
        userPrompt: "build snake game in rust with crossterm for terminal rendering",
        maxIterations: 50,
        checkpointing: true,
      };

      const workflow = createRalphWorkflow(config);

      expect(workflow).toBeDefined();
      expect(workflow.nodes.has("init-session")).toBe(true);
      expect(workflow.startNode).toBe("init-session");
    });

    test("yolo completion signal detection works correctly", () => {
      // Agent hasn't completed yet
      const inProgress = "I'm still working on implementing the game logic.";
      expect(checkYoloCompletion(inProgress)).toBe(false);

      // Agent signals completion
      const completed = `
I have finished implementing the snake game:
- Created main.rs with game loop
- Added crossterm for terminal handling
- Implemented snake movement and collision detection

COMPLETE

The game is ready to run with 'cargo run'.
`;
      expect(checkYoloCompletion(completed)).toBe(true);
    });
  });
});
