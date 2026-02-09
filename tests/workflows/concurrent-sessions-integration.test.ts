/**
 * Integration tests for Concurrent Ralph Sessions with Independent Artifacts
 *
 * Tests verify that multiple Ralph sessions can run concurrently without
 * interfering with each other, each maintaining their own independent:
 * - Session UUID
 * - Session directory structure
 * - Feature list copy
 * - Progress tracking
 * - Logs
 *
 * Feature: Integration test: Concurrent Ralph sessions with independent artifacts
 */

import { describe, test, expect, afterAll, beforeEach } from "bun:test";
import {
  generateSessionId,
  createSessionDirectory,
  createRalphSession,
  saveSession,
  loadSession,
  loadSessionIfExists,
  appendLog,
  appendProgress,
  getSessionDir,
  type RalphSession,
  type TodoItem,
} from "../../src/workflows/index.ts";

// Node fs/path imports
const { rm, stat, readFile, writeFile, readdir, mkdir } = require("node:fs/promises");
const { join } = require("node:path");

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper to clean up test directories
 */
async function cleanupDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create tasks for test sessions
 */
function createTestTasks(prefix: string): TodoItem[] {
  return [
    {
      id: `${prefix}-feat-001`,
      content: `${prefix} Feature 1`,
      status: "pending" as const,
      activeForm: `${prefix} Feature 1`,
    },
    {
      id: `${prefix}-feat-002`,
      content: `${prefix} Feature 2`,
      status: "pending" as const,
      activeForm: `${prefix} Feature 2`,
    },
  ];
}

/**
 * Initialize a complete Ralph session with directory and session.json
 */
