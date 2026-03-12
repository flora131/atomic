import { describe, expect, test } from "bun:test";
import { mkdir, readdir } from "fs/promises";
import { join } from "path";
import {
  initEventLog,
  listEventLogs,
  readEventLog,
  readRawStreamLog,
  type EventLogEntry,
} from "@/services/events/debug-subscriber.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";
import { useDebugSubscriberTestEnv } from "./debug-subscriber.test-helpers.ts";

describe("Debug Subscriber JSONL Logging", () => {
  const env = useDebugSubscriberTestEnv();

  test("initEventLog() creates a per-run log directory and writes events", async () => {
    const { write, close, logPath, rawLogPath, logDirPath } = await initEventLog({
      logDir: env.testDir,
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

    const entries = await readEventLog(logPath);
    expect(entries.length).toBe(1);
    expect(entries[0]!.type).toBe("stream.text.delta");
    expect(entries[0]!.sessionId).toBe("test-session");
    expect(entries[0]!.runId).toBe(1);
    expect((entries[0]!.data as { delta: string }).delta).toBe("hello");
    expect(logPath).toContain("events.jsonl");
    expect(rawLogPath).toContain("raw-stream.log");
    expect(logDirPath).toContain(env.testDir);
  });

  test("readEventLog() returns empty array for non-existent file", async () => {
    const entries = await readEventLog("/tmp/nonexistent-file.jsonl");
    expect(entries).toEqual([]);
  });

  test("readEventLog() supports filter function", async () => {
    const { write, close, logPath } = await initEventLog({
      logDir: env.testDir,
    });

    const events: BusEvent[] = [
      {
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "a", messageId: "m1" },
      },
      {
        type: "stream.tool.start",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { toolId: "t1", toolName: "bash", toolInput: {} },
      },
      {
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "b", messageId: "m1" },
      },
    ];

    for (const event of events) {
      write(event);
    }
    await close();

    const filtered = await readEventLog(
      logPath,
      (entry: EventLogEntry) => entry.type === "stream.text.delta",
    );
    expect(filtered.length).toBe(2);
  });

  test("initEventLog() writes raw stream conversation components", async () => {
    const { write, writeRawLine, close, rawLogPath } = await initEventLog({
      logDir: env.testDir,
    });

    writeRawLine("❯ @codebase-online-researcher Research TUI UX");
    write({
      type: "stream.thinking.delta",
      sessionId: "s-raw",
      runId: 11,
      timestamp: Date.now(),
      data: { delta: "thinking", sourceKey: "src-1", messageId: "m-raw" },
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
    for (let index = 0; index < 12; index += 1) {
      const hour = String(index).padStart(2, "0");
      const sessionName = `2026-02-26T${hour}0000`;
      const sessionDir = join(env.testDir, sessionName);
      await mkdir(sessionDir, { recursive: true });
      await Bun.write(join(sessionDir, "events.jsonl"), `{"ts":"test"}\n`);
    }

    const { cleanup } = await import("@/services/events/debug-subscriber.ts");
    await cleanup(env.testDir);

    const remaining = (await readdir(env.testDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .filter((entry) => /^\d{4}-\d{2}-\d{2}T\d{6}$/.test(entry.name));

    expect(remaining.length).toBe(10);
  });

  test("listEventLogs() returns files most recent first", async () => {
    for (const sessionName of ["2026-02-26T100000", "2026-02-26T120000", "2026-02-26T080000"]) {
      const sessionDir = join(env.testDir, sessionName);
      await mkdir(sessionDir, { recursive: true });
      await Bun.write(join(sessionDir, "events.jsonl"), "");
    }

    const logs = await listEventLogs(env.testDir);
    expect(logs.length).toBe(3);
    expect(logs[0]).toContain("120000");
    expect(logs[1]).toContain("100000");
    expect(logs[2]).toContain("080000");
  });
});
