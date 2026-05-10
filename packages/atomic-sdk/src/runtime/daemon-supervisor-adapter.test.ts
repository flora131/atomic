/**
 * DaemonSupervisorAdapter unit tests.
 *
 * Uses a fake IPtySpawner so no real processes are spawned.
 * Mocks Bun.which to control binary resolution.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { DaemonSupervisorAdapter } from "./daemon-supervisor-adapter.ts";
import { Supervisor, type IPtySpawner } from "./supervisor.ts";
import { AtomicErrorCode } from "./ui-protocol/errors.ts";
import type { IPty, IExitEvent, IDisposable, IPtyForkOptions } from "bun-pty";

// ─── Fake PTY ─────────────────────────────────────────────────────────────────

class FakePty implements IPty {
  readonly pid: number;
  readonly cols = 120;
  readonly rows = 40;
  readonly process = "fake";
  killed: string[] = [];
  writtenData: string[] = [];

  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(e: IExitEvent) => void> = [];

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

  write(data: string): void { this.writtenData.push(data); }
  resize(_cols: number, _rows: number): void {}
  kill(signal = "SIGTERM"): void { this.killed.push(signal); }

  emitData(data: string): void { for (const l of this.dataListeners) l(data); }
  emitExit(exitCode: number, signal?: string): void { for (const l of this.exitListeners) l({ exitCode, signal }); }
}

class FakeSpawner implements IPtySpawner {
  ptys: FakePty[] = [];
  lastOpts: IPtyForkOptions | null = null;
  lastFile: string | null = null;
  lastArgs: string[] | null = null;
  private nextPid = 1000;

  spawn(file: string, args: string[], opts: IPtyForkOptions): IPty {
    this.lastFile = file;
    this.lastArgs = args;
    this.lastOpts = opts;
    const pty = new FakePty(this.nextPid++);
    this.ptys.push(pty);
    return pty;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAdapter(spawner: FakeSpawner): { adapter: DaemonSupervisorAdapter; sup: Supervisor } {
  const sup = new Supervisor(spawner);
  const adapter = new DaemonSupervisorAdapter({ supervisor: sup });
  return { adapter, sup };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DaemonSupervisorAdapter", () => {
  let spawner: FakeSpawner;
  let adapter: DaemonSupervisorAdapter;

  beforeEach(() => {
    spawner = new FakeSpawner();
    ({ adapter } = makeAdapter(spawner));
  });

  describe("spawn", () => {
    it("resolves agent binary via Bun.which and returns pid", async () => {
      // Mock Bun.which to return a fake path.
      const originalWhich = Bun.which;
      (Bun as { which: typeof Bun.which }).which = mock(() => "/usr/local/bin/claude");

      try {
        const result = await adapter.spawn({
          runId: "run-1",
          stageName: "main",
          agent: "claude",
          args: ["--some-flag"],
          env: { FOO: "bar" },
        });

        expect(result.pid).toBe(1000);
        expect(spawner.lastFile).toBe("/usr/local/bin/claude");
        expect(spawner.lastArgs).toEqual(["--some-flag"]);
        expect(spawner.lastOpts?.env?.FOO).toBe("bar");
      } finally {
        (Bun as { which: typeof Bun.which }).which = originalWhich;
      }
    });

    it("resolves agent binary with the caller-provided PATH from env", async () => {
      const originalWhich = Bun.which;
      const which = mock((_cmd: string, _opts?: { PATH?: string }) => "/custom/bin/opencode");
      (Bun as { which: typeof Bun.which }).which = which as typeof Bun.which;

      try {
        await adapter.spawn({
          runId: "run-1",
          stageName: "main",
          agent: "opencode",
          args: [],
          env: { PATH: "/custom/bin" },
        });

        expect(which).toHaveBeenCalledWith("opencode", { PATH: "/custom/bin" });
        expect(spawner.lastFile).toBe("/custom/bin/opencode");
      } finally {
        (Bun as { which: typeof Bun.which }).which = originalWhich;
      }
    });

    it("uses COPILOT_CLI_PATH from env for Copilot chat spawns", async () => {
      const originalWhich = Bun.which;
      const which = mock(() => null);
      (Bun as { which: typeof Bun.which }).which = which as typeof Bun.which;

      try {
        const result = await adapter.spawn({
          runId: "run-1",
          stageName: "main",
          agent: "copilot",
          args: ["--experimental"],
          env: { COPILOT_CLI_PATH: "/custom/bin/copilot-native" },
        });

        expect(result.pid).toBe(1000);
        expect(which).not.toHaveBeenCalled();
        expect(spawner.lastFile).toBe("/custom/bin/copilot-native");
        expect(spawner.lastArgs).toEqual(["--experimental"]);
      } finally {
        (Bun as { which: typeof Bun.which }).which = originalWhich;
      }
    });

    it("throws MISSING_DEPENDENCY when agent binary not in PATH", async () => {
      const originalWhich = Bun.which;
      (Bun as { which: typeof Bun.which }).which = mock(() => null);

      try {
        await expect(
          adapter.spawn({ runId: "run-1", stageName: "main", agent: "claude", args: [] }),
        ).rejects.toMatchObject({ code: AtomicErrorCode.MISSING_DEPENDENCY });
      } finally {
        (Bun as { which: typeof Bun.which }).which = originalWhich;
      }
    });

    it("throws PTY_FAILED when spawner throws", async () => {
      const failSpawner: IPtySpawner = {
        spawn() { throw new Error("pty open failed"); },
      };
      const sup = new Supervisor(failSpawner);
      const failAdapter = new DaemonSupervisorAdapter({ supervisor: sup });

      const originalWhich = Bun.which;
      (Bun as { which: typeof Bun.which }).which = mock(() => "/usr/local/bin/claude");

      try {
        await expect(
          failAdapter.spawn({ runId: "run-1", stageName: "main", agent: "claude", args: [] }),
        ).rejects.toMatchObject({ code: AtomicErrorCode.PTY_FAILED });
      } finally {
        (Bun as { which: typeof Bun.which }).which = originalWhich;
      }
    });
  });

  describe("sendInput", () => {
    it("forwards data to PTY via supervisor", async () => {
      const originalWhich = Bun.which;
      (Bun as { which: typeof Bun.which }).which = mock(() => "/usr/local/bin/claude");
      try {
        await adapter.spawn({ runId: "run-1", stageName: "main", agent: "claude", args: [] });
      } finally {
        (Bun as { which: typeof Bun.which }).which = originalWhich;
      }

      adapter.sendInput("run-1", "main", "hello\n");
      expect(spawner.ptys[0]!.writtenData).toEqual(["hello\n"]);
    });

    it("throws STAGE_NOT_FOUND for unknown stage", () => {
      expect(() => adapter.sendInput("no-run", "no-stage", "x")).toThrow();
    });
  });

  describe("getScrollback", () => {
    it("returns data and headOffset from ring buffer", async () => {
      const originalWhich = Bun.which;
      (Bun as { which: typeof Bun.which }).which = mock(() => "/usr/local/bin/claude");
      try {
        await adapter.spawn({ runId: "run-1", stageName: "main", agent: "claude", args: [] });
      } finally {
        (Bun as { which: typeof Bun.which }).which = originalWhich;
      }

      spawner.ptys[0]!.emitData("line1\n");
      spawner.ptys[0]!.emitData("line2\n");

      const result = adapter.getScrollback("run-1", "main");
      expect(result.data).toBe("line1\nline2\n");
      expect(result.headOffset).toBe(12);
    });

    it("throws STAGE_NOT_FOUND for unknown stage", () => {
      expect(() => adapter.getScrollback("no-run", "no-stage")).toThrow();
    });
  });

  describe("kill", () => {
    it("sends SIGTERM by default via killByPid", async () => {
      const originalWhich = Bun.which;
      (Bun as { which: typeof Bun.which }).which = mock(() => "/usr/local/bin/claude");
      try {
        await adapter.spawn({ runId: "run-1", stageName: "main", agent: "claude", args: [] });
      } finally {
        (Bun as { which: typeof Bun.which }).which = originalWhich;
      }

      const pid = spawner.ptys[0]!.pid;
      adapter.kill(pid);
      expect(spawner.ptys[0]!.killed).toContain("SIGTERM");
    });

    it("sends SIGKILL when specified", async () => {
      const originalWhich = Bun.which;
      (Bun as { which: typeof Bun.which }).which = mock(() => "/usr/local/bin/claude");
      try {
        await adapter.spawn({ runId: "run-1", stageName: "main", agent: "claude", args: [] });
      } finally {
        (Bun as { which: typeof Bun.which }).which = originalWhich;
      }

      const pid = spawner.ptys[0]!.pid;
      adapter.kill(pid, "SIGKILL");
      expect(spawner.ptys[0]!.killed).toContain("SIGKILL");
    });

    it("throws STAGE_NOT_FOUND for unknown pid", () => {
      expect(() => adapter.kill(99999)).toThrow();
    });
  });
});
