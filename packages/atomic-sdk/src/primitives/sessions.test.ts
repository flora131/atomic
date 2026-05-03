/**
 * Tests for `src/sdk/primitives/sessions.ts`.
 *
 * Each function accepts an optional `deps` parameter, so these tests
 * inject in-memory fakes instead of using `mock.module` (which leaks
 * across the parallel test run). Filesystem-backed paths
 * (`getSessionStatus`, `getSessionTranscript`) write fixtures into a
 * fresh `mkdtempSync` dir and pass the dir via `deps.sessionsBaseDir`.
 */

import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachSession,
  detachSession,
  getSession,
  getSessionStatus,
  getSessionTranscript,
  gotoOrchestrator,
  listSessions,
  nextWindow,
  previousWindow,
  stopSession,
  type SessionPrimitiveDeps,
} from "./sessions.ts";
import { MissingDependencyError, SessionNotFoundError } from "../errors.ts";
import type { TmuxSession } from "../runtime/tmux.ts";
import type { WorkflowStatusSnapshot } from "../runtime/status-writer.ts";

// ─── Test deps factory ──────────────────────────────────────────────────────

interface DepsOverrides {
  isTmuxInstalled?: SessionPrimitiveDeps["isTmuxInstalled"];
  listAllTmuxSessions?: SessionPrimitiveDeps["listAllTmuxSessions"];
  killSession?: SessionPrimitiveDeps["killSession"];
  attachSession?: SessionPrimitiveDeps["attachSession"];
  detachClients?: SessionPrimitiveDeps["detachClients"];
  nextWindow?: SessionPrimitiveDeps["nextWindow"];
  previousWindow?: SessionPrimitiveDeps["previousWindow"];
  selectWindow?: SessionPrimitiveDeps["selectWindow"];
  readSnapshot?: SessionPrimitiveDeps["readSnapshot"];
  sessionsBaseDir?: string;
}

function makeDeps(overrides: DepsOverrides = {}): SessionPrimitiveDeps {
  return {
    isTmuxInstalled: overrides.isTmuxInstalled ?? (() => true),
    listAllTmuxSessions: overrides.listAllTmuxSessions ?? (() => []),
    killSession: overrides.killSession ?? (() => {}),
    attachSession: overrides.attachSession ?? (() => {}),
    detachClients: overrides.detachClients ?? (() => {}),
    nextWindow: overrides.nextWindow ?? (() => {}),
    previousWindow: overrides.previousWindow ?? (() => {}),
    selectWindow: overrides.selectWindow ?? (() => {}),
    readSnapshot: overrides.readSnapshot ?? (async () => null),
    sessionsBaseDir: overrides.sessionsBaseDir ?? "/tmp/atomic-sessions-test-fallback",
  };
}

const NOW = "2026-04-27T00:00:00.000Z";

function fakeSession(partial: Partial<TmuxSession> & { name: string }): TmuxSession {
  return {
    windows: 1,
    created: NOW,
    attached: false,
    ...partial,
  };
}

// ─── listSessions ───────────────────────────────────────────────────────────

