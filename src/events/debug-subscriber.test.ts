/**
 * Unit tests for debug-subscriber JSONL logging
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import {
  attachDebugSubscriber,
  cleanup,
  initEventLog,
  readEventLog,
  listEventLogs,
  resolveStreamDebugLogConfig,
  type EventLogEntry,
} from "./debug-subscriber.ts";
import type { BusEvent } from "./bus-events.ts";
import { EventBus } from "./event-bus.ts";

const STREAM_DEBUG_ENV_KEYS = [
  "DEBUG",
  "LOG_DIR",
  "ATOMIC_DEBUG",
  "ATOMIC_STREAM_DEBUG_LOG",
  "ATOMIC_STREAM_DEBUG_LOG_DIR",
] as const;

describe("Debug Subscriber JSONL Logging", () => {
  let testDir: string;
  let previousEnv: Partial<Record<(typeof STREAM_DEBUG_ENV_KEYS)[number], string | undefined>>;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "atomic-debug-test-"));
    previousEnv = {};
    for (const key of STREAM_DEBUG_ENV_KEYS) {
      previousEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const key of STREAM_DEBUG_ENV_KEYS) {
      const previousValue = previousEnv[key];
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
    await rm(testDir, { recursive: true, force: true });
  });

  test("resolveStreamDebugLogConfig() enables via DEBUG", () => {
    const config = resolveStreamDebugLogConfig({
      DEBUG: "1",
    });
    expect(config.enabled).toBe(true);
    expect(config.logDir).toBeUndefined();
    expect(config.consolePreviewEnabled).toBe(true);
  });

  test("resolveStreamDebugLogConfig() supports custom log directory", () => {
    const customDir = "/tmp/AtomicDebugLogs";
    const config = resolveStreamDebugLogConfig({
      DEBUG: "1",
      LOG_DIR: customDir,
    });
    expect(config.enabled).toBe(true);
    expect(config.logDir).toBe(customDir);
  });

  test("resolveStreamDebugLogConfig() keeps ATOMIC_STREAM_DEBUG_LOG compatibility", () => {
    const customDir = "/tmp/AtomicDebugLogs";
    const config = resolveStreamDebugLogConfig({
      ATOMIC_STREAM_DEBUG_LOG: customDir,
    });
    expect(config.enabled).toBe(true);
    expect(config.logDir).toBe(customDir);
  });

  test("resolveStreamDebugLogConfig() keeps legacy ATOMIC_DEBUG compatibility", () => {
    const config = resolveStreamDebugLogConfig({
      ATOMIC_DEBUG: "1",
    });
    expect(config.enabled).toBe(true);
    expect(config.consolePreviewEnabled).toBe(true);
  });

  test("initEventLog() creates a JSONL file and writes events", async () => {
    const { write, close, logPath } = await initEventLog({
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
    expect(parsed.seq).toBe(1);
    expect(parsed.runSeq).toBe(1);
    expect(typeof parsed.loggedAt).toBe("string");
    expect(typeof parsed.eventLagMs).toBe("number");
    expect(parsed.globalGapMs).toBeNull();
    expect(parsed.sessionRunGapMs).toBeNull();
    expect(parsed.streamGapMs).toBeNull();
    expect(parsed.runAgeMs).toBe(0);
    expect(parsed.streamEventCount).toBe(1);
    expect(parsed.textDeltaCount).toBe(0);
    expect(parsed.pendingToolCalls).toBe(0);
    expect(parsed.maxPendingToolCalls).toBe(0);
    expect(parsed.lifecycleMarkers).toContain("run-first-seen");
    expect(parsed.lifecycleMarkers).toContain("first-stream-event");
    expect(parsed.payloadBytes).toBeGreaterThan(0);

    const usageData = parsed.data as { inputTokens: number };
    expect(usageData.inputTokens).toBe(100);
  });

  test("initEventLog() annotates continuity gaps and run-local sequence", async () => {
    const nowSpy = spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000);
    nowSpy.mockReturnValueOnce(3200);

    const { write, close, logPath } = await initEventLog({
      logDir: testDir,
    });

    write({
      type: "stream.text.delta",
      sessionId: "s-gap",
      runId: 9,
      timestamp: 1000,
      data: { delta: "a", messageId: "m-gap" },
    });

    write({
      type: "stream.text.delta",
      sessionId: "s-gap",
      runId: 9,
      timestamp: 1200,
      data: { delta: "b", messageId: "m-gap" },
    });

    nowSpy.mockRestore();
    await close();

    const entries = await readEventLog(logPath);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.runSeq).toBe(1);
    expect(entries[1]?.runSeq).toBe(2);
    expect(entries[1]?.globalGapMs).toBe(2200);
    expect(entries[1]?.sessionRunGapMs).toBe(2200);
    expect(entries[1]?.continuityGapMs).toBe(2200);
    expect(entries[1]?.streamGapMs).toBe(2200);
    expect(entries[1]?.lifecycleMarkers).toContain("stream-gap");
    expect(entries[1]?.lifecycleMarkers).toContain("continuity-gap");
  });

  test("initEventLog() records event timestamp regression per run", async () => {
    const nowSpy = spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(5000);
    nowSpy.mockReturnValueOnce(5200);

    const { write, close, logPath } = await initEventLog({
      logDir: testDir,
    });

    write({
      type: "stream.text.delta",
      sessionId: "s-regress",
      runId: 3,
      timestamp: 10_000,
      data: { delta: "first", messageId: "m-regress" },
    });

    write({
      type: "stream.text.delta",
      sessionId: "s-regress",
      runId: 3,
      timestamp: 9_600,
      data: { delta: "second", messageId: "m-regress" },
    });

    nowSpy.mockRestore();
    await close();

    const entries = await readEventLog(logPath);
    expect(entries[1]?.eventTimestampRegressionMs).toBe(400);
    expect(entries[1]?.lifecycleMarkers).toContain("timestamp-regression");
  });

  test("initEventLog() marks lifecycle transitions and tool balance anomalies", async () => {
    const nowSpy = spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000);
    nowSpy.mockReturnValueOnce(1100);
    nowSpy.mockReturnValueOnce(1400);

    const { write, close, logPath } = await initEventLog({
      logDir: testDir,
    });

    write({
      type: "stream.session.start",
      sessionId: "s-life",
      runId: 5,
      timestamp: 1000,
      data: {},
    });

    write({
      type: "stream.tool.start",
      sessionId: "s-life",
      runId: 5,
      timestamp: 1100,
      data: { toolId: "tool-1", toolName: "bash", toolInput: { command: "pwd" } },
    });

    write({
      type: "stream.session.idle",
      sessionId: "s-life",
      runId: 5,
      timestamp: 1400,
      data: { reason: "idle" },
    });

    nowSpy.mockRestore();
    await close();

    const entries = await readEventLog(logPath);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.lifecycleMarkers).toContain("session-start");
    expect(entries[1]?.pendingToolCalls).toBe(1);
    expect(entries[1]?.maxPendingToolCalls).toBe(1);
    expect(entries[2]?.lifecycleMarkers).toContain("session-idle");
    expect(entries[2]?.lifecycleMarkers).toContain("idle-with-pending-tools");
    expect(entries[2]?.runDurationMs).toBe(400);
  });

  test("initEventLog() flags tool complete without matching start", async () => {
    const nowSpy = spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(2000);

    const { write, close, logPath } = await initEventLog({
      logDir: testDir,
    });

    write({
      type: "stream.tool.complete",
      sessionId: "s-tool",
      runId: 8,
      timestamp: 2000,
      data: {
        toolId: "tool-2",
        toolName: "bash",
        toolResult: { ok: true },
        success: true,
      },
    });

    nowSpy.mockRestore();
    await close();

    const entries = await readEventLog(logPath);
    expect(entries[0]?.lifecycleMarkers).toContain("tool-complete-without-start");
    expect(entries[0]?.pendingToolCalls).toBe(0);
  });

  test("attachDebugSubscriber() logs all events when stream debug is enabled", async () => {
    process.env.DEBUG = "1";
    process.env.LOG_DIR = testDir;
    const debugSpy = spyOn(console, "debug").mockImplementation(() => {});

    const bus = new EventBus({ validatePayloads: false });
    const { unsubscribe, logPath } = await attachDebugSubscriber(bus);
    expect(logPath).not.toBeNull();

    bus.publish({
      type: "stream.text.delta",
      sessionId: "session-debug",
      runId: 7,
      timestamp: Date.now(),
      data: { delta: "debug", messageId: "msg-debug" },
    });
    bus.publish({
      type: "stream.tool.start",
      sessionId: "session-debug",
      runId: 7,
      timestamp: Date.now(),
      data: { toolId: "tool-1", toolName: "bash", toolInput: { command: "pwd" } },
    });

    await unsubscribe();
    debugSpy.mockRestore();

    const entries = await readEventLog(logPath!);
    // First entry is the startup diagnostic, followed by 2 bus events
    expect(entries.length).toBe(3);
    expect((entries[0] as unknown as Record<string, unknown>).category).toBe("startup");
    expect(entries[1]?.type).toBe("stream.text.delta");
    expect(entries[2]?.type).toBe("stream.tool.start");
  });
});
