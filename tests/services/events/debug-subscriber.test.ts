/**
 * Unit tests for debug-subscriber JSONL logging
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { join } from "path";
import { mkdir, mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import {
  attachDebugSubscriber,
  cleanup,
  initEventLog,
  readEventLog,
  readRawStreamLog,
  listEventLogs,
  resolveStreamDebugLogConfig,
  type EventLogEntry,
} from "@/services/events/debug-subscriber.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";
import { EventBus } from "@/services/events/event-bus.ts";

const STREAM_DEBUG_ENV_KEYS = [
  "DEBUG",
  "LOG_DIR",
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

  test("resolveStreamDebugLogConfig() remains disabled when DEBUG is not set", () => {
    const config = resolveStreamDebugLogConfig({
      LOG_DIR: "/tmp/AtomicDebugLogs",
    });
    expect(config.enabled).toBe(false);
    expect(config.logDir).toBe("/tmp/AtomicDebugLogs");
    expect(config.consolePreviewEnabled).toBe(false);
  });

  test("initEventLog() creates a per-run log directory and writes events", async () => {
    const { write, close, logPath, rawLogPath, logDirPath } = await initEventLog({
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
    expect(logPath).toContain("events.jsonl");
    expect(rawLogPath).toContain("raw-stream.log");
    expect(logDirPath).toContain(testDir);
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

  test("initEventLog() writes raw stream conversation components", async () => {
    const { write, writeRawLine, close, rawLogPath } = await initEventLog({
      logDir: testDir,
    });

    writeRawLine("❯ @codebase-online-researcher Research TUI UX");
    write({
      type: "stream.thinking.delta",
      sessionId: "s-raw",
      runId: 11,
      timestamp: Date.now(),
      data: {
        delta: "thinking",
        sourceKey: "src-1",
        messageId: "m-raw",
      },
    });
    write({
      type: "stream.text.delta",
      sessionId: "s-raw",
      runId: 11,
      timestamp: Date.now(),
      data: { delta: "Launching UI/UX research task\n", messageId: "m-raw" },
    });
    write({
      type: "stream.tool.start",
      sessionId: "s-raw",
      runId: 11,
      timestamp: Date.now(),
      data: {
        toolId: "tool-task",
        toolName: "task",
        toolInput: {
          agent_type: "codebase-online-researcher",
          description: "Research TUI UX practices",
          prompt: "Research task only",
        },
      },
    });

    await close();

    const rawLines = await readRawStreamLog(rawLogPath);
    expect(rawLines).toContain("❯ @codebase-online-researcher Research TUI UX");
    expect(rawLines).toContain("⣯ Composing…");
    expect(rawLines).toContain("∴ Thinking...");
    expect(rawLines).toContain("Launching UI/UX research task");
    expect(rawLines).toContain("◉");
    expect(rawLines).toContain("task codebase-online-researcher: Research TUI UX practices");
    expect(rawLines).toContain("Agent: codebase-online-researcher");
    expect(rawLines).toContain("Task: Research TUI UX practices");
    expect(rawLines).toContain("Prompt: Research task only");
  });

  test("cleanup() retains only 10 most recent session directories", async () => {
    // Create 12 fake session directories in testDir
    for (let i = 0; i < 12; i++) {
      const hour = String(i).padStart(2, "0");
      const sessionName = `2026-02-26T${hour}0000`;
      const sessionDir = join(testDir, sessionName);
      await mkdir(sessionDir, { recursive: true });
      await Bun.write(
        join(sessionDir, "events.jsonl"),
        `{"ts":"test"}\n`,
      );
    }

    await cleanup(testDir);

    const remaining = (await readdir(testDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .filter((entry) => /^\d{4}-\d{2}-\d{2}T\d{6}$/.test(entry.name));

    expect(remaining.length).toBe(10);
  });

  test("listEventLogs() returns files most recent first", async () => {
    // Create a few log directories
    for (const sessionName of ["2026-02-26T100000", "2026-02-26T120000", "2026-02-26T080000"]) {
      const sessionDir = join(testDir, sessionName);
      await mkdir(sessionDir, { recursive: true });
      await Bun.write(join(sessionDir, "events.jsonl"), "");
    }

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
    const { unsubscribe, logPath, rawLogPath, logDirPath, writeRawLine } = await attachDebugSubscriber(bus);
    expect(logPath).not.toBeNull();
    expect(rawLogPath).not.toBeNull();
    expect(logDirPath).not.toBeNull();

    writeRawLine("❯ Investigate stream ordering");

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

    const rawLines = await readRawStreamLog(rawLogPath!);
    expect(rawLines).toContain("❯ Investigate stream ordering");
    expect(rawLines.some((line) => line.includes("stream.text.delta"))).toBe(false);
    expect(rawLines).toContain("◉ bash");
  });
});
