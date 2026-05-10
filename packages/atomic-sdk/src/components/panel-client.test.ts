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
  applyForegroundStage,
  createDirectSessionRendererConfig,
  stopRunForPanelAbort,
} from "./panel-client.tsx";
import {
  appendScrollback,
  getPaneTerminalSize,
  isPanelKey,
  paneKeyToPtyInput,
  panePtyRows,
  sliceNewPaneOutput,
} from "./pty-pane.tsx";
import {
  chatKeyToPtyInput,
  chatPtyRows,
  getChatTerminalSize,
  isChatDetachKey,
  isTerminalRunStatus,
  sliceNewPtyOutput,
} from "./chat-session-panel.tsx";
import {
  TERMINAL_MOUSE_REPORTING_DISABLE_SEQUENCE,
  TerminalMouseReportingFilter,
  stripTerminalMouseModeEnableSequences,
  withTerminalMouseReportingDisabled,
} from "./terminal-mouse.ts";
import type { MessageConnection } from "vscode-jsonrpc/node";
import type { WorkflowStatusSnapshot } from "../runtime/status-writer.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<WorkflowStatusSnapshot> = {}): WorkflowStatusSnapshot {
  const daemonRuntimeKey = "tm" + "uxSession";
  return {
    schemaVersion: 1,
    workflowRunId: "run-1",
    [daemonRuntimeKey]: "",
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
  } as WorkflowStatusSnapshot;
}

// ---------------------------------------------------------------------------
// castSnapshot
// ---------------------------------------------------------------------------

