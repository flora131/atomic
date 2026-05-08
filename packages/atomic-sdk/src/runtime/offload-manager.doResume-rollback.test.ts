/**
 * doResume rollback-discipline tests — R2 implementation (RFC §5.2.3, §8.4).
 *
 * Group 1 (task #9): R2 rollback fires when waitForReady throws RESUME_TIMEOUT.
 * Group 2 (task #1): Rollback failure emits WORKFLOW_OFFLOAD_RESUME_ROLLBACK_FAILED
 *                    while preserving the original error in WORKFLOW_OFFLOAD_RESUME_FAILED.
 */

import { test, expect, describe, mock } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOffloadManager } from "./offload-manager.ts";
import type { OffloadManagerDeps } from "./offload-manager.ts";
import type { MetadataJsonWithResume } from "./offload-types.ts";
import type { SessionData } from "../components/orchestrator-panel-types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_717_804_800_000;
const TMUX_SESSION = "atomic-wf-claude-resume-test";

const IMMUTABLES: Omit<MetadataJsonWithResume, "resume"> = {
  name: "review",
  description: "Review stage",
  agent: "claude" as const,
  paneId: "%5",
  serverUrl: "",
  port: 0,
  startedAt: new Date(FIXED_NOW).toISOString(),
};

function makeStageDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "offload-rollback-"));
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({ ...IMMUTABLES } satisfies Omit<MetadataJsonWithResume, "resume">, null, 2),
    { mode: 0o600 },
  );
  return dir;
}

// ---------------------------------------------------------------------------
// Mock-deps factory
// ---------------------------------------------------------------------------

type EmitCall = { event: string; payload: Record<string, unknown> };

interface MutablePanelStore {
  sessions: SessionData[];
  activeAgentId: string;
  setSessionStatus: ReturnType<typeof mock>;
}

function makeDeps(stageDirOverride?: string): {
  deps: OffloadManagerDeps;
  panelStore: MutablePanelStore;
  emitCalls: EmitCall[];
  stageDir: string;
} {
  const emitCalls: EmitCall[] = [];
  const stageDir = stageDirOverride ?? makeStageDir();

  const panelStore: MutablePanelStore = {
    sessions: [],
    activeAgentId: "",
    setSessionStatus: mock(() => {}),
  };

  const deps: OffloadManagerDeps = {
    panelStore: panelStore as unknown as OffloadManagerDeps["panelStore"],
    tmux: {
      killWindow: mock(async () => {}),
      createWindow: mock(async () => {}),
      selectWindow: mock(async () => {}),
    },
    providers: {
      claude:   { buildResumeArgs: mock(() => ["--resume", "sess-abc"]) },
      opencode: { buildResumeArgs: mock(() => ["--session", "sess-abc"]) },
      copilot:  { buildResumeArgs: mock(() => ["--session", "sess-abc"]) },
    },
    hookSettingsPath: mock(() => "/tmp/hook-settings.json"),
    shellQuote: mock((argv: readonly string[]) => argv.join(" ")),
    waitForReady: mock(async () => {}),
    now: mock(() => FIXED_NOW),
    emit: mock((event: string, payload: Record<string, unknown>) => {
      emitCalls.push({ event, payload });
    }),
  };

  return { deps, panelStore, emitCalls, stageDir };
}

function makeSessionInput(name: string, stageDir: string) {
  return {
    name,
    runId: "run-1",
    stageDir,
    agent: "claude" as const,
    agentSessionId: "sess-abc",
    tmuxSession: TMUX_SESSION,
    tmuxWindow: name,
    spawnEnv: { CLAUDECODE: "1" },
    spawnCwd: "/home/user/project",
    headless: false,
    chatFlags: [],
  };
}

/**
 * Drive a session from "alive" → "offloaded" via public API,
 * returning the manager ready for resume testing.
 */
async function setupOffloaded(
  name: string,
  deps: OffloadManagerDeps,
  panelStore: MutablePanelStore,
  stageDir: string,
) {
  panelStore.sessions = [
    { name, status: "complete", parents: [], startedAt: null, endedAt: null },
  ];
  const mgr = createOffloadManager(deps);
  await mgr.registerSession(makeSessionInput(name, stageDir));
  await mgr.onWorkflowCompletion();
  expect(mgr.getStatus(name)).toBe("offloaded");
  return mgr;
}

// ---------------------------------------------------------------------------
// Group 1 (task #9) — R2 rollback fires when waitForReady throws
// ---------------------------------------------------------------------------

