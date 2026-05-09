import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

import { getProductionTelemetrySink } from "./index.ts";

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "telemetry-"));
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

/** Wait for any pending async work scheduled inside `emit`. */
async function flushMicrotasks(): Promise<void> {
  // Two ticks: one for ensureDir's mkdir resolution, one for the appendFile chain.
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
}

describe("getProductionTelemetrySink", () => {
  test("appends a JSON line to <baseDir>/<runId>/telemetry.jsonl", async () => {
    const runId = "run-1";
    const sink = getProductionTelemetrySink(runId, baseDir);

    sink.emit("offload.scheduled", { count: 3 });
    await flushMicrotasks();

    const path = join(baseDir, runId, "telemetry.jsonl");
    const contents = await fs.readFile(path, "utf8");
    const lines = contents.trim().split("\n");
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0] ?? "{}");
    expect(entry.event).toBe("offload.scheduled");
    expect(entry.payload).toEqual({ count: 3 });
    expect(typeof entry.ts).toBe("number");
  });

  test("appends multiple events without collision", async () => {
    // emit is fire-and-forget, so the appendFile order across concurrent
    // emits isn't guaranteed once mkdir resolves. The contract is "all
    // events land in the file, one line each" — not write-order parity.
    const sink = getProductionTelemetrySink("run-2", baseDir);

    sink.emit("a", { i: 1 });
    sink.emit("b", { i: 2 });
    sink.emit("c", { i: 3 });
    await flushMicrotasks();

    const path = join(baseDir, "run-2", "telemetry.jsonl");
    const lines = (await fs.readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(3);
    const events = lines.map((l) => JSON.parse(l).event).sort();
    expect(events).toEqual(["a", "b", "c"]);
  });

  test("creates the runId subdirectory lazily on first emit", async () => {
    const runId = "run-3";
    const sink = getProductionTelemetrySink(runId, baseDir);
    const dirPath = join(baseDir, runId);

    // No directory yet — sink construction is side-effect-free.
    expect(existsSync(dirPath)).toBe(false);

    sink.emit("ping", {});
    await flushMicrotasks();

    expect(existsSync(dirPath)).toBe(true);
  });

  test("catch branch warns on appendFile failure (does not throw)", async () => {
    // mkdir succeeds, but appendFile fails — exercises the .catch() lambda.
    const sink = getProductionTelemetrySink("run-4", baseDir);

    const originalAppend = fs.appendFile;
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = mock((msg: string) => {
      warnings.push(msg);
    });

    // Force appendFile to reject.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fs as any).appendFile = mock(async () => {
      throw new Error("disk full");
    });

    try {
      // emit returns void synchronously — failure is observed via console.warn.
      expect(() => sink.emit("evt", {})).not.toThrow();
      await flushMicrotasks();

      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings.some((w) => w.includes("[telemetry]") && w.includes("disk full"))).toBe(
        true,
      );
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs as any).appendFile = originalAppend;
      console.warn = originalWarn;
    }
  });
});
