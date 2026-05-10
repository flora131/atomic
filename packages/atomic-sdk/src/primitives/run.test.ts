/**
 * Tests for `src/primitives/run.ts`.
 *
 * Uses dependency injection to mock `ensureStarted` so no real daemon
 * connection is needed, and `mock.module` leakage into other test files
 * is avoided.
 */

import { test, expect, describe, mock } from "bun:test";
import type { RegistrableWorkflow } from "../types.ts";
import { runWorkflow } from "./run.ts";

// ─── Fake workflow ─────────────────────────────────────────────────────────────

const fakeWorkflow = {
  kind: "builtin" as const,
  name: "hello-world",
  description: "test workflow",
  agent: "claude" as const,
  inputs: [] as const,
  source: "/fake/hello-world.ts",
  minSDKVersion: null,
  run: async () => {},
} as unknown as RegistrableWorkflow;

// ─── Connection factory ───────────────────────────────────────────────────────

/**
 * Build a mock MessageConnection.
 * - `notifyOnRegister`: `onNotification("run/ended", h)` immediately calls h —
 *   simulates notification arriving before sendRequest resolves (race path).
 * - `closeOnRegister`: `onClose(h)` immediately calls h —
 *   simulates connection drop before run/ended.
 */
function makeConn({
  runId = "test-run-id-01",
  notifyOnRegister = false,
  closeOnRegister = false,
}: {
  runId?: string;
  notifyOnRegister?: boolean;
  closeOnRegister?: boolean;
} = {}) {
  const disposable = { dispose: mock(() => {}) };

  const sendRequest = mock(async (method: string, _params: unknown) => {
    if (method === "workflow/start") {
      return { runId, attachable: true as const };
    }
    throw new Error(`Unexpected method: ${method}`);
  });

  const onNotification = mock(
    (event: string, handler: (params: { runId: string }) => void) => {
      if (event === "run/ended" && notifyOnRegister) {
        handler({ runId });
      }
      return disposable;
    },
  );

  const onClose = mock((handler: () => void) => {
    if (closeOnRegister) {
      handler();
    }
    return disposable;
  });

  const dispose = mock(() => {});

  const conn = {
    sendRequest,
    onNotification,
    onClose,
    dispose,
  } as unknown as import("vscode-jsonrpc").MessageConnection;

  return { conn, sendRequest, onNotification, onClose, dispose, disposable };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runWorkflow", () => {
  test("detach:true — sends workflow/start with correct params and returns runId and daemon", async () => {
    const { conn, sendRequest } = makeConn();
    const mockEnsureStarted = mock(async () => conn);

    const result = await runWorkflow(
      { workflow: fakeWorkflow, detach: true },
      { ensureStarted: mockEnsureStarted },
    );

    expect(result.runId).toBe("test-run-id-01");
    expect(result.daemon).toBeDefined();

    expect(sendRequest).toHaveBeenCalledTimes(1);
    const [method, params] = sendRequest.mock.calls[0]!;
    expect(method).toBe("workflow/start");
    expect(params).toMatchObject({
      source: "/fake/hello-world.ts",
      workflowName: "hello-world",
      agent: "claude",
      inputs: {},
    });
  });

  test("detach:true — does NOT subscribe to run/ended", async () => {
    const { conn, onNotification } = makeConn();
    const mockEnsureStarted = mock(async () => conn);

    await runWorkflow(
      { workflow: fakeWorkflow, detach: true },
      { ensureStarted: mockEnsureStarted },
    );

    expect(onNotification).not.toHaveBeenCalled();
  });

  test("detach:false — registers run/ended handler before sendRequest is called", async () => {
    // Track call order: onNotification must be registered before sendRequest resolves.
    const callOrder: string[] = [];
    const disposable = { dispose: mock(() => {}) };

    let capturedHandler: ((params: { runId: string }) => void) | undefined;

    const sendRequest = mock(async (method: string, _params: unknown) => {
      if (method === "workflow/start") {
        callOrder.push("sendRequest");
        return { runId: "test-run-id-01", attachable: true as const };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    const onNotification = mock(
      (event: string, handler: (params: { runId: string }) => void) => {
        if (event === "run/ended") {
          callOrder.push("onNotification");
          capturedHandler = handler;
        }
        return disposable;
      },
    );

    const onClose = mock((_handler: () => void) => disposable);

    const conn = {
      sendRequest,
      onNotification,
      onClose,
    } as unknown as import("vscode-jsonrpc").MessageConnection;

    const mockEnsureStarted = mock(async () => conn);

    const runPromise = runWorkflow(
      { workflow: fakeWorkflow, detach: false },
      { ensureStarted: mockEnsureStarted },
    );

    // Yield enough microtask ticks for the chain to reach the await sendRequest.
    await Promise.resolve();
    await Promise.resolve();
    capturedHandler?.({ runId: "test-run-id-01" });
    const result = await runPromise;

    expect(result.runId).toBe("test-run-id-01");
    // onNotification registered BEFORE sendRequest executed.
    expect(callOrder.indexOf("onNotification")).toBeLessThan(callOrder.indexOf("sendRequest"));
  });

  test("detach:false — resolves when run/ended arrives after sendRequest (normal path)", async () => {
    let capturedHandler: ((params: { runId: string }) => void) | undefined;
    const disposable = { dispose: mock(() => {}) };

    const sendRequest = mock(async (method: string, _params: unknown) => {
      if (method === "workflow/start") {
        return { runId: "test-run-id-01", attachable: true as const };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    const onNotification = mock(
      (event: string, handler: (params: { runId: string }) => void) => {
        if (event === "run/ended") capturedHandler = handler;
        return disposable;
      },
    );

    const onClose = mock((_handler: () => void) => disposable);

    const conn = {
      sendRequest,
      onNotification,
      onClose,
    } as unknown as import("vscode-jsonrpc").MessageConnection;

    const mockEnsureStarted = mock(async () => conn);

    const runPromise = runWorkflow(
      { workflow: fakeWorkflow, detach: false },
      { ensureStarted: mockEnsureStarted },
    );

    await Promise.resolve();
    await Promise.resolve();
    capturedHandler?.({ runId: "test-run-id-01" });

    const result = await runPromise;
    expect(result.runId).toBe("test-run-id-01");
  });

  test("detach:false — resolves immediately when run/ended arrives before sendRequest returns (race/buffer path)", async () => {
    // notifyOnRegister=true: handler fires synchronously inside onNotification call,
    // which happens before sendRequest — tests the buffer-and-resolve-immediately path.
    const { conn } = makeConn({ notifyOnRegister: true });
    const mockEnsureStarted = mock(async () => conn);

    const result = await runWorkflow(
      { workflow: fakeWorkflow, detach: false },
      { ensureStarted: mockEnsureStarted },
    );

    expect(result.runId).toBe("test-run-id-01");
  });

  test("detach:false — rejects when connection closes before run/ended", async () => {
    // closeOnRegister=true: onClose handler fires immediately, simulating connection drop.
    const { conn } = makeConn({ notifyOnRegister: false, closeOnRegister: true });
    const mockEnsureStarted = mock(async () => conn);

    await expect(
      runWorkflow(
        { workflow: fakeWorkflow, detach: false },
        { ensureStarted: mockEnsureStarted },
      ),
    ).rejects.toThrow("[atomic] daemon connection closed before run/ended");
  });

  test("detach:false — disposes notif and close handlers after resolving", async () => {
    const { conn, disposable } = makeConn({ notifyOnRegister: true });
    const mockEnsureStarted = mock(async () => conn);

    await runWorkflow(
      { workflow: fakeWorkflow, detach: false },
      { ensureStarted: mockEnsureStarted },
    );

    // notifDisposable.dispose() + closeDisposable.dispose() = 2 calls.
    expect(disposable.dispose).toHaveBeenCalledTimes(2);
  });

  test("passes inputs through validateInputs", async () => {
    const { conn, sendRequest } = makeConn({ notifyOnRegister: true });
    const mockEnsureStarted = mock(async () => conn);

    const workflowWithInputs = {
      ...fakeWorkflow,
      inputs: [
        { name: "greeting", type: "string" as const, required: false, default: "hello" },
      ],
    } as unknown as RegistrableWorkflow;

    const result = await runWorkflow({
      workflow: workflowWithInputs,
      inputs: { greeting: "world" },
      detach: true,
    }, { ensureStarted: mockEnsureStarted });

    expect(result.runId).toBe("test-run-id-01");
    const [, params] = sendRequest.mock.calls[0]!;
    expect((params as { inputs: Record<string, string> }).inputs).toMatchObject({
      greeting: "world",
    });
  });

  test("forwards pathToAtomicExecutable as atomicBinary to ensureStarted", async () => {
    const { conn } = makeConn();
    const mockEnsureStarted = mock(async () => conn);

    await runWorkflow({
      workflow: fakeWorkflow,
      pathToAtomicExecutable: "/usr/local/bin/atomic",
      detach: true,
    }, { ensureStarted: mockEnsureStarted });

    expect(mockEnsureStarted).toHaveBeenCalledWith(
      expect.objectContaining({ atomicBinary: "/usr/local/bin/atomic" }),
    );
  });

  test("forwards endpointFile and token to ensureStarted", async () => {
    const { conn } = makeConn();
    const mockEnsureStarted = mock(async () => conn);

    await runWorkflow({
      workflow: fakeWorkflow,
      endpointFile: "/custom/endpoint.json",
      token: "my-secret-token",
      detach: true,
    }, { ensureStarted: mockEnsureStarted });

    expect(mockEnsureStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointFile: "/custom/endpoint.json",
        token: "my-secret-token",
      }),
    );
  });

  test("default detach behavior (omitted) subscribes to run/ended", async () => {
    const { conn, onNotification } = makeConn({ notifyOnRegister: true });
    const mockEnsureStarted = mock(async () => conn);

    await runWorkflow({ workflow: fakeWorkflow }, { ensureStarted: mockEnsureStarted });

    // Without detach:true, should have subscribed to run/ended.
    expect(onNotification).toHaveBeenCalledWith("run/ended", expect.any(Function));
  });
});

