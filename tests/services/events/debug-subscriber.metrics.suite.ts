import { describe, expect, spyOn, test } from "bun:test";
import {
  initEventLog,
  readEventLog,
  type EventLogEntry,
} from "@/services/events/debug-subscriber.ts";
import { useDebugSubscriberTestEnv } from "./debug-subscriber.test-helpers.ts";

describe("Debug Subscriber JSONL Logging", () => {
  const env = useDebugSubscriberTestEnv();

  test("JSONL entries have correct format", async () => {
    const { write, close, logPath } = await initEventLog({
      logDir: env.testDir,
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
    expect((parsed.data as { inputTokens: number }).inputTokens).toBe(100);
  });

  test("initEventLog() annotates continuity gaps and run-local sequence", async () => {
    const nowSpy = spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000);
    nowSpy.mockReturnValueOnce(3200);

    const { write, close, logPath } = await initEventLog({
      logDir: env.testDir,
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
      logDir: env.testDir,
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
      logDir: env.testDir,
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
      logDir: env.testDir,
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
});
