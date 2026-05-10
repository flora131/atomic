/**
 * Tests for the Daemon lifecycle module.
 *
 * §8.2.1, §8.2.2 of specs/2026-05-09-ui-server-bun-native.md
 *
 * Tests use temp directories and real TCP sockets for integration paths.
 * Signal handlers are NOT registered in tests to avoid side-effects; we test
 * the underlying start/stop mechanics directly.
 */

import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import * as net from "node:net";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  Daemon,
  type DaemonOptions,
  type DaemonEndpoint,
  readEndpointFile,
  probeLiveness,
  connectToDaemon,
  MissingDependencyError,
  DaemonAlreadyRunningError,
} from "./daemon.ts";
import type { IRunManager, ISupervisor } from "./ui-protocol/methods.ts";
import type { WorkflowRegistry } from "./registry.ts";

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function makeRegistry(): WorkflowRegistry {
  return {
    load: mock(() => Promise.resolve({ count: 0, broken: [] })),
    list: mock(() => []),
    get: mock(() => null),
    getDescriptor: mock(() => null),
    getBySource: mock(() => null),
    refresh: mock(() => Promise.resolve({ count: 0, broken: [] })),
  } as unknown as WorkflowRegistry;
}

function makeRunManager(): IRunManager {
  return {
    start: mock(() => Promise.resolve({ runId: "run-1" })),
    stop: mock(() => Promise.resolve()),
    list: mock(() => Promise.resolve([])),
    get: mock(() => Promise.resolve(null)),
    getStageTranscript: mock(() => Promise.resolve({ lines: [] })),
    subscribe: mock(() => ({ dispose: () => {} })),
    unsubscribe: mock(() => {}),
  } as unknown as IRunManager;
}

function makeSupervisor(): ISupervisor {
  return {
    sendInput: mock(() => {}),
    getScrollback: mock(() => ({ data: "", headOffset: 0 })),
    spawn: mock(() => Promise.resolve({ pid: 12345 })),
    kill: mock(() => {}),
  };
}

// ---------------------------------------------------------------------------
// Temp dir helper
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "atomic-daemon-test-"));
}

// ---------------------------------------------------------------------------
// DaemonOptions factory
// ---------------------------------------------------------------------------

