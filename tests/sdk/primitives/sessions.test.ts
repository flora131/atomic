import { test, expect, describe } from "bun:test";
import {
  listSessions,
  getSession,
  getSessionStatus,
  getSessionTranscript,
  stopSession,
  attachSession,
  nextWindow,
} from "../../../packages/atomic-sdk/src/primitives/sessions.ts";
import type { SessionPrimitiveDeps } from "../../../packages/atomic-sdk/src/primitives/sessions.ts";
import type { RunInfo } from "../../../packages/atomic-sdk/src/runtime/ui-protocol/schemas.ts";
import type { SavedMessage } from "../../../packages/atomic-sdk/src/types.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const RUN_A: RunInfo = {
  runId: "run-abc-123",
  workflowName: "my-workflow",
  agent: "claude",
  status: "active",
  startedAt: "2024-01-01T00:00:00Z",
};

const RUN_B: RunInfo = {
  runId: "run-def-456",
  workflowName: "other-workflow",
  agent: "copilot",
  status: "completed",
  startedAt: "2024-01-02T00:00:00Z",
  endedAt: "2024-01-02T01:00:00Z",
};

const MOCK_TRANSCRIPT: SavedMessage[] = [
  { role: "user", content: "hello" },
  { role: "assistant", content: "world" },
];

const MOCK_STATUS = {
  overallStatus: "complete" as const,
  stages: [],
};

/** Build a mock deps object with sensible defaults; caller can override per field. */
function makeMockDeps(overrides: Partial<SessionPrimitiveDeps> = {}): SessionPrimitiveDeps {
  return {
    listRuns: async () => [RUN_A, RUN_B],
    getRun: async (runId) => {
      if (runId === RUN_A.runId) return RUN_A;
      if (runId === RUN_B.runId) return RUN_B;
      return null;
    },
    stopRun: async (_runId) => {},
    getRunStatus: async (runId) => {
      if (runId === RUN_A.runId) return MOCK_STATUS;
      return null;
    },
    getRunTranscript: async (runId, _sessionName) => {
      if (runId === RUN_A.runId) return MOCK_TRANSCRIPT;
      return [];
    },
    getAttachInfo: async (runId) => ({
      subscriptionId: `sub-${runId}`,
      foregroundStage: runId === RUN_A.runId ? "stage-1" : null,
    }),
    setForeground: async (_runId, _stageName) => {},
    ...overrides,
  };
}

// ─── listSessions ─────────────────────────────────────────────────────────────

describe("listSessions", () => {
  test("returns an array of SessionInfo entries", async () => {
    const result = await listSessions({}, makeMockDeps());
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });

  test("maps RunInfo fields to SessionInfo correctly", async () => {
    const [first] = await listSessions({}, makeMockDeps());
    expect(first.id).toBe(RUN_A.runId);
    expect(first.type).toBe("workflow");
    expect(first.agent).toBe(RUN_A.agent);
    expect(first.created).toBe(RUN_A.startedAt);
    expect(first.attached).toBe(false);
    expect(first.status).toBe(RUN_A.status);
    expect(first.workflowName).toBe(RUN_A.workflowName);
  });

  test("returns empty array when daemon has no runs", async () => {
    const result = await listSessions({}, makeMockDeps({ listRuns: async () => [] }));
    expect(result).toEqual([]);
  });

  test("filters by agent when options.agent is provided", async () => {
    const result = await listSessions({ agent: "claude" }, makeMockDeps());
    expect(result).toHaveLength(1);
    expect(result[0].agent).toBe("claude");
  });

  test("filters by agent array when multiple agents specified", async () => {
    const result = await listSessions({ agent: ["claude", "copilot"] }, makeMockDeps());
    expect(result).toHaveLength(2);
  });

  test("scope filter 'workflow' returns all (all daemon runs are workflow type)", async () => {
    const result = await listSessions({ scope: "workflow" }, makeMockDeps());
    expect(result).toHaveLength(2);
  });

  test("scope filter 'chat' returns empty (all daemon runs are workflow type)", async () => {
    const result = await listSessions({ scope: "chat" }, makeMockDeps());
    expect(result).toHaveLength(0);
  });
});

