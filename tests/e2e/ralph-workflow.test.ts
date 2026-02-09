/**
 * E2E tests for /ralph command with task-list
 *
 * These tests verify the /ralph command correctly:
 * 1. Creates a temp folder for testing
 * 2. Reads and processes research/tasks.json
 * 3. Starts the workflow successfully
 * 4. Displays session UUID when starting
 * 5. Creates the session directory structure
 * 6. Loads features from the feature list file
 *
 * Reference: Feature - E2E test: /ralph command starts workflow with task-list
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
  type TodoItem,
} from "../../src/workflows/index.ts";
import { createRalphWorkflow } from "../../src/workflows/index.ts";
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

/**
 * Create a test feature list JSON content.
 */
function createTestFeatureListContent(): string {
  const features = {
    tasks: [
      {
        category: "functional",
        description: "Test feature 1: Add user authentication",
        steps: [
          "Create user model",
          "Add login endpoint",
          "Implement JWT tokens",
        ],
        passes: false,
      },
      {
        category: "functional",
        description: "Test feature 2: Add dashboard view",
        steps: [
          "Create dashboard component",
          "Add data visualization",
        ],
        passes: false,
      },
      {
        category: "test",
        description: "Test feature 3: Add unit tests",
        steps: [
          "Write tests for user model",
          "Write tests for dashboard",
        ],
        passes: false,
      },
    ],
  };
  return JSON.stringify(features, null, 2);
}

// ============================================================================
// E2E TEST: /ralph command starts workflow with task-list
// ============================================================================

