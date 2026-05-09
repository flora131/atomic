/**
 * Contract tests for RFC §5.2.4 executor offload-wiring invariants.
 *
 * Tests target `persistAndRegisterStage` — the exported helper extracted from
 * `createSessionRunner` that owns the Bun.write → registerSession sequence.
 *
 * Four invariants:
 *  1. Order   — Bun.write(metadata.json) happens-before registerSession.
 *  2. Awaited — registerSession is fully awaited; continuation is blocked.
 *  3. Rejection observability — rejection swallowed, console.warn fired, stage continues.
 *  4. Headless skip — headless:true still awaits registerSession; write still precedes it.
 */

import { test, expect, mock, spyOn, beforeEach, afterEach, describe } from "bun:test";
import { join } from "node:path";
import { persistAndRegisterStage, defaultWaitForAgentReady } from "./executor.ts";
import type { OffloadManager } from "./offload-manager.ts";

// ─── shared helpers ───────────────────────────────────────────────────────────

const STAGE_DIR = "/tmp/test-stage-abc123";
const STAGE_NAME = "my-stage";

function makeMetadata(overrides?: Partial<Parameters<typeof persistAndRegisterStage>[1]>) {
  return {
    name: STAGE_NAME,
    description: "test stage",
    agent: "claude" as const,
    paneId: "pane-1",
    serverUrl: "http://localhost:4242",
    port: 4242,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRegisterInput(overrides?: Partial<Parameters<typeof persistAndRegisterStage>[3]>) {
  return {
    name: STAGE_NAME,
    runId: "run-001",
    stageDir: STAGE_DIR,
    agent: "claude" as const,
    agentSessionId: "sess-abc",
    tmuxSession: "atomic-session",
    tmuxWindow: STAGE_NAME,
    spawnEnv: { PATH: "/usr/bin" },
    spawnCwd: "/home/user/project",
    chatFlags: [] as string[],
    headless: false,
    ...overrides,
  };
}

// ─── setup/teardown ───────────────────────────────────────────────────────────

let bunWriteSpy: ReturnType<typeof spyOn>;
let unhandledRejections: unknown[] = [];
const unhandledHandler = (reason: unknown) => {
  unhandledRejections.push(reason);
};

beforeEach(() => {
  // Suppress real disk I/O for Bun.write — default mock resolves immediately.
  bunWriteSpy = spyOn(Bun, "write").mockImplementation(() =>
    Promise.resolve(0),
  );
  unhandledRejections = [];
  process.on("unhandledRejection", unhandledHandler);
});

afterEach(() => {
  bunWriteSpy.mockRestore();
  process.removeListener("unhandledRejection", unhandledHandler);
});

// ─── 1. Order ─────────────────────────────────────────────────────────────────

test("§5.2.4 invariant 1 — Bun.write(metadata.json) is called BEFORE registerSession", async () => {
  const calls: string[] = [];
  let order = 0;

  // Async Bun.write mock so ordering is observable even with await chains.
  bunWriteSpy.mockImplementation((_path: unknown, _data: unknown) => {
    return new Promise<number>((resolve) => {
      calls.push(`write:${++order}`);
      // Resolve on next microtask to make the ordering non-trivial.
      Promise.resolve().then(() => resolve(0));
    });
  });

  const mockOffloadManager: OffloadManager = {
    registerSession: mock(async () => {
      calls.push(`register:${++order}`);
    }),
    offloadSession: mock(async () => {}),
    onWorkflowCompletion: mock(async () => {}),
    requestResume: mock(async () => {}),
    getStatus: mock(() => "alive" as const),
  };

  await persistAndRegisterStage(
    STAGE_DIR,
    makeMetadata(),
    mockOffloadManager,
    makeRegisterInput(),
  );

  // write must appear before register in the calls array
  const writeIdx = calls.findIndex((c) => c.startsWith("write:"));
  const registerIdx = calls.findIndex((c) => c.startsWith("register:"));

  expect(writeIdx).toBeGreaterThanOrEqual(0);
  expect(registerIdx).toBeGreaterThanOrEqual(0);
  expect(writeIdx).toBeLessThan(registerIdx);
});

test("§5.2.4 invariant 1 — Bun.write path ends with metadata.json", async () => {
  let capturedPath: string | undefined;

  bunWriteSpy.mockImplementation((pathOrUrl: unknown, _data: unknown) => {
    if (typeof pathOrUrl === "string") capturedPath = pathOrUrl;
    return Promise.resolve(0);
  });

  const mockOffloadManager: OffloadManager = {
    registerSession: mock(async () => {}),
    offloadSession: mock(async () => {}),
    onWorkflowCompletion: mock(async () => {}),
    requestResume: mock(async () => {}),
    getStatus: mock(() => "alive" as const),
  };

  await persistAndRegisterStage(
    STAGE_DIR,
    makeMetadata(),
    mockOffloadManager,
    makeRegisterInput(),
  );

  expect(capturedPath).toBeDefined();
  expect(capturedPath!.endsWith("metadata.json")).toBe(true);
  expect(capturedPath).toBe(join(STAGE_DIR, "metadata.json"));
});

// ─── 2. Awaited ───────────────────────────────────────────────────────────────

test("§5.2.4 invariant 2 — registerSession is fully awaited before persistAndRegisterStage resolves", async () => {
  let registerSessionResolve!: () => void;
  let registerSessionSettled = false;

  const delayedRegisterSession = () =>
    new Promise<void>((resolve) => {
      registerSessionResolve = () => {
        registerSessionSettled = true;
        resolve();
      };
    });

  const mockOffloadManager: OffloadManager = {
    registerSession: mock(delayedRegisterSession),
    offloadSession: mock(async () => {}),
    onWorkflowCompletion: mock(async () => {}),
    requestResume: mock(async () => {}),
    getStatus: mock(() => "alive" as const),
  };

  let persistResolved = false;
  const persistPromise = persistAndRegisterStage(
    STAGE_DIR,
    makeMetadata(),
    mockOffloadManager,
    makeRegisterInput(),
  ).then(() => {
    persistResolved = true;
  });

  // Drain microtasks — Bun.write resolves, but registerSession hasn't yet.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  // persistAndRegisterStage must NOT have resolved yet.
  expect(persistResolved).toBe(false);
  expect(registerSessionSettled).toBe(false);

  // Now release the delayed registerSession.
  registerSessionResolve();
  await persistPromise;

  expect(persistResolved).toBe(true);
  expect(registerSessionSettled).toBe(true);
});

// ─── 3. Rejection observability ──────────────────────────────────────────────

test("§5.2.4 invariant 3 — rejected registerSession is swallowed and console.warn fires with stage name + error message", async () => {
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

  const errorMsg = "metadata.json not found at /tmp/foo";
  const mockOffloadManager: OffloadManager = {
    registerSession: mock(() => Promise.reject(new Error(errorMsg))),
    offloadSession: mock(async () => {}),
    onWorkflowCompletion: mock(async () => {}),
    requestResume: mock(async () => {}),
    getStatus: mock(() => "alive" as const),
  };

  let continuationExecuted = false;

  // persistAndRegisterStage must not throw even though registerSession rejects.
  await persistAndRegisterStage(
    STAGE_DIR,
    makeMetadata(),
    mockOffloadManager,
    makeRegisterInput(),
  );
  continuationExecuted = true;

  // (a) continuation ran
  expect(continuationExecuted).toBe(true);

  // (b) console.warn called once with expected content
  expect(warnSpy).toHaveBeenCalledTimes(1);
  const warnArg = (warnSpy.mock.calls[0] as unknown[])[0] as string;
  expect(warnArg).toContain(`[offload] registerSession failed for stage ${STAGE_NAME}`);
  expect(warnArg).toContain(errorMsg);

  // (c) no unhandledRejection
  // Yield to event loop to let any dangling rejections surface.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(unhandledRejections).toHaveLength(0);

  warnSpy.mockRestore();
});

test("§5.2.4 invariant 3 — registerSession rejection does not bubble as thrown error", async () => {
  spyOn(console, "warn").mockImplementation(() => {});

  const mockOffloadManager: OffloadManager = {
    registerSession: mock(() => Promise.reject(new Error("boom"))),
    offloadSession: mock(async () => {}),
    onWorkflowCompletion: mock(async () => {}),
    requestResume: mock(async () => {}),
    getStatus: mock(() => "alive" as const),
  };

  // Must not throw
  let caught: unknown = null;
  let resolved: unknown = "unset";
  try {
    resolved = await persistAndRegisterStage(
      STAGE_DIR,
      makeMetadata(),
      mockOffloadManager,
      makeRegisterInput(),
    );
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeNull();
  expect(resolved).toBeUndefined();
});

// ─── 4. Headless skip ────────────────────────────────────────────────────────

test("§5.2.4 invariant 4 — headless:true still awaits registerSession fully", async () => {
  let registerSessionResolve!: () => void;
  let registerSessionSettled = false;

  const delayedRegisterSession = () =>
    new Promise<void>((resolve) => {
      registerSessionResolve = () => {
        registerSessionSettled = true;
        resolve();
      };
    });

  const mockOffloadManager: OffloadManager = {
    registerSession: mock(delayedRegisterSession),
    offloadSession: mock(async () => {}),
    onWorkflowCompletion: mock(async () => {}),
    requestResume: mock(async () => {}),
    getStatus: mock(() => "alive" as const),
  };

  let persistResolved = false;
  const persistPromise = persistAndRegisterStage(
    STAGE_DIR,
    makeMetadata(),
    mockOffloadManager,
    makeRegisterInput({ headless: true }),
  ).then(() => {
    persistResolved = true;
  });

  // Drain microtasks
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(persistResolved).toBe(false);
  expect(registerSessionSettled).toBe(false);

  registerSessionResolve();
  await persistPromise;

  expect(persistResolved).toBe(true);
  expect(registerSessionSettled).toBe(true);
});

test("§5.2.4 invariant 4 — headless:true: Bun.write still called before registerSession", async () => {
  const calls: string[] = [];
  let order = 0;

  bunWriteSpy.mockImplementation((_path: unknown, _data: unknown) => {
    return new Promise<number>((resolve) => {
      calls.push(`write:${++order}`);
      Promise.resolve().then(() => resolve(0));
    });
  });

  const mockOffloadManager: OffloadManager = {
    registerSession: mock(async () => {
      calls.push(`register:${++order}`);
    }),
    offloadSession: mock(async () => {}),
    onWorkflowCompletion: mock(async () => {}),
    requestResume: mock(async () => {}),
    getStatus: mock(() => "alive" as const),
  };

  await persistAndRegisterStage(
    STAGE_DIR,
    makeMetadata(),
    mockOffloadManager,
    makeRegisterInput({ headless: true }),
  );

  const writeIdx = calls.findIndex((c) => c.startsWith("write:"));
  const registerIdx = calls.findIndex((c) => c.startsWith("register:"));

  expect(writeIdx).toBeGreaterThanOrEqual(0);
  expect(registerIdx).toBeGreaterThanOrEqual(0);
  expect(writeIdx).toBeLessThan(registerIdx);
});

// ─── defaultWaitForAgentReady — RFC §5.2.2(d) readiness probes ───────────────
//
// Tests verify RESUME_TIMEOUT_<AGENT> is thrown when the agent session cannot
// be confirmed within the deadline. Module mocks stand in for real tmux panes
// and SDK servers so the tests are fast and self-contained.

// Snapshot real modules BEFORE any mock.module call so afterEach can restore.
const _tmuxModOW = await import("./tmux.ts");
const _realTmuxSnapshotOW = { ..._tmuxModOW };
const _portModOW = await import("./port-discovery.ts");
const _realPortSnapshotOW = { ..._portModOW };
let _realOcSdkSnapshotOW: Record<string, unknown> | null = null;
try {
  const _ocMod = await import("@opencode-ai/sdk/v2");
  _realOcSdkSnapshotOW = { ..._ocMod };
} catch { /* not installed in all environments */ }
let _realCopilotSdkSnapshotOW: Record<string, unknown> | null = null;
try {
  const _copilotMod = await import("@github/copilot-sdk");
  _realCopilotSdkSnapshotOW = { ..._copilotMod };
} catch { /* not installed in all environments */ }

describe("defaultWaitForAgentReady — readiness probes (RFC §5.2.2(d))", () => {
  let originalSleep: typeof Bun.sleep;
  let realDateNow: typeof Date.now;

  beforeEach(() => {
    originalSleep = Bun.sleep;
    // Make Bun.sleep instant so probe retry loops resolve immediately.
    (globalThis as { Bun: { sleep: (ms: number) => Promise<void> } }).Bun.sleep =
      () => Promise.resolve();

    // Mock tmux so waitForServer sees a "ready" pane with a PID.
    mock.module("./tmux.ts", () => ({
      capturePane: () => "line1\nline2\nline3\n",
      getPanePid: () => 99999,
      spawnMuxAttach: () => {},
    }));

    // Mock port discovery to return a port immediately.
    mock.module("./port-discovery.ts", () => ({
      getListeningPortForPid: async () => 54321,
      PORT_DISCOVERY_TIMEOUT_MS: 100,
    }));
  });

  afterEach(() => {
    (globalThis as { Bun: { sleep: typeof Bun.sleep } }).Bun.sleep = originalSleep;
    mock.module("./tmux.ts", () => _realTmuxSnapshotOW);
    mock.module("./port-discovery.ts", () => _realPortSnapshotOW);
    if (_realOcSdkSnapshotOW !== null) {
      mock.module("@opencode-ai/sdk/v2", () => _realOcSdkSnapshotOW!);
    }
    if (_realCopilotSdkSnapshotOW !== null) {
      mock.module("@github/copilot-sdk", () => _realCopilotSdkSnapshotOW!);
    }
    if (realDateNow) {
      Date.now = realDateNow;
      realDateNow = undefined as unknown as typeof Date.now;
    }
  });

  test("opencode: throws RESUME_TIMEOUT_OPENCODE when session.get never succeeds", async () => {
    // OpenCode session.get returns no data (session not yet registered).
    mock.module("@opencode-ai/sdk/v2", () => ({
      createOpencodeClient: () => ({
        session: {
          get: () => Promise.resolve({ data: null, error: { message: "not found" } }),
        },
      }),
    }));

    // Jump Date.now past AGENT_READY_TIMEOUT_MS (10_000ms) after a few checks.
    realDateNow = Date.now;
    let calls = 0;
    Date.now = () => {
      calls++;
      return calls > 5 ? realDateNow() + 20_000 : realDateNow();
    };

    let caught: unknown = null;
    try {
      await defaultWaitForAgentReady("opencode", "sess-oc-123", "atomic-wf:review");
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toBe("RESUME_TIMEOUT_OPENCODE");
  });

  test("opencode: resolves immediately when session.get succeeds on first try", async () => {
    mock.module("@opencode-ai/sdk/v2", () => ({
      createOpencodeClient: () => ({
        session: {
          // SDK v2 shape: { sessionID } — returns a RequestResult-like object.
          get: () => Promise.resolve({ data: { id: "sess-oc-ok" }, error: null }),
        },
      }),
    }));

    // Should resolve without throwing.
    await defaultWaitForAgentReady("opencode", "sess-oc-ok", "atomic-wf:review");
  });

  test("copilot: throws RESUME_TIMEOUT_COPILOT when getSessionMetadata returns undefined", async () => {
    // listSessions() is called by waitForServer's internal Copilot probe.
    // getSessionMetadata() is called by defaultWaitForAgentReady to verify the
    // specific resumed session is registered.
    mock.module("@github/copilot-sdk", () => ({
      CopilotClient: class {
        start() { return Promise.resolve(); }
        stop() { return Promise.resolve([]); }
        listSessions() { return Promise.resolve([]); }
        getSessionMetadata(_id: string) { return Promise.resolve(undefined); }
      },
    }));

    let caught: unknown = null;
    try {
      await defaultWaitForAgentReady("copilot", "sess-cp-456", "atomic-wf:review");
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toBe("RESUME_TIMEOUT_COPILOT");
  });

  test("copilot: resolves when getSessionMetadata returns session metadata", async () => {
    mock.module("@github/copilot-sdk", () => ({
      CopilotClient: class {
        start() { return Promise.resolve(); }
        stop() { return Promise.resolve([]); }
        listSessions() { return Promise.resolve([]); }
        getSessionMetadata(_id: string) {
          return Promise.resolve({
            sessionId: "sess-cp-ok",
            startTime: new Date(),
            modifiedTime: new Date(),
            isRemote: false,
          });
        }
      },
    }));

    // Should resolve without throwing.
    await defaultWaitForAgentReady("copilot", "sess-cp-ok", "atomic-wf:review");
  });
});