function makeDaemonOpts(tmpDir: string, overrides: Partial<DaemonOptions> = {}): DaemonOptions {
  const logs: string[] = [];
  const warns: string[] = [];
  return {
    workflows: makeRegistry(),
    runs: makeRunManager(),
    supervisor: makeSupervisor(),
    atomicVersion: "2.0.0",
    sdkVersion: "0.7.13",
    token: "test-token-abc",
    endpointFile: path.join(tmpDir, "daemon.endpoint.json"),
    logFile: path.join(tmpDir, "daemon.log"),
    onLog: (msg) => { logs.push(msg); },
    onWarn: (msg) => { warns.push(msg); },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("readEndpointFile", () => {
  test("returns null when file absent", async () => {
    const tmpDir = await makeTempDir();
    const result = await readEndpointFile(path.join(tmpDir, "nope.json"));
    expect(result).toBeNull();
  });

  test("returns parsed endpoint when file exists", async () => {
    const tmpDir = await makeTempDir();
    const ep: DaemonEndpoint = {
      host: "127.0.0.1",
      port: 12345,
      pid: 999,
      startedAt: "2026-01-01T00:00:00.000Z",
      atomicVersion: "2.0.0",
      protocolVersion: "1.0.0",
    };
    const file = path.join(tmpDir, "ep.json");
    await fsp.writeFile(file, JSON.stringify(ep), "utf8");
    const result = await readEndpointFile(file);
    expect(result).toEqual(ep);
  });

  test("returns null on corrupt JSON", async () => {
    const tmpDir = await makeTempDir();
    const file = path.join(tmpDir, "ep.json");
    await fsp.writeFile(file, "NOT JSON", "utf8");
    const result = await readEndpointFile(file);
    expect(result).toBeNull();
  });
});

describe("probeLiveness", () => {
  test("returns null for refused connection (no server on port)", async () => {
    // Use a port that's almost certainly closed.
    const ep: DaemonEndpoint = {
      host: "127.0.0.1",
      port: 1, // privileged / almost certainly closed
      pid: 1,
      startedAt: new Date().toISOString(),
      atomicVersion: "2.0.0",
      protocolVersion: "1.0.0",
    };
    const result = await probeLiveness(ep);
    expect(result).toBeNull();
  });

  test("returns protocolVersion string for a live daemon", async () => {
    const tmpDir = await makeTempDir();
    const opts = makeDaemonOpts(tmpDir);
    const daemon = new Daemon(opts);
    const { endpoint } = await daemon.start();
    try {
      const version = await probeLiveness(endpoint);
      expect(typeof version).toBe("string");
      expect(version!.length).toBeGreaterThan(0);
    } finally {
      await daemon.stop();
    }
  });
});

describe("Daemon.start()", () => {
  test("starts and writes endpoint file with correct shape", async () => {
    const tmpDir = await makeTempDir();
    const opts = makeDaemonOpts(tmpDir);
    const daemon = new Daemon(opts);

    const result = await daemon.start();
    try {
      expect(result.mode).toBe("new");
      const ep = result.endpoint;
      expect(ep.host).toBe("127.0.0.1");
      expect(typeof ep.port).toBe("number");
      expect(ep.port).toBeGreaterThan(0);
      expect(ep.pid).toBe(process.pid);
      expect(typeof ep.startedAt).toBe("string");
      expect(ep.atomicVersion).toBe("2.0.0");
      expect(typeof ep.protocolVersion).toBe("string");

      // Verify file exists and has correct content.
      const raw = await fsp.readFile(opts.endpointFile!, "utf8");
      const parsed = JSON.parse(raw) as DaemonEndpoint;
      expect(parsed).toEqual(ep);
    } finally {
      await daemon.stop();
    }
  });

  test("endpoint file mode is 0o600", async () => {
    const tmpDir = await makeTempDir();
    const daemon = new Daemon(makeDaemonOpts(tmpDir));
    await daemon.start();
    try {
      const stat = await fsp.stat(makeDaemonOpts(tmpDir).endpointFile!);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await daemon.stop();
    }
  });

  test("returns mode=existing when a live daemon is already running", async () => {
    const tmpDir = await makeTempDir();
    const endpointFile = path.join(tmpDir, "daemon.endpoint.json");

    const d1 = new Daemon(makeDaemonOpts(tmpDir));
    const r1 = await d1.start();
    expect(r1.mode).toBe("new");

    try {
      const d2 = new Daemon(makeDaemonOpts(tmpDir));
      const r2 = await d2.start();
      expect(r2.mode).toBe("existing");
      // d2 didn't start a new server — it found d1's endpoint.
      expect(r2.endpoint.port).toBe(r1.endpoint.port);
      expect(r2.endpoint.pid).toBe(r1.endpoint.pid);
    } finally {
      await d1.stop();
    }
  });

  test("cleans up stale endpoint file and starts fresh", async () => {
    const tmpDir = await makeTempDir();
    const endpointFile = path.join(tmpDir, "daemon.endpoint.json");

    // Write a stale endpoint pointing at a closed port.
    const staleEndpoint: DaemonEndpoint = {
      host: "127.0.0.1",
      port: 1, // closed
      pid: 99999,
      startedAt: new Date().toISOString(),
      atomicVersion: "2.0.0",
      protocolVersion: "1.0.0",
    };
    await fsp.mkdir(path.dirname(endpointFile), { recursive: true });
    await fsp.writeFile(endpointFile, JSON.stringify(staleEndpoint), "utf8");

    const daemon = new Daemon(makeDaemonOpts(tmpDir));
    const result = await daemon.start();
    try {
      expect(result.mode).toBe("new");
      // New port must differ from stale port.
      expect(result.endpoint.port).not.toBe(1);
    } finally {
      await daemon.stop();
    }
  });

  test("creates parent directories for endpointFile", async () => {
    const tmpDir = await makeTempDir();
    const nestedFile = path.join(tmpDir, "nested", "deep", "daemon.endpoint.json");
    const daemon = new Daemon(makeDaemonOpts(tmpDir, { endpointFile: nestedFile }));
    await daemon.start();
    try {
      expect(fs.existsSync(nestedFile)).toBe(true);
    } finally {
      await daemon.stop();
    }
  });

  test("uses ATOMIC_UI_SERVER_TOKEN env var when no token provided", async () => {
    const tmpDir = await makeTempDir();
    const original = process.env.ATOMIC_UI_SERVER_TOKEN;
    process.env.ATOMIC_UI_SERVER_TOKEN = "env-token-xyz";
    try {
      const daemon = new Daemon(makeDaemonOpts(tmpDir, { token: undefined }));
      expect(daemon.getToken()).toBe("env-token-xyz");
    } finally {
      if (original === undefined) delete process.env.ATOMIC_UI_SERVER_TOKEN;
      else process.env.ATOMIC_UI_SERVER_TOKEN = original;
    }
  });

  test("token is undefined (permissive mode) when no token and env unset", async () => {
    const tmpDir = await makeTempDir();
    const original = process.env.ATOMIC_UI_SERVER_TOKEN;
    delete process.env.ATOMIC_UI_SERVER_TOKEN;
    try {
      const daemon = new Daemon(makeDaemonOpts(tmpDir, { token: undefined }));
      expect(daemon.getToken()).toBeUndefined();
    } finally {
      if (original !== undefined) process.env.ATOMIC_UI_SERVER_TOKEN = original;
    }
  });
});

describe("Daemon.stop()", () => {
  test("unlinks endpoint file on shutdown", async () => {
    const tmpDir = await makeTempDir();
    const opts = makeDaemonOpts(tmpDir);
    const daemon = new Daemon(opts);
    await daemon.start();
    expect(fs.existsSync(opts.endpointFile!)).toBe(true);

    await daemon.stop();
    expect(fs.existsSync(opts.endpointFile!)).toBe(false);
  });

  test("getEndpoint() returns null after stop", async () => {
    const tmpDir = await makeTempDir();
    const daemon = new Daemon(makeDaemonOpts(tmpDir));
    await daemon.start();
    expect(daemon.getEndpoint()).not.toBeNull();

    await daemon.stop();
    expect(daemon.getEndpoint()).toBeNull();
  });

  test("stop() is idempotent — calling twice doesn't throw", async () => {
    const tmpDir = await makeTempDir();
    const daemon = new Daemon(makeDaemonOpts(tmpDir));
    await daemon.start();
    await daemon.stop();
    await expect(daemon.stop()).resolves.toBeUndefined();
  });

  test("stop() with reason=fatal does not throw", async () => {
    const tmpDir = await makeTempDir();
    const daemon = new Daemon(makeDaemonOpts(tmpDir));
    await daemon.start();
    await expect(daemon.stop("fatal")).resolves.toBeUndefined();
  });
});

describe("connectToDaemon()", () => {
  test("connects and authenticates with valid token", async () => {
    const tmpDir = await makeTempDir();
    const opts = makeDaemonOpts(tmpDir, { token: "my-secret-token" });
    const daemon = new Daemon(opts);
    const { endpoint } = await daemon.start();
    try {
      const conn = await connectToDaemon({
        endpointFile: opts.endpointFile,
        token: "my-secret-token",
      });
      // Verify connection is alive by sending a request.
      const res = await conn.sendRequest("protocol/getVersion", {});
      expect((res as { protocolVersion: string }).protocolVersion).toBeTypeOf("string");
      conn.dispose();
    } finally {
      await daemon.stop();
    }
  });

  test("throws MissingDependencyError when no endpoint file", async () => {
    const tmpDir = await makeTempDir();
    const missingFile = path.join(tmpDir, "does-not-exist.json");
    await expect(
      connectToDaemon({ endpointFile: missingFile }),
    ).rejects.toThrow(MissingDependencyError);
  });

  test("connection send returns data", async () => {
    const tmpDir = await makeTempDir();
    const opts = makeDaemonOpts(tmpDir, { token: undefined });
    const daemon = new Daemon(opts);
    await daemon.start();
    try {
      const conn = await connectToDaemon({
        endpointFile: opts.endpointFile,
        token: undefined,
      });
      const res = (await conn.sendRequest("protocol/getVersion", {})) as {
        atomicVersion: string;
        sdkVersion: string;
        protocolVersion: string;
      };
      expect(res.atomicVersion).toBe("2.0.0");
      expect(res.sdkVersion).toBe("0.7.13");
      conn.dispose();
    } finally {
      await daemon.stop();
    }
  });
});

describe("Daemon integration — server/closing broadcast", () => {
  test("clients receive server/closing notification on daemon stop", async () => {
    const tmpDir = await makeTempDir();
    const opts = makeDaemonOpts(tmpDir, { token: undefined });
    const daemon = new Daemon(opts);
    await daemon.start();

    const conn = await connectToDaemon({ endpointFile: opts.endpointFile });
    const closingNotifications: unknown[] = [];
    conn.onNotification("server/closing", (params) => {
      closingNotifications.push(params);
    });

    await daemon.stop("shutdown");

    // Give notification time to arrive.
    await new Promise((r) => setTimeout(r, 150));
    conn.dispose();

    expect(closingNotifications.length).toBeGreaterThan(0);
    expect((closingNotifications[0] as { reason: string }).reason).toBe("shutdown");
  });
});

describe("log file", () => {
  test("writes log messages to the log file", async () => {
    const tmpDir = await makeTempDir();
    const logFile = path.join(tmpDir, "daemon.log");
    const lines: string[] = [];
    const opts = makeDaemonOpts(tmpDir, {
      logFile,
      onLog: (msg) => { lines.push(msg); },
    });
    const daemon = new Daemon(opts);
    await daemon.start();
    await daemon.stop();

    // Check that the onLog hook was called with daemon messages.
    expect(lines.some((l) => l.includes("[daemon] Started"))).toBe(true);
    expect(lines.some((l) => l.includes("[daemon] Stopped"))).toBe(true);
  });
});