describe("doResume: R2 rollback on waitForReady failure (task #9)", () => {
  test(
    "waitForReady throws RESUME_TIMEOUT_CLAUDE → killWindow called once, status offloaded, RESUME_FAILED emitted",
    async () => {
      const { deps, panelStore, emitCalls, stageDir } = makeDeps();

      // Stub waitForReady to throw after createWindow resolves.
      deps.waitForReady = mock(
        async (_agent: string, _agentSessionId: string, _paneId: string) => {
          throw new Error("RESUME_TIMEOUT_CLAUDE");
        },
      ) as unknown as OffloadManagerDeps["waitForReady"];

      const mgr = await setupOffloaded("review", deps, panelStore, stageDir);
      emitCalls.length = 0;
      (panelStore.setSessionStatus as ReturnType<typeof mock>).mockClear();
      (deps.tmux.killWindow as ReturnType<typeof mock>).mockClear();

      let thrownErr: unknown;
      try {
        await mgr.requestResume("review");
      } catch (e) {
        thrownErr = e;
      }

      // requestResume rethrows — error propagates.
      expect(thrownErr).toBeInstanceOf(Error);
      expect((thrownErr as Error).message).toBe("RESUME_TIMEOUT_CLAUDE");

      // createWindow was called once (before waitForReady).
      expect(deps.tmux.createWindow).toHaveBeenCalledTimes(1);
      const firstCall = ((deps.tmux.createWindow as ReturnType<typeof mock>).mock.calls as [string, string, ...unknown[]][])[0]!;
      const [cwSession, cwWindow] = firstCall;
      expect(cwSession).toBe(TMUX_SESSION);
      expect(cwWindow).toBe("review");

      // R2 rollback: killWindow called exactly once with matching session+window.
      expect(deps.tmux.killWindow).toHaveBeenCalledTimes(1);
      expect(deps.tmux.killWindow).toHaveBeenCalledWith(TMUX_SESSION, "review");

      // Final state: rolled back to offloaded.
      expect(mgr.getStatus("review")).toBe("offloaded");

      // WORKFLOW_OFFLOAD_RESUME_FAILED emitted with correct error and errorCode.
      const failedEvent = emitCalls.find((c) => c.event === "workflow.offload.resume.failed");
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.payload.errorCode).toBe("RESUME_TIMEOUT");
      expect(failedEvent!.payload.error).toBe("RESUME_TIMEOUT_CLAUDE");
      expect(failedEvent!.payload.name).toBe("review");

      // WORKFLOW_OFFLOAD_RESUME_ROLLBACK_FAILED must NOT be emitted (rollback succeeded).
      const rollbackFailed = emitCalls.find(
        (c) => c.event === "workflow.offload.resume.rollback_failed",
      );
      expect(rollbackFailed).toBeUndefined();
    },
  );
});

// ---------------------------------------------------------------------------
// Group 2 (task #1) — Rollback failure telemetry
// ---------------------------------------------------------------------------

describe("doResume: rollback failure telemetry (task #1)", () => {
  test(
    "waitForReady throws RESUME_TIMEOUT_CLAUDE AND killWindow throws → ROLLBACK_FAILED emitted, " +
    "original error preserved in RESUME_FAILED, status offloaded",
    async () => {
      const { deps, panelStore, emitCalls, stageDir } = makeDeps();

      // waitForReady throws the primary error.
      deps.waitForReady = mock(
        async (_agent: string, _agentSessionId: string, _paneId: string) => {
          throw new Error("RESUME_TIMEOUT_CLAUDE");
        },
      ) as unknown as OffloadManagerDeps["waitForReady"];

      const mgr = await setupOffloaded("review", deps, panelStore, stageDir);
      emitCalls.length = 0;
      (panelStore.setSessionStatus as ReturnType<typeof mock>).mockClear();
      (deps.tmux.killWindow as ReturnType<typeof mock>).mockClear();

      // killWindow also throws during rollback.
      deps.tmux.killWindow = mock(async () => {
        throw new Error("KILL_WINDOW_FAILED");
      }) as unknown as OffloadManagerDeps["tmux"]["killWindow"];

      let thrownErr: unknown;
      try {
        await mgr.requestResume("review");
      } catch (e) {
        thrownErr = e;
      }

      // requestResume rethrows the ORIGINAL error, not the rollback error.
      expect(thrownErr).toBeInstanceOf(Error);
      expect((thrownErr as Error).message).toBe("RESUME_TIMEOUT_CLAUDE");

      // WORKFLOW_OFFLOAD_RESUME_FAILED: error field is the ORIGINAL error.
      const failedEvent = emitCalls.find((c) => c.event === "workflow.offload.resume.failed");
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.payload.error).toBe("RESUME_TIMEOUT_CLAUDE");
      expect(failedEvent!.payload.errorCode).toBe("RESUME_TIMEOUT");

      // WORKFLOW_OFFLOAD_RESUME_ROLLBACK_FAILED also emitted with the rollback error.
      const rollbackFailed = emitCalls.find(
        (c) => c.event === "workflow.offload.resume.rollback_failed",
      );
      expect(rollbackFailed).toBeDefined();
      expect(rollbackFailed!.payload.error).toBe("KILL_WINDOW_FAILED");

      // Final state: rolled back to offloaded even when rollback itself failed.
      expect(mgr.getStatus("review")).toBe("offloaded");
    },
  );
});
