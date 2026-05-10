/**
 * Supervisor unit tests — use a fake PTY spawner, no real processes.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Supervisor, RingBuffer, type IPtySpawner, type SpawnOptions } from "./supervisor.ts";
import type { IPty, IExitEvent, IDisposable, IPtyForkOptions } from "bun-pty";
import { AtomicRpcError } from "./ui-protocol/errors.ts";
import { AtomicErrorCode } from "./ui-protocol/errors.ts";

// ─── Fake PTY ─────────────────────────────────────────────────────────────────

class FakePty implements IPty {
  readonly pid: number;
  readonly cols = 120;
  readonly rows = 40;
  readonly process = "fake";

  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(e: IExitEvent) => void> = [];
  writtenData: string[] = [];
  killed: string[] = [];

  constructor(pid: number) {
    this.pid = pid;
  }

  onData(listener: (data: string) => void): IDisposable {
    this.dataListeners.push(listener);
    return { dispose: () => { this.dataListeners = this.dataListeners.filter(l => l !== listener); } };
  }

  onExit(listener: (e: IExitEvent) => void): IDisposable {
    this.exitListeners.push(listener);
    return { dispose: () => { this.exitListeners = this.exitListeners.filter(l => l !== listener); } };
  }

  write(data: string): void {
    this.writtenData.push(data);
  }

  resize(_cols: number, _rows: number): void {}

  kill(signal = "SIGTERM"): void {
    this.killed.push(signal);
  }

  // test helpers
  emitData(data: string): void {
    for (const l of this.dataListeners) l(data);
  }

  emitExit(exitCode: number, signal?: string): void {
    for (const l of this.exitListeners) l({ exitCode, signal });
  }
}

// ─── Fake Spawner ─────────────────────────────────────────────────────────────

class FakeSpawner implements IPtySpawner {
  private nextPid = 1000;
  public ptys: FakePty[] = [];
  public spawnCalls: Array<{ file: string; args: string[]; opts: IPtyForkOptions }> = [];
  public shouldThrow: string | null = null;

  spawn(file: string, args: string[], opts: IPtyForkOptions): IPty {
    if (this.shouldThrow) throw new Error(this.shouldThrow);
    this.spawnCalls.push({ file, args, opts });
    const pty = new FakePty(this.nextPid++);
    this.ptys.push(pty);
    return pty;
  }

  get lastPty(): FakePty {
    return this.ptys[this.ptys.length - 1]!;
  }
}

// ─── Fake MessageConnection ───────────────────────────────────────────────────

interface NotificationCall {
  method: string;
  params: unknown;
}

class FakeConnection {
  notifications: NotificationCall[] = [];
  shouldThrow = false;

  sendNotification(method: string, params: unknown): void {
    if (this.shouldThrow) throw new Error("connection error");
    this.notifications.push({ method, params });
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeSpawnOpts(
  overrides: Partial<SpawnOptions> = {},
): SpawnOptions {
  return {
    runId: "run-1",
    stageName: "stage-1",
    agent: "claude",
    file: "/usr/bin/cat",
    args: [],
    cwd: "/tmp",
    ...overrides,
  };
}

// ─── RingBuffer tests ─────────────────────────────────────────────────────────

describe("RingBuffer", () => {
  it("starts empty", () => {
    const buf = new RingBuffer(100);
    expect(buf.headOffset).toBe(0);
    expect(buf.length).toBe(0);
    expect(buf.getFrom(0)).toBe("");
  });

  it("appends data and returns it from offset 0", () => {
    const buf = new RingBuffer(100);
    buf.append("hello");
    buf.append(" world");
    expect(buf.headOffset).toBe(11);
    expect(buf.getFrom(0)).toBe("hello world");
  });

  it("returns slice from mid-stream offset", () => {
    const buf = new RingBuffer(100);
    buf.append("hello");
    buf.append(" world");
    // offset 5 = start of " world"
    expect(buf.getFrom(5)).toBe(" world");
  });

  it("returns empty string for offset >= headOffset", () => {
    const buf = new RingBuffer(100);
    buf.append("hi");
    expect(buf.getFrom(2)).toBe("");
    expect(buf.getFrom(99)).toBe("");
  });

  it("evicts oldest data when capacity exceeded", () => {
    const buf = new RingBuffer(5);
    buf.append("12345"); // fills exactly
    buf.append("67");    // evicts "12", now contains "34567"
    expect(buf.headOffset).toBe(7);
    expect(buf.length).toBe(5);
    // fromOffset=0 → returns everything retained
    expect(buf.getFrom(0)).toBe("34567");
    // fromOffset=2 → points into evicted zone → return all retained
    expect(buf.getFrom(2)).toBe("34567");
    // fromOffset=3 → "4567"
    expect(buf.getFrom(3)).toBe("4567");
  });

  it("large multi-eviction: always returns up to capacity", () => {
    const buf = new RingBuffer(4);
    for (let i = 0; i < 10; i++) buf.append("ab");
    // 20 total chars written, 4 retained
    expect(buf.headOffset).toBe(20);
    expect(buf.length).toBe(4);
    // All from base should be the last 4 chars
    const all = buf.getFrom(0);
    expect(all.length).toBe(4);
  });
});

// ─── Supervisor — spawn ───────────────────────────────────────────────────────

describe("Supervisor.spawn", () => {
  let spawner: FakeSpawner;
  let sup: Supervisor;

  beforeEach(() => {
    spawner = new FakeSpawner();
    sup = new Supervisor(spawner);
  });

  afterEach(() => sup.dispose());

  it("spawns PTY with correct options", () => {
    sup.spawn(makeSpawnOpts({ cols: 80, rows: 24, cwd: "/project", env: { FOO: "bar" } }));
    expect(spawner.spawnCalls).toHaveLength(1);
    const call = spawner.spawnCalls[0]!;
    expect(call.file).toBe("/usr/bin/cat");
    expect(call.opts.name).toBe("xterm-256color");
    expect(call.opts.cols).toBe(80);
    expect(call.opts.rows).toBe(24);
    expect(call.opts.cwd).toBe("/project");
    expect((call.opts.env as Record<string, string>)["FOO"]).toBe("bar");
  });

  it("returns pid from PTY", () => {
    const result = sup.spawn(makeSpawnOpts());
    expect(result.pid).toBe(spawner.lastPty.pid);
  });

  it("uses default cols/rows when not specified", () => {
    sup.spawn(makeSpawnOpts());
    expect(spawner.spawnCalls[0]!.opts.cols).toBe(120);
    expect(spawner.spawnCalls[0]!.opts.rows).toBe(40);
  });

  it("throws PTY_FAILED when spawner throws", () => {
    spawner.shouldThrow = "no pty available";
    expect(() => sup.spawn(makeSpawnOpts())).toThrow();
    try {
      sup.spawn(makeSpawnOpts());
    } catch (err) {
      expect(err).toBeInstanceOf(AtomicRpcError);
      expect((err as AtomicRpcError).code).toBe(AtomicErrorCode.PTY_FAILED);
    }
  });

  it("throws PTY_FAILED on duplicate stage key", () => {
    sup.spawn(makeSpawnOpts());
    expect(() => sup.spawn(makeSpawnOpts())).toThrow();
    try {
      sup.spawn(makeSpawnOpts());
    } catch (err) {
      expect(err).toBeInstanceOf(AtomicRpcError);
      expect((err as AtomicRpcError).code).toBe(AtomicErrorCode.PTY_FAILED);
    }
  });

  it("tracks stage and pid index", () => {
    const { pid } = sup.spawn(makeSpawnOpts());
    expect(sup.hasStage("run-1", "stage-1")).toBe(true);
    expect(sup.getPid("run-1", "stage-1")).toBe(pid);
    expect(sup.stageCount).toBe(1);
  });

  it("allows multiple distinct stages", () => {
    sup.spawn(makeSpawnOpts({ stageName: "a" }));
    sup.spawn(makeSpawnOpts({ stageName: "b" }));
    expect(sup.stageCount).toBe(2);
  });
});

// ─── Supervisor — scrollback ──────────────────────────────────────────────────

describe("Supervisor scrollback", () => {
  let spawner: FakeSpawner;
  let sup: Supervisor;

  beforeEach(() => {
    spawner = new FakeSpawner();
    sup = new Supervisor(spawner);
    sup.spawn(makeSpawnOpts());
  });

  afterEach(() => sup.dispose());

  it("accumulates PTY output in scrollback", () => {
    spawner.lastPty.emitData("hello");
    spawner.lastPty.emitData(" world");
    const result = sup.getScrollback("run-1", "stage-1");
    expect(result.data).toBe("hello world");
    expect(result.headOffset).toBe(11);
  });

  it("getScrollback with fromOffset returns tail", () => {
    spawner.lastPty.emitData("hello world");
    const result = sup.getScrollback("run-1", "stage-1", 6);
    expect(result.data).toBe("world");
  });

  it("getScrollback fromOffset=0 returns all", () => {
    spawner.lastPty.emitData("abc");
    const result = sup.getScrollback("run-1", "stage-1", 0);
    expect(result.data).toBe("abc");
  });

  it("respects custom scrollbackCapacity", () => {
    // small capacity: 5 bytes
    sup.spawn(makeSpawnOpts({ runId: "run-2", stageName: "small", scrollbackCapacity: 5 }));
    const pty = spawner.ptys[1]!;
    pty.emitData("12345678"); // 8 chars, only last 5 retained
    const result = sup.getScrollback("run-2", "small");
    expect(result.data.length).toBe(5);
  });

  it("throws STAGE_NOT_FOUND for unknown stage", () => {
    try {
      sup.getScrollback("run-1", "no-such-stage");
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(AtomicRpcError);
      expect((err as AtomicRpcError).code).toBe(AtomicErrorCode.STAGE_NOT_FOUND);
    }
  });
});

// ─── Supervisor — sendInput ───────────────────────────────────────────────────

describe("Supervisor.sendInput", () => {
  let spawner: FakeSpawner;
  let sup: Supervisor;

  beforeEach(() => {
    spawner = new FakeSpawner();
    sup = new Supervisor(spawner);
    sup.spawn(makeSpawnOpts());
  });

  afterEach(() => sup.dispose());

  it("forwards data to PTY write()", () => {
    sup.sendInput("run-1", "stage-1", "ls -la\n");
    expect(spawner.lastPty.writtenData).toEqual(["ls -la\n"]);
  });

  it("multiple writes accumulate", () => {
    sup.sendInput("run-1", "stage-1", "a");
    sup.sendInput("run-1", "stage-1", "b");
    expect(spawner.lastPty.writtenData).toEqual(["a", "b"]);
  });

  it("throws STAGE_NOT_FOUND for unknown stage", () => {
    try {
      sup.sendInput("run-1", "bad", "data");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(AtomicRpcError);
      expect((err as AtomicRpcError).code).toBe(AtomicErrorCode.STAGE_NOT_FOUND);
    }
  });
});

// ─── Supervisor — kill ────────────────────────────────────────────────────────

describe("Supervisor kill", () => {
  let spawner: FakeSpawner;
  let sup: Supervisor;

  beforeEach(() => {
    spawner = new FakeSpawner();
    sup = new Supervisor(spawner);
    sup.spawn(makeSpawnOpts());
  });

  afterEach(() => sup.dispose());

  it("killByPid sends SIGTERM by default", () => {
    const pid = spawner.lastPty.pid;
    sup.killByPid(pid);
    expect(spawner.lastPty.killed).toEqual(["SIGTERM"]);
  });

  it("killByPid sends specified signal", () => {
    const pid = spawner.lastPty.pid;
    sup.killByPid(pid, "SIGKILL");
    expect(spawner.lastPty.killed).toEqual(["SIGKILL"]);
  });

  it("killStage sends SIGTERM by default", () => {
    sup.killStage("run-1", "stage-1");
    expect(spawner.lastPty.killed).toEqual(["SIGTERM"]);
  });

  it("killStage with signal", () => {
    sup.killStage("run-1", "stage-1", "SIGKILL");
    expect(spawner.lastPty.killed).toEqual(["SIGKILL"]);
  });

  it("killByPid throws STAGE_NOT_FOUND for unknown pid", () => {
    try {
      sup.killByPid(99999);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(AtomicRpcError);
      expect((err as AtomicRpcError).code).toBe(AtomicErrorCode.STAGE_NOT_FOUND);
    }
  });

  it("killStage throws STAGE_NOT_FOUND for unknown stage", () => {
    try {
      sup.killStage("run-1", "bad");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(AtomicRpcError);
      expect((err as AtomicRpcError).code).toBe(AtomicErrorCode.STAGE_NOT_FOUND);
    }
  });
});

// ─── Supervisor — pane/output notifications ───────────────────────────────────

describe("Supervisor pane/output notifications", () => {
  let spawner: FakeSpawner;
  let sup: Supervisor;
  let conn: FakeConnection;

  beforeEach(() => {
    spawner = new FakeSpawner();
    sup = new Supervisor(spawner);
    sup.spawn(makeSpawnOpts());
    conn = new FakeConnection();
  });

  afterEach(() => sup.dispose());

  it("broadcasts pane/output to subscribers on PTY data", () => {
    sup.subscribeOutput("run-1", "stage-1", conn as never);
    spawner.lastPty.emitData("hello");

    expect(conn.notifications).toHaveLength(1);
    const n = conn.notifications[0]!;
    expect(n.method).toBe("pane/output");
    expect((n.params as Record<string, unknown>)["runId"]).toBe("run-1");
    expect((n.params as Record<string, unknown>)["stageName"]).toBe("stage-1");
    expect((n.params as Record<string, unknown>)["data"]).toBe("hello");
    expect((n.params as Record<string, unknown>)["offset"]).toBe(0);
  });

  it("broadcasts to multiple subscribers", () => {
    const conn2 = new FakeConnection();
    sup.subscribeOutput("run-1", "stage-1", conn as never);
    sup.subscribeOutput("run-1", "stage-1", conn2 as never);
    spawner.lastPty.emitData("hi");

    expect(conn.notifications).toHaveLength(1);
    expect(conn2.notifications).toHaveLength(1);
  });

  it("offset increments across multiple data events", () => {
    sup.subscribeOutput("run-1", "stage-1", conn as never);
    spawner.lastPty.emitData("abc"); // offset=0
    spawner.lastPty.emitData("de");  // offset=3

    const offsets = conn.notifications.map(n => (n.params as Record<string, unknown>)["offset"]);
    expect(offsets).toEqual([0, 3]);
  });

  it("no notifications before subscribe", () => {
    spawner.lastPty.emitData("hidden");
    // subscribe after data
    sup.subscribeOutput("run-1", "stage-1", conn as never);
    expect(conn.notifications).toHaveLength(0);
  });

  it("no notifications after unsubscribe", () => {
    const subId = sup.subscribeOutput("run-1", "stage-1", conn as never);
    spawner.lastPty.emitData("before");
    sup.unsubscribeOutput(subId);
    spawner.lastPty.emitData("after");

    expect(conn.notifications).toHaveLength(1);
    expect((conn.notifications[0]!.params as Record<string, unknown>)["data"]).toBe("before");
  });

  it("subscribeOutput throws STAGE_NOT_FOUND for unknown stage", () => {
    try {
      sup.subscribeOutput("run-1", "bad", conn as never);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(AtomicRpcError);
      expect((err as AtomicRpcError).code).toBe(AtomicErrorCode.STAGE_NOT_FOUND);
    }
  });

  it("returns unique subscriptionIds", () => {
    const conn2 = new FakeConnection();
    const id1 = sup.subscribeOutput("run-1", "stage-1", conn as never);
    const id2 = sup.subscribeOutput("run-1", "stage-1", conn2 as never);
    expect(id1).not.toBe(id2);
  });

  it("outputSubCount tracks subscriptions", () => {
    expect(sup.outputSubCount).toBe(0);
    const id = sup.subscribeOutput("run-1", "stage-1", conn as never);
    expect(sup.outputSubCount).toBe(1);
    sup.unsubscribeOutput(id);
    expect(sup.outputSubCount).toBe(0);
  });
});

// ─── Supervisor — pane/exit notifications ─────────────────────────────────────

describe("Supervisor pane/exit notifications", () => {
  let spawner: FakeSpawner;
  let sup: Supervisor;
  let conn: FakeConnection;

  beforeEach(() => {
    spawner = new FakeSpawner();
    sup = new Supervisor(spawner);
    sup.spawn(makeSpawnOpts());
    conn = new FakeConnection();
    sup.subscribeOutput("run-1", "stage-1", conn as never);
  });

  afterEach(() => sup.dispose());

  it("broadcasts pane/exit on PTY exit", () => {
    spawner.lastPty.emitExit(0);

    const exits = conn.notifications.filter(n => n.method === "pane/exit");
    expect(exits).toHaveLength(1);
    const params = exits[0]!.params as Record<string, unknown>;
    expect(params["runId"]).toBe("run-1");
    expect(params["stageName"]).toBe("stage-1");
    expect(params["exitCode"]).toBe(0);
  });

  it("includes signal in pane/exit when present", () => {
    spawner.lastPty.emitExit(1, "SIGTERM");
    const exits = conn.notifications.filter(n => n.method === "pane/exit");
    const params = exits[0]!.params as Record<string, unknown>;
    expect(params["signal"]).toBe("SIGTERM");
    expect(params["exitCode"]).toBe(1);
  });

  it("omits signal field when no signal", () => {
    spawner.lastPty.emitExit(0);
    const exits = conn.notifications.filter(n => n.method === "pane/exit");
    const params = exits[0]!.params as Record<string, unknown>;
    expect("signal" in params).toBe(false);
  });

  it("records exit code on stage", () => {
    spawner.lastPty.emitExit(42);
    expect(sup.getExitCode("run-1", "stage-1")).toBe(42);
  });
});

// ─── Supervisor — StageCallbacks ──────────────────────────────────────────────

describe("Supervisor StageCallbacks", () => {
  let spawner: FakeSpawner;
  let sup: Supervisor;

  beforeEach(() => {
    spawner = new FakeSpawner();
    sup = new Supervisor(spawner);
  });

  afterEach(() => sup.dispose());

  it("invokes callbacks.onExit on exit", () => {
    const exits: Array<{ exitCode: number; signal?: string }> = [];
    sup.spawn(makeSpawnOpts({
      callbacks: {
        onExit(exitCode, signal) { exits.push({ exitCode, signal }); },
      },
    }));
    spawner.lastPty.emitExit(0);
    expect(exits).toEqual([{ exitCode: 0, signal: undefined }]);
  });

  it("callbacks.onExit receives non-zero exit code", () => {
    const exits: number[] = [];
    sup.spawn(makeSpawnOpts({
      callbacks: { onExit(code) { exits.push(code); } },
    }));
    spawner.lastPty.emitExit(1);
    expect(exits).toEqual([1]);
  });

  it("works without callbacks (no crash)", () => {
    sup.spawn(makeSpawnOpts()); // no callbacks
    expect(() => spawner.lastPty.emitExit(0)).not.toThrow();
  });
});

// ─── Supervisor — dispose ─────────────────────────────────────────────────────

describe("Supervisor.dispose", () => {
  let spawner: FakeSpawner;
  let sup: Supervisor;

  beforeEach(() => {
    spawner = new FakeSpawner();
    sup = new Supervisor(spawner);
  });

  it("kills all PTYs on dispose", () => {
    sup.spawn(makeSpawnOpts({ stageName: "a" }));
    sup.spawn(makeSpawnOpts({ stageName: "b" }));
    sup.dispose();
    for (const pty of spawner.ptys) {
      expect(pty.killed).toContain("SIGKILL");
    }
  });

  it("dispose is idempotent", () => {
    sup.spawn(makeSpawnOpts());
    sup.dispose();
    expect(() => sup.dispose()).not.toThrow();
  });

  it("clears stage tracking after dispose", () => {
    sup.spawn(makeSpawnOpts());
    sup.dispose();
    expect(sup.stageCount).toBe(0);
    expect(sup.outputSubCount).toBe(0);
  });
});
