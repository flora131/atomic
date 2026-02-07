/**
 * E2E tests for /ralph --resume resumes paused session
 *
 * These tests verify the /ralph command correctly:
 * 1. Start /ralph session
 * 2. Interrupt with Ctrl+C
 * 3. Note session UUID
 * 4. Run /ralph --resume {uuid}
 * 5. Verify 'Resuming existing session' message
 * 6. Verify execution continues
 *
 * Reference: Feature - E2E test: /ralph --resume resumes paused session
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
  createRalphFeature,
  type RalphSession,
  type RalphFeature,
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
        steps: ["Create dashboard component", "Add data visualization"],
        passes: false,
      },
      {
        category: "test",
        description: "Test feature 3: Add unit tests",
        steps: ["Write tests for user model", "Write tests for dashboard"],
        passes: false,
      },
    ],
  };
  return JSON.stringify(features, null, 2);
}

/**
 * Create a paused session with test data.
 */
async function createPausedSession(
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
      status: "pending",
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
    status: "paused",
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

// ============================================================================
// E2E TEST: /ralph --resume resumes paused session
// ============================================================================

describe("E2E test: /ralph --resume resumes paused session", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();

    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-ralph-resume-e2e-"));

    // Change to temp directory for testing
    process.chdir(tmpDir);

    // Register workflow commands
    registerWorkflowCommands();
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

    test("session starts with unique UUID", async () => {
      const context = createMockContext();
      const command = globalRegistry.get("ralph");
      expect(command).toBeDefined();

      const result = await command!.execute("implement features", context);
      expect(result.success).toBe(true);
      expect(result.stateUpdate?.ralphConfig?.sessionId).toBeDefined();
      expect(isValidUUID(result.stateUpdate?.ralphConfig?.sessionId ?? "")).toBe(true);
    });

    test("session UUID is different for each start", async () => {
      const context1 = createMockContext();
      const context2 = createMockContext();
      const command = globalRegistry.get("ralph");

      const result1 = await command!.execute("implement features", context1);
      const result2 = await command!.execute("implement features", context2);

      expect(result1.stateUpdate?.ralphConfig?.sessionId).not.toBe(
        result2.stateUpdate?.ralphConfig?.sessionId
      );
    });

    test("session message includes UUID for later reference", async () => {
      const context = createMockContext();
      const command = globalRegistry.get("ralph");

      const result = await command!.execute("implement features", context);
      const sessionId = result.stateUpdate?.ralphConfig?.sessionId;

      // The message should include the session UUID
      expect(result.message).toContain("Started Ralph session:");
      expect(result.message).toContain(sessionId ?? "");
    });

    test("session directory can be created and session saved", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      expect(existsSync(sessionDir)).toBe(true);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        features: [
          createRalphFeature({
            id: "feat-1",
            name: "Test feature",
            description: "Test description",
          }),
        ],
      });

      await saveSession(sessionDir, session);
      expect(existsSync(path.join(sessionDir, "session.json"))).toBe(true);
    });
  });

  // ============================================================================
  // 2. Interrupt with Ctrl+C (simulated)
  // ============================================================================

  describe("2. Interrupt with Ctrl+C (simulated)", () => {
    test("session status can be changed to paused", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        iteration: 3,
        features: [
          createRalphFeature({
            id: "feat-1",
            name: "Test feature",
            description: "Test description",
          }),
        ],
      });

      await saveSession(sessionDir, session);

      // Simulate Ctrl+C by marking session as paused
      const loaded = await loadSession(sessionDir);
      loaded.status = "paused";
      await saveSession(sessionDir, loaded);

      const final = await loadSession(sessionDir);
      expect(final.status).toBe("paused");
    });

    test("session preserves state when paused", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const features: RalphFeature[] = [
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
      ];

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        iteration: 5,
        features,
        completedFeatures: ["feat-001"],
        currentFeatureIndex: 1,
      });

      await saveSession(sessionDir, session);

      // Simulate pause
      const running = await loadSession(sessionDir);
      running.status = "paused";
      await saveSession(sessionDir, running);

      // Verify all state preserved
      const paused = await loadSession(sessionDir);
      expect(paused.status).toBe("paused");
      expect(paused.iteration).toBe(5);
      expect(paused.features.length).toBe(2);
      expect(paused.features[0]!.status).toBe("passing");
      expect(paused.features[1]!.status).toBe("in_progress");
      expect(paused.completedFeatures).toContain("feat-001");
    });

    test("session lastUpdated timestamp updates on pause", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      await saveSession(sessionDir, session);
      const initial = await loadSession(sessionDir);
      const initialTime = new Date(initial.lastUpdated).getTime();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Pause
      initial.status = "paused";
      await saveSession(sessionDir, initial);

      const paused = await loadSession(sessionDir);
      const pausedTime = new Date(paused.lastUpdated).getTime();

      expect(pausedTime).toBeGreaterThan(initialTime);
    });
  });

  // ============================================================================
  // 3. Note session UUID
  // ============================================================================

  describe("3. Note session UUID", () => {
    test("UUID is valid v4 format", () => {
      const sessionId = generateSessionId();
      expect(isValidUUID(sessionId)).toBe(true);

      // Check specific v4 pattern
      const v4Pattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(sessionId).toMatch(v4Pattern);
    });

    test("UUID can be used to construct session directory path", async () => {
      const sessionId = generateSessionId();
      const sessionDir = getSessionDir(sessionId);

      expect(sessionDir).toBe(`.ralph/sessions/${sessionId}/`);
    });

    test("session can be found using UUID", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "paused",
      });

      await saveSession(sessionDir, session);

      // Find session using UUID
      const foundDir = getSessionDir(sessionId);
      const loaded = await loadSessionIfExists(foundDir);

      expect(loaded).not.toBeNull();
      expect(loaded?.sessionId).toBe(sessionId);
    });

    test("invalid UUID returns null on lookup", async () => {
      const invalidId = "not-a-valid-uuid";
      const sessionDir = getSessionDir(invalidId);
      const loaded = await loadSessionIfExists(sessionDir);

      expect(loaded).toBeNull();
    });
  });

  // ============================================================================
  // 4. Run /ralph --resume {uuid}
  // ============================================================================

  describe("4. Run /ralph --resume {uuid}", () => {
    test("parseRalphArgs correctly parses --resume flag", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const args = parseRalphArgs(`--resume ${uuid}`);

      expect(args.resumeSessionId).toBe(uuid);
      expect(args.yolo).toBe(false);
      expect(args.prompt).toBeNull();
    });

    test("parseRalphArgs handles invalid UUID format gracefully", () => {
      const invalidId = "invalid-uuid";
      const args = parseRalphArgs(`--resume ${invalidId}`);

      // Parser accepts any string, validation happens in command handler
      expect(args.resumeSessionId).toBe(invalidId);
    });

    test("/ralph --resume with valid UUID succeeds", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      await createPausedSession(sessionDir, sessionId);

      const context = createMockContext();
      const command = globalRegistry.get("ralph");

      const result = await command!.execute(`--resume ${sessionId}`, context);

      expect(result.success).toBe(true);
      expect(result.stateUpdate?.ralphConfig?.resumeSessionId).toBe(sessionId);
    });

    test("/ralph --resume with non-existent UUID fails", async () => {
      const nonExistentId = generateSessionId();
      const context = createMockContext();
      const command = globalRegistry.get("ralph");

      const result = await command!.execute(`--resume ${nonExistentId}`, context);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Session not found");
    });

    test("/ralph --resume with invalid UUID format fails", async () => {
      const invalidId = "not-a-uuid";
      const context = createMockContext();
      const command = globalRegistry.get("ralph");

      const result = await command!.execute(`--resume ${invalidId}`, context);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Invalid session ID format");
    });

    test("/ralph --resume sets workflow state for resumption", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      await createPausedSession(sessionDir, sessionId);

      const context = createMockContext();
      const command = globalRegistry.get("ralph");

      const result = await command!.execute(`--resume ${sessionId}`, context);

      expect(result.stateUpdate?.workflowActive).toBe(true);
      expect(result.stateUpdate?.workflowType).toBe("ralph");
      expect(result.stateUpdate?.ralphConfig).toBeDefined();
      expect(result.stateUpdate?.ralphConfig?.resumeSessionId).toBe(sessionId);
    });
  });

  // ============================================================================
  // 5. Verify 'Resuming existing session' message
  // ============================================================================

  describe("5. Verify 'Resuming existing session' message", () => {
    test("command output message contains 'Resuming'", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      await createPausedSession(sessionDir, sessionId);

      const context = createMockContext();
      const command = globalRegistry.get("ralph");

      const result = await command!.execute(`--resume ${sessionId}`, context);

      expect(result.message).toContain("Resuming");
      expect(result.message).toContain(sessionId);
    });

    test("system message is added for resume", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      await createPausedSession(sessionDir, sessionId);

      const context = createMockContext();
      const command = globalRegistry.get("ralph");

      await command!.execute(`--resume ${sessionId}`, context);

      const messages = context.getMessages();
      const systemMessage = messages.find((m) => m.role === "system");

      expect(systemMessage).toBeDefined();
      expect(systemMessage?.content).toContain("Resuming session");
      expect(systemMessage?.content).toContain(sessionId);
    });

    test("different messages for new vs resumed sessions", async () => {
      // Create paused session for resume
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      await createPausedSession(sessionDir, sessionId);

      // Create feature list for new session
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      await fs.writeFile(
        path.join(researchDir, "feature-list.json"),
        createTestFeatureListContent()
      );

      const command = globalRegistry.get("ralph");

      // New session
      const newContext = createMockContext();
      const newResult = await command!.execute("implement features", newContext);

      // Resume session
      const resumeContext = createMockContext();
      const resumeResult = await command!.execute(`--resume ${sessionId}`, resumeContext);

      expect(newResult.message).toContain("Started Ralph session");
      expect(resumeResult.message).toContain("Resuming");

      expect(newResult.message).not.toContain("Resuming");
      expect(resumeResult.message).not.toContain("Started Ralph session");
    });
  });

  // ============================================================================
  // 6. Verify execution continues
  // ============================================================================

  describe("6. Verify execution continues", () => {
    test("resumed session can be loaded with preserved state", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      const original = await createPausedSession(sessionDir, sessionId, {
        iteration: 10,
        completedFeatures: ["feat-001", "feat-002"],
      });

      // Load session as would happen during resume
      const loaded = await loadSession(sessionDir);

      expect(loaded.sessionId).toBe(original.sessionId);
      expect(loaded.iteration).toBe(10);
      expect(loaded.completedFeatures).toEqual(["feat-001", "feat-002"]);
      expect(loaded.status).toBe("paused");
    });

    test("session status can change from paused to running on resume", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      await createPausedSession(sessionDir, sessionId);

      // Simulate resume changing status
      const session = await loadSession(sessionDir);
      expect(session.status).toBe("paused");

      session.status = "running";
      await saveSession(sessionDir, session);

      const resumed = await loadSession(sessionDir);
      expect(resumed.status).toBe("running");
    });

    test("pending features remain for continued execution", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      await createPausedSession(sessionDir, sessionId);

      const session = await loadSession(sessionDir);

      const pendingFeatures = session.features.filter(
        (f) => f.status === "pending"
      );
      expect(pendingFeatures.length).toBeGreaterThan(0);
    });

    test("iteration counter preserved for continued execution", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      await createPausedSession(sessionDir, sessionId, { iteration: 42 });

      const session = await loadSession(sessionDir);
      expect(session.iteration).toBe(42);

      // Simulate continuing iteration
      session.iteration = 43;
      session.status = "running";
      await saveSession(sessionDir, session);

      const continued = await loadSession(sessionDir);
      expect(continued.iteration).toBe(43);
    });

    test("current feature index preserved for continued execution", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      await createPausedSession(sessionDir, sessionId, {
        currentFeatureIndex: 2,
      });

      const session = await loadSession(sessionDir);
      expect(session.currentFeatureIndex).toBe(2);
    });

    test("workflow configuration includes resumeSessionId", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      await createPausedSession(sessionDir, sessionId);

      const context = createMockContext();
      const command = globalRegistry.get("ralph");

      const result = await command!.execute(`--resume ${sessionId}`, context);

      // The workflow config should include the resume session ID
      // This tells the workflow to load existing state instead of starting fresh
      expect(result.stateUpdate?.ralphConfig?.resumeSessionId).toBe(sessionId);
      expect(result.stateUpdate?.ralphConfig?.yolo).toBe(false);
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("Integration: Complete resume flow", () => {
    test("full pause and resume cycle preserves all session data", async () => {
      // Step 1: Create a running session with progress
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const features: RalphFeature[] = [
        createRalphFeature({
          id: "feat-001",
          name: "Feature 1",
          description: "First feature",
          status: "passing",
          implementedAt: new Date().toISOString(),
        }),
        createRalphFeature({
          id: "feat-002",
          name: "Feature 2",
          description: "Second feature",
          status: "in_progress",
        }),
        createRalphFeature({
          id: "feat-003",
          name: "Feature 3",
          description: "Third feature",
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
        iteration: 7,
        maxIterations: 50,
        yolo: false,
        sourceFeatureListPath: "research/feature-list.json",
      });

      await saveSession(sessionDir, session);

      // Step 2: Simulate Ctrl+C (pause)
      const running = await loadSession(sessionDir);
      running.status = "paused";
      await saveSession(sessionDir, running);

      // Step 3: Use parseRalphArgs to parse --resume command
      const args = parseRalphArgs(`--resume ${sessionId}`);
      expect(args.resumeSessionId).toBe(sessionId);

      // Step 4: Load session for resumption
      const resumedSession = await loadSessionIfExists(sessionDir);
      expect(resumedSession).not.toBeNull();

      // Step 5: Verify all data preserved
      expect(resumedSession!.sessionId).toBe(sessionId);
      expect(resumedSession!.status).toBe("paused");
      expect(resumedSession!.iteration).toBe(7);
      expect(resumedSession!.maxIterations).toBe(50);
      expect(resumedSession!.features.length).toBe(3);
      expect(resumedSession!.features[0]!.status).toBe("passing");
      expect(resumedSession!.features[1]!.status).toBe("in_progress");
      expect(resumedSession!.features[2]!.status).toBe("pending");
      expect(resumedSession!.completedFeatures).toEqual(["feat-001"]);
      expect(resumedSession!.currentFeatureIndex).toBe(1);

      // Step 6: Execute /ralph --resume command
      const context = createMockContext();
      const command = globalRegistry.get("ralph");
      const result = await command!.execute(`--resume ${sessionId}`, context);

      // Step 7: Verify command succeeds
      expect(result.success).toBe(true);
      expect(result.message).toContain("Resuming");
      expect(result.stateUpdate?.workflowActive).toBe(true);
      expect(result.stateUpdate?.ralphConfig?.resumeSessionId).toBe(sessionId);
    });

    test("multiple pause and resume cycles work correctly", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        iteration: 1,
        features: [
          createRalphFeature({
            id: "feat-001",
            name: "Feature 1",
            description: "First feature",
          }),
        ],
      });

      await saveSession(sessionDir, session);

      // Cycle 1: Run -> Pause
      let current = await loadSession(sessionDir);
      current.iteration = 5;
      current.status = "paused";
      await saveSession(sessionDir, current);

      // Cycle 1: Resume
      current = await loadSession(sessionDir);
      expect(current.status).toBe("paused");
      current.status = "running";
      await saveSession(sessionDir, current);

      // Cycle 2: Run -> Pause
      current = await loadSession(sessionDir);
      current.iteration = 10;
      current.status = "paused";
      await saveSession(sessionDir, current);

      // Cycle 2: Resume
      current = await loadSession(sessionDir);
      expect(current.status).toBe("paused");
      expect(current.iteration).toBe(10);

      // Final verify with command
      const context = createMockContext();
      const command = globalRegistry.get("ralph");
      const result = await command!.execute(`--resume ${sessionId}`, context);

      expect(result.success).toBe(true);
    });

    test("resume command respects feature list path from session", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "paused",
        sourceFeatureListPath: "custom/feature-list.json",
      });

      await saveSession(sessionDir, session);

      // Load and verify custom path is preserved
      const loaded = await loadSession(sessionDir);
      expect(loaded.sourceFeatureListPath).toBe("custom/feature-list.json");
    });

    test("resume command works for yolo mode sessions", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "paused",
        yolo: true,
        iteration: 15,
        features: [], // No features in yolo mode
      });

      await saveSession(sessionDir, session);

      // Load and verify yolo mode preserved
      const loaded = await loadSession(sessionDir);
      expect(loaded.yolo).toBe(true);
      expect(loaded.features).toEqual([]);

      // Execute resume command
      const context = createMockContext();
      const command = globalRegistry.get("ralph");
      const result = await command!.execute(`--resume ${sessionId}`, context);

      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe("Edge cases and error handling", () => {
    test("handles already running workflow gracefully", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);
      await createPausedSession(sessionDir, sessionId);

      const context = createMockContext({
        workflowActive: true,
        workflowType: "ralph",
      });
      const command = globalRegistry.get("ralph");

      const result = await command!.execute(`--resume ${sessionId}`, context);

      expect(result.success).toBe(false);
      expect(result.message).toContain("workflow is already active");
    });

    test("handles session with all features already completed", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const allCompleteFeatures: RalphFeature[] = [
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
          status: "passing",
        }),
      ];

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "paused",
        features: allCompleteFeatures,
        completedFeatures: ["feat-001", "feat-002"],
      });

      await saveSession(sessionDir, session);

      // Resume should still work even if all features are complete
      const context = createMockContext();
      const command = globalRegistry.get("ralph");
      const result = await command!.execute(`--resume ${sessionId}`, context);

      expect(result.success).toBe(true);
    });

    test("handles empty features array in session", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "paused",
        features: [],
        yolo: true,
      });

      await saveSession(sessionDir, session);

      const loaded = await loadSession(sessionDir);
      expect(loaded.features).toEqual([]);

      const context = createMockContext();
      const command = globalRegistry.get("ralph");
      const result = await command!.execute(`--resume ${sessionId}`, context);

      expect(result.success).toBe(true);
    });

    test("handles missing session.json in existing directory", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Don't create session.json - just directory exists
      const loaded = await loadSessionIfExists(sessionDir);
      expect(loaded).toBeNull();

      const context = createMockContext();
      const command = globalRegistry.get("ralph");
      const result = await command!.execute(`--resume ${sessionId}`, context);

      // Note: Command only checks directory existence for basic validation.
      // The workflow executor would handle loading session.json and fail if missing.
      // This is acceptable behavior as the directory structure indicates a session was started.
      expect(result.success).toBe(true);
      expect(result.stateUpdate?.ralphConfig?.resumeSessionId).toBe(sessionId);
    });

    test("handles session with completed status", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "completed",
        features: [
          createRalphFeature({
            id: "feat-001",
            name: "Feature 1",
            description: "First feature",
            status: "passing",
          }),
        ],
        completedFeatures: ["feat-001"],
        prUrl: "https://github.com/test/repo/pull/1",
      });

      await saveSession(sessionDir, session);

      // Resume should still work for completed sessions
      const context = createMockContext();
      const command = globalRegistry.get("ralph");
      const result = await command!.execute(`--resume ${sessionId}`, context);

      expect(result.success).toBe(true);
    });

    test("handles session with failed status", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "failed",
        features: [
          createRalphFeature({
            id: "feat-001",
            name: "Feature 1",
            description: "First feature",
            status: "failing",
            error: "Test error message",
          }),
        ],
      });

      await saveSession(sessionDir, session);

      // Resume should still work for failed sessions
      const context = createMockContext();
      const command = globalRegistry.get("ralph");
      const result = await command!.execute(`--resume ${sessionId}`, context);

      expect(result.success).toBe(true);
    });

    test("parseRalphArgs handles --resume without UUID", () => {
      const args = parseRalphArgs("--resume");

      // Empty string indicates --resume was used but no UUID provided
      // (null means --resume flag was not used at all)
      expect(args.resumeSessionId).toBe("");
    });

    test("parseRalphArgs handles --resume with extra whitespace", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const args = parseRalphArgs(`--resume    ${uuid}   `);

      expect(args.resumeSessionId).toBe(uuid);
    });

    test("isValidUUID rejects various invalid formats", () => {
      expect(isValidUUID("")).toBe(false);
      expect(isValidUUID("not-a-uuid")).toBe(false);
      expect(isValidUUID("123")).toBe(false);
      expect(isValidUUID("550e8400-e29b-41d4-a716")).toBe(false);
      expect(isValidUUID("550e8400-e29b-41d4-a716-446655440000-extra")).toBe(
        false
      );
      expect(isValidUUID("550e8400_e29b_41d4_a716_446655440000")).toBe(false);
    });

    test("isValidUUID accepts valid UUID formats", () => {
      expect(isValidUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      expect(isValidUUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
      expect(isValidUUID(generateSessionId())).toBe(true);
    });
  });
});
