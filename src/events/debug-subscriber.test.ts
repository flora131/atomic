/**
 * Unit tests for debug-subscriber JSONL logging
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import {
  cleanup,
  initEventLog,
  readEventLog,
  listEventLogs,
  type EventLogEntry,
} from "./debug-subscriber.ts";
import type { BusEvent } from "./bus-events.ts";

describe("Debug Subscriber JSONL Logging", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "atomic-debug-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("initEventLog() creates a JSONL file and writes events", async () => {
    const { write, close, logPath } = await initEventLog({
      dev: true,
      logDir: testDir,
    });
    
    const event: BusEvent = {
      type: "stream.text.delta",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "hello", messageId: "m1" },
    };

    write(event);
    await close();

    // Read the file to verify
    const entries = await readEventLog(logPath);
    expect(entries.length).toBe(1);
    expect(entries[0]!.type).toBe("stream.text.delta");
    expect(entries[0]!.sessionId).toBe("test-session");
    expect(entries[0]!.runId).toBe(1);
    expect((entries[0]!.data as any).delta).toBe("hello");
  });

  test("readEventLog() returns empty array for non-existent file", async () => {
    const entries = await readEventLog("/tmp/nonexistent-file.jsonl");
    expect(entries).toEqual([]);
  });

  test("readEventLog() supports filter function", async () => {
    const { write, close, logPath } = await initEventLog({
      dev: true,
      logDir: testDir,
    });

    const events: BusEvent[] = [
      { type: "stream.text.delta", sessionId: "s1", runId: 1, timestamp: Date.now(), data: { delta: "a", messageId: "m1" } },
      { type: "stream.tool.start", sessionId: "s1", runId: 1, timestamp: Date.now(), data: { toolId: "t1", toolName: "bash", toolInput: {} } },
      { type: "stream.text.delta", sessionId: "s1", runId: 1, timestamp: Date.now(), data: { delta: "b", messageId: "m1" } },
    ];

    for (const event of events) {
      write(event);
    }
    await close();

    const filtered = await readEventLog(logPath, (entry) => entry.type === "stream.text.delta");
    expect(filtered.length).toBe(2);
  });

  test("cleanup() retains only MAX_LOG_FILES most recent files", async () => {
    // Create 12 fake log files in testDir
    for (let i = 0; i < 12; i++) {
      const hour = String(i).padStart(2, "0");
      const filename = `2026-02-26T${hour}0000.events.jsonl`;
      await Bun.write(join(testDir, filename), `{"ts":"test"}\n`);
    }

    await cleanup(testDir);

    const glob = new Bun.Glob("????-??-??T??????.events.jsonl");
    const remaining: string[] = [];
    for await (const file of glob.scan({ cwd: testDir })) {
      remaining.push(file);
    }

    expect(remaining.length).toBe(10);
  });

  test("listEventLogs() returns files most recent first", async () => {
    // Create a few log files
    await Bun.write(join(testDir, "2026-02-26T100000.events.jsonl"), "");
    await Bun.write(join(testDir, "2026-02-26T120000.events.jsonl"), "");
    await Bun.write(join(testDir, "2026-02-26T080000.events.jsonl"), "");

    const logs = await listEventLogs(testDir);
    expect(logs.length).toBe(3);
    expect(logs[0]).toContain("120000");
    expect(logs[1]).toContain("100000");
    expect(logs[2]).toContain("080000");
  });

  test("JSONL entries have correct format", async () => {
    const { write, close, logPath } = await initEventLog({
      dev: true,
      logDir: testDir,
    });

    const now = Date.now();
    write({
      type: "stream.usage",
      sessionId: "s1",
      runId: 42,
      timestamp: now,
      data: { inputTokens: 100, outputTokens: 50, model: "gpt-4" },
    });
    await close();

    const content = await Bun.file(logPath).text();
    const parsed = JSON.parse(content.trim()) as EventLogEntry;
    
    expect(parsed.ts).toBe(new Date(now).toISOString());
    expect(parsed.type).toBe("stream.usage");
    expect(parsed.sessionId).toBe("s1");
    expect(parsed.runId).toBe(42);
    expect((parsed.data as any).inputTokens).toBe(100);
  });
});
