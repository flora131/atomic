import { describe, expect, mock, test } from "bun:test";
import { daemonRestartCommand, defaultDaemonEndpointFile, type DaemonRestartDeps } from "./daemon.ts";
import type { DaemonEndpoint, EnsureStartedOptions } from "@bastani/atomic-sdk/runtime/daemon";

function endpoint(pid: number): DaemonEndpoint {
  return {
    host: "127.0.0.1",
    port: 45678,
    pid,
    startedAt: new Date(0).toISOString(),
    atomicVersion: "0.7.13",
    protocolVersion: "1.0.0",
  };
}

function makeOutput() {
  let text = "";
  return {
    stream: { write: (chunk: string | Uint8Array) => { text += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); return true; } },
    text: () => text,
  };
}

function makeDeps(overrides: Partial<DaemonRestartDeps> = {}): DaemonRestartDeps {
  const stdout = makeOutput();
  const stderr = makeOutput();
  const fakeConn = { dispose: mock(() => {}) } as unknown as Awaited<ReturnType<DaemonRestartDeps["ensureStarted"]>>;
  let currentTime = 0;

  return {
    endpointFile: "/tmp/atomic-daemon.endpoint.json",
    readEndpoint: mock(async () => endpoint(2222)),
    ensureStarted: mock(async (_opts: EnsureStartedOptions) => fakeConn),
    closeConnection: mock((_conn: Awaited<ReturnType<DaemonRestartDeps["ensureStarted"]>>) => {}),
    signalProcess: mock((_pid: number, _signal: NodeJS.Signals) => {}),
    isProcessAlive: mock(() => false),
    sleep: mock(async (ms: number) => { currentTime += ms; }),
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => currentTime,
    ...overrides,
  };
}

describe("defaultDaemonEndpointFile", () => {
  test("points at ~/.atomic/daemon.endpoint.json", () => {
    expect(defaultDaemonEndpointFile("/home/tester")).toBe("/home/tester/.atomic/daemon.endpoint.json");
  });
});

describe("daemonRestartCommand", () => {
  test("starts a daemon when no endpoint exists", async () => {
    const stdout = makeOutput();
    const deps = makeDeps({
      readEndpoint: mock(async (): Promise<DaemonEndpoint | null> => null),
      stdout: stdout.stream,
    });

    const exitCode = await daemonRestartCommand({}, deps);

    expect(exitCode).toBe(0);
    expect(deps.signalProcess).not.toHaveBeenCalled();
    expect(deps.ensureStarted).toHaveBeenCalledWith({
      endpointFile: "/tmp/atomic-daemon.endpoint.json",
      clientName: "@bastani/atomic/daemon",
    });
    expect(stdout.text()).toContain("no running daemon found");
  });

  test("sends SIGTERM to the existing daemon before starting a replacement", async () => {
    const oldEndpoint = endpoint(1111);
    const newEndpoint = endpoint(2222);
    let readCount = 0;
    const readEndpoint = mock(async (): Promise<DaemonEndpoint | null> => {
      readCount++;
      if (readCount === 1) return oldEndpoint;
      if (readCount === 2) return null;
      return newEndpoint;
    });
    const deps = makeDeps({ readEndpoint });

    const exitCode = await daemonRestartCommand({}, deps);

    expect(exitCode).toBe(0);
    expect(deps.signalProcess).toHaveBeenCalledWith(1111, "SIGTERM");
    expect(deps.ensureStarted).toHaveBeenCalledTimes(1);
  });

  test("escalates to SIGKILL when the old daemon does not stop after SIGTERM", async () => {
    let currentTime = 0;
    const deps = makeDeps({
      now: () => currentTime,
      sleep: mock(async (ms: number) => { currentTime += ms; }),
      isProcessAlive: mock(() => true),
      readEndpoint: mock(async () => endpoint(1111)),
    });

    const exitCode = await daemonRestartCommand({ timeoutMs: 100, pollIntervalMs: 50 }, deps);

    expect(exitCode).toBe(1);
    expect(deps.signalProcess).toHaveBeenCalledWith(1111, "SIGTERM");
    expect(deps.signalProcess).toHaveBeenCalledWith(1111, "SIGKILL");
    expect(deps.ensureStarted).not.toHaveBeenCalled();
  });

  test("returns 1 when daemon startup fails", async () => {
    const stderr = makeOutput();
    const deps = makeDeps({
      readEndpoint: mock(async (): Promise<DaemonEndpoint | null> => null),
      ensureStarted: mock(async () => { throw new Error("boom"); }),
      stderr: stderr.stream,
    });

    const exitCode = await daemonRestartCommand({}, deps);

    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain("failed to start daemon: boom");
  });
});
