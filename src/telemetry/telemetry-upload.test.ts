/**
 * Tests for filterStaleEvents, splitIntoBatches, and readEventsFromJSONL functions
 * Reference: specs/phase-6-telemetry-upload-backend.md
 */
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  filterStaleEvents,
  splitIntoBatches,
  readEventsFromJSONL,
  TELEMETRY_UPLOAD_CONFIG,
} from "./telemetry-upload";
import type { TelemetryEvent, AtomicCommandEvent } from "./types";

/**
 * Factory helper to create a valid AtomicCommandEvent with a given timestamp.
 */
function makeEvent(
  timestamp: string,
  overrides: Partial<AtomicCommandEvent> = {}
): AtomicCommandEvent {
  return {
    anonymousId: "test-anonymous-id",
    eventId: `event-${Math.random().toString(36).slice(2)}`,
    eventType: "atomic_command",
    timestamp,
    platform: "linux",
    atomicVersion: "1.0.0",
    source: "cli",
    command: "chat",
    agentType: "claude",
    success: true,
    ...overrides,
  };
}

/**
 * Helper to create a timestamp relative to now.
 * @param offsetMs - Offset in milliseconds from now (negative = past, positive = future)
 */
function makeTimestamp(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe("filterStaleEvents", () => {
  const maxAge = TELEMETRY_UPLOAD_CONFIG.storage.maxEventAge; // 30 days in ms

  describe("empty and single-element arrays", () => {
    test("returns empty valid array and zero staleCount for empty input", () => {
      const result = filterStaleEvents([]);

      expect(result.valid).toEqual([]);
      expect(result.staleCount).toBe(0);
    });

    test("keeps single recent event (within 30 days)", () => {
      const recentEvent = makeEvent(makeTimestamp(-1 * 24 * 60 * 60 * 1000)); // 1 day ago

      const result = filterStaleEvents([recentEvent]);

      expect(result.valid).toHaveLength(1);
      expect(result.valid[0]!).toEqual(recentEvent);
      expect(result.staleCount).toBe(0);
    });

    test("removes single stale event (older than 30 days)", () => {
      const staleEvent = makeEvent(makeTimestamp(-maxAge - 1000)); // Just over 30 days ago

      const result = filterStaleEvents([staleEvent]);

      expect(result.valid).toHaveLength(0);
      expect(result.staleCount).toBe(1);
    });
  });

  describe("all-stale and no-stale filtering", () => {
    test("removes all events when all are stale", () => {
      const staleEvents = [
        makeEvent(makeTimestamp(-maxAge - 10000)), // 30+ days ago
        makeEvent(makeTimestamp(-maxAge - 5000)),
        makeEvent(makeTimestamp(-maxAge - 1)),
      ];

      const result = filterStaleEvents(staleEvents);

      expect(result.valid).toHaveLength(0);
      expect(result.staleCount).toBe(3);
    });

    test("keeps all events when all are recent", () => {
      const recentEvents = [
        makeEvent(makeTimestamp(0)), // now
        makeEvent(makeTimestamp(-1000)), // 1 second ago
        makeEvent(makeTimestamp(-7 * 24 * 60 * 60 * 1000)), // 7 days ago
      ];

      const result = filterStaleEvents(recentEvents);

      expect(result.valid).toHaveLength(3);
      expect(result.staleCount).toBe(0);
    });
  });

  describe("mixed timestamps", () => {
    test("correctly filters mix of stale and recent events", () => {
      const events = [
        makeEvent(makeTimestamp(-maxAge - 1000)), // stale
        makeEvent(makeTimestamp(-1000)), // recent
        makeEvent(makeTimestamp(-maxAge - 5000)), // stale
        makeEvent(makeTimestamp(-15 * 24 * 60 * 60 * 1000)), // recent (15 days ago)
        makeEvent(makeTimestamp(0)), // recent (now)
      ];

      const result = filterStaleEvents(events);

      expect(result.valid).toHaveLength(3);
      expect(result.staleCount).toBe(2);
    });

    test("keeps events exactly at the boundary (cutoff time is inclusive)", () => {
      // Mock Date.now() to prevent race condition between timestamp creation and filtering
      // Without this, time can pass between makeTimestamp() and filterStaleEvents(),
      // causing the boundary event to become slightly too old
      const fixedNow = 1672531200000; // 2023-01-01T00:00:00.000Z
      const dateNowSpy = spyOn(Date, "now").mockReturnValue(fixedNow);

      try {
        const boundaryEvent = makeEvent(makeTimestamp(-maxAge)); // Exactly 30 days ago

        const result = filterStaleEvents([boundaryEvent]);

        // Events at exactly cutoff time should be kept (>= cutoff)
        expect(result.valid).toHaveLength(1);
        expect(result.staleCount).toBe(0);
      } finally {
        dateNowSpy.mockRestore();
      }
    });

    test("removes events just before the boundary", () => {
      // Mock Date.now() to prevent race condition
      const fixedNow = 1672531200000; // 2023-01-01T00:00:00.000Z
      const dateNowSpy = spyOn(Date, "now").mockReturnValue(fixedNow);

      try {
        const justStaleEvent = makeEvent(makeTimestamp(-maxAge - 1)); // 1ms over 30 days

        const result = filterStaleEvents([justStaleEvent]);

        expect(result.valid).toHaveLength(0);
        expect(result.staleCount).toBe(1);
      } finally {
        dateNowSpy.mockRestore();
      }
    });
  });

  describe("preserves event order", () => {
    test("maintains original order of valid events", () => {
      const events = [
        makeEvent(makeTimestamp(-maxAge - 1000), { eventId: "stale-1" }),
        makeEvent(makeTimestamp(-1000), { eventId: "recent-1" }),
        makeEvent(makeTimestamp(-maxAge - 2000), { eventId: "stale-2" }),
        makeEvent(makeTimestamp(-2000), { eventId: "recent-2" }),
      ];

      const result = filterStaleEvents(events);

      expect(result.valid).toHaveLength(2);
      expect(result.valid[0]!.eventId).toBe("recent-1");
      expect(result.valid[1]!.eventId).toBe("recent-2");
    });
  });
});

describe("splitIntoBatches", () => {
  const defaultBatchSize = TELEMETRY_UPLOAD_CONFIG.batch.maxEvents; // 100

  describe("empty and single-element arrays", () => {
    test("returns empty array for empty input", () => {
      const result = splitIntoBatches([]);

      expect(result).toEqual([]);
    });

    test("returns single batch for single element", () => {
      const events = [makeEvent(makeTimestamp(0))];

      const result = splitIntoBatches(events);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(1);
    });
  });

  describe("exact batch-size boundaries", () => {
    test("returns single batch when count equals batch size", () => {
      const events = Array.from({ length: defaultBatchSize }, (_, i) =>
        makeEvent(makeTimestamp(-i * 1000))
      );

      const result = splitIntoBatches(events);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(defaultBatchSize);
    });

    test("returns two batches when count is one more than batch size", () => {
      const events = Array.from({ length: defaultBatchSize + 1 }, (_, i) =>
        makeEvent(makeTimestamp(-i * 1000))
      );

      const result = splitIntoBatches(events);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(defaultBatchSize);
      expect(result[1]).toHaveLength(1);
    });

    test("returns two batches when count is exactly twice the batch size", () => {
      const events = Array.from({ length: defaultBatchSize * 2 }, (_, i) =>
        makeEvent(makeTimestamp(-i * 1000))
      );

      const result = splitIntoBatches(events);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(defaultBatchSize);
      expect(result[1]).toHaveLength(defaultBatchSize);
    });
  });

  describe("custom batch sizes", () => {
    test("respects custom batch size of 1", () => {
      const events = [
        makeEvent(makeTimestamp(0)),
        makeEvent(makeTimestamp(-1000)),
        makeEvent(makeTimestamp(-2000)),
      ];

      const result = splitIntoBatches(events, 1);

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveLength(1);
      expect(result[1]).toHaveLength(1);
      expect(result[2]).toHaveLength(1);
    });

    test("respects custom batch size of 3", () => {
      const events = Array.from({ length: 8 }, (_, i) =>
        makeEvent(makeTimestamp(-i * 1000))
      );

      const result = splitIntoBatches(events, 3);

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveLength(3);
      expect(result[1]).toHaveLength(3);
      expect(result[2]).toHaveLength(2);
    });

    test("handles batch size larger than array length", () => {
      const events = [makeEvent(makeTimestamp(0)), makeEvent(makeTimestamp(-1000))];

      const result = splitIntoBatches(events, 1000);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(2);
    });
  });

  describe("preserves event order", () => {
    test("maintains original order across batches", () => {
      const events = Array.from({ length: 5 }, (_, i) =>
        makeEvent(makeTimestamp(0), { eventId: `event-${i}` })
      );

      const result = splitIntoBatches(events, 2);

      expect(result).toHaveLength(3);
      // First batch: event-0, event-1
      expect(result[0]![0]!.eventId).toBe("event-0");
      expect(result[0]![1]!.eventId).toBe("event-1");
      // Second batch: event-2, event-3
      expect(result[1]![0]!.eventId).toBe("event-2");
      expect(result[1]![1]!.eventId).toBe("event-3");
      // Third batch: event-4
      expect(result[2]![0]!.eventId).toBe("event-4");
    });
  });
});

describe("readEventsFromJSONL", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `telemetry-test-${crypto.randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns empty array when file does not exist", () => {
    const result = readEventsFromJSONL(join(tempDir, "nonexistent.jsonl"));

    expect(result).toEqual([]);
  });

  test("returns empty array for an empty file", () => {
    const filePath = join(tempDir, "empty.jsonl");
    writeFileSync(filePath, "");

    const result = readEventsFromJSONL(filePath);

    expect(result).toEqual([]);
  });

  test("parses a single valid JSONL line", () => {
    const event = makeEvent(makeTimestamp(0), { eventId: "read-test-1" });
    const filePath = join(tempDir, "single.jsonl");
    writeFileSync(filePath, JSON.stringify(event) + "\n");

    const result = readEventsFromJSONL(filePath);

    expect(result).toHaveLength(1);
    expect(result[0]!.eventId).toBe("read-test-1");
    expect(result[0]!.eventType).toBe("atomic_command");
  });

  test("parses multiple valid JSONL lines", () => {
    const events = [
      makeEvent(makeTimestamp(0), { eventId: "multi-1" }),
      makeEvent(makeTimestamp(-1000), { eventId: "multi-2" }),
      makeEvent(makeTimestamp(-2000), { eventId: "multi-3" }),
    ];
    const filePath = join(tempDir, "multi.jsonl");
    const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(filePath, content);

    const result = readEventsFromJSONL(filePath);

    expect(result).toHaveLength(3);
    expect(result[0]!.eventId).toBe("multi-1");
    expect(result[1]!.eventId).toBe("multi-2");
    expect(result[2]!.eventId).toBe("multi-3");
  });

  test("skips invalid JSON lines and keeps valid ones", () => {
    const validEvent = makeEvent(makeTimestamp(0), { eventId: "valid-1" });
    const filePath = join(tempDir, "mixed-validity.jsonl");
    const content = [
      "not valid json",
      JSON.stringify(validEvent),
      "{broken: json}",
      "",
    ].join("\n");
    writeFileSync(filePath, content);

    const result = readEventsFromJSONL(filePath);

    expect(result).toHaveLength(1);
    expect(result[0]!.eventId).toBe("valid-1");
  });

  test("skips lines with missing required fields", () => {
    const filePath = join(tempDir, "missing-fields.jsonl");
    const incompleteEvent = { anonymousId: "test-id", eventId: "incomplete" };
    const validEvent = makeEvent(makeTimestamp(0), { eventId: "complete-1" });
    const content = [
      JSON.stringify(incompleteEvent),
      JSON.stringify(validEvent),
    ].join("\n");
    writeFileSync(filePath, content);

    const result = readEventsFromJSONL(filePath);

    expect(result).toHaveLength(1);
    expect(result[0]!.eventId).toBe("complete-1");
  });

  test("handles file with only blank lines", () => {
    const filePath = join(tempDir, "blanks.jsonl");
    writeFileSync(filePath, "\n\n\n  \n");

    const result = readEventsFromJSONL(filePath);

    expect(result).toEqual([]);
  });
});

describe("TELEMETRY_UPLOAD_CONFIG", () => {
  test("has expected batch and storage configuration values", () => {
    expect(TELEMETRY_UPLOAD_CONFIG.batch.maxEvents).toBe(100);
    expect(TELEMETRY_UPLOAD_CONFIG.storage.maxEventAge).toBe(2592000000);
  });
});
