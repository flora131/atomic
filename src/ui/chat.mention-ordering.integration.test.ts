import { describe, expect, test } from "bun:test";
import {
  shouldDeferPostCompleteDeltaUntilDoneProjection,
} from "./chat.tsx";
import {
  createAgentOrderingState,
  hasDoneStateProjection,
  registerAgentCompletionSequence,
  registerDoneStateProjection,
  type DoneStateProjection,
} from "./utils/agent-ordering-contract.ts";

type OrderingScenario = "single" | "multi";

interface DeferredDelta {
  messageId: string;
  delta: string;
  completionSequence: number;
}

interface OrderingObservabilitySample {
  agentId: string;
  scenario: OrderingScenario;
  doneProjected: boolean;
}

function createMentionOrderingHarness(initialForegroundAgentCount: number) {
  const orderingState = createAgentOrderingState();
  const deferredByAgent = new Map<string, DeferredDelta[]>();
  const rendered: Array<{ agentId: string; messageId: string; delta: string }> = [];
  const observabilitySamples: OrderingObservabilitySample[] = [];
  const timeline: string[] = [];
  let foregroundAgentCount = initialForegroundAgentCount;

  const scenario = (): OrderingScenario => (foregroundAgentCount > 1 ? "multi" : "single");

  const emitPostCompleteSample = (agentId: string, doneProjected: boolean): void => {
    observabilitySamples.push({
      agentId,
      doneProjected,
      scenario: scenario(),
    });
  };

  const flushDeferred = (agentId: string): void => {
    const deferred = deferredByAgent.get(agentId);
    if (!deferred || deferred.length === 0) return;
    if (!hasDoneStateProjection(orderingState, agentId)) return;
    deferredByAgent.delete(agentId);

    for (const item of deferred) {
      emitPostCompleteSample(agentId, true);
      rendered.push({ agentId, messageId: item.messageId, delta: item.delta });
      timeline.push(`text:${agentId}:${item.delta}`);
    }
  };

  return {
    setForegroundAgentCount(count: number): void {
      foregroundAgentCount = count;
    },
    registerCompletion(agentId: string, sequence: number): void {
      registerAgentCompletionSequence(orderingState, agentId, sequence);
    },
    registerDoneProjection(
      agentId: string,
      sequence: number,
      projectionMode: DoneStateProjection["projectionMode"] = "sync-bridge",
    ): void {
      registerDoneStateProjection(orderingState, {
        agentId,
        sequence,
        projectionMode,
      });
      timeline.push(`done:${agentId}`);
      flushDeferred(agentId);
    },
    handleAgentScopedTextDelta(agentId: string, messageId: string, delta: string): void {
      const completionSequence = orderingState.lastCompletionSequenceByAgent.get(agentId);
      if (typeof completionSequence !== "number") {
        rendered.push({ agentId, messageId, delta });
        timeline.push(`text:${agentId}:${delta}`);
        return;
      }

      const doneProjected = hasDoneStateProjection(orderingState, agentId);
      if (shouldDeferPostCompleteDeltaUntilDoneProjection({ completionSequence, doneProjected })) {
        const deferred = deferredByAgent.get(agentId) ?? [];
        deferred.push({ messageId, delta, completionSequence });
        deferredByAgent.set(agentId, deferred);
        return;
      }

      emitPostCompleteSample(agentId, doneProjected);
      rendered.push({ agentId, messageId, delta });
      timeline.push(`text:${agentId}:${delta}`);
    },
    getDeferredCount(agentId: string): number {
      return deferredByAgent.get(agentId)?.length ?? 0;
    },
    rendered,
    observabilitySamples,
    timeline,
  };
}

describe("@ mention ordering integration", () => {
  test("single mention defers post-complete text until done projection is visible", () => {
    const harness = createMentionOrderingHarness(1);
    harness.registerCompletion("agent-a", 4);

    harness.handleAgentScopedTextDelta("agent-a", "msg-1", "late-delta");
    expect(harness.getDeferredCount("agent-a")).toBe(1);
    expect(harness.rendered).toEqual([]);

    harness.registerDoneProjection("agent-a", 4);
    expect(harness.getDeferredCount("agent-a")).toBe(0);
    expect(harness.rendered).toEqual([
      { agentId: "agent-a", messageId: "msg-1", delta: "late-delta" },
    ]);
    expect(harness.timeline).toEqual(["done:agent-a", "text:agent-a:late-delta"]);
    expect(harness.observabilitySamples).toEqual([
      {
        agentId: "agent-a",
        doneProjected: true,
        scenario: "single",
      },
    ]);
  });

  test("multi mention enforces ordering per agent without cross-agent blocking", () => {
    const harness = createMentionOrderingHarness(2);
    harness.registerCompletion("agent-a", 10);
    harness.registerCompletion("agent-b", 11);

    harness.handleAgentScopedTextDelta("agent-a", "msg-a", "a-after-complete");
    expect(harness.getDeferredCount("agent-a")).toBe(1);
    expect(harness.getDeferredCount("agent-b")).toBe(0);

    harness.registerDoneProjection("agent-b", 11);
    harness.handleAgentScopedTextDelta("agent-b", "msg-b", "b-after-complete");
    expect(harness.rendered).toEqual([
      { agentId: "agent-b", messageId: "msg-b", delta: "b-after-complete" },
    ]);

    harness.registerDoneProjection("agent-a", 10);
    expect(harness.getDeferredCount("agent-a")).toBe(0);
    expect(harness.rendered).toEqual([
      { agentId: "agent-b", messageId: "msg-b", delta: "b-after-complete" },
      { agentId: "agent-a", messageId: "msg-a", delta: "a-after-complete" },
    ]);
    expect(harness.timeline).toEqual([
      "done:agent-b",
      "text:agent-b:b-after-complete",
      "done:agent-a",
      "text:agent-a:a-after-complete",
    ]);
    expect(harness.observabilitySamples.every((sample) => sample.scenario === "multi")).toBeTrue();
    expect(harness.observabilitySamples.every((sample) => sample.doneProjected)).toBeTrue();
  });
});
