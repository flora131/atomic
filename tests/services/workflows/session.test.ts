import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { homedir } from "os";
import { rm } from "fs/promises";
import {
  generateWorkflowSessionId,
  getWorkflowSessionDir,
  initWorkflowSession,
  saveWorkflowSession,
  WORKFLOW_SESSIONS_DIR,
  type WorkflowSession,
} from "@/services/workflows/session.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("WORKFLOW_SESSIONS_DIR", () => {
  test("is a string path under the user home directory", () => {
    expect(typeof WORKFLOW_SESSIONS_DIR).toBe("string");
    expect(WORKFLOW_SESSIONS_DIR.startsWith(homedir())).toBe(true);
  });

  test("ends with the expected directory structure", () => {
    const expected = join(homedir(), ".atomic", "sessions", "workflows");
    expect(WORKFLOW_SESSIONS_DIR).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// generateWorkflowSessionId
// ---------------------------------------------------------------------------

describe("generateWorkflowSessionId", () => {
  test("returns a valid UUID v4 string", () => {
    const id = generateWorkflowSessionId();
    expect(typeof id).toBe("string");
    // UUID v4 format: 8-4-4-4-12 hex digits
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("generates unique IDs on successive calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateWorkflowSessionId());
    }
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// getWorkflowSessionDir
// ---------------------------------------------------------------------------

describe("getWorkflowSessionDir", () => {
  test("returns path under WORKFLOW_SESSIONS_DIR with workflow name and session ID", () => {
    const dir = getWorkflowSessionDir("ralph", "session-123");
    expect(dir).toBe(join(WORKFLOW_SESSIONS_DIR, "ralph", "session-123"));
  });

  test("handles hyphenated workflow names", () => {
    const dir = getWorkflowSessionDir("my-custom-workflow", "abc-def");
    expect(dir).toBe(
      join(WORKFLOW_SESSIONS_DIR, "my-custom-workflow", "abc-def"),
    );
  });

  test("handles UUID-style session IDs", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const dir = getWorkflowSessionDir("test", uuid);
    expect(dir).toBe(join(WORKFLOW_SESSIONS_DIR, "test", uuid));
  });
});

// ---------------------------------------------------------------------------
// initWorkflowSession
// ---------------------------------------------------------------------------

describe("initWorkflowSession", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors.
      }
    }
    cleanupDirs.length = 0;
  });

  test("creates a session with provided session ID", async () => {
    const sessionId = `test-session-${Date.now()}`;
    const session = await initWorkflowSession("test-init", sessionId);
    cleanupDirs.push(session.sessionDir);

    expect(session.sessionId).toBe(sessionId);
    expect(session.workflowName).toBe("test-init");
    expect(session.status).toBe("running");
    expect(session.nodeHistory).toEqual([]);
    expect(session.outputs).toEqual({});
  });

  test("generates a session ID when none is provided", async () => {
    const session = await initWorkflowSession("test-auto-id");
    cleanupDirs.push(session.sessionDir);

    // Should be a UUID v4
    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("creates session directory with subdirectories", async () => {
    const sessionId = `test-dirs-${Date.now()}`;
    const session = await initWorkflowSession("test-dirs", sessionId);
    cleanupDirs.push(session.sessionDir);

    const sessionDir = session.sessionDir;
    expect(sessionDir).toBe(
      getWorkflowSessionDir("test-dirs", sessionId),
    );

    // Verify directory structure exists by checking for .gitkeep files
    const gitkeep = await Bun.file(join(sessionDir, ".gitkeep")).exists();
    expect(gitkeep).toBe(true);

    for (const subdir of ["checkpoints", "agents", "logs"]) {
      const subdirGitkeep = await Bun.file(
        join(sessionDir, subdir, ".gitkeep"),
      ).exists();
      expect(subdirGitkeep).toBe(true);
    }
  });

  test("writes session.json to session directory", async () => {
    const sessionId = `test-json-${Date.now()}`;
    const session = await initWorkflowSession("test-json", sessionId);
    cleanupDirs.push(session.sessionDir);

    const sessionFile = Bun.file(join(session.sessionDir, "session.json"));
    expect(await sessionFile.exists()).toBe(true);

    const savedSession = JSON.parse(await sessionFile.text());
    expect(savedSession.sessionId).toBe(sessionId);
    expect(savedSession.workflowName).toBe("test-json");
    expect(savedSession.status).toBe("running");
  });

  test("sets createdAt and lastUpdated to ISO date strings", async () => {
    const beforeTime = new Date().toISOString();
    const session = await initWorkflowSession("test-dates");
    cleanupDirs.push(session.sessionDir);
    const afterTime = new Date().toISOString();

    expect(session.createdAt).toBeDefined();
    expect(session.lastUpdated).toBeDefined();
    // Validate ISO format
    expect(new Date(session.createdAt).toISOString()).toBe(session.createdAt);
    expect(new Date(session.lastUpdated).toISOString()).toBe(
      session.lastUpdated,
    );
    // Should be within our time bounds
    expect(session.createdAt >= beforeTime).toBe(true);
    expect(session.lastUpdated <= afterTime).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// saveWorkflowSession
// ---------------------------------------------------------------------------

describe("saveWorkflowSession", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors.
      }
    }
    cleanupDirs.length = 0;
  });

  test("updates lastUpdated timestamp on save", async () => {
    const session = await initWorkflowSession("test-save");
    cleanupDirs.push(session.sessionDir);

    const originalLastUpdated = session.lastUpdated;

    // Wait a small amount to ensure time difference
    await new Promise((resolve) => setTimeout(resolve, 10));

    session.status = "completed";
    await saveWorkflowSession(session);

    // lastUpdated should be mutated on the session object
    expect(session.lastUpdated).not.toBe(originalLastUpdated);

    // Read back from disk to verify persistence
    const savedSession = JSON.parse(
      await Bun.file(join(session.sessionDir, "session.json")).text(),
    );
    expect(savedSession.status).toBe("completed");
    expect(savedSession.lastUpdated).toBe(session.lastUpdated);
  });

  test("persists node history and outputs", async () => {
    const session = await initWorkflowSession("test-persist");
    cleanupDirs.push(session.sessionDir);

    session.nodeHistory.push("start", "process", "end");
    session.outputs = { result: "success", count: 42 };
    await saveWorkflowSession(session);

    const savedSession = JSON.parse(
      await Bun.file(join(session.sessionDir, "session.json")).text(),
    );
    expect(savedSession.nodeHistory).toEqual(["start", "process", "end"]);
    expect(savedSession.outputs).toEqual({ result: "success", count: 42 });
  });

  test("overwrites previous session.json on subsequent saves", async () => {
    const session = await initWorkflowSession("test-overwrite");
    cleanupDirs.push(session.sessionDir);

    session.status = "paused";
    await saveWorkflowSession(session);

    session.status = "completed";
    await saveWorkflowSession(session);

    const savedSession = JSON.parse(
      await Bun.file(join(session.sessionDir, "session.json")).text(),
    );
    expect(savedSession.status).toBe("completed");
  });
});
