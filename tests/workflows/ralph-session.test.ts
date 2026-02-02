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

import { describe, test, expect } from "bun:test";
import {
  generateSessionId,
  getSessionDir,
  createRalphSession,
  createRalphFeature,
  isRalphFeature,
  isRalphSession,
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