describe("castSnapshot", () => {
  test("passes through an opaque record as WorkflowStatusSnapshot", () => {
    const opaque: Parameters<typeof castSnapshot>[0] = {
      schemaVersion: 1,
      workflowRunId: "abc",
      tmuxSession: "",
      workflowName: "wf",
      agent: "claude",
      prompt: "",
      overall: "in_progress",
      completionReached: false,
      fatalError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
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
// applyForegroundStage
// ---------------------------------------------------------------------------

describe("applyForegroundStage", () => {
  test("null foreground returns the panel to graph mode", () => {
    const store = new DaemonPanelStore();
    store.setViewMode("attached", "stage-a");

    applyForegroundStage(store, null);

    expect(store.viewMode).toBe("graph");
    expect(store.activeAgentId).toBe("");
  });

  test("stage foreground opens that stage's attached pane", () => {
    const store = new DaemonPanelStore();

    applyForegroundStage(store, "stage-a");

    expect(store.viewMode).toBe("attached");
    expect(store.activeAgentId).toBe("stage-a");
  });
});

// ---------------------------------------------------------------------------
// createDirectSessionRendererConfig
// ---------------------------------------------------------------------------

describe("createDirectSessionRendererConfig", () => {
  test("keeps terminal text selection available in direct chat sessions", () => {
    const config = createDirectSessionRendererConfig({
      footerHeight: 2,
      clearOnShutdown: false,
    });

    expect(config.screenMode).toBe("split-footer");
    expect(config.externalOutputMode).toBe("passthrough");
    expect(config.useMouse).toBe(false);
  });

  test("keeps terminal text selection available in direct workflow pane sessions", () => {
    const config = createDirectSessionRendererConfig({
      footerHeight: 1,
      clearOnShutdown: true,
    });

    expect(config.screenMode).toBe("split-footer");
    expect(config.footerHeight).toBe(1);
    expect(config.clearOnShutdown).toBe(true);
    expect(config.useMouse).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stopRunForPanelAbort
// ---------------------------------------------------------------------------

describe("stopRunForPanelAbort", () => {
  test("sends run/stop for the mounted workflow run", async () => {
    const calls: Array<{ method: string; params: object }> = [];
    const connection = {
      sendRequest: async (method: string, params: object) => {
        calls.push({ method, params });
      },
    } as Pick<MessageConnection, "sendRequest"> as MessageConnection;

    await stopRunForPanelAbort(connection, "run-123");

    expect(calls).toEqual([
      { method: "run/stop", params: { runId: "run-123" } },
    ]);
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
// terminal mouse reporting filter
// ---------------------------------------------------------------------------

describe("terminal mouse reporting filter", () => {
  test("strips mouse reporting enable sequences from direct PTY output", () => {
    const output = `before\x1b[?1000h\x1b[?1006hafter`;

    expect(stripTerminalMouseModeEnableSequences(output)).toBe("beforeafter");
  });

  test("preserves non-mouse private modes when combined with mouse modes", () => {
    const output = `\x1b[?25;1000;1006hdraw`;

    expect(stripTerminalMouseModeEnableSequences(output)).toBe("\x1b[?25hdraw");
  });

  test("appends a defensive mouse-disable sequence after streamed output", () => {
    const output = withTerminalMouseReportingDisabled("paint");

    expect(output).toBe(`paint${TERMINAL_MOUSE_REPORTING_DISABLE_SEQUENCE}`);
  });

  test("buffers incomplete CSI sequences across PTY chunks", () => {
    const filter = new TerminalMouseReportingFilter();

    expect(filter.write("start\x1b[?100")).toBe(`start${TERMINAL_MOUSE_REPORTING_DISABLE_SEQUENCE}`);
    expect(filter.write("0hpaint")).toBe(`paint${TERMINAL_MOUSE_REPORTING_DISABLE_SEQUENCE}`);
  });
});

// ---------------------------------------------------------------------------
// isPanelKey
// ---------------------------------------------------------------------------

describe("isPanelKey", () => {
  test("keeps panel quit/navigation keys out of the PTY", () => {
    expect(isPanelKey({ name: "q", ctrl: false })).toBe(true);
    expect(isPanelKey({ name: "c", ctrl: true })).toBe(true);
    expect(isPanelKey({ name: "g", ctrl: true })).toBe(true);
  });

  test("allows ordinary input keys through to the PTY", () => {
    expect(isPanelKey({ name: "g", ctrl: false })).toBe(false);
    expect(isPanelKey({ name: "enter", ctrl: false })).toBe(false);
    expect(isPanelKey({ name: "escape", ctrl: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Direct workflow pane pure helpers
// ---------------------------------------------------------------------------

describe("Direct workflow pane helpers", () => {
  test("panePtyRows reserves the footer row for Atomic controls", () => {
    expect(panePtyRows(40)).toBe(39);
    expect(panePtyRows(1)).toBe(1);
    expect(panePtyRows(undefined)).toBe(39);
  });

  test("getPaneTerminalSize uses physical terminal size in split-footer mode", () => {
    const size = getPaneTerminalSize({
      width: 120,
      height: 1,
      terminalWidth: 120,
      terminalHeight: 40,
    });

    expect(size).toEqual({ cols: 120, rows: 39 });
  });

  test("sliceNewPaneOutput suppresses log gap markers for direct terminal streams", () => {
    expect(sliceNewPaneOutput(5, "full-screen repaint", 10)).toEqual({
      data: "full-screen repaint",
      headOffset: 29,
    });
  });

  test("paneKeyToPtyInput maps arrow keys to terminal escape sequences", () => {
    expect(paneKeyToPtyInput({ name: "up", ctrl: false })).toBe("\x1b[A");
    expect(paneKeyToPtyInput({ name: "down", ctrl: false })).toBe("\x1b[B");
  });

  test("paneKeyToPtyInput maps Ctrl+C to the PTY interrupt byte", () => {
    expect(paneKeyToPtyInput({ name: "c", ctrl: true, sequence: "\x1b[99;5u" })).toBe("\x03");
  });
});

// ---------------------------------------------------------------------------
// ChatSessionPanel pure helpers
// ---------------------------------------------------------------------------

describe("ChatSessionPanel helpers", () => {
  test("chatPtyRows reserves footer rows for the OpenTUI divider and footer", () => {
    expect(chatPtyRows(40)).toBe(38);
    expect(chatPtyRows(1)).toBe(1);
    expect(chatPtyRows(undefined)).toBe(38);
  });

  test("getChatTerminalSize uses physical terminal size instead of split-footer render size", () => {
    const size = getChatTerminalSize({
      width: 120,
      height: 2,
      terminalWidth: 120,
      terminalHeight: 40,
    });

    expect(size).toEqual({ cols: 120, rows: 38 });
  });

  test("getChatTerminalSize falls back to render size when physical terminal size is unavailable", () => {
    const size = getChatTerminalSize({
      width: 100,
      height: 30,
      terminalWidth: 0,
      terminalHeight: 0,
    });

    expect(size).toEqual({ cols: 100, rows: 28 });
  });

  test("sliceNewPtyOutput discards live output already covered by the initial scrollback", () => {
    expect(sliceNewPtyOutput(10, "abc", 3)).toEqual({ data: "", headOffset: 10 });
  });

  test("sliceNewPtyOutput appends only the new tail for partially overlapping live output", () => {
    expect(sliceNewPtyOutput(5, "cdefg", 3)).toEqual({ data: "efg", headOffset: 8 });
  });

  test("sliceNewPtyOutput preserves first live output when subscription wins the startup race", () => {
    expect(sliceNewPtyOutput(0, "initial screen", 0)).toEqual({
      data: "initial screen",
      headOffset: 14,
    });
  });

  test("chatKeyToPtyInput maps Ctrl+C to the PTY interrupt byte", () => {
    expect(chatKeyToPtyInput({ name: "c", ctrl: true, sequence: "\x1b[99;5u" })).toBe("\x03");
  });

  test("chatKeyToPtyInput maps Escape to ESC even without a sequence", () => {
    expect(chatKeyToPtyInput({ name: "escape", ctrl: false })).toBe("\x1b");
  });

  test("chatKeyToPtyInput preserves ordinary key sequences", () => {
    expect(chatKeyToPtyInput({ name: "x", ctrl: false, sequence: "x" })).toBe("x");
  });

  test("terminal run status identifies agent-exited chat sessions", () => {
    expect(isTerminalRunStatus("complete")).toBe(true);
    expect(isTerminalRunStatus("error")).toBe(true);
    expect(isTerminalRunStatus("cancelled")).toBe(true);
    expect(isTerminalRunStatus("active")).toBe(false);
    expect(isTerminalRunStatus(undefined)).toBe(false);
  });

  test("Ctrl+D is the direct-chat detach key", () => {
    expect(isChatDetachKey({ name: "d", ctrl: true })).toBe(true);
    expect(isChatDetachKey({ name: "b", ctrl: true })).toBe(false);
    expect(isChatDetachKey({ name: "g", ctrl: true })).toBe(false);
    expect(isChatDetachKey({ name: "d", ctrl: false })).toBe(false);
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
