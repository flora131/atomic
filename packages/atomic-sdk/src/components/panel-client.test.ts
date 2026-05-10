/**
 * Tests for PanelClient pure helpers and PtyPane scrollback logic.
 *
 * No OpenTUI mounts — exercises pure functions extracted from components.
 */

import { test, expect, describe } from "bun:test";
import {
  DaemonPanelStore,
  castSnapshot,
  mapSnapshotSessions,
} from "./panel-client.tsx";
import { appendScrollback } from "./pty-pane.tsx";
import type { WorkflowStatusSnapshot } from "../runtime/status-writer.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<WorkflowStatusSnapshot> = {}): WorkflowStatusSnapshot {
  return {
    schemaVersion: 1,
    workflowRunId: "run-1",
    tmuxSession: "atomic-run-1",
    workflowName: "test-workflow",
    agent: "claude",
    prompt: "Do the thing",
    overall: "completed",
    completionReached: false,
    fatalError: null,
    updatedAt: new Date().toISOString(),
    sessions: [
      {
        name: "orchestrator",
        status: "running",
        parents: [],
        startedAt: 1000,
        endedAt: null,
      },
      {
        name: "stage-a",
        status: "pending",
        parents: ["orchestrator"],
        startedAt: null,
        endedAt: null,
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// castSnapshot
// ---------------------------------------------------------------------------

describe("castSnapshot", () => {
  test("passes through an opaque record as WorkflowStatusSnapshot", () => {
    const opaque: Record<string, unknown> = {
      schemaVersion: 1,
      workflowRunId: "abc",
      workflowName: "wf",
      sessions: [],
    };
    const result = castSnapshot(opaque);
    // castSnapshot is a pure cast — same reference, no copy made.
    expect(Object.is(result, opaque)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mapSnapshotSessions
// ---------------------------------------------------------------------------

describe("mapSnapshotSessions", () => {
  test("maps all fields from snapshot.sessions to SessionData", () => {
    const snapshot = makeSnapshot();
    const sessions = mapSnapshotSessions(snapshot);

    expect(sessions).toHaveLength(2);

    expect(sessions[0]).toEqual({
      name: "orchestrator",
      status: "running",
      parents: [],
      startedAt: 1000,
      endedAt: null,
      error: undefined,
    });

    expect(sessions[1]).toEqual({
      name: "stage-a",
      status: "pending",
      parents: ["orchestrator"],
      startedAt: null,
      endedAt: null,
      error: undefined,
    });
  });

  test("preserves error field when present", () => {
    const snapshot = makeSnapshot({
      sessions: [
        {
          name: "stage-b",
          status: "error",
          parents: ["orchestrator"],
          error: "something went wrong",
          startedAt: 2000,
          endedAt: 3000,
        },
      ],
    });
    const sessions = mapSnapshotSessions(snapshot);
    expect(sessions[0]?.error).toBe("something went wrong");
    expect(sessions[0]?.status).toBe("error");
  });

  test("returns empty array for snapshot with no sessions", () => {
    const snapshot = makeSnapshot({ sessions: [] });
    expect(mapSnapshotSessions(snapshot)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DaemonPanelStore.applySnapshot
// ---------------------------------------------------------------------------

describe("DaemonPanelStore.applySnapshot", () => {
  test("updates workflowName, agent, and prompt from snapshot", () => {
    const store = new DaemonPanelStore();
    const snapshot = makeSnapshot({ workflowName: "my-workflow", agent: "claude", prompt: "Run it" });
    store.applySnapshot(snapshot);
    expect(store.workflowName).toBe("my-workflow");
    expect(store.agent).toBe("claude");
    expect(store.prompt).toBe("Run it");
  });

  test("updates sessions from snapshot", () => {
    const store = new DaemonPanelStore();
    const snapshot = makeSnapshot();
    store.applySnapshot(snapshot);
    expect(store.sessions).toHaveLength(2);
    expect(store.sessions[0]?.name).toBe("orchestrator");
    expect(store.sessions[1]?.name).toBe("stage-a");
  });

  test("sets fatalError from snapshot", () => {
    const store = new DaemonPanelStore();
    const snapshot = makeSnapshot({ fatalError: "boom" });
    store.applySnapshot(snapshot);
    expect(store.fatalError).toBe("boom");
  });

  test("sets completionReached when snapshot says so", () => {
    const store = new DaemonPanelStore();
    expect(store.completionReached).toBe(false);
    const snapshot = makeSnapshot({ completionReached: true });
    store.applySnapshot(snapshot);
    expect(store.completionReached).toBe(true);
  });

  test("does not reset completionReached if already set", () => {
    const store = new DaemonPanelStore();
    store.markCompletionReached();
    expect(store.completionReached).toBe(true);
    // Snapshot says NOT complete — store should retain completionReached = true.
    const snapshot = makeSnapshot({ completionReached: false });
    store.applySnapshot(snapshot);
    expect(store.completionReached).toBe(true);
  });

  test("fires listeners on applySnapshot", () => {
    const store = new DaemonPanelStore();
    let callCount = 0;
    store.subscribe(() => { callCount++; });
    const initialVersion = store.version;

    store.applySnapshot(makeSnapshot());

    expect(callCount).toBe(1);
    expect(store.version).toBeGreaterThan(initialVersion);
  });

  test("applying snapshot twice fires listeners twice", () => {
    const store = new DaemonPanelStore();
    let callCount = 0;
    store.subscribe(() => { callCount++; });

    store.applySnapshot(makeSnapshot());
    store.applySnapshot(makeSnapshot({ workflowName: "updated" }));

    expect(callCount).toBe(2);
  });

  test("unsubscribe stops receiving notifications", () => {
    const store = new DaemonPanelStore();
    let callCount = 0;
    const unsub = store.subscribe(() => { callCount++; });
    store.applySnapshot(makeSnapshot());
    expect(callCount).toBe(1);

    unsub();
    store.applySnapshot(makeSnapshot());
    expect(callCount).toBe(1); // Still 1 — listener was removed.
  });
});

// ---------------------------------------------------------------------------
// appendScrollback
// ---------------------------------------------------------------------------

describe("appendScrollback", () => {
  test("appends data at the expected offset", () => {
    const result = appendScrollback("hello ", 6, "world", 6);
    expect(result.content).toBe("hello world");
    expect(result.headOffset).toBe(11);
  });

  test("returns unchanged buffer for empty incoming data", () => {
    const result = appendScrollback("existing", 8, "", 8);
    expect(result.content).toBe("existing");
    expect(result.headOffset).toBe(8);
  });

  test("discards data entirely within already-seen range", () => {
    // existing buffer covers offsets 0-9 (headOffset = 10)
    // incoming at offset 3 (before headOffset) should be discarded
    const result = appendScrollback("0123456789", 10, "345", 3);
    expect(result.content).toBe("0123456789");
    expect(result.headOffset).toBe(10);
  });

  test("partial overlap: appends only the new tail", () => {
    // existing = "abcde" covers byte offsets 0-4 (headOffset = 5).
    // incoming = "cdefg" starts at offset 3.
    //   byte 3 = 'c' → already seen (offset < headOffset)
    //   byte 4 = 'd' → already seen
    //   byte 5 = 'e' → NEW (== headOffset)
    //   byte 6 = 'f' → new
    //   byte 7 = 'g' → new
    // We slice from index (headOffset - offset) = 2, giving "efg".
    // Result = "abcde" + "efg" = "abcdeefg", headOffset advances to 8.
    const result = appendScrollback("abcde", 5, "cdefg", 3);
    expect(result.content).toBe("abcdeefg");
    expect(result.headOffset).toBe(8);
  });

  test("gap: inserts missing marker and appends incoming data", () => {
    // headOffset = 5, incoming at offset 10 — 5 bytes are missing
    const result = appendScrollback("abcde", 5, "fghij", 10);
    expect(result.content).toContain("abcde");
    expect(result.content).toContain("5 bytes missing");
    expect(result.content).toContain("fghij");
    expect(result.headOffset).toBe(15);
  });

  test("contiguous append from offset 0", () => {
    const result = appendScrollback("", 0, "hello", 0);
    expect(result.content).toBe("hello");
    expect(result.headOffset).toBe(5);
  });

  test("sequential appends chain correctly", () => {
    let state = appendScrollback("", 0, "abc", 0);
    expect(state.content).toBe("abc");
    expect(state.headOffset).toBe(3);

    state = appendScrollback(state.content, state.headOffset, "def", 3);
    expect(state.content).toBe("abcdef");
    expect(state.headOffset).toBe(6);

    state = appendScrollback(state.content, state.headOffset, "ghi", 6);
    expect(state.content).toBe("abcdefghi");
    expect(state.headOffset).toBe(9);
  });

  test("gap marker reflects exact byte count", () => {
    // 100 bytes gap
    const result = appendScrollback("start", 5, "end", 105);
    expect(result.content).toContain("100 bytes missing");
    expect(result.headOffset).toBe(108);
  });
});
