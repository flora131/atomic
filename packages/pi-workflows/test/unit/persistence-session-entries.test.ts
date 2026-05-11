/**
 * Unit tests for persistence/session-entries.ts
 * cross-ref: spec §5.6
 */

import { test, expect, describe, beforeEach } from "bun:test";
import {
  appendRunStart,
  appendStageStart,
  appendStageProgress,
  appendStageEnd,
  appendRunEnd,
} from "../../src/persistence/session-entries.js";
import type { PersistenceAPI } from "../../src/persistence/session-entries.js";

// ---------------------------------------------------------------------------
// Mock PersistenceAPI
// ---------------------------------------------------------------------------

interface AppendedEntry {
  type: string;
  payload: Record<string, unknown>;
}

function makeMockApi(): PersistenceAPI & {
  _entries: AppendedEntry[];
  _labels: Map<string, string>;
  _messages: string[];
  _entryCounter: number;
} {
  const _entries: AppendedEntry[] = [];
  const _labels = new Map<string, string>();
  const _messages: string[] = [];
  let _entryCounter = 0;

  return {
    _entries,
    _labels,
    _messages,
    get _entryCounter() { return _entryCounter; },
    appendEntry(type: string, payload: Record<string, unknown>): string {
      _entries.push({ type, payload });
      return `entry-${_entryCounter++}`;
    },
    setLabel(entryId: string, label: string): void {
      _labels.set(entryId, label);
    },
    appendCustomMessageEntry(content: string, meta?: Record<string, unknown>): string {
      _messages.push(content);
      void meta;
      return `msg-${_entryCounter++}`;
    },
  };
}

// ---------------------------------------------------------------------------
// appendRunStart
// ---------------------------------------------------------------------------

