import { describe, expect, test } from "bun:test";

import {
  createAgentLifecycleLedger,
  formatAgentLifecycleViolation,
  registerAgentLifecycleComplete,
  registerAgentLifecycleStart,
  registerAgentLifecycleUpdate,
} from "./agent-lifecycle-ledger.ts";

describe("agent lifecycle ledger", () => {
  test("allows ordered start update complete transitions", () => {
    const ledger = createAgentLifecycleLedger();

    const started = registerAgentLifecycleStart(ledger, "agent-1");
    const updated = registerAgentLifecycleUpdate(ledger, "agent-1");
    const completed = registerAgentLifecycleComplete(ledger, "agent-1");

    expect(started.ok).toBeTrue();
    expect(updated.ok).toBeTrue();
    expect(completed.ok).toBeTrue();
    expect(ledger.get("agent-1")).toEqual({
      started: true,
      completed: true,
      sequence: 3,
    });
  });

  test("tracks lifecycle entries independently per agent", () => {
    const ledger = createAgentLifecycleLedger();

    registerAgentLifecycleStart(ledger, "agent-1");
    registerAgentLifecycleStart(ledger, "agent-2");
    registerAgentLifecycleUpdate(ledger, "agent-2");
    registerAgentLifecycleComplete(ledger, "agent-2");

    expect(ledger.get("agent-1")).toEqual({
      started: true,
      completed: false,
      sequence: 1,
    });
    expect(ledger.get("agent-2")).toEqual({
      started: true,
      completed: true,
      sequence: 3,
    });
  });

  test("rejects update before start", () => {
    const ledger = createAgentLifecycleLedger();

    const result = registerAgentLifecycleUpdate(ledger, "agent-1");

    expect(result).toEqual({ ok: false, code: "MISSING_START" });
  });

  test("rejects complete before start", () => {
    const ledger = createAgentLifecycleLedger();

    const result = registerAgentLifecycleComplete(ledger, "agent-1");

    expect(result).toEqual({ ok: false, code: "MISSING_START" });
  });

  test("rejects update after complete", () => {
    const ledger = createAgentLifecycleLedger();
    registerAgentLifecycleStart(ledger, "agent-1");
    registerAgentLifecycleComplete(ledger, "agent-1");

    const result = registerAgentLifecycleUpdate(ledger, "agent-1");

    expect(result).toEqual({ ok: false, code: "OUT_OF_ORDER_EVENT" });
  });

  test("rejects duplicate complete transition", () => {
    const ledger = createAgentLifecycleLedger();
    registerAgentLifecycleStart(ledger, "agent-1");
    registerAgentLifecycleComplete(ledger, "agent-1");

    const result = registerAgentLifecycleComplete(ledger, "agent-1");

    expect(result).toEqual({ ok: false, code: "INVALID_TERMINAL_TRANSITION" });
  });

  test("rejects start after terminal completion", () => {
    const ledger = createAgentLifecycleLedger();
    registerAgentLifecycleStart(ledger, "agent-1");
    registerAgentLifecycleComplete(ledger, "agent-1");

    const restarted = registerAgentLifecycleStart(ledger, "agent-1");

    expect(restarted).toEqual({ ok: false, code: "INVALID_TERMINAL_TRANSITION" });
    expect(ledger.get("agent-1")).toEqual({
      started: true,
      completed: true,
      sequence: 2,
    });
  });

  test("formats violation diagnostics with event and agent details", () => {
    const message = formatAgentLifecycleViolation({
      code: "MISSING_START",
      eventType: "stream.agent.start",
      agentId: "agent-1",
    });

    expect(message).toBe(
      '[stream.agent.contract_violation] MISSING_START: received stream.agent.start for agent "agent-1" without a valid lifecycle transition.',
    );
  });
});