describe("listSessions", () => {
  test("returns [] when tmux is not installed", () => {
    const result = listSessions(
      {},
      makeDeps({ isTmuxInstalled: () => false }),
    );
    expect(result).toEqual([]);
  });

  test("returns [] when no tmux sessions exist", () => {
    const result = listSessions({}, makeDeps());
    expect(result).toEqual([]);
  });

  test("maps TmuxSession to SessionInfo and preserves all fields", () => {
    const tmuxSession = fakeSession({
      name: "atomic-chat-claude-aaa11111",
      type: "chat",
      agent: "claude",
      attached: true,
    });
    const result = listSessions(
      {},
      makeDeps({ listAllTmuxSessions: () => [tmuxSession] }),
    );
    expect(result).toEqual([
      {
        id: "atomic-chat-claude-aaa11111",
        type: "chat",
        agent: "claude",
        created: NOW,
        attached: true,
      },
    ]);
  });

  test("scope='chat' excludes workflow sessions", () => {
    const sessions = [
      fakeSession({ name: "c", type: "chat", agent: "claude" }),
      fakeSession({ name: "w", type: "workflow", agent: "claude" }),
    ];
    const result = listSessions(
      { scope: "chat" },
      makeDeps({ listAllTmuxSessions: () => sessions }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("c");
  });

  test("scope='workflow' excludes chat sessions", () => {
    const sessions = [
      fakeSession({ name: "c", type: "chat", agent: "claude" }),
      fakeSession({ name: "w", type: "workflow", agent: "claude" }),
    ];
    const result = listSessions(
      { scope: "workflow" },
      makeDeps({ listAllTmuxSessions: () => sessions }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("w");
  });

  test("scope defaults to 'all'", () => {
    const sessions = [
      fakeSession({ name: "c", type: "chat", agent: "claude" }),
      fakeSession({ name: "w", type: "workflow", agent: "claude" }),
    ];
    const result = listSessions(
      {},
      makeDeps({ listAllTmuxSessions: () => sessions }),
    );
    expect(result).toHaveLength(2);
  });

  test("agent filter accepts a single AgentType", () => {
    const sessions = [
      fakeSession({ name: "a", type: "chat", agent: "claude" }),
      fakeSession({ name: "b", type: "chat", agent: "copilot" }),
    ];
    const result = listSessions(
      { agent: "claude" },
      makeDeps({ listAllTmuxSessions: () => sessions }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.agent).toBe("claude");
  });

  test("agent filter accepts a readonly array of AgentTypes", () => {
    const sessions = [
      fakeSession({ name: "a", type: "chat", agent: "claude" }),
      fakeSession({ name: "b", type: "chat", agent: "copilot" }),
      fakeSession({ name: "c", type: "chat", agent: "opencode" }),
    ];
    const result = listSessions(
      { agent: ["claude", "opencode"] as const },
      makeDeps({ listAllTmuxSessions: () => sessions }),
    );
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.agent).sort()).toEqual(["claude", "opencode"]);
  });

  test("agent filter excludes sessions with no agent field", () => {
    const sessions = [
      fakeSession({ name: "a", type: "chat", agent: "claude" }),
      fakeSession({ name: "b", type: "chat" }),
    ];
    const result = listSessions(
      { agent: "claude" },
      makeDeps({ listAllTmuxSessions: () => sessions }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a");
  });

  test("scope + agent filters compose", () => {
    const sessions = [
      fakeSession({ name: "wfc", type: "workflow", agent: "claude" }),
      fakeSession({ name: "wfo", type: "workflow", agent: "opencode" }),
      fakeSession({ name: "chc", type: "chat", agent: "claude" }),
    ];
    const result = listSessions(
      { scope: "workflow", agent: "claude" },
      makeDeps({ listAllTmuxSessions: () => sessions }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("wfc");
  });
});

// ─── getSession ─────────────────────────────────────────────────────────────

describe("getSession", () => {
  test("returns undefined when tmux is not installed", () => {
    const result = getSession(
      "atomic-chat-claude-aaa11111",
      makeDeps({ isTmuxInstalled: () => false }),
    );
    expect(result).toBeUndefined();
  });

  test("returns undefined when no session matches the id", () => {
    const result = getSession(
      "missing",
      makeDeps({
        listAllTmuxSessions: () => [
          fakeSession({ name: "atomic-chat-claude-aaa11111", type: "chat", agent: "claude" }),
        ],
      }),
    );
    expect(result).toBeUndefined();
  });

  test("returns SessionInfo when the session exists", () => {
    const target = fakeSession({
      name: "atomic-chat-claude-aaa11111",
      type: "chat",
      agent: "claude",
    });
    const result = getSession(
      "atomic-chat-claude-aaa11111",
      makeDeps({ listAllTmuxSessions: () => [target] }),
    );
    expect(result).toBeDefined();
    expect(result!.id).toBe("atomic-chat-claude-aaa11111");
    expect(result!.agent).toBe("claude");
  });
});

// ─── stopSession ────────────────────────────────────────────────────────────

describe("stopSession", () => {
  test("returns silently when tmux is not installed", async () => {
    const killSpy = mock<(id: string) => void>(() => {});
    await stopSession(
      "atomic-chat-claude-aaa11111",
      makeDeps({ isTmuxInstalled: () => false, killSession: killSpy }),
    );
    expect(killSpy).not.toHaveBeenCalled();
  });

  test("calls killSession when tmux is installed", async () => {
    const killSpy = mock<(id: string) => void>(() => {});
    await stopSession("atomic-chat-claude-aaa11111", makeDeps({ killSession: killSpy }));
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith("atomic-chat-claude-aaa11111");
  });

  test("swallows errors from killSession (best-effort stop)", async () => {
    const killSpy = mock<(id: string) => void>(() => {
      throw new Error("session not found");
    });
    // Must not throw — sessions that are already gone should resolve cleanly.
    await stopSession("ghost", makeDeps({ killSession: killSpy }));
    expect(killSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── detachSession ──────────────────────────────────────────────────────────

describe("detachSession", () => {
  test("returns silently when tmux is not installed", async () => {
    const detachSpy = mock<(id: string) => void>(() => {});
    await detachSession(
      "atomic-chat-claude-aaa11111",
      makeDeps({ isTmuxInstalled: () => false, detachClients: detachSpy }),
    );
    expect(detachSpy).not.toHaveBeenCalled();
  });

  test("calls detachClients when tmux is installed", async () => {
    const detachSpy = mock<(id: string) => void>(() => {});
    await detachSession(
      "atomic-chat-claude-aaa11111",
      makeDeps({ detachClients: detachSpy }),
    );
    expect(detachSpy).toHaveBeenCalledTimes(1);
    expect(detachSpy).toHaveBeenCalledWith("atomic-chat-claude-aaa11111");
  });

  test("swallows errors from detachClients (best-effort detach)", async () => {
    const detachSpy = mock<(id: string) => void>(() => {
      throw new Error("session not found");
    });
    // Must not throw — detaching from a session that's already gone or has
    // no clients attached should resolve cleanly.
    await detachSession("ghost", makeDeps({ detachClients: detachSpy }));
    expect(detachSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── attachSession ──────────────────────────────────────────────────────────

describe("attachSession", () => {
  test("throws MissingDependencyError when tmux is not installed", async () => {
    await expect(
      attachSession(
        "atomic-chat-claude-aaa11111",
        makeDeps({ isTmuxInstalled: () => false }),
      ),
    ).rejects.toBeInstanceOf(MissingDependencyError);
  });

  test("delegates to deps.attachSession when tmux is installed", async () => {
    const attachSpy = mock<(id: string) => void>(() => {});
    await attachSession(
      "atomic-chat-claude-aaa11111",
      makeDeps({ attachSession: attachSpy }),
    );
    expect(attachSpy).toHaveBeenCalledTimes(1);
    expect(attachSpy).toHaveBeenCalledWith("atomic-chat-claude-aaa11111");
  });
});

// ─── nextWindow / previousWindow / gotoOrchestrator ────────────────────────
//
// All three navigation primitives share the same shape:
//   1. throw when tmux is not installed
//   2. throw when the session does not exist
//   3. invoke the underlying tmux verb against the session
//   4. NEVER attach — navigation is silent. Callers compose
//      `nextWindow(id) + attachSession(id)` if they want navigate-then-attach.
//
// The shared describe block keeps the preamble contract explicit and pins
// the no-auto-attach guarantee; per-primitive blocks below pin the exact
// tmux verb each one routes to.

interface NavCase {
  label: string;
  call: (id: string, deps: SessionPrimitiveDeps) => Promise<void>;
}

const NAV_CASES: NavCase[] = [
  { label: "nextWindow", call: nextWindow },
  { label: "previousWindow", call: previousWindow },
  { label: "gotoOrchestrator", call: gotoOrchestrator },
];

describe.each(NAV_CASES)("$label — shared contract", ({ call }) => {
  test("throws MissingDependencyError when tmux is not installed", async () => {
    await expect(
      call("atomic-wf-claude-ralph-deadbeef", makeDeps({ isTmuxInstalled: () => false })),
    ).rejects.toBeInstanceOf(MissingDependencyError);
  });

  test("throws SessionNotFoundError when the session id is not found", async () => {
    const promise = call("ghost", makeDeps({ listAllTmuxSessions: () => [] }));
    await expect(promise).rejects.toBeInstanceOf(SessionNotFoundError);
    // Carry the id so callers can render it without parsing message text.
    await expect(promise).rejects.toMatchObject({ id: "ghost" });
  });

  test("never attaches, regardless of whether a client is watching", async () => {
    const attachSpy = mock<(id: string) => void>(() => {});
    const detached = fakeSession({
      name: "atomic-wf-claude-ralph-detached",
      type: "workflow",
      agent: "claude",
      attached: false,
    });
    const attached = fakeSession({
      name: "atomic-wf-claude-ralph-attached",
      type: "workflow",
      agent: "claude",
      attached: true,
    });
    await call(
      "atomic-wf-claude-ralph-detached",
      makeDeps({ listAllTmuxSessions: () => [detached], attachSession: attachSpy }),
    );
    await call(
      "atomic-wf-claude-ralph-attached",
      makeDeps({ listAllTmuxSessions: () => [attached], attachSession: attachSpy }),
    );
    expect(attachSpy).not.toHaveBeenCalled();
  });
});

describe("nextWindow", () => {
  test("invokes tmux next-window against the session id", async () => {
    const nextSpy = mock<(id: string) => void>(() => {});
    const sess = fakeSession({ name: "s" });
    await nextWindow("s", makeDeps({ listAllTmuxSessions: () => [sess], nextWindow: nextSpy }));
    expect(nextSpy).toHaveBeenCalledTimes(1);
    expect(nextSpy).toHaveBeenCalledWith("s");
  });
});

describe("previousWindow", () => {
  test("invokes tmux previous-window against the session id", async () => {
    const prevSpy = mock<(id: string) => void>(() => {});
    const sess = fakeSession({ name: "s" });
    await previousWindow(
      "s",
      makeDeps({ listAllTmuxSessions: () => [sess], previousWindow: prevSpy }),
    );
    expect(prevSpy).toHaveBeenCalledTimes(1);
    expect(prevSpy).toHaveBeenCalledWith("s");
  });
});

describe("gotoOrchestrator", () => {
  test("selects window 0 of the target session", async () => {
    const selectSpy = mock<(target: string) => void>(() => {});
    const sess = fakeSession({ name: "s" });
    await gotoOrchestrator(
      "s",
      makeDeps({ listAllTmuxSessions: () => [sess], selectWindow: selectSpy }),
    );
    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(selectSpy).toHaveBeenCalledWith("s:0");
  });
});

// ─── getSessionStatus ───────────────────────────────────────────────────────

describe("getSessionStatus", () => {
  test("returns null for an id that doesn't match the workflow tmux pattern", async () => {
    const readSpy = mock(async () => null);
    const result = await getSessionStatus(
      "atomic-chat-claude-aaa11111",
      makeDeps({ readSnapshot: readSpy }),
    );
    expect(result).toBeNull();
    // Bail-out should happen before the snapshot reader is consulted.
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("returns null for a name with no 8-hex run-id suffix", async () => {
    const readSpy = mock(async () => null);
    const result = await getSessionStatus(
      "atomic-wf-claude-ralph-shortid",
      makeDeps({ readSnapshot: readSpy }),
    );
    expect(result).toBeNull();
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("returns null when the snapshot reader returns null", async () => {
    const result = await getSessionStatus(
      "atomic-wf-claude-ralph-deadbeef",
      makeDeps({ readSnapshot: async () => null }),
    );
    expect(result).toBeNull();
  });

  test("returns the snapshot when the reader yields one", async () => {
    const snapshot: WorkflowStatusSnapshot = {
      schemaVersion: 1,
      workflowRunId: "deadbeef",
      tmuxSession: "atomic-wf-claude-ralph-deadbeef",
      workflowName: "ralph",
      agent: "claude",
      prompt: "fix the auth bug",
      overall: "in_progress",
      completionReached: false,
      fatalError: null,
      updatedAt: NOW,
      sessions: [],
    };
    const readSpy = mock(async () => snapshot);
    const result = await getSessionStatus(
      "atomic-wf-claude-ralph-deadbeef",
      makeDeps({ readSnapshot: readSpy, sessionsBaseDir: "/fake/base" }),
    );
    expect(result).toEqual(snapshot);
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(readSpy).toHaveBeenCalledWith("/fake/base/deadbeef");
  });
});

// ─── getSessionTranscript ───────────────────────────────────────────────────

describe("getSessionTranscript", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "atomic-sessions-test-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  test("returns [] for an id that doesn't match the workflow tmux pattern", async () => {
    const result = await getSessionTranscript(
      "atomic-chat-claude-aaa11111",
      "stage-1",
      makeDeps({ sessionsBaseDir: baseDir }),
    );
    expect(result).toEqual([]);
  });

  test("returns [] when the messages file does not exist", async () => {
    const result = await getSessionTranscript(
      "atomic-wf-claude-ralph-deadbeef",
      "stage-1",
      makeDeps({ sessionsBaseDir: baseDir }),
    );
    expect(result).toEqual([]);
  });

  test("returns parsed messages with valid provider entries", async () => {
    const runId = "deadbeef";
    const stageDir = join(baseDir, runId, "stage-1");
    mkdirSync(stageDir, { recursive: true });
    const messages = [
      { provider: "claude", data: { kind: "assistant", text: "hello" } },
      { provider: "copilot", data: { type: "tool" } },
      { provider: "opencode", data: { info: {}, parts: [] } },
    ];
    writeFileSync(join(stageDir, "messages.json"), JSON.stringify(messages));

    const result = await getSessionTranscript(
      "atomic-wf-claude-ralph-deadbeef",
      "stage-1",
      makeDeps({ sessionsBaseDir: baseDir }),
    );
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.provider).sort()).toEqual([
      "claude",
      "copilot",
      "opencode",
    ]);
  });

  test("filters out array entries with unknown provider field", async () => {
    const runId = "deadbeef";
    const stageDir = join(baseDir, runId, "stage-1");
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(
      join(stageDir, "messages.json"),
      JSON.stringify([
        { provider: "claude", data: {} },
        { provider: "bogus", data: {} },
        null,
        "string-entry",
        42,
      ]),
    );

    const result = await getSessionTranscript(
      "atomic-wf-claude-ralph-deadbeef",
      "stage-1",
      makeDeps({ sessionsBaseDir: baseDir }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.provider).toBe("claude");
  });

  test("returns [] when the messages file is invalid JSON", async () => {
    const runId = "deadbeef";
    const stageDir = join(baseDir, runId, "stage-1");
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(stageDir, "messages.json"), "{not-json");

    const result = await getSessionTranscript(
      "atomic-wf-claude-ralph-deadbeef",
      "stage-1",
      makeDeps({ sessionsBaseDir: baseDir }),
    );
    expect(result).toEqual([]);
  });

  test("returns [] when the messages file parses to a non-array", async () => {
    const runId = "deadbeef";
    const stageDir = join(baseDir, runId, "stage-1");
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(
      join(stageDir, "messages.json"),
      JSON.stringify({ provider: "claude" }),
    );

    const result = await getSessionTranscript(
      "atomic-wf-claude-ralph-deadbeef",
      "stage-1",
      makeDeps({ sessionsBaseDir: baseDir }),
    );
    expect(result).toEqual([]);
  });
});
