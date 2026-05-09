/**
 * State-transition integration tests for OffloadManager bodies.
 * Spec: specs/2026-05-08-workflow-pane-offload-and-resume.md §8.3
 *
 * Tests: onWorkflowCompletion (skip headless, skip active, skip non-complete,
 * happy path, idempotency) + requestResume (unknown, alive, happy path,
 * schema mismatch, createWindow failure).
 */

import { test, expect, describe, mock } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
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
const TMUX_SESSION = "atomic-wf-claude-test-1";

const IMMUTABLES: Omit<MetadataJsonWithResume, "resume"> = {
  name: "review",
  description: "Review stage",
  agent: "claude" as const,
  paneId: "%7",
  serverUrl: "",
  port: 0,
  startedAt: new Date(FIXED_NOW).toISOString(),
};

function makeStageDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "offload-bodies-"));
  // RFC §8.3: fixtures must NOT pre-populate metadata.json#resume.
  // registerSession seeds the resume block; makeStageDir only writes immutables.
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify(
      { ...IMMUTABLES } satisfies Omit<MetadataJsonWithResume, "resume">,
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return dir;
}

function readMetadata(stageDir: string): MetadataJsonWithResume {
  return JSON.parse(readFileSync(join(stageDir, "metadata.json"), "utf8")) as MetadataJsonWithResume;
}

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

type EmitCall = { event: string; payload: Record<string, unknown> };

/** Mutable panel-store backing state that `OffloadManagerDeps.panelStore` reads from. */
interface MutablePanelStore {
  sessions: SessionData[];
  activeAgentId: string;
  setSessionStatus: ReturnType<typeof mock>;
}

interface TestContext {
  deps: OffloadManagerDeps;
  panelStore: MutablePanelStore;
  emitCalls: EmitCall[];
  stageDir: string;
}

