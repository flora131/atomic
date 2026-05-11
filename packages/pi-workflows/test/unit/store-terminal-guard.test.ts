/**
 * Tests for:
 *  - recordRunEnd terminal guard (completed | failed | killed cannot be overwritten)
 *  - recordRunEnd boolean return
 *  - error param only stored for failed/killed; result only stored for completed
 *  - WorkflowNotice APIs: recordNotice, ackNotice, notices()
 *  - StoreSnapshot includes notices
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { createStore } from "../../src/store.js";
import type { Store } from "../../src/store.js";
import type { RunSnapshot, WorkflowNotice } from "../../src/store-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(id: string): RunSnapshot {
  return {
    id,
    name: `run-${id}`,
    inputs: {},
    status: "running",
    stages: [],
    startedAt: Date.now(),
  };
}

function makeNotice(id: string, overrides: Partial<WorkflowNotice> = {}): WorkflowNotice {
  return {
    id,
    level: "info",
    message: `notice ${id}`,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Terminal guard — recordRunEnd
// ---------------------------------------------------------------------------

describe("recordRunEnd — terminal guard", () => {
  let s: Store;

  beforeEach(() => {
    s = createStore();
    s.recordRunStart(makeRun("r1"));
  });

  test("returns true when state changes (running → completed)", () => {
    expect(s.recordRunEnd("r1", "completed")).toBe(true);
  });

  test("returns false for unknown runId", () => {
    expect(s.recordRunEnd("no-such-run", "completed")).toBe(false);
  });

  test("sets endedAt and durationMs on success", () => {
    s.recordRunEnd("r1", "completed");
    const run = s.runs().find((r) => r.id === "r1")!;
    expect(run.endedAt).toBeDefined();
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
  });

  // --- completed is terminal ---

  test("completed cannot be overwritten by completed", () => {
    s.recordRunEnd("r1", "completed");
    const changed = s.recordRunEnd("r1", "completed");
    expect(changed).toBe(false);
  });

  test("completed cannot be overwritten by failed", () => {
    s.recordRunEnd("r1", "completed");
    expect(s.recordRunEnd("r1", "failed")).toBe(false);
    expect(s.runs().find((r) => r.id === "r1")!.status).toBe("completed");
  });

  test("completed cannot be overwritten by killed", () => {
    s.recordRunEnd("r1", "completed");
    expect(s.recordRunEnd("r1", "killed")).toBe(false);
    expect(s.runs().find((r) => r.id === "r1")!.status).toBe("completed");
  });

  // --- failed is terminal ---

  test("failed cannot be overwritten by completed", () => {
    s.recordRunEnd("r1", "failed");
    expect(s.recordRunEnd("r1", "completed")).toBe(false);
    expect(s.runs().find((r) => r.id === "r1")!.status).toBe("failed");
  });

  test("failed cannot be overwritten by killed", () => {
    s.recordRunEnd("r1", "failed");
    expect(s.recordRunEnd("r1", "killed")).toBe(false);
  });

  // --- killed is terminal ---

  test("killed cannot be overwritten by completed", () => {
    s.recordRunEnd("r1", "killed");
    expect(s.recordRunEnd("r1", "completed")).toBe(false);
    expect(s.runs().find((r) => r.id === "r1")!.status).toBe("killed");
  });

  test("killed cannot be overwritten by failed", () => {
    s.recordRunEnd("r1", "killed");
    expect(s.recordRunEnd("r1", "failed")).toBe(false);
  });

  // --- result/error field rules ---

  test("result stored only for completed", () => {
    s.recordRunEnd("r1", "completed", { answer: 42 });
    expect(s.runs().find((r) => r.id === "r1")!.result).toEqual({ answer: 42 });
  });

  test("result NOT stored for failed (wrong status)", () => {
    s.recordRunEnd("r1", "failed", { answer: 42 });
    expect(s.runs().find((r) => r.id === "r1")!.result).toBeUndefined();
  });

  test("result NOT stored for killed", () => {
    s.recordRunEnd("r1", "killed", { answer: 42 });
    expect(s.runs().find((r) => r.id === "r1")!.result).toBeUndefined();
  });

  test("error stored for failed", () => {
    s.recordRunEnd("r1", "failed", undefined, "boom");
    expect(s.runs().find((r) => r.id === "r1")!.error).toBe("boom");
  });

  test("error stored for killed", () => {
    s.recordRunEnd("r1", "killed", undefined, "signal 9");
    expect(s.runs().find((r) => r.id === "r1")!.error).toBe("signal 9");
  });

  test("error NOT stored for completed", () => {
    s.recordRunEnd("r1", "completed", undefined, "ignored-error");
    expect(s.runs().find((r) => r.id === "r1")!.error).toBeUndefined();
  });

  // --- endedAt not overwritten on guard rejection ---

  test("endedAt not overwritten after terminal guard rejection", () => {
    s.recordRunEnd("r1", "completed");
    const endedAt = s.runs().find((r) => r.id === "r1")!.endedAt!;
    // small delay then attempt overwrite
    const changed = s.recordRunEnd("r1", "failed");
    expect(changed).toBe(false);
    expect(s.runs().find((r) => r.id === "r1")!.endedAt).toBe(endedAt);
  });

  // --- subscriber notified exactly once per successful call ---

  test("subscriber notified on success, not notified on guard rejection", () => {
    const calls: number[] = [];
    s.subscribe((snap) => calls.push(snap.version));

    s.recordRunEnd("r1", "completed"); // should notify
    const versionAfterFirst = calls[calls.length - 1];

    s.recordRunEnd("r1", "failed"); // guard: no notify
    expect(calls[calls.length - 1]).toBe(versionAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// WorkflowNotice APIs
// ---------------------------------------------------------------------------

describe("recordNotice and ackNotice", () => {
  let s: Store;

  beforeEach(() => {
    s = createStore();
  });

  test("notices() initially empty", () => {
    expect(s.notices()).toHaveLength(0);
  });

  test("recordNotice stores notice", () => {
    s.recordNotice(makeNotice("n1"));
    expect(s.notices()).toHaveLength(1);
    expect(s.notices()[0]!.id).toBe("n1");
  });

  test("recordNotice increments version and notifies", () => {
    const versions: number[] = [];
    s.subscribe((snap) => versions.push(snap.version));
    s.recordNotice(makeNotice("n1"));
    expect(versions.length).toBeGreaterThanOrEqual(1);
  });

  test("notices included in snapshot", () => {
    s.recordNotice(makeNotice("n1", { level: "warning", message: "watch out" }));
    const snap = s.snapshot();
    expect(snap.notices).toHaveLength(1);
    expect(snap.notices[0]!.level).toBe("warning");
    expect(snap.notices[0]!.message).toBe("watch out");
  });

  test("ackNotice returns true and sets ackedAt", () => {
    s.recordNotice(makeNotice("n1", { requiresAck: true }));
    const before = Date.now();
    const result = s.ackNotice("n1");
    const after = Date.now();
    expect(result).toBe(true);
    const notice = s.notices().find((n) => n.id === "n1")!;
    expect(notice.ackedAt).toBeGreaterThanOrEqual(before);
    expect(notice.ackedAt).toBeLessThanOrEqual(after);
  });

  test("ackNotice returns false for unknown id", () => {
    expect(s.ackNotice("no-such-notice")).toBe(false);
  });

  test("ackNotice returns false if already acked", () => {
    s.recordNotice(makeNotice("n1"));
    s.ackNotice("n1");
    expect(s.ackNotice("n1")).toBe(false);
  });

  test("ackNotice notifies subscriber", () => {
    s.recordNotice(makeNotice("n1"));
    const versions: number[] = [];
    s.subscribe((snap) => versions.push(snap.version));
    s.ackNotice("n1");
    expect(versions.length).toBeGreaterThanOrEqual(1);
  });

  test("ackNotice on unknown id does not notify", () => {
    const versions: number[] = [];
    s.subscribe((snap) => versions.push(snap.version));
    s.ackNotice("ghost");
    expect(versions.length).toBe(0);
  });

  test("multiple notices stored independently", () => {
    s.recordNotice(makeNotice("n1", { level: "info" }));
    s.recordNotice(makeNotice("n2", { level: "error" }));
    s.recordNotice(makeNotice("n3", { level: "warning" }));
    expect(s.notices()).toHaveLength(3);
    expect(s.notices()[1]!.level).toBe("error");
  });

  test("notice can carry runId and stageId", () => {
    s.recordNotice(makeNotice("n1", { runId: "r1", stageId: "s1" }));
    const snap = s.snapshot();
    expect(snap.notices[0]!.runId).toBe("r1");
    expect(snap.notices[0]!.stageId).toBe("s1");
  });

  test("snapshot notices are deep-cloned (immutable from outside)", () => {
    s.recordNotice(makeNotice("n1", { message: "original" }));
    const snap = s.snapshot();
    // Mutating snapshot should not affect store
    (snap.notices[0] as WorkflowNotice).message = "mutated";
    expect(s.notices()[0]!.message).toBe("original");
  });
});
