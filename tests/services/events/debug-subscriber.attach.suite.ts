import { describe, expect, spyOn, test } from "bun:test";
import {
  attachDebugSubscriber,
  readEventLog,
  readRawStreamLog,
} from "@/services/events/debug-subscriber.ts";
import { EventBus } from "@/services/events/event-bus.ts";
import { useDebugSubscriberTestEnv } from "./debug-subscriber.test-helpers.ts";

describe("Debug Subscriber JSONL Logging", () => {
  const env = useDebugSubscriberTestEnv();

  test("attachDebugSubscriber() logs all events when stream debug is enabled", async () => {
    process.env.DEBUG = "1";
    process.env.LOG_DIR = env.testDir;
    const debugSpy = spyOn(console, "debug").mockImplementation(() => {});

    const bus = new EventBus({ validatePayloads: false });
    const { unsubscribe, logPath, rawLogPath, logDirPath, writeRawLine } =
      await attachDebugSubscriber(bus);

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
    expect(entries.length).toBe(3);
    expect((entries[0] as unknown as Record<string, unknown>).category).toBe("startup");
    expect(entries[1]?.type).toBe("stream.text.delta");
    expect(entries[2]?.type).toBe("stream.tool.start");

    const rawLines = await readRawStreamLog(rawLogPath!);
    expect(rawLines).toContain("❯ Investigate stream ordering");
    expect(rawLines.some((line: string) => line.includes("stream.text.delta"))).toBe(
      false,
    );
    expect(rawLines).toContain("◉ bash");
  });
});