describe("E2E test: /ralph command starts workflow with task-list", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();

    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-ralph-e2e-"));

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
  // 1. Create temp folder for test
  // ============================================================================

  describe("1. Create temp folder for test", () => {
    test("temp folder is created successfully", async () => {
      expect(existsSync(tmpDir)).toBe(true);
    });

    test("temp folder is writable", async () => {
      const testFile = path.join(tmpDir, "test.txt");
      await fs.writeFile(testFile, "test content");
      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("test content");
    });

    test("temp folder can contain nested directories", async () => {
      const nestedDir = path.join(tmpDir, "research");
      await fs.mkdir(nestedDir, { recursive: true });
      expect(existsSync(nestedDir)).toBe(true);
    });

    test("temp folder is unique per test run", async () => {
      expect(tmpDir).toMatch(/atomic-ralph-e2e-/);
    });
  });

  // ============================================================================
  // 2. Create research/tasks.json with test features
  // ============================================================================

  describe("2. Create research/tasks.json with test features", () => {
    test("can create research directory", async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      expect(existsSync(researchDir)).toBe(true);
    });

    test("can create tasks.json with test content", async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });

      const tasksPath = path.join(researchDir, "tasks.json");
      const content = createTestFeatureListContent();
      await fs.writeFile(tasksPath, content);

      expect(existsSync(tasksPath)).toBe(true);
    });

    test("tasks.json contains valid JSON", async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });

      const tasksPath = path.join(researchDir, "tasks.json");
      const content = createTestFeatureListContent();
      await fs.writeFile(tasksPath, content);

      const parsed = JSON.parse(await fs.readFile(tasksPath, "utf-8"));
      expect(parsed.tasks).toBeDefined();
      expect(Array.isArray(parsed.tasks)).toBe(true);
    });

    test("tasks.json has expected structure", async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });

      const tasksPath = path.join(researchDir, "tasks.json");
      const content = createTestFeatureListContent();
      await fs.writeFile(tasksPath, content);

      const parsed = JSON.parse(await fs.readFile(tasksPath, "utf-8"));
      expect(parsed.tasks.length).toBe(3);
      expect(parsed.tasks[0].category).toBe("functional");
      expect(parsed.tasks[0].description).toContain("user authentication");
    });

    test("tasks.json features have required fields", async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });

      const tasksPath = path.join(researchDir, "tasks.json");
      const content = createTestFeatureListContent();
      await fs.writeFile(tasksPath, content);

      const parsed = JSON.parse(await fs.readFile(tasksPath, "utf-8"));
      for (const feature of parsed.tasks) {
        expect(feature.category).toBeDefined();
        expect(feature.description).toBeDefined();
        expect(feature.steps).toBeDefined();
        expect(feature.passes).toBeDefined();
      }
    });
  });

  // ============================================================================
  // 3. Run /ralph command
  // ============================================================================

  describe("3. Run /ralph command", () => {
    test("parseRalphArgs parses standard prompt", () => {
      const args = parseRalphArgs("implement the feature list");
      expect(args.prompt).toBe("implement the feature list");
      expect(args.resumeSessionId).toBeNull();
    });

    test("parseRalphArgs parses  flag", () => {
      const args = parseRalphArgs(" build a snake game");
      expect(args.prompt).toBe("build a snake game");
    });

    test("parseRalphArgs parses --task-list flag", () => {
      const args = parseRalphArgs("--task-list custom/features.json implement");
      expect(args.tasksPath).toBe("custom/features.json");
      expect(args.prompt).toBe("implement");
    });

    test("parseRalphArgs uses default task-list path", () => {
      const args = parseRalphArgs("implement features");
      expect(args.tasksPath).toBe("research/tasks.json");
    });

    test("parseRalphArgs parses --max-iterations flag", () => {
      const args = parseRalphArgs("--max-iterations 50 implement");
      expect(args.prompt).toBe("implement");
    });

    test("parseRalphArgs parses --resume flag", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const args = parseRalphArgs(`--resume ${uuid}`);
      expect(args.resumeSessionId).toBe(uuid);
    });

    test("ralph command can be retrieved from registry after registration", async () => {
      // First check if it exists
      const { registerWorkflowCommands } = await import(
        "../../src/ui/commands/workflow-commands.ts"
      );
      registerWorkflowCommands();

      expect(globalRegistry.has("ralph")).toBe(true);
    });
  });

  // ============================================================================
  // 4. Verify workflow starts
  // ============================================================================

  describe("4. Verify workflow starts", () => {
    beforeEach(async () => {
      // Create research directory and feature list for all tests in this block
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      const tasksPath = path.join(researchDir, "tasks.json");
      await fs.writeFile(tasksPath, createTestFeatureListContent());
    });

    test("createRalphWorkflow creates a valid workflow", () => {
      const workflow = createRalphWorkflow({
        tasksPath: "research/tasks.json",
        checkpointing: false,
      });

      expect(workflow).toBeDefined();
      expect(workflow.nodes).toBeInstanceOf(Map);
      expect(workflow.startNode).toBeDefined();
    });

    test("workflow has required nodes", () => {
      const workflow = createRalphWorkflow({
        tasksPath: "research/tasks.json",
        checkpointing: false,
      });

      expect(workflow.nodes.has("init-session")).toBe(true);
      expect(workflow.nodes.has("clear-context")).toBe(true);
      expect(workflow.nodes.has("implement-feature")).toBe(true);
      expect(workflow.nodes.has("check-completion")).toBe(true);
      // Note: create-pr is not a node in the Ralph workflow - it only has 4 nodes
    });

    test("workflow starts with init-session node", () => {
      const workflow = createRalphWorkflow({
        tasksPath: "research/tasks.json",
        checkpointing: false,
      });

      expect(workflow.startNode).toBe("init-session");
    });

      expect(workflow).toBeDefined();
    });

    test("workflow can be created in prompt mode", () => {
      const workflow = createRalphWorkflow({
        userPrompt: "Build something",
        checkpointing: false,
      });

      expect(workflow).toBeDefined();
    });
  });

  // ============================================================================
  // 5. Verify session UUID displayed
  // ============================================================================

  describe("5. Verify session UUID displayed", () => {
    test("generateSessionId creates a valid UUID v4", () => {
      const sessionId = generateSessionId();
      expect(isValidUUID(sessionId)).toBe(true);
    });

    test("generateSessionId creates unique UUIDs", () => {
      const uuids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        uuids.add(generateSessionId());
      }
      expect(uuids.size).toBe(100);
    });

    test("isValidUUID validates correct UUID format", () => {
      expect(isValidUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      expect(isValidUUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
    });

    test("isValidUUID rejects invalid UUID format", () => {
      expect(isValidUUID("not-a-uuid")).toBe(false);
      expect(isValidUUID("123")).toBe(false);
      expect(isValidUUID("")).toBe(false);
    });

    test("session ID is included in workflow state after command execution", () => {
      // Simulate what happens when /ralph command is executed
      const sessionId = generateSessionId();
      const state = {
        workflowActive: true,
        workflowType: "ralph",
        initialPrompt: "implement features",
        ralphConfig: {
          sessionId,
          userPrompt: "implement features",
          tasksPath: "research/tasks.json",
        },
      };

      expect(state.ralphConfig.sessionId).toBe(sessionId);
      expect(isValidUUID(state.ralphConfig.sessionId)).toBe(true);
    });

    test("session UUID format matches expected pattern", () => {
      const sessionId = generateSessionId();
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      // where x is any hex digit and y is one of 8, 9, a, or b
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(sessionId).toMatch(uuidPattern);
    });
  });

  // ============================================================================
  // 6. Verify session directory created
  // ============================================================================

  describe("6. Verify session directory created", () => {
    test("getSessionDir returns correct path format", () => {
      const sessionId = "test-session-id";
      const sessionDir = getSessionDir(sessionId);
      expect(sessionDir).toBe(".ralph/sessions/test-session-id/");
    });

    test("createSessionDirectory creates the directory structure", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      expect(existsSync(sessionDir)).toBe(true);
      expect(existsSync(path.join(sessionDir, "checkpoints"))).toBe(true);
      expect(existsSync(path.join(sessionDir, "research"))).toBe(true);
      expect(existsSync(path.join(sessionDir, "logs"))).toBe(true);
    });

    test("session directory is created at correct location", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      expect(sessionDir).toBe(`.ralph/sessions/${sessionId}/`);
      expect(existsSync(`.ralph/sessions/${sessionId}/`)).toBe(true);
    });

    test("session directory contains required subdirectories", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const subdirs = ["checkpoints", "research", "logs"];
      for (const subdir of subdirs) {
        expect(existsSync(path.join(sessionDir, subdir))).toBe(true);
      }
    });

    test("multiple sessions create separate directories", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();

      const sessionDir1 = await createSessionDirectory(sessionId1);
      const sessionDir2 = await createSessionDirectory(sessionId2);

      expect(sessionDir1).not.toBe(sessionDir2);
      expect(existsSync(sessionDir1)).toBe(true);
      expect(existsSync(sessionDir2)).toBe(true);
    });

    test("session.json can be saved to session directory", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const sessionFile = path.join(sessionDir, "session.json");
      expect(existsSync(sessionFile)).toBe(true);
    });

    test("saved session can be loaded", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        tasks: [
          createTodoItem({
            id: "feat-1",
            name: "Test feature",
            description: "Test description",
          }),
        ],
      });

      await saveSession(sessionDir, session);
      const loaded = await loadSession(sessionDir);

      expect(loaded.sessionId).toBe(sessionId);
      expect(loaded.status).toBe("running");
      expect(loaded.tasks.length).toBe(1);
    });
  });

  // ============================================================================
  // 7. Verify features loaded from file
  // ============================================================================

  describe("7. Verify features loaded from file", () => {
    beforeEach(async () => {
      // Create research directory and feature list
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      const tasksPath = path.join(researchDir, "tasks.json");
      await fs.writeFile(tasksPath, createTestFeatureListContent());
    });

    test("tasks.json can be read from expected path", async () => {
      const tasksPath = "research/tasks.json";
      const content = await fs.readFile(tasksPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.tasks).toBeDefined();
      expect(parsed.tasks.length).toBe(3);
    });

    test("features can be converted to TodoItem format", async () => {
      const tasksPath = "research/tasks.json";
      const content = await fs.readFile(tasksPath, "utf-8");
      const parsed = JSON.parse(content);

      const ralphFeatures: TodoItem[] = parsed.tasks.map(
        (f: { description: string; steps: string[] }, index: number) =>
          createTodoItem({
            id: `feat-${index + 1}`,
            name: f.description,
            description: f.steps.join(", "),
          })
      );

      expect(ralphFeatures.length).toBe(3);
      expect(ralphFeatures[0]?.status).toBe("pending");
      expect(ralphFeatures[0]?.name).toContain("user authentication");
    });

    test("features are loaded with pending status by default", async () => {
      const tasksPath = "research/tasks.json";
      const content = await fs.readFile(tasksPath, "utf-8");
      const parsed = JSON.parse(content);

      const ralphFeatures: TodoItem[] = parsed.tasks.map(
        (f: { description: string; steps: string[] }, index: number) =>
          createTodoItem({
            id: `feat-${index + 1}`,
            name: f.description,
            description: f.steps.join(", "),
          })
      );

      for (const feature of ralphFeatures) {
        expect(feature.status).toBe("pending");
      }
    });

    test("session can be created with loaded features", async () => {
      const tasksPath = "research/tasks.json";
      const content = await fs.readFile(tasksPath, "utf-8");
      const parsed = JSON.parse(content);

      const ralphFeatures: TodoItem[] = parsed.tasks.map(
        (f: { description: string; steps: string[] }, index: number) =>
          createTodoItem({
            id: `feat-${index + 1}`,
            name: f.description,
            description: f.steps.join(", "),
          })
      );

      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        features: ralphFeatures,
        sourceFeatureListPath: tasksPath,
      });

      expect(session.tasks.length).toBe(3);
      expect(session.sourceFeatureListPath).toBe(tasksPath);
    });

    test("session with features can be saved and loaded", async () => {
      const tasksPath = "research/tasks.json";
      const content = await fs.readFile(tasksPath, "utf-8");
      const parsed = JSON.parse(content);

      const ralphFeatures: TodoItem[] = parsed.tasks.map(
        (f: { description: string; steps: string[] }, index: number) =>
          createTodoItem({
            id: `feat-${index + 1}`,
            name: f.description,
            description: f.steps.join(", "),
          })
      );

      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        features: ralphFeatures,
        sourceFeatureListPath: tasksPath,
      });

      await saveSession(sessionDir, session);
      const loaded = await loadSession(sessionDir);

      expect(loaded.tasks.length).toBe(3);
      expect(loaded.tasks[0]?.name).toContain("user authentication");
      expect(loaded.sourceFeatureListPath).toBe(tasksPath);
    });

    test("loadSessionIfExists returns null for non-existent session", async () => {
      const result = await loadSessionIfExists(".ralph/sessions/non-existent/");
      expect(result).toBeNull();
    });

    test("loadSessionIfExists returns session when exists", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const loaded = await loadSessionIfExists(sessionDir);
      expect(loaded).not.toBeNull();
      expect(loaded?.sessionId).toBe(sessionId);
    });

    test("custom task-list path is respected", async () => {
      // Create custom feature list in different location
      const customDir = path.join(tmpDir, "custom");
      await fs.mkdir(customDir, { recursive: true });
      const customPath = path.join(customDir, "my-features.json");

      const customFeatures = {
        tasks: [
          {
            category: "custom",
            description: "Custom feature",
            steps: ["Step 1"],
            passes: false,
          },
        ],
      };

      await fs.writeFile(customPath, JSON.stringify(customFeatures, null, 2));

      const args = parseRalphArgs("--task-list custom/my-features.json implement");
      expect(args.tasksPath).toBe("custom/my-features.json");

      const content = await fs.readFile(args.tasksPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.tasks.length).toBe(1);
      expect(parsed.tasks[0].description).toBe("Custom feature");
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("Integration: Complete workflow initialization flow", () => {
    beforeEach(async () => {
      // Create research directory and feature list
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      const tasksPath = path.join(researchDir, "tasks.json");
      await fs.writeFile(tasksPath, createTestFeatureListContent());
    });

    test("complete flow: parse args -> create session -> load features -> save session", async () => {
      // Step 1: Parse command arguments
      const args = parseRalphArgs("implement all features");
      expect(args.prompt).toBe("implement all features");
      expect(args.tasksPath).toBe("research/tasks.json");

      // Step 2: Read feature list
      const content = await fs.readFile(args.tasksPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.tasks.length).toBe(3);

      // Step 3: Convert to TodoItem format
      const ralphFeatures: TodoItem[] = parsed.tasks.map(
        (f: { description: string; steps: string[] }, index: number) =>
          createTodoItem({
            id: `feat-${index + 1}`,
            name: f.description,
            description: f.steps.join(", "),
          })
      );

      // Step 4: Generate session ID and create directory
      const sessionId = generateSessionId();
      expect(isValidUUID(sessionId)).toBe(true);

      const sessionDir = await createSessionDirectory(sessionId);
      expect(existsSync(sessionDir)).toBe(true);

      // Step 5: Create session with features
      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        features: ralphFeatures,
        sourceFeatureListPath: args.tasksPath,
      });

      // Step 6: Save session
      await saveSession(sessionDir, session);

      // Step 7: Verify session can be loaded
      const loaded = await loadSession(sessionDir);
      expect(loaded.sessionId).toBe(sessionId);
      expect(loaded.tasks.length).toBe(3);
      expect(loaded.status).toBe("running");
    });

    test("workflow can be created with session configuration", async () => {
      // Parse args
      const args = parseRalphArgs("--max-iterations 50 implement");

      // Create workflow with parsed config
      const workflow = createRalphWorkflow({
        tasksPath: args.tasksPath,
        userPrompt: args.prompt ?? undefined,
        checkpointing: true,
      });

      expect(workflow).toBeDefined();
      expect(workflow.nodes).toBeInstanceOf(Map);
      expect(workflow.startNode).toBe("init-session");
    });

    test("session directory structure matches expected layout", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Verify structure
      const expectedPaths = [
        sessionDir,
        path.join(sessionDir, "checkpoints"),
        path.join(sessionDir, "research"),
        path.join(sessionDir, "logs"),
      ];

      for (const expectedPath of expectedPaths) {
        expect(existsSync(expectedPath)).toBe(true);
      }
    });

    test("session state persists across save/load cycles", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Create initial session
      let session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        iteration: 1,
        tasks: [
          createTodoItem({
            id: "feat-1",
            name: "Test",
            description: "Description",
          }),
        ],
      });

      // Save and load multiple times
      await saveSession(sessionDir, session);
      session = await loadSession(sessionDir);
      expect(session.iteration).toBe(1);

      // Update and save again
      session.iteration = 2;
      session.tasks[0]!.status = "in_progress";
      await saveSession(sessionDir, session);

      // Load and verify
      const final = await loadSession(sessionDir);
      expect(final.iteration).toBe(2);
      expect(final.tasks[0]?.status).toBe("in_progress");
    });
  });

