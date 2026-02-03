/**
 * E2E tests for Session artifacts saved to .ralph/sessions/{uuid}/
 *
 * These tests verify that when running a /ralph session:
 * 1. The .ralph/sessions/{uuid}/ directory is created
 * 2. session.json exists and is valid
 * 3. progress.txt exists
 * 4. logs/ directory exists
 * 5. checkpoints/ directory exists
 *
 * Reference: Feature - E2E test: Session artifacts saved to .ralph/sessions/{uuid}/
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
  appendLog,
  appendProgress,
  SESSION_SUBDIRECTORIES,
  type RalphSession,
  type RalphFeature,
  isRalphSession,
} from "../../src/workflows/ralph-session.ts";
import { createRalphWorkflow } from "../../src/workflows/ralph.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

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
    ],
  };
  return JSON.stringify(features, null, 2);
}

// ============================================================================
// E2E TEST: Session artifacts saved to .ralph/sessions/{uuid}/
// ============================================================================

describe("E2E test: Session artifacts saved to .ralph/sessions/{uuid}/", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();

    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "atomic-ralph-artifacts-e2e-")
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
  // 1. Run /ralph session
  // ============================================================================

  describe("1. Run /ralph session", () => {
    test("parseRalphArgs parses standard /ralph invocation", () => {
      const args = parseRalphArgs("implement features");
      expect(args.yolo).toBe(false);
      expect(args.prompt).toBe("implement features");
      expect(args.resumeSessionId).toBeNull();
      expect(args.featureListPath).toBe("research/feature-list.json");
    });

    test("generateSessionId creates a valid UUID for session", () => {
      const sessionId = generateSessionId();
      expect(isValidUUID(sessionId)).toBe(true);
      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    test("session can be created with generated UUID", () => {
      const sessionId = generateSessionId();
      const sessionDir = getSessionDir(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      expect(session.sessionId).toBe(sessionId);
      expect(session.sessionDir).toBe(sessionDir);
      expect(session.status).toBe("running");
    });

    test("workflow can be created for /ralph session", () => {
      const workflow = createRalphWorkflow({
        featureListPath: "research/feature-list.json",
        checkpointing: false,
      });

      expect(workflow).toBeDefined();
      expect(workflow.nodes).toBeInstanceOf(Map);
      expect(workflow.startNode).toBe("init-session");
    });

    test("yolo mode session can be created", () => {
      const sessionId = generateSessionId();
      const sessionDir = getSessionDir(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        status: "running",
      });

      expect(session.yolo).toBe(true);
      expect(session.features).toEqual([]);
    });
  });

  // ============================================================================
  // 2. Verify .ralph/sessions/{uuid}/ directory created
  // ============================================================================

  describe("2. Verify .ralph/sessions/{uuid}/ directory created", () => {
    test("createSessionDirectory creates the main session directory", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      expect(existsSync(sessionDir)).toBe(true);
      expect(sessionDir).toBe(`.ralph/sessions/${sessionId}/`);
    });

    test("createSessionDirectory creates .ralph directory at root", async () => {
      const sessionId = generateSessionId();
      await createSessionDirectory(sessionId);

      expect(existsSync(".ralph")).toBe(true);
    });

    test("createSessionDirectory creates sessions subdirectory", async () => {
      const sessionId = generateSessionId();
      await createSessionDirectory(sessionId);

      expect(existsSync(".ralph/sessions")).toBe(true);
    });

    test("session directory path uses UUID format", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      expect(sessionDir).toContain(sessionId);
      expect(isValidUUID(sessionId)).toBe(true);
    });

    test("multiple sessions create separate directories", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();

      const dir1 = await createSessionDirectory(sessionId1);
      const dir2 = await createSessionDirectory(sessionId2);

      expect(dir1).not.toBe(dir2);
      expect(existsSync(dir1)).toBe(true);
      expect(existsSync(dir2)).toBe(true);
    });

    test("session directory can be accessed via getSessionDir()", async () => {
      const sessionId = generateSessionId();
      await createSessionDirectory(sessionId);

      const expectedDir = getSessionDir(sessionId);
      expect(existsSync(expectedDir)).toBe(true);
    });

    test("getSessionDir returns correct path format", () => {
      const sessionId = "550e8400-e29b-41d4-a716-446655440000";
      const dir = getSessionDir(sessionId);
      expect(dir).toBe(`.ralph/sessions/${sessionId}/`);
    });

    test("session directory persists after creation", async () => {
      const sessionId = generateSessionId();
      await createSessionDirectory(sessionId);

      // Wait a bit to ensure filesystem operations complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      const sessionDir = getSessionDir(sessionId);
      expect(existsSync(sessionDir)).toBe(true);
    });
  });

  // ============================================================================
  // 3. Verify session.json exists and valid
  // ============================================================================

  describe("3. Verify session.json exists and valid", () => {
    test("session.json is created when session is saved", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const sessionJsonPath = path.join(sessionDir, "session.json");
      expect(existsSync(sessionJsonPath)).toBe(true);
    });

    test("session.json contains valid JSON", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const sessionJsonPath = path.join(sessionDir, "session.json");
      const content = await fs.readFile(sessionJsonPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed).toBeDefined();
      expect(typeof parsed).toBe("object");
    });

    test("session.json passes isRalphSession type guard", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const sessionJsonPath = path.join(sessionDir, "session.json");
      const content = await fs.readFile(sessionJsonPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(isRalphSession(parsed)).toBe(true);
    });

    test("session.json contains correct sessionId", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const loaded = await loadSession(sessionDir);
      expect(loaded.sessionId).toBe(sessionId);
    });

    test("session.json contains correct sessionDir", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const loaded = await loadSession(sessionDir);
      expect(loaded.sessionDir).toBe(sessionDir);
    });

    test("session.json contains createdAt timestamp", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const loaded = await loadSession(sessionDir);
      expect(loaded.createdAt).toBeDefined();
      expect(new Date(loaded.createdAt).toISOString()).toBe(loaded.createdAt);
    });

    test("session.json contains lastUpdated timestamp", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const loaded = await loadSession(sessionDir);
      expect(loaded.lastUpdated).toBeDefined();
      expect(new Date(loaded.lastUpdated).toISOString()).toBe(
        loaded.lastUpdated
      );
    });

    test("session.json contains status field", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const loaded = await loadSession(sessionDir);
      expect(loaded.status).toBe("running");
    });

    test("session.json contains yolo field", async () => {
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
    });

    test("session.json contains maxIterations field", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        maxIterations: 75,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const loaded = await loadSession(sessionDir);
      expect(loaded.maxIterations).toBe(75);
    });

    test("session.json contains iteration field", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        iteration: 5,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const loaded = await loadSession(sessionDir);
      expect(loaded.iteration).toBe(5);
    });

    test("session.json contains features array", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

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

      const loaded = await loadSession(sessionDir);
      expect(Array.isArray(loaded.features)).toBe(true);
      expect(loaded.features.length).toBe(1);
      expect(loaded.features[0].name).toBe("Test feature");
    });

    test("session.json can be loaded with loadSession()", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
      });

      await saveSession(sessionDir, session);

      const loaded = await loadSession(sessionDir);
      expect(loaded.sessionId).toBe(sessionId);
    });

    test("session.json can be checked with loadSessionIfExists()", async () => {
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

    test("loadSessionIfExists returns null for non-existent session", async () => {
      const result = await loadSessionIfExists(".ralph/sessions/non-existent/");
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // 4. Verify progress.txt exists
  // ============================================================================

  describe("4. Verify progress.txt exists", () => {
    test("progress.txt can be created via appendProgress()", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const feature = createRalphFeature({
        id: "feat-1",
        name: "Test feature",
        description: "Test description",
      });

      await appendProgress(sessionDir, feature, true);

      const progressPath = path.join(sessionDir, "progress.txt");
      expect(existsSync(progressPath)).toBe(true);
    });

    test("progress.txt contains feature name", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const feature = createRalphFeature({
        id: "feat-1",
        name: "Add user authentication",
        description: "Implement auth",
      });

      await appendProgress(sessionDir, feature, true);

      const progressPath = path.join(sessionDir, "progress.txt");
      const content = await fs.readFile(progressPath, "utf-8");
      expect(content).toContain("Add user authentication");
    });

    test("progress.txt contains success checkmark for passing features", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const feature = createRalphFeature({
        id: "feat-1",
        name: "Test feature",
        description: "Test",
      });

      await appendProgress(sessionDir, feature, true);

      const progressPath = path.join(sessionDir, "progress.txt");
      const content = await fs.readFile(progressPath, "utf-8");
      expect(content).toContain("✓");
    });

    test("progress.txt contains failure mark for failing features", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const feature = createRalphFeature({
        id: "feat-1",
        name: "Test feature",
        description: "Test",
      });

      await appendProgress(sessionDir, feature, false);

      const progressPath = path.join(sessionDir, "progress.txt");
      const content = await fs.readFile(progressPath, "utf-8");
      expect(content).toContain("✗");
    });

    test("progress.txt contains timestamp", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const feature = createRalphFeature({
        id: "feat-1",
        name: "Test feature",
        description: "Test",
      });

      await appendProgress(sessionDir, feature, true);

      const progressPath = path.join(sessionDir, "progress.txt");
      const content = await fs.readFile(progressPath, "utf-8");

      // Timestamp format: [2026-02-03T10:30:00.000Z]
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    test("progress.txt can contain multiple entries", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const feature1 = createRalphFeature({
        id: "feat-1",
        name: "Feature 1",
        description: "Test",
      });

      const feature2 = createRalphFeature({
        id: "feat-2",
        name: "Feature 2",
        description: "Test",
      });

      await appendProgress(sessionDir, feature1, true);
      await appendProgress(sessionDir, feature2, false);

      const progressPath = path.join(sessionDir, "progress.txt");
      const content = await fs.readFile(progressPath, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines.length).toBe(2);
      expect(lines[0]).toContain("Feature 1");
      expect(lines[0]).toContain("✓");
      expect(lines[1]).toContain("Feature 2");
      expect(lines[1]).toContain("✗");
    });

    test("progress.txt entries are appended, not overwritten", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const feature1 = createRalphFeature({
        id: "feat-1",
        name: "First feature",
        description: "Test",
      });

      const feature2 = createRalphFeature({
        id: "feat-2",
        name: "Second feature",
        description: "Test",
      });

      await appendProgress(sessionDir, feature1, true);

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await appendProgress(sessionDir, feature2, true);

      const progressPath = path.join(sessionDir, "progress.txt");
      const content = await fs.readFile(progressPath, "utf-8");

      expect(content).toContain("First feature");
      expect(content).toContain("Second feature");
    });

    test("progress.txt format matches expected pattern", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const feature = createRalphFeature({
        id: "feat-1",
        name: "Test feature",
        description: "Test",
      });

      await appendProgress(sessionDir, feature, true);

      const progressPath = path.join(sessionDir, "progress.txt");
      const content = await fs.readFile(progressPath, "utf-8");

      // Expected format: [timestamp] ✓/✗ feature_name
      expect(content).toMatch(
        /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] [✓✗] .+/
      );
    });
  });

  // ============================================================================
  // 5. Verify logs/ directory exists
  // ============================================================================

  describe("5. Verify logs/ directory exists", () => {
    test("logs/ directory is created by createSessionDirectory()", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const logsDir = path.join(sessionDir, "logs");
      expect(existsSync(logsDir)).toBe(true);
    });

    test("logs/ directory is in SESSION_SUBDIRECTORIES constant", () => {
      expect(SESSION_SUBDIRECTORIES).toContain("logs");
    });

    test("logs/ directory is initially empty", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const logsDir = path.join(sessionDir, "logs");
      const files = await fs.readdir(logsDir);
      expect(files.length).toBe(0);
    });

    test("logs/ directory can contain log files via appendLog()", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      await appendLog(sessionDir, "agent-calls", {
        action: "test",
        tool: "Bash",
      });

      const logFilePath = path.join(sessionDir, "logs", "agent-calls.jsonl");
      expect(existsSync(logFilePath)).toBe(true);
    });

    test("appendLog creates JSONL format log files", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      await appendLog(sessionDir, "agent-calls", {
        action: "execute",
        tool: "Bash",
        input: { command: "ls -la" },
      });

      const logFilePath = path.join(sessionDir, "logs", "agent-calls.jsonl");
      const content = await fs.readFile(logFilePath, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines.length).toBe(1);

      const entry = JSON.parse(lines[0]);
      expect(entry.action).toBe("execute");
      expect(entry.tool).toBe("Bash");
      expect(entry.timestamp).toBeDefined();
    });

    test("appendLog adds timestamp to entries", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      await appendLog(sessionDir, "test-log", {
        message: "test entry",
      });

      const logFilePath = path.join(sessionDir, "logs", "test-log.jsonl");
      const content = await fs.readFile(logFilePath, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.timestamp).toBeDefined();
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    });

    test("appendLog can append multiple entries", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      await appendLog(sessionDir, "agent-calls", { action: "first" });
      await appendLog(sessionDir, "agent-calls", { action: "second" });
      await appendLog(sessionDir, "agent-calls", { action: "third" });

      const logFilePath = path.join(sessionDir, "logs", "agent-calls.jsonl");
      const content = await fs.readFile(logFilePath, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines.length).toBe(3);

      const entries = lines.map((line) => JSON.parse(line));
      expect(entries[0].action).toBe("first");
      expect(entries[1].action).toBe("second");
      expect(entries[2].action).toBe("third");
    });

    test("logs/ can contain multiple log files", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      await appendLog(sessionDir, "agent-calls", { type: "agent" });
      await appendLog(sessionDir, "tool-calls", { type: "tool" });
      await appendLog(sessionDir, "errors", { type: "error" });

      const logsDir = path.join(sessionDir, "logs");
      const files = await fs.readdir(logsDir);

      expect(files).toContain("agent-calls.jsonl");
      expect(files).toContain("tool-calls.jsonl");
      expect(files).toContain("errors.jsonl");
    });
  });

  // ============================================================================
  // 6. Verify checkpoints/ directory exists
  // ============================================================================

  describe("6. Verify checkpoints/ directory exists", () => {
    test("checkpoints/ directory is created by createSessionDirectory()", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const checkpointsDir = path.join(sessionDir, "checkpoints");
      expect(existsSync(checkpointsDir)).toBe(true);
    });

    test("checkpoints/ directory is in SESSION_SUBDIRECTORIES constant", () => {
      expect(SESSION_SUBDIRECTORIES).toContain("checkpoints");
    });

    test("checkpoints/ directory is initially empty", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const checkpointsDir = path.join(sessionDir, "checkpoints");
      const files = await fs.readdir(checkpointsDir);
      expect(files.length).toBe(0);
    });

    test("checkpoints/ directory can contain checkpoint files", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Simulate creating a checkpoint file
      const checkpointPath = path.join(
        sessionDir,
        "checkpoints",
        "node-001.json"
      );
      const checkpointData = {
        nodeName: "init-session",
        state: { iteration: 1 },
        timestamp: new Date().toISOString(),
      };

      await fs.writeFile(
        checkpointPath,
        JSON.stringify(checkpointData, null, 2)
      );

      expect(existsSync(checkpointPath)).toBe(true);
    });

    test("checkpoints/ can store multiple checkpoint files", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Create multiple checkpoint files
      const checkpointsDir = path.join(sessionDir, "checkpoints");

      for (let i = 1; i <= 3; i++) {
        const checkpointPath = path.join(
          checkpointsDir,
          `node-${String(i).padStart(3, "0")}.json`
        );
        await fs.writeFile(
          checkpointPath,
          JSON.stringify({
            nodeName: `node-${i}`,
            iteration: i,
          })
        );
      }

      const files = await fs.readdir(checkpointsDir);
      expect(files).toContain("node-001.json");
      expect(files).toContain("node-002.json");
      expect(files).toContain("node-003.json");
    });

    test("checkpoints/ directory is at correct path within session", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const expectedPath = path.join(sessionDir, "checkpoints");
      const absolutePath = path.resolve(expectedPath);

      expect(existsSync(absolutePath)).toBe(true);
      expect(absolutePath).toContain(sessionId);
      expect(absolutePath).toContain("checkpoints");
    });
  });

  // ============================================================================
  // 7. Research subdirectory
  // ============================================================================

  describe("7. Research subdirectory", () => {
    test("research/ directory is created by createSessionDirectory()", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const researchDir = path.join(sessionDir, "research");
      expect(existsSync(researchDir)).toBe(true);
    });

    test("research/ directory is in SESSION_SUBDIRECTORIES constant", () => {
      expect(SESSION_SUBDIRECTORIES).toContain("research");
    });

    test("research/ directory is initially empty", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const researchDir = path.join(sessionDir, "research");
      const files = await fs.readdir(researchDir);
      expect(files.length).toBe(0);
    });

    test("research/ can contain copied feature-list.json", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Simulate copying feature list to session research directory
      const researchDir = path.join(sessionDir, "research");
      const featureListPath = path.join(researchDir, "feature-list.json");

      await fs.writeFile(featureListPath, createTestFeatureListContent());

      expect(existsSync(featureListPath)).toBe(true);

      const content = await fs.readFile(featureListPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.features).toBeDefined();
    });
  });

  // ============================================================================
  // Integration: Complete session artifact creation flow
  // ============================================================================

  describe("Integration: Complete session artifact creation flow", () => {
    test("complete flow: create session -> save -> verify all artifacts", async () => {
      // Step 1: Generate session ID
      const sessionId = generateSessionId();
      expect(isValidUUID(sessionId)).toBe(true);

      // Step 2: Create session directory structure
      const sessionDir = await createSessionDirectory(sessionId);
      expect(existsSync(sessionDir)).toBe(true);

      // Step 3: Create session with features
      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        maxIterations: 100,
        features: [
          createRalphFeature({
            id: "feat-1",
            name: "Test feature 1",
            description: "First test feature",
          }),
          createRalphFeature({
            id: "feat-2",
            name: "Test feature 2",
            description: "Second test feature",
          }),
        ],
      });

      // Step 4: Save session
      await saveSession(sessionDir, session);

      // Step 5: Add progress entries
      for (const feature of session.features) {
        await appendProgress(sessionDir, feature, true);
      }

      // Step 6: Add log entries
      await appendLog(sessionDir, "agent-calls", {
        action: "implement",
        featureId: "feat-1",
      });

      // Verify all artifacts exist
      expect(existsSync(path.join(sessionDir, "session.json"))).toBe(true);
      expect(existsSync(path.join(sessionDir, "progress.txt"))).toBe(true);
      expect(existsSync(path.join(sessionDir, "logs"))).toBe(true);
      expect(existsSync(path.join(sessionDir, "checkpoints"))).toBe(true);
      expect(existsSync(path.join(sessionDir, "research"))).toBe(true);
      expect(
        existsSync(path.join(sessionDir, "logs", "agent-calls.jsonl"))
      ).toBe(true);
    });

    test("session artifacts persist and can be read after creation", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        features: [
          createRalphFeature({
            id: "feat-1",
            name: "Persistent feature",
            description: "Test persistence",
          }),
        ],
      });

      await saveSession(sessionDir, session);
      await appendProgress(sessionDir, session.features[0], true);
      await appendLog(sessionDir, "test-log", { persisted: true });

      // Read and verify all artifacts
      const loadedSession = await loadSession(sessionDir);
      expect(loadedSession.sessionId).toBe(sessionId);
      expect(loadedSession.features[0].name).toBe("Persistent feature");

      const progressContent = await fs.readFile(
        path.join(sessionDir, "progress.txt"),
        "utf-8"
      );
      expect(progressContent).toContain("Persistent feature");

      const logContent = await fs.readFile(
        path.join(sessionDir, "logs", "test-log.jsonl"),
        "utf-8"
      );
      const logEntry = JSON.parse(logContent.trim());
      expect(logEntry.persisted).toBe(true);
    });

    test("multiple sessions have independent artifact directories", async () => {
      // Create two sessions
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();

      const sessionDir1 = await createSessionDirectory(sessionId1);
      const sessionDir2 = await createSessionDirectory(sessionId2);

      // Create and save sessions
      const session1 = createRalphSession({
        sessionId: sessionId1,
        sessionDir: sessionDir1,
        status: "running",
      });

      const session2 = createRalphSession({
        sessionId: sessionId2,
        sessionDir: sessionDir2,
        status: "running",
      });

      await saveSession(sessionDir1, session1);
      await saveSession(sessionDir2, session2);

      // Add different logs to each
      await appendLog(sessionDir1, "test", { session: 1 });
      await appendLog(sessionDir2, "test", { session: 2 });

      // Verify independence
      const log1Content = await fs.readFile(
        path.join(sessionDir1, "logs", "test.jsonl"),
        "utf-8"
      );
      const log2Content = await fs.readFile(
        path.join(sessionDir2, "logs", "test.jsonl"),
        "utf-8"
      );

      const log1Entry = JSON.parse(log1Content.trim());
      const log2Entry = JSON.parse(log2Content.trim());

      expect(log1Entry.session).toBe(1);
      expect(log2Entry.session).toBe(2);
    });

    test("session state can be updated and re-saved", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Create initial session
      let session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        iteration: 1,
      });

      await saveSession(sessionDir, session);

      // Load, update, and save multiple times
      session = await loadSession(sessionDir);
      session.iteration = 2;
      session.status = "running";
      await saveSession(sessionDir, session);

      session = await loadSession(sessionDir);
      session.iteration = 3;
      session.status = "completed";
      await saveSession(sessionDir, session);

      // Verify final state
      const finalSession = await loadSession(sessionDir);
      expect(finalSession.iteration).toBe(3);
      expect(finalSession.status).toBe("completed");
    });

    test("all required subdirectories exist after session creation", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Verify all subdirectories from SESSION_SUBDIRECTORIES constant
      for (const subdir of SESSION_SUBDIRECTORIES) {
        const subdirPath = path.join(sessionDir, subdir);
        expect(existsSync(subdirPath)).toBe(true);
      }
    });

    test("yolo mode session still creates all artifact directories", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        yolo: true,
        status: "running",
      });

      await saveSession(sessionDir, session);

      // Verify all directories exist even in yolo mode
      expect(existsSync(path.join(sessionDir, "checkpoints"))).toBe(true);
      expect(existsSync(path.join(sessionDir, "research"))).toBe(true);
      expect(existsSync(path.join(sessionDir, "logs"))).toBe(true);
    });
  });
});