function makeTestDeps(stageDirOverride?: string): TestContext {
  const emitCalls: EmitCall[] = [];
  const stageDir = stageDirOverride ?? makeStageDir();

  // Mutable backing store — tests mutate this; OffloadManagerDeps reads from it.
  const panelStore: MutablePanelStore = {
    sessions: [],
    activeAgentId: "",
    setSessionStatus: mock(() => {}),
  };

  const deps: OffloadManagerDeps = {
    // Cast to satisfy the readonly interface; tests mutate via panelStore ref.
    panelStore: panelStore as unknown as OffloadManagerDeps["panelStore"],
    tmux: {
      killWindow: mock(async () => {}),
      createWindow: mock(async () => {}),
      selectWindow: mock(async () => {}),
    },
    providers: {
      claude: { buildResumeArgs: mock(() => ["--resume", "sess-abc"]) },
      opencode: { buildResumeArgs: mock(() => ["--session", "sess-abc"]) },
      copilot: { buildResumeArgs: mock(() => ["--session", "sess-abc"]) },
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

function makeSessionInput(name: string, stageDir: string, overrides: Partial<{
  headless: boolean;
  agent: "claude" | "opencode" | "copilot";
  chatFlags: string[];
}> = {}) {
  return {
    name,
    runId: "run-1",
    stageDir,
    agent: overrides.agent ?? ("claude" as const),
    agentSessionId: "sess-abc",
    tmuxSession: TMUX_SESSION,
    tmuxWindow: name,
    spawnEnv: { CLAUDECODE: "1" },
    spawnCwd: "/home/user/project",
    headless: overrides.headless ?? false,
    chatFlags: overrides.chatFlags ?? [],
  };
}

// ---------------------------------------------------------------------------
// 1. onWorkflowCompletion skips headless sessions
// ---------------------------------------------------------------------------

describe("onWorkflowCompletion: filter logic", () => {
  test("skips headless session — no kill, no WORKFLOW_OFFLOAD_COMPLETED", async () => {
    const { deps, panelStore, emitCalls, stageDir } = makeTestDeps();
    // panelStore has a matching "complete" entry so eligibility would pass but for headless flag
    panelStore.sessions = [{ name: "review", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir, { headless: true }));

    await mgr.onWorkflowCompletion();

    expect(deps.tmux.killWindow).not.toHaveBeenCalled();
    expect(panelStore.setSessionStatus).not.toHaveBeenCalledWith("review", "offloaded");
    expect(emitCalls.some((c) => c.event === "workflow.offload.completed")).toBe(false);
    // SCHEDULED may emit with count:0
    const scheduled = emitCalls.find((c) => c.event === "workflow.offload.scheduled");
    if (scheduled !== undefined) {
      expect(scheduled.payload.count).toBe(0);
    }
  });

  // ---------------------------------------------------------------------------
  // 2. onWorkflowCompletion skips the user's currently-focused pane
  //
  // Chrome-tab semantics: never offload the pane the user is reading. They
  // must navigate away before the focus poller fires offloadSession, or
  // workflow teardown reaps the pane. Single-stage workflows offload only
  // after the user returns to the orchestrator window.
  // ---------------------------------------------------------------------------

  test("skips focused session (panelStore.activeAgentId matches name)", async () => {
    const { deps, panelStore, stageDir } = makeTestDeps();
    panelStore.activeAgentId = "review";
    panelStore.sessions = [{ name: "review", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir));

    await mgr.onWorkflowCompletion();

    expect(deps.tmux.killWindow).not.toHaveBeenCalled();
    expect(panelStore.setSessionStatus).not.toHaveBeenCalledWith("review", "offloaded");
  });

  test("offloadSession skips focused session", async () => {
    const { deps, panelStore, stageDir } = makeTestDeps();
    panelStore.activeAgentId = "review";
    panelStore.sessions = [{ name: "review", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir));

    await mgr.offloadSession("review");

    expect(deps.tmux.killWindow).not.toHaveBeenCalled();
    expect(mgr.getStatus("review")).toBe("alive");
  });

  test("offloadSession offloads after user navigates away (activeAgentId changes)", async () => {
    const { deps, panelStore, stageDir } = makeTestDeps();
    panelStore.activeAgentId = "review";
    panelStore.sessions = [{ name: "review", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir));

    // First call: user is still on the pane → skipped.
    await mgr.offloadSession("review");
    expect(deps.tmux.killWindow).not.toHaveBeenCalled();

    // User navigates away — focus poller updates activeAgentId.
    panelStore.activeAgentId = "";

    // Second call: pane now eligible → offloaded.
    await mgr.offloadSession("review");
    expect(deps.tmux.killWindow).toHaveBeenCalledTimes(1);
    expect(mgr.getStatus("review")).toBe("offloaded");
  });

  // ---------------------------------------------------------------------------
  // 3. onWorkflowCompletion skips sessions with non-complete panel status
  // ---------------------------------------------------------------------------

  test("skips session with panelStore status !== 'complete'", async () => {
    const { deps, panelStore, stageDir } = makeTestDeps();
    panelStore.sessions = [{ name: "review", status: "running", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir));

    await mgr.onWorkflowCompletion();

    expect(deps.tmux.killWindow).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 4. onWorkflowCompletion happy path — eligible session is offloaded
  // ---------------------------------------------------------------------------

  test("offloads eligible session: killWindow + setSessionStatus('offloaded') + WORKFLOW_OFFLOAD_COMPLETED emitted", async () => {
    const { deps, panelStore, emitCalls, stageDir } = makeTestDeps();
    panelStore.sessions = [{ name: "review", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir));

    await mgr.onWorkflowCompletion();

    // tmux.killWindow called exactly once with correct session+window
    expect(deps.tmux.killWindow).toHaveBeenCalledTimes(1);
    expect(deps.tmux.killWindow).toHaveBeenCalledWith(TMUX_SESSION, "review");

    // status updated to offloaded
    expect(panelStore.setSessionStatus).toHaveBeenCalledWith("review", "offloaded");

    // WORKFLOW_OFFLOAD_COMPLETED emitted with correct payload
    const completed = emitCalls.find((c) => c.event === "workflow.offload.completed");
    expect(completed).toBeDefined();
    expect(completed?.payload.runId).toBe("run-1");
    expect(completed?.payload.name).toBe("review");
    expect(completed?.payload.agent).toBe("claude");

    // internal state is offloaded
    expect(mgr.getStatus("review")).toBe("offloaded");

    // metadata.json has offloadedAt set to the value returned by deps.now()
    const meta = readMetadata(stageDir);
    expect(typeof meta.resume?.offloadedAt).toBe("number");
    expect(meta.resume?.offloadedAt).toBe(FIXED_NOW);
  });

  // ---------------------------------------------------------------------------
  // 5. onWorkflowCompletion idempotency — calling twice doesn't double-kill
  // ---------------------------------------------------------------------------

  test("idempotent: two concurrent onWorkflowCompletion calls kill pane exactly once", async () => {
    const { deps, panelStore, stageDir } = makeTestDeps();
    panelStore.sessions = [{ name: "review", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir));

    // Fire both concurrently — getOrStartOp should dedup
    await Promise.all([mgr.onWorkflowCompletion(), mgr.onWorkflowCompletion()]);

    expect(deps.tmux.killWindow).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 5b. offloadSession — per-stage offload triggered as each stage completes
// ---------------------------------------------------------------------------

describe("offloadSession: per-stage offload", () => {
  test("offloads a single completed stage immediately", async () => {
    const { deps, panelStore, stageDir } = makeTestDeps();
    panelStore.sessions = [{ name: "describe", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("describe", stageDir));

    await mgr.offloadSession("describe");

    expect(deps.tmux.killWindow).toHaveBeenCalledTimes(1);
    expect(deps.tmux.killWindow).toHaveBeenCalledWith(TMUX_SESSION, "describe");
    expect(panelStore.setSessionStatus).toHaveBeenCalledWith("describe", "offloaded");
    expect(mgr.getStatus("describe")).toBe("offloaded");
  });

  test("no-op for unknown session", async () => {
    const { deps } = makeTestDeps();
    const mgr = createOffloadManager(deps);
    await mgr.offloadSession("does-not-exist");
    expect(deps.tmux.killWindow).not.toHaveBeenCalled();
  });

  test("no-op for headless session", async () => {
    const { deps, panelStore, stageDir } = makeTestDeps();
    panelStore.sessions = [{ name: "bg", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("bg", stageDir, { headless: true }));

    await mgr.offloadSession("bg");

    expect(deps.tmux.killWindow).not.toHaveBeenCalled();
  });

  test("no-op when already offloaded (idempotent)", async () => {
    const { deps, panelStore, stageDir } = makeTestDeps();
    panelStore.sessions = [{ name: "describe", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("describe", stageDir));

    await mgr.offloadSession("describe");
    await mgr.offloadSession("describe");

    expect(deps.tmux.killWindow).toHaveBeenCalledTimes(1);
  });

  test("subsequent onWorkflowCompletion skips already-offloaded sessions", async () => {
    const { deps, panelStore, stageDir } = makeTestDeps();
    panelStore.sessions = [{ name: "describe", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("describe", stageDir));

    await mgr.offloadSession("describe");
    await mgr.onWorkflowCompletion();

    // Killed exactly once across both calls.
    expect(deps.tmux.killWindow).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. requestResume returns early when session is unknown
// ---------------------------------------------------------------------------

describe("requestResume: guard conditions", () => {
  test("no-op for unknown session name", async () => {
    const { deps, emitCalls } = makeTestDeps();
    const mgr = createOffloadManager(deps);

    const result = await mgr.requestResume("missing");

    expect(result).toBeUndefined();
    expect(emitCalls).toHaveLength(0);
    expect(deps.tmux.createWindow).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 7. requestResume returns early when state is alive
  // ---------------------------------------------------------------------------

  test("no-op when session state is alive", async () => {
    const { deps, emitCalls, stageDir } = makeTestDeps();
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir));

    // Clear emits from registration before checking resume behavior.
    emitCalls.length = 0;

    const result = await mgr.requestResume("review");

    expect(result).toBeUndefined();
    // No resume-related events emitted.
    expect(emitCalls.every((c) => !c.event.includes("resume"))).toBe(true);
    expect(deps.tmux.createWindow).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. requestResume happy path — resumes offloaded session
// ---------------------------------------------------------------------------

describe("requestResume: happy path", () => {
  test("resumes offloaded session: createWindow + selectWindow + status complete + RESUME_SUCCEEDED", async () => {
    const { deps, panelStore, emitCalls, stageDir } = makeTestDeps();
    panelStore.sessions = [{ name: "review", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir));

    // Offload first via public API
    await mgr.onWorkflowCompletion();
    expect(mgr.getStatus("review")).toBe("offloaded");

    // Clear call tracking for resume assertions
    emitCalls.length = 0;

    await mgr.requestResume("review");

    // createWindow called with 5 args: session, window, command, cwd, envVars
    expect(deps.tmux.createWindow).toHaveBeenCalledTimes(1);
    const [session, window, command, cwd, envVars] = (deps.tmux.createWindow as ReturnType<typeof mock>).mock.calls[0] as [string, string, string, string, Record<string, string>];
    expect(session).toBe(TMUX_SESSION);
    expect(window).toBe("review");
    // command is shellQuote(["claude", "--resume", "sess-abc"]) — mock joins with space
    expect(command).toBe("claude --resume sess-abc");
    expect(cwd).toBe("/home/user/project");
    // envVars is the in-memory (unfiltered) spawnEnv
    expect(envVars).toEqual({ CLAUDECODE: "1" });

    // waitForReady awaited before selectWindow (3rd arg is tmux target paneId)
    expect(deps.waitForReady).toHaveBeenCalledWith("claude", "sess-abc", `${TMUX_SESSION}:review`);

    // selectWindow called
    expect(deps.tmux.selectWindow).toHaveBeenCalledWith(TMUX_SESSION, "review");

    // panel status set to complete
    expect(panelStore.setSessionStatus).toHaveBeenCalledWith("review", "complete");

    // RESUME_SUCCEEDED emitted
    const succeeded = emitCalls.find((c) => c.event === "workflow.offload.resume.succeeded");
    expect(succeeded).toBeDefined();
    expect(succeeded?.payload.name).toBe("review");
    expect(succeeded?.payload.agent).toBe("claude");
    expect(succeeded?.payload.runId).toBe("run-1");

    // state restored to alive
    expect(mgr.getStatus("review")).toBe("alive");
  });
});

// ---------------------------------------------------------------------------
// 9. requestResume schemaVersion mismatch
// ---------------------------------------------------------------------------

describe("requestResume: error rollback", () => {
  test("schema version mismatch: RESUME_FAILED with errorCode SCHEMA_MISMATCH + state rollback to offloaded", async () => {
    const stageDir = makeStageDir();
    const { deps, panelStore, emitCalls } = makeTestDeps(stageDir);
    panelStore.sessions = [{ name: "review", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir));

    // Offload via public API
    await mgr.onWorkflowCompletion();
    expect(mgr.getStatus("review")).toBe("offloaded");

    // Now corrupt schema version in metadata.json
    const meta = readMetadata(stageDir);
    writeFileSync(
      join(stageDir, "metadata.json"),
      JSON.stringify(
        {
          ...meta,
          resume: { ...meta.resume, schemaVersion: 2 },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    emitCalls.length = 0;

    // requestResume should throw (doResume rethrows)
    let err: unknown;
    try {
      await mgr.requestResume("review");
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("SCHEMA_MISMATCH");

    // RESUME_FAILED emitted with correct errorCode
    const failed = emitCalls.find((c) => c.event === "workflow.offload.resume.failed");
    expect(failed).toBeDefined();
    expect(failed?.payload.errorCode).toBe("SCHEMA_MISMATCH");
    expect(failed?.payload.name).toBe("review");

    // panel status rolled back to offloaded
    expect(panelStore.setSessionStatus).toHaveBeenCalledWith("review", "offloaded");

    // internal state rolled back
    expect(mgr.getStatus("review")).toBe("offloaded");
  });

  // ---------------------------------------------------------------------------
  // 10. requestResume mid-resume failure (createWindow throws)
  // ---------------------------------------------------------------------------

  test("createWindow failure: RESUME_FAILED with errorCode RESUME_FAILED + state rollback to offloaded", async () => {
    const stageDir = makeStageDir();
    const { deps, panelStore, emitCalls } = makeTestDeps(stageDir);
    panelStore.sessions = [{ name: "review", status: "complete", parents: [], startedAt: null, endedAt: null }];

    // Make createWindow throw after the first call (registration uses no createWindow;
    // only the resume path does). Replace the mock after makeTestDeps so only the
    // resume call is affected.
    deps.tmux.createWindow = mock(async () => {
      throw new Error("tmux: create-window failed");
    }) as unknown as OffloadManagerDeps["tmux"]["createWindow"];

    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir));

    // Offload
    await mgr.onWorkflowCompletion();
    expect(mgr.getStatus("review")).toBe("offloaded");

    emitCalls.length = 0;

    let err: unknown;
    try {
      await mgr.requestResume("review");
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("tmux: create-window failed");

    // RESUME_FAILED emitted
    const failed = emitCalls.find((c) => c.event === "workflow.offload.resume.failed");
    expect(failed).toBeDefined();
    expect(failed?.payload.errorCode).toBe("RESUME_FAILED");

    // state rolled back
    expect(mgr.getStatus("review")).toBe("offloaded");
    expect(panelStore.setSessionStatus).toHaveBeenCalledWith("review", "offloaded");
  });
});

// ---------------------------------------------------------------------------
// 11. registerSession persists chatFlags into metadata.json#resume.chatFlags
// ---------------------------------------------------------------------------

describe("registerSession: chatFlags persistence", () => {
  test("chatFlags are written to metadata.json#resume.chatFlags", async () => {
    const { deps, stageDir } = makeTestDeps();
    const mgr = createOffloadManager(deps);
    const flags = ["--model", "claude-opus-4-5", "--tools", "all"];
    await mgr.registerSession(makeSessionInput("review", stageDir, { chatFlags: flags }));

    const meta = readMetadata(stageDir);
    expect(meta.resume?.chatFlags).toEqual(flags);
  });

  test("empty chatFlags are persisted as empty array", async () => {
    const { deps, stageDir } = makeTestDeps();
    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir, { chatFlags: [] }));

    const meta = readMetadata(stageDir);
    expect(meta.resume?.chatFlags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 12. doResume forwards chatFlags from disk meta to provider builder
// ---------------------------------------------------------------------------

describe("doResume: chatFlags forwarded to provider builder", () => {
  test("meta.chatFlags from disk is passed to claude buildResumeArgs", async () => {
    const stageDir = makeStageDir();
    const capturedMetas: Array<{ agentSessionId: string; chatFlags: string[] }> = [];

    const { deps, panelStore, emitCalls } = makeTestDeps(stageDir);
    // Override claude buildResumeArgs to capture meta
    deps.providers.claude.buildResumeArgs = mock(
      (meta: { agentSessionId: string; chatFlags: string[] }) => {
        capturedMetas.push({ agentSessionId: meta.agentSessionId, chatFlags: meta.chatFlags });
        return ["--resume", meta.agentSessionId];
      },
    ) as unknown as typeof deps.providers.claude.buildResumeArgs;

    panelStore.sessions = [{ name: "review", status: "complete", parents: [], startedAt: null, endedAt: null }];
    const mgr = createOffloadManager(deps);
    const flags = ["--model", "claude-opus-4-5"];
    await mgr.registerSession(makeSessionInput("review", stageDir, { chatFlags: flags }));

    // Offload to set up offloaded state
    await mgr.onWorkflowCompletion();
    expect(mgr.getStatus("review")).toBe("offloaded");

    emitCalls.length = 0;

    await mgr.requestResume("review");

    expect(capturedMetas).toHaveLength(1);
    expect(capturedMetas[0]!.chatFlags).toEqual(flags);
    expect(capturedMetas[0]!.agentSessionId).toBe("sess-abc");
  });

});

// ---------------------------------------------------------------------------
// 13. doResume clock — latencyMs derived from injected deps.now()
// ---------------------------------------------------------------------------

describe("doResume: clock discipline (RFC §5.10)", () => {
  test("WORKFLOW_OFFLOAD_RESUME_SUCCEEDED latencyMs equals exact difference between two deps.now() calls", async () => {
    const stageDir = makeStageDir();

    // deps.now() is called: (1) at startMs, (2) at latencyMs computation.
    // We step by 50 ms between calls so expected latency = 50.
    let t = 1_000_000;
    const STEP = 50;
    const nowMock = mock(() => {
      const v = t;
      t += STEP;
      return v;
    });

    const emitCalls: EmitCall[] = [];
    const panelStoreBacking: MutablePanelStore = {
      sessions: [{ name: "review", status: "complete", parents: [], startedAt: null, endedAt: null }],
      activeAgentId: "",
      setSessionStatus: mock(() => {}),
    };

    const deps: OffloadManagerDeps = {
      panelStore: panelStoreBacking as unknown as OffloadManagerDeps["panelStore"],
      tmux: {
        killWindow: mock(async () => {}),
        createWindow: mock(async () => {}),
        selectWindow: mock(async () => {}),
      },
      providers: {
        claude: { buildResumeArgs: mock(() => ["--resume", "sess-abc"]) },
        opencode: { buildResumeArgs: mock(() => ["--session", "sess-abc"]) },
        copilot: { buildResumeArgs: mock(() => ["--session", "sess-abc"]) },
      },
      hookSettingsPath: mock(() => "/tmp/hook-settings.json"),
      shellQuote: mock((argv: readonly string[]) => argv.join(" ")),
      waitForReady: mock(async () => {}),
      now: nowMock,
      emit: mock((event: string, payload: Record<string, unknown>) => {
        emitCalls.push({ event, payload });
      }),
    };

    const mgr = createOffloadManager(deps);
    await mgr.registerSession(makeSessionInput("review", stageDir));
    await mgr.onWorkflowCompletion();

    emitCalls.length = 0;

    // Reset t so we control the exact window for doResume's two now() calls.
    // registerSession + killOnePane consumed some now() calls; reset to known base.
    t = 5_000;

    await mgr.requestResume("review");

    const succeeded = emitCalls.find((c) => c.event === "workflow.offload.resume.succeeded");
    expect(succeeded).toBeDefined();
    // startMs = 5_000 (first call), end = 5_050 (second call) → latencyMs = 50
    expect(succeeded?.payload.latencyMs).toBe(STEP);
  });
});
