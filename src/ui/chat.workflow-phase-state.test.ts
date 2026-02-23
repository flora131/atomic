import { describe, expect, test } from "bun:test";
import type { PhaseData } from "./commands/workflow-commands.ts";
import {
  getWorkflowPhaseRenderItems,
  getWorkflowPhaseKey,
  toggleExpandedWorkflowPhase,
} from "./chat.tsx";

function createPhase(overrides?: Partial<PhaseData>): PhaseData {
  return {
    nodeId: "review",
    phaseName: "Code Review",
    phaseIcon: "✓",
    message: "[Code Review] Review completed.",
    events: [],
    startedAt: "2026-02-22T00:00:00.000Z",
    completedAt: "2026-02-22T00:00:01.000Z",
    durationMs: 1000,
    status: "completed",
    ...overrides,
  };
}

describe("workflow phase key helpers", () => {
  test("includes index to keep duplicate node IDs unique", () => {
    const phase = createPhase();
    expect(getWorkflowPhaseKey("msg-1", phase, 0)).not.toBe(getWorkflowPhaseKey("msg-1", phase, 1));
  });

  test("toggles expanded state on and off", () => {
    const phaseKey = getWorkflowPhaseKey("msg-1", createPhase(), 0);
    const expanded = toggleExpandedWorkflowPhase(new Set(), phaseKey);
    expect(expanded.has(phaseKey)).toBe(true);

    const collapsed = toggleExpandedWorkflowPhase(expanded, phaseKey);
    expect(collapsed.has(phaseKey)).toBe(false);
  });
});

describe("workflow phase render items", () => {
  test("renders all phases and applies expanded state by key", () => {
    const first = createPhase({ nodeId: "plan", startedAt: "2026-02-22T00:00:00.000Z" });
    const second = createPhase({ nodeId: "review", startedAt: "2026-02-22T00:01:00.000Z" });
    const secondKey = getWorkflowPhaseKey("msg-1", second, 1);
    const expanded = new Set([secondKey]);

    const items = getWorkflowPhaseRenderItems("msg-1", [first, second], expanded);

    expect(items).toHaveLength(2);
    expect(items[0]?.expanded).toBe(false);
    expect(items[1]?.expanded).toBe(true);
  });

  test("wires toggle callback for each workflow phase item", () => {
    const phase = createPhase();
    const calls: string[] = [];
    const items = getWorkflowPhaseRenderItems(
      "msg-1",
      [phase],
      undefined,
      (phaseKey) => {
        calls.push(phaseKey);
      },
    );

    items[0]?.onToggle?.();

    expect(calls).toEqual([getWorkflowPhaseKey("msg-1", phase, 0)]);
  });
});
