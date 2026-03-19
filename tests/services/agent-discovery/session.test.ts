/**
 * Tests for the active session registry in services/agent-discovery/session.ts
 *
 * These tests verify real in-memory session lifecycle management —
 * no mocks needed since the registry is a pure in-memory Map.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import {
  registerActiveSession,
  getActiveSession,
  completeSession,
  getActiveSessions,
  clearActiveSessions,
} from "@/services/agent-discovery/session.ts";
import type { WorkflowSession } from "@/services/workflows/session.ts";

function createTestSession(overrides: Partial<WorkflowSession> = {}): WorkflowSession {
  return {
    sessionId: overrides.sessionId ?? crypto.randomUUID(),
    workflowName: overrides.workflowName ?? "test-workflow",
    sessionDir: overrides.sessionDir ?? "/tmp/test-session",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    lastUpdated: overrides.lastUpdated ?? new Date().toISOString(),
    status: overrides.status ?? "running",
    nodeHistory: overrides.nodeHistory ?? [],
    outputs: overrides.outputs ?? {},
  };
}

describe("session registry", () => {
  beforeEach(() => {
    clearActiveSessions();
  });

  describe("registerActiveSession", () => {
    test("registers a session that can be retrieved", () => {
      const session = createTestSession();
      registerActiveSession(session);

      const active = getActiveSession();
      expect(active).toBeDefined();
      expect(active!.sessionId).toBe(session.sessionId);
    });

    test("replaces a session with the same sessionId", () => {
      const sessionId = "fixed-id";
      const first = createTestSession({ sessionId, workflowName: "first" });
      const second = createTestSession({ sessionId, workflowName: "second" });

      registerActiveSession(first);
      registerActiveSession(second);

      const sessions = getActiveSessions();
      expect(sessions.size).toBe(1);
      expect(sessions.get(sessionId)!.workflowName).toBe("second");
    });

    test("allows multiple sessions with different ids", () => {
      const a = createTestSession({ sessionId: "a" });
      const b = createTestSession({ sessionId: "b" });

      registerActiveSession(a);
      registerActiveSession(b);

      expect(getActiveSessions().size).toBe(2);
    });
  });

  describe("getActiveSession", () => {
    test("returns undefined when no sessions are registered", () => {
      expect(getActiveSession()).toBeUndefined();
    });

    test("returns the most recently created session", () => {
      const older = createTestSession({
        sessionId: "older",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const newer = createTestSession({
        sessionId: "newer",
        createdAt: "2026-03-01T00:00:00.000Z",
      });

      registerActiveSession(older);
      registerActiveSession(newer);

      const active = getActiveSession();
      expect(active!.sessionId).toBe("newer");
    });

    test("returns the most recent even if registered in reverse order", () => {
      const newer = createTestSession({
        sessionId: "newer",
        createdAt: "2026-03-01T00:00:00.000Z",
      });
      const older = createTestSession({
        sessionId: "older",
        createdAt: "2026-01-01T00:00:00.000Z",
      });

      registerActiveSession(newer);
      registerActiveSession(older);

      expect(getActiveSession()!.sessionId).toBe("newer");
    });
  });

  describe("completeSession", () => {
    test("removes a registered session by id", () => {
      const session = createTestSession({ sessionId: "to-remove" });
      registerActiveSession(session);
      expect(getActiveSessions().size).toBe(1);

      completeSession("to-remove");
      expect(getActiveSessions().size).toBe(0);
    });

    test("is a no-op for an unknown session id", () => {
      const session = createTestSession({ sessionId: "keep" });
      registerActiveSession(session);

      completeSession("nonexistent");
      expect(getActiveSessions().size).toBe(1);
    });

    test("getActiveSession returns next session after removal", () => {
      const a = createTestSession({
        sessionId: "a",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const b = createTestSession({
        sessionId: "b",
        createdAt: "2026-02-01T00:00:00.000Z",
      });

      registerActiveSession(a);
      registerActiveSession(b);

      completeSession("b");
      expect(getActiveSession()!.sessionId).toBe("a");
    });
  });

  describe("clearActiveSessions", () => {
    test("removes all sessions", () => {
      registerActiveSession(createTestSession({ sessionId: "x" }));
      registerActiveSession(createTestSession({ sessionId: "y" }));
      expect(getActiveSessions().size).toBe(2);

      clearActiveSessions();
      expect(getActiveSessions().size).toBe(0);
      expect(getActiveSession()).toBeUndefined();
    });
  });

  describe("getActiveSessions", () => {
    test("returns a read-only map of all sessions", () => {
      const session = createTestSession({ sessionId: "s1" });
      registerActiveSession(session);

      const map = getActiveSessions();
      expect(map.size).toBe(1);
      expect(map.get("s1")).toBeDefined();
      expect(map.get("s1")!.workflowName).toBe(session.workflowName);
    });
  });
});