// ─── getSession ───────────────────────────────────────────────────────────────

describe("getSession", () => {
  test("returns SessionInfo for a known run id", async () => {
    const result = await getSession(RUN_A.runId, makeMockDeps());
    expect(result).toBeDefined();
    expect(result!.id).toBe(RUN_A.runId);
    expect(result!.workflowName).toBe(RUN_A.workflowName);
  });

  test("returns undefined for a non-existent run id", async () => {
    const result = await getSession("does-not-exist-123", makeMockDeps());
    expect(result).toBeUndefined();
  });

  test("returns SessionInfo for second run", async () => {
    const result = await getSession(RUN_B.runId, makeMockDeps());
    expect(result).toBeDefined();
    expect(result!.id).toBe(RUN_B.runId);
    expect(result!.agent).toBe("copilot");
  });
});

// ─── getSessionStatus ─────────────────────────────────────────────────────────

describe("getSessionStatus", () => {
  test("returns null for an unknown run id", async () => {
    const result = await getSessionStatus("not-a-real-id", makeMockDeps());
    expect(result).toBeNull();
  });

  test("returns status snapshot for a known run id", async () => {
    const result = await getSessionStatus(RUN_A.runId, makeMockDeps());
    expect(result).not.toBeNull();
    expect(result).toEqual(MOCK_STATUS);
  });
});

// ─── getSessionTranscript ─────────────────────────────────────────────────────

describe("getSessionTranscript", () => {
  test("returns empty array for unknown run id", async () => {
    const result = await getSessionTranscript("nope", "stage", makeMockDeps());
    expect(result).toEqual([]);
  });

  test("returns messages for known run id", async () => {
    const result = await getSessionTranscript(RUN_A.runId, "stage-1", makeMockDeps());
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: "user", content: "hello" });
  });

  test("passes sessionName through to deps.getRunTranscript", async () => {
    let capturedSessionName: string | undefined;
    const deps = makeMockDeps({
      getRunTranscript: async (_runId, sessionName) => {
        capturedSessionName = sessionName;
        return [];
      },
    });
    await getSessionTranscript(RUN_A.runId, "my-stage", deps);
    expect(capturedSessionName).toBe("my-stage");
  });
});

// ─── stopSession ──────────────────────────────────────────────────────────────

describe("stopSession", () => {
  test("calls stopRun with the correct run id", async () => {
    let stopped: string | undefined;
    const deps = makeMockDeps({ stopRun: async (runId) => { stopped = runId; } });
    await stopSession(RUN_A.runId, deps);
    expect(stopped).toBe(RUN_A.runId);
  });

  test("does not throw when stopRun rejects (best-effort)", async () => {
    const deps = makeMockDeps({ stopRun: async () => { throw new Error("gone"); } });
    await expect(stopSession("any-id", deps)).resolves.toBeUndefined();
  });
});

// ─── attachSession ────────────────────────────────────────────────────────────

describe("attachSession", () => {
  test("returns subscriptionId and foregroundStage for known run", async () => {
    const result = await attachSession(RUN_A.runId, makeMockDeps());
    expect(result.subscriptionId).toBe(`sub-${RUN_A.runId}`);
    expect(result.foregroundStage).toBe("stage-1");
  });

  test("returns null foregroundStage when not set", async () => {
    const result = await attachSession(RUN_B.runId, makeMockDeps());
    expect(result.foregroundStage).toBeNull();
  });
});

// ─── nextWindow ───────────────────────────────────────────────────────────────

describe("nextWindow", () => {
  test("calls setForeground with undefined stageName", async () => {
    let calledWith: { runId: string; stageName: string | undefined } | undefined;
    const deps = makeMockDeps({
      setForeground: async (runId, stageName) => { calledWith = { runId, stageName }; },
    });
    await nextWindow(RUN_A.runId, deps);
    expect(calledWith).toEqual({ runId: RUN_A.runId, stageName: undefined });
  });
});
