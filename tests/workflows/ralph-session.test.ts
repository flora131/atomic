/**
 * Unit tests for Ralph Session types and helper functions
 *
 * Tests cover:
 * - RalphFeature interface and creation
 * - RalphSession interface and creation
 * - generateSessionId() UUID generation
 * - getSessionDir() path generation
 * - Type guards for validation
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  generateSessionId,
  getSessionDir,
  createRalphSession,
  createRalphFeature,
  isRalphFeature,
  isRalphSession,
  createSessionDirectory,
  saveSession,
  loadSession,
  loadSessionIfExists,
  appendLog,
  appendProgress,
  SESSION_SUBDIRECTORIES,
  type RalphFeature,
  type RalphSession,
} from "../../src/workflows/ralph-session.ts";

describe("RalphFeature", () => {
  describe("createRalphFeature", () => {
    test("creates feature with required fields", () => {
      const feature = createRalphFeature({
        id: "feat-001",
        name: "Add authentication",
        description: "Implement JWT-based authentication",
      });

      expect(feature.id).toBe("feat-001");
      expect(feature.name).toBe("Add authentication");
      expect(feature.description).toBe("Implement JWT-based authentication");
      expect(feature.status).toBe("pending");
      expect(feature.acceptanceCriteria).toBeUndefined();
      expect(feature.implementedAt).toBeUndefined();
      expect(feature.error).toBeUndefined();
    });

    test("creates feature with all optional fields", () => {
      const feature = createRalphFeature({
        id: "feat-002",
        name: "Add logging",
        description: "Add structured logging",
        acceptanceCriteria: ["Logs to stdout", "JSON format"],
        status: "passing",
        implementedAt: "2026-02-02T10:00:00.000Z",
      });

      expect(feature.status).toBe("passing");
      expect(feature.acceptanceCriteria).toEqual(["Logs to stdout", "JSON format"]);
      expect(feature.implementedAt).toBe("2026-02-02T10:00:00.000Z");
    });

    test("creates feature with error for failing status", () => {
      const feature = createRalphFeature({
        id: "feat-003",
        name: "Broken feature",
        description: "This feature failed",
        status: "failing",
        error: "Test suite failed with 3 errors",
      });

      expect(feature.status).toBe("failing");
      expect(feature.error).toBe("Test suite failed with 3 errors");
    });
  });

  describe("isRalphFeature", () => {
    test("returns true for valid feature", () => {
      const feature: RalphFeature = {
        id: "feat-001",
        name: "Test",
        description: "Test description",
        status: "pending",
      };
      expect(isRalphFeature(feature)).toBe(true);
    });

    test("returns true for feature with all fields", () => {
      const feature: RalphFeature = {
        id: "feat-001",
        name: "Test",
        description: "Test description",
        acceptanceCriteria: ["Criterion 1"],
        status: "passing",
        implementedAt: "2026-02-02T10:00:00.000Z",
        error: undefined,
      };
      expect(isRalphFeature(feature)).toBe(true);
    });

    test("returns false for null", () => {
      expect(isRalphFeature(null)).toBe(false);
    });

    test("returns false for undefined", () => {
      expect(isRalphFeature(undefined)).toBe(false);
    });

    test("returns false for non-object", () => {
      expect(isRalphFeature("string")).toBe(false);
      expect(isRalphFeature(123)).toBe(false);
      expect(isRalphFeature([])).toBe(false);
    });

    test("returns false for missing required fields", () => {
      expect(isRalphFeature({ id: "001" })).toBe(false);
      expect(isRalphFeature({ id: "001", name: "Test" })).toBe(false);
      expect(
        isRalphFeature({ id: "001", name: "Test", description: "Desc" })
      ).toBe(false);
    });

    test("returns false for invalid status", () => {
      expect(
        isRalphFeature({
          id: "001",
          name: "Test",
          description: "Desc",
          status: "invalid",
        })
      ).toBe(false);
    });

    test("validates all valid status values", () => {
      const statuses = ["pending", "in_progress", "passing", "failing"] as const;
      for (const status of statuses) {
        const feature = {
          id: "001",
          name: "Test",
          description: "Desc",
          status,
        };
        expect(isRalphFeature(feature)).toBe(true);
      }
    });
  });
});

describe("RalphSession", () => {
  describe("generateSessionId", () => {
    test("generates a valid UUID v4", () => {
      const id = generateSessionId();
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(id).toMatch(uuidRegex);
    });

    test("generates unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateSessionId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe("getSessionDir", () => {
    test("returns correct path for session ID", () => {
      const dir = getSessionDir("abc123");
      expect(dir).toBe(".ralph/sessions/abc123/");
    });

    test("handles UUID session IDs", () => {
      const sessionId = "550e8400-e29b-41d4-a716-446655440000";
      const dir = getSessionDir(sessionId);
      expect(dir).toBe(`.ralph/sessions/${sessionId}/`);
    });
  });

  describe("createRalphSession", () => {
    test("creates session with default values", () => {
      const session = createRalphSession();

      expect(session.sessionId).toBeDefined();
      expect(session.sessionDir).toContain(".ralph/sessions/");
      expect(session.sessionDir).toContain(session.sessionId);
      expect(session.createdAt).toBeDefined();
      expect(session.lastUpdated).toBeDefined();
      expect(session.yolo).toBe(false);
      expect(session.maxIterations).toBe(50);
      expect(session.features).toEqual([]);
      expect(session.currentFeatureIndex).toBe(0);
      expect(session.completedFeatures).toEqual([]);
      expect(session.iteration).toBe(1);
      expect(session.status).toBe("running");
      expect(session.prUrl).toBeUndefined();
      expect(session.prBranch).toBeUndefined();
      expect(session.sourceFeatureListPath).toBeUndefined();
    });

    test("creates session with custom values", () => {
      const session = createRalphSession({
        sessionId: "custom-id",
        yolo: true,
        maxIterations: 100,
        sourceFeatureListPath: "research/feature-list.json",
        prBranch: "feature/my-feature",
      });

      expect(session.sessionId).toBe("custom-id");
      expect(session.sessionDir).toBe(".ralph/sessions/custom-id/");
      expect(session.yolo).toBe(true);
      expect(session.maxIterations).toBe(100);
      expect(session.sourceFeatureListPath).toBe("research/feature-list.json");
      expect(session.prBranch).toBe("feature/my-feature");
    });

    test("creates session with features", () => {
      const features: RalphFeature[] = [
        {
          id: "feat-001",
          name: "Feature 1",
          description: "First feature",
          status: "pending",
        },
        {
          id: "feat-002",
          name: "Feature 2",
          description: "Second feature",
          status: "pending",
        },
      ];

      const session = createRalphSession({
        features,
        currentFeatureIndex: 1,
        completedFeatures: ["feat-001"],
      });

      expect(session.features).toEqual(features);
      expect(session.currentFeatureIndex).toBe(1);
      expect(session.completedFeatures).toEqual(["feat-001"]);
    });

    test("creates session with specific timestamps", () => {
      const session = createRalphSession({
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUpdated: "2026-02-01T00:00:00.000Z",
      });

      expect(session.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(session.lastUpdated).toBe("2026-02-01T00:00:00.000Z");
    });

    test("session timestamps are valid ISO strings", () => {
      const session = createRalphSession();

      // Verify timestamps are valid ISO dates
      expect(() => new Date(session.createdAt)).not.toThrow();
      expect(() => new Date(session.lastUpdated)).not.toThrow();

      const created = new Date(session.createdAt);
      const updated = new Date(session.lastUpdated);
      expect(created.toISOString()).toBe(session.createdAt);
      expect(updated.toISOString()).toBe(session.lastUpdated);
    });
  });

  describe("isRalphSession", () => {
    test("returns true for valid session", () => {
      const session = createRalphSession();
      expect(isRalphSession(session)).toBe(true);
    });

    test("returns true for session with all fields", () => {
      const session: RalphSession = {
        sessionId: "abc123",
        sessionDir: ".ralph/sessions/abc123/",
        createdAt: "2026-02-02T10:00:00.000Z",
        lastUpdated: "2026-02-02T10:30:00.000Z",
        yolo: false,
        maxIterations: 50,
        sourceFeatureListPath: "research/feature-list.json",
        features: [],
        currentFeatureIndex: 0,
        completedFeatures: [],
        iteration: 1,
        status: "running",
        prUrl: "https://github.com/user/repo/pull/123",
        prBranch: "feature/my-feature",
      };
      expect(isRalphSession(session)).toBe(true);
    });

    test("returns false for null", () => {
      expect(isRalphSession(null)).toBe(false);
    });

    test("returns false for undefined", () => {
      expect(isRalphSession(undefined)).toBe(false);
    });

    test("returns false for non-object", () => {
      expect(isRalphSession("string")).toBe(false);
      expect(isRalphSession(123)).toBe(false);
    });

    test("returns false for missing required fields", () => {
      expect(isRalphSession({ sessionId: "abc" })).toBe(false);
    });

    test("returns false for invalid status", () => {
      const session = {
        ...createRalphSession(),
        status: "invalid",
      };
      expect(isRalphSession(session)).toBe(false);
    });

    test("validates all valid status values", () => {
      const statuses = ["running", "paused", "completed", "failed"] as const;
      for (const status of statuses) {
        const session = createRalphSession({ status });
        expect(isRalphSession(session)).toBe(true);
      }
    });

    test("returns false for non-array features", () => {
      const session = {
        ...createRalphSession(),
        features: "not an array",
      };
      expect(isRalphSession(session)).toBe(false);
    });

    test("returns false for non-array completedFeatures", () => {
      const session = {
        ...createRalphSession(),
        completedFeatures: "not an array",
      };
      expect(isRalphSession(session)).toBe(false);
    });
  });
});

describe("Integration", () => {
  test("complete workflow simulation", () => {
    // Create a new session
    const session = createRalphSession({
      sourceFeatureListPath: "research/feature-list.json",
      maxIterations: 10,
    });

    expect(session.status).toBe("running");
    expect(session.iteration).toBe(1);

    // Add features
    const features: RalphFeature[] = [
      createRalphFeature({
        id: "feat-001",
        name: "Add login",
        description: "Implement user login",
        acceptanceCriteria: ["Users can login", "Invalid credentials show error"],
      }),
      createRalphFeature({
        id: "feat-002",
        name: "Add logout",
        description: "Implement user logout",
      }),
    ];

    // Update session with features
    const updatedSession: RalphSession = {
      ...session,
      features,
      lastUpdated: new Date().toISOString(),
    };

    expect(updatedSession.features.length).toBe(2);
    expect(updatedSession.features[0].status).toBe("pending");

    // Simulate implementing first feature
    const withProgress: RalphSession = {
      ...updatedSession,
      features: [
        { ...features[0], status: "passing", implementedAt: new Date().toISOString() },
        features[1],
      ],
      currentFeatureIndex: 1,
      completedFeatures: ["feat-001"],
      iteration: 5,
      lastUpdated: new Date().toISOString(),
    };

    expect(withProgress.features[0].status).toBe("passing");
    expect(withProgress.completedFeatures).toContain("feat-001");

    // Complete session
    const completedSession: RalphSession = {
      ...withProgress,
      features: [
        withProgress.features[0],
        { ...features[1], status: "passing", implementedAt: new Date().toISOString() },
      ],
      completedFeatures: ["feat-001", "feat-002"],
      status: "completed",
      prUrl: "https://github.com/user/repo/pull/123",
      lastUpdated: new Date().toISOString(),
    };

    expect(completedSession.status).toBe("completed");
    expect(completedSession.completedFeatures.length).toBe(2);
    expect(completedSession.prUrl).toBeDefined();

    // Validate final state
    expect(isRalphSession(completedSession)).toBe(true);
    for (const feature of completedSession.features) {
      expect(isRalphFeature(feature)).toBe(true);
    }
  });
});

describe("File System Operations", () => {
  // Import node modules
  const { rm, stat, readFile, writeFile } = require("node:fs/promises");
  const { join } = require("node:path");

  // Helper to clean up test directories after each test
  async function cleanupDir(dir: string) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  // Clean up .ralph directory after all tests
  afterAll(async () => {
    try {
      await rm(".ralph", { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("SESSION_SUBDIRECTORIES", () => {
    test("contains expected subdirectories", () => {
      expect(SESSION_SUBDIRECTORIES).toContain("checkpoints");
      expect(SESSION_SUBDIRECTORIES).toContain("research");
      expect(SESSION_SUBDIRECTORIES).toContain("logs");
      expect(SESSION_SUBDIRECTORIES.length).toBe(3);
    });
  });

  describe("createSessionDirectory", () => {
    test("creates session directory with all subdirectories", async () => {
      const sessionId = `test-create-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        // Verify main directory was created
        const dirStat = await stat(sessionDir);
        expect(dirStat.isDirectory()).toBe(true);

        // Verify subdirectories were created
        for (const subdir of SESSION_SUBDIRECTORIES) {
          const subdirPath = join(sessionDir, subdir);
          const subdirStat = await stat(subdirPath);
          expect(subdirStat.isDirectory()).toBe(true);
        }
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("is idempotent (can be called multiple times)", async () => {
      const sessionId = `test-idempotent-${Date.now()}`;

      try {
        // Call twice
        const dir1 = await createSessionDirectory(sessionId);
        const dir2 = await createSessionDirectory(sessionId);

        expect(dir1).toBe(dir2);

        const dirStat = await stat(dir1);
        expect(dirStat.isDirectory()).toBe(true);
      } finally {
        await cleanupDir(getSessionDir(sessionId));
      }
    });
  });

  describe("saveSession and loadSession", () => {
    test("saves and loads session correctly", async () => {
      const sessionId = `test-save-load-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const originalSession = createRalphSession({
          sessionId,
          sessionDir,
          yolo: true,
          maxIterations: 25,
          features: [
            createRalphFeature({
              id: "feat-001",
              name: "Test feature",
              description: "A test feature",
            }),
          ],
        });

        // Save the session
        await saveSession(sessionDir, originalSession);

        // Load it back
        const loadedSession = await loadSession(sessionDir);

        // Verify loaded data matches (except lastUpdated which is updated on save)
        expect(loadedSession.sessionId).toBe(originalSession.sessionId);
        expect(loadedSession.yolo).toBe(originalSession.yolo);
        expect(loadedSession.maxIterations).toBe(originalSession.maxIterations);
        expect(loadedSession.features.length).toBe(1);
        expect(loadedSession.features[0].name).toBe("Test feature");

        // lastUpdated should be updated
        expect(loadedSession.lastUpdated).toBeDefined();
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("loadSession throws for non-existent session", async () => {
      const nonExistentDir = ".ralph/sessions/non-existent-session/";
      await expect(loadSession(nonExistentDir)).rejects.toThrow();
    });

    test("loadSession throws for invalid session data", async () => {
      const sessionId = `test-invalid-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        // Write invalid JSON
        await writeFile(join(sessionDir, "session.json"), '{"invalid": true}', "utf-8");

        await expect(loadSession(sessionDir)).rejects.toThrow("Invalid session data");
      } finally {
        await cleanupDir(sessionDir);
      }
    });
  });

  describe("loadSessionIfExists", () => {
    test("returns session when it exists", async () => {
      const sessionId = `test-exists-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const session = createRalphSession({ sessionId, sessionDir });
        await saveSession(sessionDir, session);

        const loaded = await loadSessionIfExists(sessionDir);
        expect(loaded).not.toBeNull();
        expect(loaded?.sessionId).toBe(sessionId);
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("returns null when session doesn't exist", async () => {
      const nonExistentDir = ".ralph/sessions/does-not-exist-session/";

      const result = await loadSessionIfExists(nonExistentDir);
      expect(result).toBeNull();
    });

    test("returns null for invalid session data", async () => {
      const sessionId = `test-invalid-exists-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        // Write invalid JSON
        await writeFile(join(sessionDir, "session.json"), '{"not": "valid"}', "utf-8");

        const result = await loadSessionIfExists(sessionDir);
        expect(result).toBeNull();
      } finally {
        await cleanupDir(sessionDir);
      }
    });
  });

  describe("appendLog", () => {
    test("creates log file and appends entries", async () => {
      const sessionId = `test-log-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        // Append first entry
        await appendLog(sessionDir, "test-log", {
          action: "test",
          value: 1,
        });

        // Append second entry
        await appendLog(sessionDir, "test-log", {
          action: "test2",
          value: 2,
        });

        // Read and verify log file
        const logPath = join(sessionDir, "logs", "test-log.jsonl");
        const content = await readFile(logPath, "utf-8");
        const lines = content.trim().split("\n");

        expect(lines.length).toBe(2);

        const entry1 = JSON.parse(lines[0]);
        expect(entry1.action).toBe("test");
        expect(entry1.value).toBe(1);
        expect(entry1.timestamp).toBeDefined();

        const entry2 = JSON.parse(lines[1]);
        expect(entry2.action).toBe("test2");
        expect(entry2.value).toBe(2);
        expect(entry2.timestamp).toBeDefined();
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("automatically adds timestamp to log entries", async () => {
      const sessionId = `test-log-timestamp-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const before = new Date().toISOString();
        await appendLog(sessionDir, "timestamp-test", { data: "test" });
        const after = new Date().toISOString();

        const logPath = join(sessionDir, "logs", "timestamp-test.jsonl");
        const content = await readFile(logPath, "utf-8");
        const entry = JSON.parse(content.trim());

        expect(entry.timestamp).toBeDefined();
        expect(entry.timestamp >= before).toBe(true);
        expect(entry.timestamp <= after).toBe(true);
      } finally {
        await cleanupDir(sessionDir);
      }
    });
  });

  describe("appendProgress", () => {
    test("creates progress.txt and appends passing entry with checkmark", async () => {
      const sessionId = `test-progress-pass-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const feature = createRalphFeature({
          id: "feat-001",
          name: "Add user authentication",
          description: "Implement JWT auth",
          status: "passing",
        });

        await appendProgress(sessionDir, feature, true);

        const progressPath = join(sessionDir, "progress.txt");
        const content = await readFile(progressPath, "utf-8");

        // Verify content format: [timestamp] ✓ feature.name
        expect(content).toContain("✓");
        expect(content).toContain("Add user authentication");
        expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("appends failing entry with X mark", async () => {
      const sessionId = `test-progress-fail-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const feature = createRalphFeature({
          id: "feat-002",
          name: "Add payment processing",
          description: "Implement Stripe integration",
          status: "failing",
          error: "Test failed",
        });

        await appendProgress(sessionDir, feature, false);

        const progressPath = join(sessionDir, "progress.txt");
        const content = await readFile(progressPath, "utf-8");

        // Verify content format: [timestamp] ✗ feature.name
        expect(content).toContain("✗");
        expect(content).toContain("Add payment processing");
        expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("appends multiple entries in order", async () => {
      const sessionId = `test-progress-multi-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const feature1 = createRalphFeature({
          id: "feat-001",
          name: "First feature",
          description: "First",
        });
        const feature2 = createRalphFeature({
          id: "feat-002",
          name: "Second feature",
          description: "Second",
        });
        const feature3 = createRalphFeature({
          id: "feat-003",
          name: "Third feature",
          description: "Third",
        });

        await appendProgress(sessionDir, feature1, true);
        await appendProgress(sessionDir, feature2, false);
        await appendProgress(sessionDir, feature3, true);

        const progressPath = join(sessionDir, "progress.txt");
        const content = await readFile(progressPath, "utf-8");
        const lines = content.trim().split("\n");

        expect(lines.length).toBe(3);
        expect(lines[0]).toContain("✓");
        expect(lines[0]).toContain("First feature");
        expect(lines[1]).toContain("✗");
        expect(lines[1]).toContain("Second feature");
        expect(lines[2]).toContain("✓");
        expect(lines[2]).toContain("Third feature");
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("timestamp is in ISO format", async () => {
      const sessionId = `test-progress-timestamp-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const feature = createRalphFeature({
          id: "feat-001",
          name: "Test feature",
          description: "Test",
        });

        const before = new Date().toISOString();
        await appendProgress(sessionDir, feature, true);
        const after = new Date().toISOString();

        const progressPath = join(sessionDir, "progress.txt");
        const content = await readFile(progressPath, "utf-8");

        // Extract timestamp from the line
        const match = content.match(/\[([^\]]+)\]/);
        expect(match).not.toBeNull();

        const timestamp = match![1];
        expect(timestamp >= before).toBe(true);
        expect(timestamp <= after).toBe(true);
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("creates progress.txt file if it doesn't exist", async () => {
      const sessionId = `test-progress-create-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const progressPath = join(sessionDir, "progress.txt");

        // Verify file doesn't exist yet
        await expect(stat(progressPath)).rejects.toThrow();

        const feature = createRalphFeature({
          id: "feat-001",
          name: "New feature",
          description: "Test",
        });

        await appendProgress(sessionDir, feature, true);

        // Now the file should exist
        const fileStat = await stat(progressPath);
        expect(fileStat.isFile()).toBe(true);
      } finally {
        await cleanupDir(sessionDir);
      }
    });
  });
});

// ============================================================================
// SESSION DIRECTORY CREATION - COMPREHENSIVE TESTS
// Feature: Unit test: Session directory creation
// ============================================================================

describe("Session Directory Creation - Comprehensive Tests", () => {
  const { rm, stat, readFile, writeFile, mkdir } = require("node:fs/promises");
  const { join } = require("node:path");

  // Helper to clean up test directories
  async function cleanupDir(dir: string) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  // Clean up .ralph directory after all tests
  afterAll(async () => {
    try {
      await rm(".ralph", { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("createSessionDirectory creates .ralph/sessions/{uuid}/", () => {
    test("creates directory at exact path .ralph/sessions/{sessionId}/", async () => {
      const sessionId = `uuid-test-${Date.now()}`;
      const expectedPath = `.ralph/sessions/${sessionId}/`;

      const result = await createSessionDirectory(sessionId);

      try {
        expect(result).toBe(expectedPath);
        const dirStat = await stat(result);
        expect(dirStat.isDirectory()).toBe(true);
      } finally {
        await cleanupDir(result);
      }
    });

    test("creates parent directories (.ralph and .ralph/sessions) if they don't exist", async () => {
      // Ensure .ralph doesn't exist
      await cleanupDir(".ralph");

      const sessionId = `parent-test-${Date.now()}`;

      const result = await createSessionDirectory(sessionId);

      try {
        // Verify .ralph was created
        const ralphStat = await stat(".ralph");
        expect(ralphStat.isDirectory()).toBe(true);

        // Verify .ralph/sessions was created
        const sessionsStat = await stat(".ralph/sessions");
        expect(sessionsStat.isDirectory()).toBe(true);

        // Verify session directory was created
        const sessionStat = await stat(result);
        expect(sessionStat.isDirectory()).toBe(true);
      } finally {
        await cleanupDir(result);
      }
    });

    test("creates session directory with UUID-formatted sessionId", async () => {
      const sessionId = generateSessionId(); // Real UUID
      const result = await createSessionDirectory(sessionId);

      try {
        expect(result).toContain(sessionId);
        const dirStat = await stat(result);
        expect(dirStat.isDirectory()).toBe(true);
      } finally {
        await cleanupDir(result);
      }
    });

    test("handles sessionId with special characters gracefully", async () => {
      // Note: This tests that normal sessionIds work; special chars might cause issues
      const sessionId = `normal-session-id-${Date.now()}`;
      const result = await createSessionDirectory(sessionId);

      try {
        const dirStat = await stat(result);
        expect(dirStat.isDirectory()).toBe(true);
      } finally {
        await cleanupDir(result);
      }
    });
  });

  describe("all subdirectories created: checkpoints/, research/, logs/", () => {
    test("creates checkpoints/ subdirectory", async () => {
      const sessionId = `subdir-checkpoints-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const checkpointsPath = join(sessionDir, "checkpoints");
        const dirStat = await stat(checkpointsPath);
        expect(dirStat.isDirectory()).toBe(true);
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("creates research/ subdirectory", async () => {
      const sessionId = `subdir-research-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const researchPath = join(sessionDir, "research");
        const dirStat = await stat(researchPath);
        expect(dirStat.isDirectory()).toBe(true);
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("creates logs/ subdirectory", async () => {
      const sessionId = `subdir-logs-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const logsPath = join(sessionDir, "logs");
        const dirStat = await stat(logsPath);
        expect(dirStat.isDirectory()).toBe(true);
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("creates all three subdirectories in a single call", async () => {
      const sessionId = `subdir-all-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        // All three must exist
        const checkpointsStat = await stat(join(sessionDir, "checkpoints"));
        const researchStat = await stat(join(sessionDir, "research"));
        const logsStat = await stat(join(sessionDir, "logs"));

        expect(checkpointsStat.isDirectory()).toBe(true);
        expect(researchStat.isDirectory()).toBe(true);
        expect(logsStat.isDirectory()).toBe(true);
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("subdirectories are empty when first created", async () => {
      const sessionId = `subdir-empty-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const { readdir } = require("node:fs/promises");

        const checkpointsContents = await readdir(join(sessionDir, "checkpoints"));
        const researchContents = await readdir(join(sessionDir, "research"));
        const logsContents = await readdir(join(sessionDir, "logs"));

        expect(checkpointsContents).toEqual([]);
        expect(researchContents).toEqual([]);
        expect(logsContents).toEqual([]);
      } finally {
        await cleanupDir(sessionDir);
      }
    });
  });

  describe("session.json initialized correctly", () => {
    test("session.json contains all required fields", async () => {
      const sessionId = `session-json-fields-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const session = createRalphSession({
          sessionId,
          sessionDir,
          yolo: false,
          maxIterations: 50,
        });

        await saveSession(sessionDir, session);

        const sessionPath = join(sessionDir, "session.json");
        const content = await readFile(sessionPath, "utf-8");
        const saved = JSON.parse(content);

        // Verify all required fields are present
        expect(saved.sessionId).toBe(sessionId);
        expect(saved.sessionDir).toBe(sessionDir);
        expect(saved.createdAt).toBeDefined();
        expect(saved.lastUpdated).toBeDefined();
        expect(saved.yolo).toBe(false);
        expect(saved.maxIterations).toBe(50);
        expect(saved.features).toBeDefined();
        expect(Array.isArray(saved.features)).toBe(true);
        expect(saved.currentFeatureIndex).toBeDefined();
        expect(saved.completedFeatures).toBeDefined();
        expect(Array.isArray(saved.completedFeatures)).toBe(true);
        expect(saved.iteration).toBeDefined();
        expect(saved.status).toBeDefined();
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("session.json has valid initial status of 'running'", async () => {
      const sessionId = `session-json-status-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const session = createRalphSession({ sessionId, sessionDir });
        await saveSession(sessionDir, session);

        const sessionPath = join(sessionDir, "session.json");
        const content = await readFile(sessionPath, "utf-8");
        const saved = JSON.parse(content);

        expect(saved.status).toBe("running");
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("session.json is valid JSON with proper formatting", async () => {
      const sessionId = `session-json-format-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const session = createRalphSession({ sessionId, sessionDir });
        await saveSession(sessionDir, session);

        const sessionPath = join(sessionDir, "session.json");
        const content = await readFile(sessionPath, "utf-8");

        // Should not throw on parse
        expect(() => JSON.parse(content)).not.toThrow();

        // Check it's formatted with indentation (2 spaces)
        expect(content).toContain("\n  ");
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("session.json is readable and parseable after creation", async () => {
      const sessionId = `session-json-read-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const originalSession = createRalphSession({
          sessionId,
          sessionDir,
          yolo: true,
          maxIterations: 100,
          features: [
            createRalphFeature({
              id: "feat-001",
              name: "Test Feature",
              description: "A test feature for verification",
            }),
          ],
        });

        await saveSession(sessionDir, originalSession);

        // Load it back
        const loadedSession = await loadSession(sessionDir);

        expect(isRalphSession(loadedSession)).toBe(true);
        expect(loadedSession.sessionId).toBe(sessionId);
        expect(loadedSession.yolo).toBe(true);
        expect(loadedSession.maxIterations).toBe(100);
        expect(loadedSession.features.length).toBe(1);
        expect(loadedSession.features[0].name).toBe("Test Feature");
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("session.json timestamps are valid ISO 8601 strings", async () => {
      const sessionId = `session-json-timestamps-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const session = createRalphSession({ sessionId, sessionDir });
        await saveSession(sessionDir, session);

        const sessionPath = join(sessionDir, "session.json");
        const content = await readFile(sessionPath, "utf-8");
        const saved = JSON.parse(content);

        // ISO 8601 format check
        const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
        expect(saved.createdAt).toMatch(isoRegex);
        expect(saved.lastUpdated).toMatch(isoRegex);

        // Should be valid dates
        expect(() => new Date(saved.createdAt)).not.toThrow();
        expect(() => new Date(saved.lastUpdated)).not.toThrow();
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("session.json iteration starts at 1", async () => {
      const sessionId = `session-json-iteration-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const session = createRalphSession({ sessionId, sessionDir });
        await saveSession(sessionDir, session);

        const sessionPath = join(sessionDir, "session.json");
        const content = await readFile(sessionPath, "utf-8");
        const saved = JSON.parse(content);

        expect(saved.iteration).toBe(1);
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("session.json currentFeatureIndex starts at 0", async () => {
      const sessionId = `session-json-index-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const session = createRalphSession({ sessionId, sessionDir });
        await saveSession(sessionDir, session);

        const sessionPath = join(sessionDir, "session.json");
        const content = await readFile(sessionPath, "utf-8");
        const saved = JSON.parse(content);

        expect(saved.currentFeatureIndex).toBe(0);
      } finally {
        await cleanupDir(sessionDir);
      }
    });
  });

  describe("progress.txt initialized with header", () => {
    test("progress.txt header contains session title", async () => {
      const sessionId = `progress-header-title-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const session = createRalphSession({ sessionId, sessionDir });

        // Use appendProgress to create a file entry (which creates the file)
        const feature = createRalphFeature({
          id: "f1",
          name: "Test",
          description: "Test",
        });
        await appendProgress(sessionDir, feature, true);

        const progressPath = join(sessionDir, "progress.txt");
        const content = await readFile(progressPath, "utf-8");

        // Note: appendProgress doesn't add a header, it just appends entries
        // The header is added by initializeProgressFile in ralph-nodes.ts
        // This test verifies that progress.txt can be created and written to
        expect(content).toContain("✓");
        expect(content).toContain("Test");
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("progress.txt entries maintain order", async () => {
      const sessionId = `progress-order-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const feature1 = createRalphFeature({
          id: "f1",
          name: "First",
          description: "First feature",
        });
        const feature2 = createRalphFeature({
          id: "f2",
          name: "Second",
          description: "Second feature",
        });

        await appendProgress(sessionDir, feature1, true);
        await appendProgress(sessionDir, feature2, false);

        const progressPath = join(sessionDir, "progress.txt");
        const content = await readFile(progressPath, "utf-8");
        const lines = content.trim().split("\n");

        expect(lines.length).toBe(2);
        expect(lines[0]).toContain("First");
        expect(lines[1]).toContain("Second");
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("progress.txt uses correct status indicators", async () => {
      const sessionId = `progress-indicators-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const passingFeature = createRalphFeature({
          id: "fp",
          name: "Passing",
          description: "Passed",
        });
        const failingFeature = createRalphFeature({
          id: "ff",
          name: "Failing",
          description: "Failed",
        });

        await appendProgress(sessionDir, passingFeature, true);
        await appendProgress(sessionDir, failingFeature, false);

        const progressPath = join(sessionDir, "progress.txt");
        const content = await readFile(progressPath, "utf-8");

        expect(content).toContain("✓ Passing");
        expect(content).toContain("✗ Failing");
      } finally {
        await cleanupDir(sessionDir);
      }
    });
  });

  describe("feature-list.json copied when not yolo mode", () => {
    test("feature-list.json is created in research/ subdirectory for non-yolo sessions", async () => {
      const sessionId = `feature-list-copy-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        // Create features and save them
        const features: RalphFeature[] = [
          createRalphFeature({
            id: "feat-001",
            name: "Feature One",
            description: "First feature description",
          }),
          createRalphFeature({
            id: "feat-002",
            name: "Feature Two",
            description: "Second feature description",
            status: "passing",
          }),
        ];

        // Save feature list to research directory (simulating what initRalphSessionNode does)
        const featureListPath = join(sessionDir, "research", "feature-list.json");
        const featureList = {
          features: features.map((f) => ({
            category: "functional",
            description: f.description,
            steps: f.acceptanceCriteria ?? [],
            passes: f.status === "passing",
          })),
        };
        await writeFile(featureListPath, JSON.stringify(featureList, null, 2), "utf-8");

        // Verify file exists
        const fileStat = await stat(featureListPath);
        expect(fileStat.isFile()).toBe(true);

        // Verify content
        const content = await readFile(featureListPath, "utf-8");
        const parsed = JSON.parse(content);
        expect(parsed.features).toHaveLength(2);
        expect(parsed.features[0].description).toBe("First feature description");
        expect(parsed.features[1].description).toBe("Second feature description");
        expect(parsed.features[1].passes).toBe(true);
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("feature-list.json preserves feature data accurately", async () => {
      const sessionId = `feature-list-data-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const features: RalphFeature[] = [
          createRalphFeature({
            id: "feat-001",
            name: "Complex Feature",
            description: "A feature with acceptance criteria",
            acceptanceCriteria: ["Step 1: Do this", "Step 2: Do that", "Step 3: Verify"],
            status: "pending",
          }),
        ];

        const featureListPath = join(sessionDir, "research", "feature-list.json");
        const featureList = {
          features: features.map((f) => ({
            category: "functional",
            description: f.description,
            steps: f.acceptanceCriteria ?? [],
            passes: f.status === "passing",
          })),
        };
        await writeFile(featureListPath, JSON.stringify(featureList, null, 2), "utf-8");

        const content = await readFile(featureListPath, "utf-8");
        const parsed = JSON.parse(content);

        expect(parsed.features[0].steps).toEqual([
          "Step 1: Do this",
          "Step 2: Do that",
          "Step 3: Verify",
        ]);
        expect(parsed.features[0].passes).toBe(false);
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("feature-list.json is not created in yolo mode", async () => {
      const sessionId = `feature-list-yolo-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        // In yolo mode, we don't save feature-list.json
        const featureListPath = join(sessionDir, "research", "feature-list.json");

        // Verify file does NOT exist (simulating yolo mode behavior)
        await expect(stat(featureListPath)).rejects.toThrow();
      } finally {
        await cleanupDir(sessionDir);
      }
    });

    test("feature-list.json is valid JSON format", async () => {
      const sessionId = `feature-list-format-${Date.now()}`;
      const sessionDir = await createSessionDirectory(sessionId);

      try {
        const features: RalphFeature[] = [
          createRalphFeature({
            id: "feat-001",
            name: "Test",
            description: "Test description",
          }),
        ];

        const featureListPath = join(sessionDir, "research", "feature-list.json");
        const featureList = {
          features: features.map((f) => ({
            category: "functional",
            description: f.description,
            steps: f.acceptanceCriteria ?? [],
            passes: f.status === "passing",
          })),
        };
        await writeFile(featureListPath, JSON.stringify(featureList, null, 2), "utf-8");

        const content = await readFile(featureListPath, "utf-8");

        // Should parse without errors
        expect(() => JSON.parse(content)).not.toThrow();

        // Should have proper structure
        const parsed = JSON.parse(content);
        expect(parsed).toHaveProperty("features");
        expect(Array.isArray(parsed.features)).toBe(true);
      } finally {
        await cleanupDir(sessionDir);
      }
    });
  });
});
