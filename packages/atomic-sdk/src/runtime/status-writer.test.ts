/**
 * Unit tests for the workflow status writer.
 *
 * Covers the pure helpers (overall-status derivation, snapshot
 * construction, tmux-name → run-id parsing) and the file I/O round
 * trip against a real temp directory.
 */

import { describe, test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildSnapshot,
  deriveOverallStatus,
  readSnapshot,
  workflowRunIdFromTmuxName,
  writeSnapshot,
  type WorkflowStatusSnapshot,
} from "./status-writer.ts";
import type { SessionData } from "../components/orchestrator-panel-types.ts";

function session(
  name: string,
  status: SessionData["status"],
  extra: Partial<SessionData> = {},
): SessionData {
  return {
    name,
    status,
    parents: [],
    startedAt: 1000,
    endedAt: null,
    ...extra,
  };
}

// ─── deriveOverallStatus ────────────────────────────────────────────

describe("deriveOverallStatus", () => {
  test("returns 'error' when fatalError is set, even if completion is reached", () => {
    expect(
      deriveOverallStatus({
        sessions: [],
        fatalError: "boom",
        completionReached: true,
      }),
    ).toBe("error");
  });

  test("returns 'error' when any session ended in error", () => {
    expect(
      deriveOverallStatus({
        sessions: [session("a", "complete"), session("b", "error")],
        fatalError: null,
        completionReached: false,
      }),
    ).toBe("error");
  });

  test("returns 'needs_review' when any session is awaiting_input", () => {
    expect(
      deriveOverallStatus({
        sessions: [session("a", "running"), session("b", "awaiting_input")],
        fatalError: null,
        completionReached: false,
      }),
    ).toBe("needs_review");
  });

  test("'needs_review' wins over 'completed' so a HIL pause near the end isn't reported as done", () => {
    expect(
      deriveOverallStatus({
        sessions: [session("a", "complete"), session("b", "awaiting_input")],
        fatalError: null,
        completionReached: true,
      }),
    ).toBe("needs_review");
  });

  test("returns 'completed' when completionReached and nothing errored or paused", () => {
    expect(
      deriveOverallStatus({
        sessions: [session("a", "complete"), session("b", "complete")],
        fatalError: null,
        completionReached: true,
      }),
    ).toBe("completed");
  });

  test("returns 'in_progress' as the default", () => {
    expect(
      deriveOverallStatus({
        sessions: [session("a", "running")],
        fatalError: null,
        completionReached: false,
      }),
    ).toBe("in_progress");
  });
});

// ─── workflowRunIdFromTmuxName ──────────────────────────────────────

describe("workflowRunIdFromTmuxName", () => {
  test("extracts the trailing 8-hex segment from a workflow session name", () => {
    expect(workflowRunIdFromTmuxName("atomic-wf-claude-ralph-a1b2c3d4")).toBe(
      "a1b2c3d4",
    );
  });

  test("handles workflow names containing hyphens", () => {
    expect(
      workflowRunIdFromTmuxName("atomic-wf-claude-deep-research-12345678"),
    ).toBe("12345678");
  });

  test("returns null for chat sessions", () => {
    expect(workflowRunIdFromTmuxName("atomic-chat-claude-deadbeef")).toBeNull();
  });

  test("returns null when the suffix is not 8-char hex", () => {
    expect(workflowRunIdFromTmuxName("atomic-wf-claude-ralph-not-hex")).toBeNull();
  });

  test("returns null for an unrelated session name", () => {
    expect(workflowRunIdFromTmuxName("my-session")).toBeNull();
  });
});

// ─── buildSnapshot ──────────────────────────────────────────────────

describe("buildSnapshot", () => {
  test("populates schemaVersion + identifying fields and clones session arrays", () => {
    const fixed = new Date("2026-01-01T00:00:00.000Z");
    const sourceParents = ["orchestrator"];
    const sourceSession = session("orchestrator", "running", { parents: sourceParents });
    const snap = buildSnapshot(
      {
        workflowRunId: "abcd1234",
        tmuxSession: "atomic-wf-claude-ralph-abcd1234",
        workflowName: "ralph",
        agent: "claude",
        prompt: "hello",
        fatalError: null,
        completionReached: false,
        sessions: [sourceSession],
      },
      () => fixed,
    );

    expect(snap.schemaVersion).toBe(1);
    expect(snap.workflowRunId).toBe("abcd1234");
    expect(snap.tmuxSession).toBe("atomic-wf-claude-ralph-abcd1234");
    expect(snap.workflowName).toBe("ralph");
    expect(snap.agent).toBe("claude");
    expect(snap.prompt).toBe("hello");
    expect(snap.overall).toBe("in_progress");
    expect(snap.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0]!.name).toBe("orchestrator");
    // parents must be cloned, not aliased to the input array — otherwise
    // a later panel-store mutation would silently rewrite a snapshot
    // that we already handed to a consumer.
    expect(snap.sessions[0]!.parents).not.toBe(sourceParents);
    expect(snap.sessions[0]!.parents).toEqual(sourceParents);
  });

  test("propagates the derived overall status from the inputs", () => {
    const snap = buildSnapshot({
      workflowRunId: "abcd1234",
      tmuxSession: "x",
      workflowName: "ralph",
      agent: "claude",
      prompt: "",
      fatalError: null,
      completionReached: true,
      sessions: [session("a", "complete")],
    });
    expect(snap.overall).toBe("completed");
  });
});

// ─── write/read round trip ──────────────────────────────────────────

describe("writeSnapshot + readSnapshot", () => {
  test("persists a snapshot and reads it back unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atomic-status-"));
    try {
      const snap: WorkflowStatusSnapshot = buildSnapshot({
        workflowRunId: "abcd1234",
        tmuxSession: "atomic-wf-claude-ralph-abcd1234",
        workflowName: "ralph",
        agent: "claude",
        prompt: "hello",
        fatalError: null,
        completionReached: false,
        sessions: [session("orchestrator", "running")],
      });

      await writeSnapshot(dir, snap);
      const back = await readSnapshot(dir);
      expect(back).not.toBeNull();
      expect(back!.workflowRunId).toBe("abcd1234");
      expect(back!.overall).toBe("in_progress");
      expect(back!.sessions).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null when status.json does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atomic-status-"));
    try {
      const back = await readSnapshot(dir);
      expect(back).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null when status.json is malformed JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atomic-status-"));
    try {
      await Bun.write(join(dir, "status.json"), "not-json");
      const back = await readSnapshot(dir);
      expect(back).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null when status.json fails the snapshot shape guard", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atomic-status-"));
    try {
      await Bun.write(
        join(dir, "status.json"),
        JSON.stringify({ schemaVersion: 99, foo: "bar" }),
      );
      const back = await readSnapshot(dir);
      expect(back).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