describe("appendRunStart", () => {
  test("calls appendEntry with workflow.run.start type", () => {
    const api = makeMockApi();
    appendRunStart(api, { runId: "abc-123", name: "my-wf", inputs: {}, ts: 1000 });
    expect(api._entries).toHaveLength(1);
    expect(api._entries[0]!.type).toBe("workflow.run.start");
  });

  test("payload contains runId, name, inputs, ts", () => {
    const api = makeMockApi();
    appendRunStart(api, { runId: "r1", name: "wf", inputs: { x: 1 }, ts: 42 });
    const p = api._entries[0]!.payload;
    expect(p["runId"]).toBe("r1");
    expect(p["name"]).toBe("wf");
    expect(p["ts"]).toBe(42);
    expect((p["inputs"] as Record<string, unknown>)["x"]).toBe(1);
  });

  test("calls setLabel with wf:<name>:<short-id> format", () => {
    const api = makeMockApi();
    appendRunStart(api, { runId: "abcdefgh-1234", name: "my-workflow", inputs: {}, ts: 1 });
    expect(api._labels.size).toBe(1);
    const label = [...api._labels.values()][0];
    expect(label).toBe("wf:my-workflow:abcdefgh");
  });

  test("no-op when appendEntry absent", () => {
    const api: PersistenceAPI = {};
    // Should not throw
    appendRunStart(api, { runId: "r1", name: "wf", inputs: {}, ts: 1 });
  });

  test("no setLabel when setLabel absent", () => {
    const _entries: AppendedEntry[] = [];
    const api: PersistenceAPI = {
      appendEntry(type, payload) {
        _entries.push({ type, payload });
        return "eid";
      },
      // setLabel intentionally absent
    };
    // Should not throw
    appendRunStart(api, { runId: "r1", name: "wf", inputs: {}, ts: 1 });
    expect(_entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// appendStageStart
// ---------------------------------------------------------------------------

describe("appendStageStart", () => {
  test("calls appendEntry with workflow.stage.start type", () => {
    const api = makeMockApi();
    appendStageStart(api, {
      runId: "r1",
      stageId: "s1",
      name: "fetch",
      parentIds: [],
      ts: 100,
    });
    expect(api._entries[0]!.type).toBe("workflow.stage.start");
  });

  test("payload contains all required fields", () => {
    const api = makeMockApi();
    appendStageStart(api, {
      runId: "r1",
      stageId: "s2",
      name: "analyze",
      parentIds: ["s1"],
      model: "sonnet",
      ts: 200,
    });
    const p = api._entries[0]!.payload;
    expect(p["runId"]).toBe("r1");
    expect(p["stageId"]).toBe("s2");
    expect(p["name"]).toBe("analyze");
    expect(p["parentIds"]).toEqual(["s1"]);
    expect(p["model"]).toBe("sonnet");
    expect(p["ts"]).toBe(200);
  });

  test("model omitted when not provided", () => {
    const api = makeMockApi();
    appendStageStart(api, { runId: "r1", stageId: "s1", name: "n", parentIds: [], ts: 1 });
    expect("model" in api._entries[0]!.payload).toBe(false);
  });

  test("no-op when appendEntry absent", () => {
    const api: PersistenceAPI = {};
    appendStageStart(api, { runId: "r1", stageId: "s1", name: "n", parentIds: [], ts: 1 });
  });
});

// ---------------------------------------------------------------------------
// appendStageProgress
// ---------------------------------------------------------------------------

describe("appendStageProgress", () => {
  test("calls appendEntry with workflow.stage.progress type", () => {
    const api = makeMockApi();
    appendStageProgress(api, { runId: "r1", stageId: "s1", kind: "tool_call", payload: { tool: "read_file" } });
    expect(api._entries[0]!.type).toBe("workflow.stage.progress");
  });

  test("payload contains kind", () => {
    const api = makeMockApi();
    appendStageProgress(api, { runId: "r1", stageId: "s1", kind: "message_delta", payload: "hello" });
    expect(api._entries[0]!.payload["kind"]).toBe("message_delta");
  });

  test("no-op when appendEntry absent", () => {
    const api: PersistenceAPI = {};
    appendStageProgress(api, { runId: "r1", stageId: "s1", kind: "k", payload: {} });
  });
});

// ---------------------------------------------------------------------------
// appendStageEnd
// ---------------------------------------------------------------------------

describe("appendStageEnd", () => {
  test("calls appendEntry with workflow.stage.end type", () => {
    const api = makeMockApi();
    appendStageEnd(api, { runId: "r1", stageId: "s1", status: "completed" });
    expect(api._entries[0]!.type).toBe("workflow.stage.end");
  });

  test("includes durationMs and summary when provided", () => {
    const api = makeMockApi();
    appendStageEnd(api, { runId: "r1", stageId: "s1", status: "completed", durationMs: 500, summary: "done" });
    const p = api._entries[0]!.payload;
    expect(p["durationMs"]).toBe(500);
    expect(p["summary"]).toBe("done");
  });

  test("omits durationMs/summary when not provided", () => {
    const api = makeMockApi();
    appendStageEnd(api, { runId: "r1", stageId: "s1", status: "failed" });
    const p = api._entries[0]!.payload;
    expect("durationMs" in p).toBe(false);
    expect("summary" in p).toBe(false);
  });

  test("emitMessage=true calls appendCustomMessageEntry when summary provided", () => {
    const api = makeMockApi();
    appendStageEnd(
      api,
      { runId: "r1", stageId: "s1", status: "completed", summary: "fetched 10 files" },
      { emitMessage: true },
    );
    expect(api._messages).toHaveLength(1);
    expect(api._messages[0]).toContain("fetched 10 files");
  });

  test("emitMessage=true does NOT call appendCustomMessageEntry when summary absent", () => {
    const api = makeMockApi();
    appendStageEnd(api, { runId: "r1", stageId: "s1", status: "completed" }, { emitMessage: true });
    expect(api._messages).toHaveLength(0);
  });

  test("no-op when appendEntry absent", () => {
    const api: PersistenceAPI = {};
    appendStageEnd(api, { runId: "r1", stageId: "s1", status: "completed" });
  });
});

// ---------------------------------------------------------------------------
// appendRunEnd
// ---------------------------------------------------------------------------

describe("appendRunEnd", () => {
  test("calls appendEntry with workflow.run.end type", () => {
    const api = makeMockApi();
    appendRunEnd(api, { runId: "r1", status: "completed", ts: 999 });
    expect(api._entries[0]!.type).toBe("workflow.run.end");
  });

  test("payload contains runId, status, ts", () => {
    const api = makeMockApi();
    appendRunEnd(api, { runId: "r1", status: "failed", ts: 123 });
    const p = api._entries[0]!.payload;
    expect(p["runId"]).toBe("r1");
    expect(p["status"]).toBe("failed");
    expect(p["ts"]).toBe(123);
  });

  test("includes result when provided", () => {
    const api = makeMockApi();
    appendRunEnd(api, { runId: "r1", status: "completed", result: { out: 42 }, ts: 1 });
    expect((api._entries[0]!.payload["result"] as Record<string, unknown>)["out"]).toBe(42);
  });

  test("no-op when appendEntry absent", () => {
    const api: PersistenceAPI = {};
    appendRunEnd(api, { runId: "r1", status: "completed", ts: 1 });
  });
});