async function initializeTestSession(
  sessionId: string,
  options: {
    tasks?: TodoItem[];
      } = {}
): Promise<RalphSession> {
  const sessionDir = await createSessionDirectory(sessionId);

  const session = createRalphSession({
    sessionId,
    sessionDir,
        tasks: options.tasks ?? [],
  });

  await saveSession(sessionDir, session);

  // Create feature-list.json in research directory
  if (options.tasks) {
    const tasksPath = join(sessionDir, "research", "feature-list.json");
    const taskList = {
      tasks: options.tasks.map((t) => ({
        id: t.id,
        content: t.content,
        status: t.status,
        activeForm: t.activeForm,
      })),
    };
    await writeFile(tasksPath, JSON.stringify(taskList, null, 2), "utf-8");
  }

  return session;
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe("Integration test: Concurrent Ralph sessions with independent artifacts", () => {
  // Track session IDs for cleanup
  const sessionsToCleanup: string[] = [];

  // Clean up all test sessions after tests
  afterAll(async () => {
    for (const sessionId of sessionsToCleanup) {
      await cleanupDir(getSessionDir(sessionId));
    }
    // Clean up .ralph directory if empty
    try {
      const contents = await readdir(".ralph/sessions");
      if (contents.length === 0) {
        await rm(".ralph", { recursive: true, force: true });
      }
    } catch {
      // Ignore errors
    }
  });

  // ============================================================================
  // Start Ralph session 1
  // ============================================================================

  describe("Start Ralph session 1", () => {
    test("session 1 is created with unique UUID", async () => {
      const sessionId1 = generateSessionId();
      sessionsToCleanup.push(sessionId1);

      const tasks1 = createTestTasks("session1");
      const session1 = await initializeTestSession(sessionId1, { tasks: tasks1 });

      expect(session1.sessionId).toBe(sessionId1);
      expect(session1.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    test("session 1 has its own session directory", async () => {
      const sessionId1 = generateSessionId();
      sessionsToCleanup.push(sessionId1);

      const tasks1 = createTestTasks("session1");
      const session1 = await initializeTestSession(sessionId1, { tasks: tasks1 });

      const dirStat = await stat(session1.sessionDir);
      expect(dirStat.isDirectory()).toBe(true);
      expect(session1.sessionDir).toBe(`.ralph/sessions/${sessionId1}/`);
    });

    test("session 1 has all required subdirectories", async () => {
      const sessionId1 = generateSessionId();
      sessionsToCleanup.push(sessionId1);

      const tasks1 = createTestTasks("session1");
      const session1 = await initializeTestSession(sessionId1, { tasks: tasks1 });

      const checkpointsStat = await stat(join(session1.sessionDir, "checkpoints"));
      const researchStat = await stat(join(session1.sessionDir, "research"));
      const logsStat = await stat(join(session1.sessionDir, "logs"));

      expect(checkpointsStat.isDirectory()).toBe(true);
      expect(researchStat.isDirectory()).toBe(true);
      expect(logsStat.isDirectory()).toBe(true);
    });

    test("session 1 has valid session.json", async () => {
      const sessionId1 = generateSessionId();
      sessionsToCleanup.push(sessionId1);

      const tasks1 = createTestTasks("session1");
      const session1 = await initializeTestSession(sessionId1, { tasks: tasks1 });

      const loaded = await loadSession(session1.sessionDir);
      expect(loaded.sessionId).toBe(sessionId1);
      expect(loaded.tasks.length).toBe(2);
    });
  });

  // ============================================================================
  // Start Ralph session 2 concurrently
  // ============================================================================

  describe("Start Ralph session 2 concurrently", () => {
    test("two sessions can be created concurrently", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      // Create both sessions concurrently
      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      expect(session1).toBeDefined();
      expect(session2).toBeDefined();
      expect(session1.sessionId).toBe(sessionId1);
      expect(session2.sessionId).toBe(sessionId2);
    });

    test("concurrent sessions are both accessible after creation", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      // Create both sessions concurrently
      await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      // Load both sessions
      const [loaded1, loaded2] = await Promise.all([
        loadSession(getSessionDir(sessionId1)),
        loadSession(getSessionDir(sessionId2)),
      ]);

      expect(loaded1.sessionId).toBe(sessionId1);
      expect(loaded2.sessionId).toBe(sessionId2);
    });

    test("creating many concurrent sessions does not cause errors", async () => {
      const sessionIds: string[] = [];
      const sessionCount = 5;

      for (let i = 0; i < sessionCount; i++) {
        const id = generateSessionId();
        sessionIds.push(id);
        sessionsToCleanup.push(id);
      }

      // Create all sessions concurrently
      const sessions = await Promise.all(
        sessionIds.map((id, index) =>
          initializeTestSession(id, { tasks: createTestTasks(`session${index}`) })
        )
      );

      expect(sessions.length).toBe(sessionCount);

      // Verify all sessions are accessible
      const loadedSessions = await Promise.all(
        sessionIds.map((id) => loadSession(getSessionDir(id)))
      );

      expect(loadedSessions.length).toBe(sessionCount);
      for (let i = 0; i < sessionCount; i++) {
        expect(loadedSessions[i]!.sessionId).toBe(sessionIds[i]!);
      }
    });
  });

  // ============================================================================
  // Verify different UUIDs generated
  // ============================================================================

  describe("Verify different UUIDs generated", () => {
    test("each session has a unique UUID", async () => {
      const sessionIds = new Set<string>();
      const count = 10;

      for (let i = 0; i < count; i++) {
        const id = generateSessionId();
        sessionIds.add(id);
      }

      // All 10 IDs should be unique
      expect(sessionIds.size).toBe(count);
    });

    test("concurrent session UUIDs are guaranteed unique", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      // UUIDs should be different
      expect(sessionId1).not.toBe(sessionId2);

      // Both should be valid UUID v4 format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(sessionId1).toMatch(uuidRegex);
      expect(sessionId2).toMatch(uuidRegex);
    });

    test("1000 generated UUIDs are all unique", () => {
      const sessionIds = new Set<string>();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        sessionIds.add(generateSessionId());
      }

      expect(sessionIds.size).toBe(count);
    });
  });

  // ============================================================================
  // Verify separate session directories created
  // ============================================================================

  describe("Verify separate session directories created", () => {
    test("each session has its own directory path", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      expect(session1.sessionDir).not.toBe(session2.sessionDir);
      expect(session1.sessionDir).toContain(sessionId1);
      expect(session2.sessionDir).toContain(sessionId2);
    });

    test("session directories exist as separate filesystem entries", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      // Both directories should exist
      const stat1 = await stat(session1.sessionDir);
      const stat2 = await stat(session2.sessionDir);

      expect(stat1.isDirectory()).toBe(true);
      expect(stat2.isDirectory()).toBe(true);
    });

    test("each session directory has independent subdirectories", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      // Verify each has its own subdirectories
      const subdirs = ["checkpoints", "research", "logs"];

      for (const subdir of subdirs) {
        const path1 = join(session1.sessionDir, subdir);
        const path2 = join(session2.sessionDir, subdir);

        const stat1 = await stat(path1);
        const stat2 = await stat(path2);

        expect(stat1.isDirectory()).toBe(true);
        expect(stat2.isDirectory()).toBe(true);
        expect(path1).not.toBe(path2);
      }
    });
  });

  // ============================================================================
  // Verify sessions don't interfere with each other
  // ============================================================================

  describe("Verify sessions don't interfere with each other", () => {
    test("updating session 1 does not affect session 2", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      // Update session 1
      const updatedSession1: RalphSession = {
        ...session1,
        iteration: 10,
        status: "paused",
        tasks: session1.tasks.map((f, i) =>
          i === 0 ? { ...f, status: "completed" as const } : f
        ),
        completedFeatures: [tasks1[0]!.id!],
      };
      await saveSession(session1.sessionDir, updatedSession1);

      // Session 2 should be unchanged
      const loaded2 = await loadSession(session2.sessionDir);
      expect(loaded2.iteration).toBe(1);
      expect(loaded2.status).toBe("running");
      expect(loaded2.completedFeatures).toEqual([]);
      expect(loaded2.tasks[0]!.status).toBe("pending");
    });

    test("appending logs to session 1 does not affect session 2 logs", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      // Append logs to session 1
      await appendLog(session1.sessionDir, "agent-calls", {
        tool: "Bash",
        input: { command: "ls -la" },
        sessionId: sessionId1,
      });

      await appendLog(session1.sessionDir, "agent-calls", {
        tool: "Read",
        input: { path: "/some/file" },
        sessionId: sessionId1,
      });

      // Verify session 1 has logs
      const logPath1 = join(session1.sessionDir, "logs", "agent-calls.jsonl");
      const logContent1 = await readFile(logPath1, "utf-8");
      const logLines1 = logContent1.trim().split("\n");
      expect(logLines1.length).toBe(2);

      // Session 2 should have no logs
      const logPath2 = join(session2.sessionDir, "logs", "agent-calls.jsonl");
      await expect(stat(logPath2)).rejects.toThrow();
    });

    test("appending progress to session 1 does not affect session 2 progress", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      // Append progress to session 1
      await appendProgress(session1.sessionDir, `✓ ${tasks1[0]!.content}`);
      await appendProgress(session1.sessionDir, `✗ ${tasks1[1]!.content}`);

      // Verify session 1 has progress
      const progressPath1 = join(session1.sessionDir, "progress.txt");
      const progressContent1 = await readFile(progressPath1, "utf-8");
      const progressLines1 = progressContent1.trim().split("\n");
      expect(progressLines1.length).toBe(2);
      expect(progressLines1[0]).toContain("session1 Feature 1");
      expect(progressLines1[1]).toContain("session1 Feature 2");

      // Session 2 should have no progress file
      const progressPath2 = join(session2.sessionDir, "progress.txt");
      await expect(stat(progressPath2)).rejects.toThrow();
    });

    test("concurrent writes to different sessions do not corrupt data", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      // Perform many concurrent writes to both sessions
      const writePromises: Promise<void>[] = [];

      for (let i = 0; i < 10; i++) {
        writePromises.push(
          appendLog(session1.sessionDir, "concurrent-test", {
            iteration: i,
            sessionId: sessionId1,
            data: `session1-data-${i}`,
          })
        );
        writePromises.push(
          appendLog(session2.sessionDir, "concurrent-test", {
            iteration: i,
            sessionId: sessionId2,
            data: `session2-data-${i}`,
          })
        );
      }

      await Promise.all(writePromises);

      // Verify each session's log contains only its own data
      const logPath1 = join(session1.sessionDir, "logs", "concurrent-test.jsonl");
      const logPath2 = join(session2.sessionDir, "logs", "concurrent-test.jsonl");

      const logContent1 = await readFile(logPath1, "utf-8");
      const logContent2 = await readFile(logPath2, "utf-8");

      const logLines1 = logContent1.trim().split("\n");
      const logLines2 = logContent2.trim().split("\n");

      // Each log should have exactly 10 entries
      expect(logLines1.length).toBe(10);
      expect(logLines2.length).toBe(10);

      // All entries in session 1 log should reference session 1
      for (const line of logLines1) {
        const entry = JSON.parse(line);
        expect(entry.sessionId).toBe(sessionId1);
        expect(entry.data).toContain("session1-data");
      }

      // All entries in session 2 log should reference session 2
      for (const line of logLines2) {
        const entry = JSON.parse(line);
        expect(entry.sessionId).toBe(sessionId2);
        expect(entry.data).toContain("session2-data");
      }
    });

    test("deleting session 1 does not affect session 2", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId2); // Only push session 2 for cleanup

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      // Verify both sessions exist
      const loaded1Before = await loadSession(session1.sessionDir);
      const loaded2Before = await loadSession(session2.sessionDir);
      expect(loaded1Before.sessionId).toBe(sessionId1);
      expect(loaded2Before.sessionId).toBe(sessionId2);

      // Delete session 1
      await cleanupDir(session1.sessionDir);

      // Session 1 should no longer exist
      const loaded1After = await loadSessionIfExists(session1.sessionDir);
      expect(loaded1After).toBeNull();

      // Session 2 should still exist and be unchanged
      const loaded2After = await loadSession(session2.sessionDir);
      expect(loaded2After.sessionId).toBe(sessionId2);
      expect(loaded2After.tasks.length).toBe(2);
    });
  });

  // ============================================================================
  // Verify each session has independent feature list copy
  // ============================================================================

  describe("Verify each session has independent feature list copy", () => {
    test("each session has its own feature-list.json in research directory", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      // Verify each has its own feature-list.json
      const tasksPath1 = join(session1.sessionDir, "research", "feature-list.json");
      const tasksPath2 = join(session2.sessionDir, "research", "feature-list.json");

      const stat1 = await stat(tasksPath1);
      const stat2 = await stat(tasksPath2);

      expect(stat1.isFile()).toBe(true);
      expect(stat2.isFile()).toBe(true);
    });

    test("feature lists contain different session-specific content", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      // Read both feature lists
      const tasksPath1 = join(session1.sessionDir, "research", "feature-list.json");
      const tasksPath2 = join(session2.sessionDir, "research", "feature-list.json");

      const content1 = await readFile(tasksPath1, "utf-8");
      const content2 = await readFile(tasksPath2, "utf-8");

      const taskList1 = JSON.parse(content1);
      const taskList2 = JSON.parse(content2);

      // Verify they have different descriptions
      expect(taskList1.tasks[0].content).toContain("session1");
      expect(taskList2.tasks[0].content).toContain("session2");
    });

    test("modifying session 1 feature list does not affect session 2", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const tasks1 = createTestTasks("session1");
      const tasks2 = createTestTasks("session2");

      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: tasks1 }),
        initializeTestSession(sessionId2, { tasks: tasks2 }),
      ]);

      // Read session 2 feature list before modification
      const tasksPath2 = join(session2.sessionDir, "research", "feature-list.json");
      const contentBefore = await readFile(tasksPath2, "utf-8");
      const taskListBefore = JSON.parse(contentBefore);

      // Modify session 1 feature list
      const tasksPath1 = join(session1.sessionDir, "research", "feature-list.json");
      const modifiedFeatureList = {
        tasks: [
          {
            id: "modified-001",
            content: "MODIFIED - This was changed",
            status: "completed",
            activeForm: "MODIFIED - This was changed",
          },
        ],
      };
      await writeFile(tasksPath1, JSON.stringify(modifiedFeatureList, null, 2), "utf-8");

      // Verify session 1 was modified
      const content1Modified = await readFile(tasksPath1, "utf-8");
      const taskList1Modified = JSON.parse(content1Modified);
      expect(taskList1Modified.tasks[0].content).toBe("MODIFIED - This was changed");

      // Verify session 2 is unchanged
      const contentAfter = await readFile(tasksPath2, "utf-8");
      const taskListAfter = JSON.parse(contentAfter);
      expect(taskListAfter).toEqual(taskListBefore);
      expect(taskListAfter.tasks[0].content).toContain("session2");
    });

    test("session feature lists can have different numbers of features", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      // Create session 1 with 2 features
      const tasks1 = createTestTasks("session1");
      const session1 = await initializeTestSession(sessionId1, { tasks: tasks1 });

      // Create session 2 with 5 features
      const tasks2 = [
        ...createTestTasks("session2"),
        { id: "session2-feat-003", content: "session2 Feature 3", status: "pending" as const, activeForm: "session2 Feature 3" },
        { id: "session2-feat-004", content: "session2 Feature 4", status: "pending" as const, activeForm: "session2 Feature 4" },
        { id: "session2-feat-005", content: "session2 Feature 5", status: "pending" as const, activeForm: "session2 Feature 5" },
      ];
      const session2 = await initializeTestSession(sessionId2, { tasks: tasks2 });

      // Verify different feature counts
      const tasksPath1 = join(session1.sessionDir, "research", "feature-list.json");
      const tasksPath2 = join(session2.sessionDir, "research", "feature-list.json");

      const content1 = await readFile(tasksPath1, "utf-8");
      const content2 = await readFile(tasksPath2, "utf-8");

      const taskList1 = JSON.parse(content1);
      const taskList2 = JSON.parse(content2);

      expect(taskList1.tasks.length).toBe(2);
      expect(taskList2.tasks.length).toBe(5);
    });
  });

  // ============================================================================
  // Edge cases and stress tests
  // ============================================================================

  describe("Edge cases and stress tests", () => {
    test("sessions with same features have independent copies", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      // Both sessions use same features (but different objects)
      const features = createTestTasks("shared");

      const [session1, session2] = await Promise.all([
        initializeTestSession(sessionId1, { tasks: [...features] }),
        initializeTestSession(sessionId2, { tasks: [...features] }),
      ]);

      // Update session 1's first feature to passing
      const updatedSession1: RalphSession = {
        ...session1,
        tasks: session1.tasks.map((f, i) =>
          i === 0 ? { ...f, status: "completed" as const } : f
        ),
        completedFeatures: [session1.tasks[0]!.id!],
      };
      await saveSession(session1.sessionDir, updatedSession1);

      // Session 2's features should still be pending
      const loaded2 = await loadSession(session2.sessionDir);
      expect(loaded2.tasks[0]!.status).toBe("pending");
      expect(loaded2.completedFeatures).toEqual([]);
    });

    test("sessions can have different statuses simultaneously", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      const sessionId3 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2, sessionId3);

      // Create sessions with different statuses
      const session1 = await initializeTestSession(sessionId1, {
        tasks: createTestTasks("session1"),
      });
      const session2 = await initializeTestSession(sessionId2, {
        tasks: createTestTasks("session2"),
      });
      const session3 = await initializeTestSession(sessionId3, {
        tasks: createTestTasks("session3"),
      });

      // Update each to a different status
      await saveSession(session1.sessionDir, { ...session1, status: "running" });
      await saveSession(session2.sessionDir, { ...session2, status: "paused" });
      await saveSession(session3.sessionDir, { ...session3, status: "completed" });

      // Verify each has independent status
      const [loaded1, loaded2, loaded3] = await Promise.all([
        loadSession(session1.sessionDir),
        loadSession(session2.sessionDir),
        loadSession(session3.sessionDir),
      ]);

      expect(loaded1.status).toBe("running");
      expect(loaded2.status).toBe("paused");
      expect(loaded3.status).toBe("completed");
    });

    test("sessions can have different iteration counts simultaneously", async () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();
      sessionsToCleanup.push(sessionId1, sessionId2);

      const session1 = await initializeTestSession(sessionId1, {
        tasks: createTestTasks("session1"),
      });
      const session2 = await initializeTestSession(sessionId2, {
        tasks: createTestTasks("session2"),
      });

      // Update to different iterations
      await saveSession(session1.sessionDir, { ...session1, iteration: 42 });
      await saveSession(session2.sessionDir, { ...session2, iteration: 7 });

      const [loaded1, loaded2] = await Promise.all([
        loadSession(session1.sessionDir),
        loadSession(session2.sessionDir),
      ]);

      expect(loaded1.iteration).toBe(42);
      expect(loaded2.iteration).toBe(7);
    });
  });
});
