import { test, expect, describe } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProductionTelemetrySink } from "./index.ts";

describe("getProductionTelemetrySink", () => {
  test("creates telemetry.jsonl with correct content after two emits", async () => {
    // Skip on Windows (no mode 0o600 support)
    if (process.platform === "win32") return;

    const baseDir = await fs.mkdtemp(join(tmpdir(), "telemetry-test-"));
    const runId = "test-run-abc123";
    const sink = getProductionTelemetrySink(runId, baseDir);

    sink.emit("test.event.one", { key: "value1" });
    sink.emit("test.event.two", { key: "value2" });

    // Poll until file has content (up to 1s)
    const filePath = join(baseDir, runId, "telemetry.jsonl");
    const deadline = Date.now() + 1000;
    let content = "";
    while (Date.now() < deadline) {
      try {
        content = await fs.readFile(filePath, "utf8");
        if (content.trim().split("\n").length >= 2) break;
      } catch {
        // file may not exist yet
      }
      await Bun.sleep(20);
    }

    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    // fire-and-forget — order not guaranteed; sort by event name for stable assertions
    const parsed = lines.map((l) => JSON.parse(l)).sort(
      (a: { event: string }, b: { event: string }) => a.event.localeCompare(b.event),
    );

    const parsed0 = parsed[0]!;
    expect(parsed0.event).toBe("test.event.one");
    expect(parsed0.payload).toEqual({ key: "value1" });
    expect(typeof parsed0.ts).toBe("number");

    const parsed1 = parsed[1]!;
    expect(parsed1.event).toBe("test.event.two");
    expect(parsed1.payload).toEqual({ key: "value2" });

    // Assert file mode 0o600
    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);

    // Cleanup
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  test("multiple sinks with same runId append to same file", async () => {
    if (process.platform === "win32") return;

    const baseDir = await fs.mkdtemp(join(tmpdir(), "telemetry-test2-"));
    const runId = "shared-run";

    const sink1 = getProductionTelemetrySink(runId, baseDir);
    const sink2 = getProductionTelemetrySink(runId, baseDir);

    sink1.emit("event.from.sink1", { x: 1 });
    sink2.emit("event.from.sink2", { x: 2 });

    const filePath = join(baseDir, runId, "telemetry.jsonl");
    const deadline = Date.now() + 1000;
    let content = "";
    while (Date.now() < deadline) {
      try {
        content = await fs.readFile(filePath, "utf8");
        if (content.trim().split("\n").length >= 2) break;
      } catch {
        // not yet
      }
      await Bun.sleep(20);
    }

    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    await fs.rm(baseDir, { recursive: true, force: true });
  });
});
