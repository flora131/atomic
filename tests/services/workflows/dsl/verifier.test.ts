/**
 * Tests for the Workflow Verifier orchestrator.
 *
 * Uses dependency injection (PropertyCheckers) to test the orchestration
 * logic in isolation without mock.module, avoiding mock contamination
 * of sibling test files.
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { EncodedGraph, PropertyResult, VerificationResult } from "@/services/workflows/verification/types";
import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types";
import { verifyWorkflow } from "@/services/workflows/verification/verifier";
import type { PropertyCheckers } from "@/services/workflows/verification/verifier";

const PASS: PropertyResult = { verified: true };
const FAIL_R: PropertyResult = { verified: false, counterexample: 'Node(s) "orphan" unreachable', details: { unreachableNodes: ["orphan"] } };
const FAIL_T: PropertyResult = { verified: false, counterexample: "Not all paths reach an end node", details: { deadEndNodes: [] } };
const FAIL_D: PropertyResult = { verified: false, counterexample: 'Node(s) "stuck" may deadlock', details: { deadlockedNodes: ["stuck"] } };
const FAIL_L: PropertyResult = { verified: false, counterexample: 'Unbounded loops detected', details: { unboundedLoops: [{ entryNode: "x", maxIterations: 10 }] } };
const FAIL_S: PropertyResult = { verified: false, counterexample: 'node "reader" reads "data" not written', details: { violations: [{ nodeId: "reader", field: "data" }] } };

function makeDummyGraph(): CompiledGraph<BaseState> {
  return { nodes: new Map([["start", { id: "start", type: "agent" as const, execute: async () => ({}) }], ["end", { id: "end", type: "agent" as const, execute: async () => ({}) }]]), edges: [{ from: "start", to: "end" }], startNode: "start", endNodes: new Set(["end"]), config: {} } as unknown as CompiledGraph<BaseState>;
}

function makeEncodedGraph(o?: Partial<EncodedGraph>): EncodedGraph {
  return { nodes: [{ id: "start", type: "agent" }, { id: "end", type: "agent" }], edges: [{ from: "start", to: "end", hasCondition: false }], startNode: "start", endNodes: ["end"], loops: [], stateFields: [], ...o };
}

type MC = ReturnType<typeof mock<(g: EncodedGraph) => Promise<PropertyResult>>>;

function createMockCheckers(): PropertyCheckers & { mocks: { r: MC; t: MC; d: MC; l: MC; s: MC } } {
  const r = mock<(g: EncodedGraph) => Promise<PropertyResult>>(async () => PASS);
  const t = mock<(g: EncodedGraph) => Promise<PropertyResult>>(async () => PASS);
  const d = mock<(g: EncodedGraph) => Promise<PropertyResult>>(async () => PASS);
  const l = mock<(g: EncodedGraph) => Promise<PropertyResult>>(async () => PASS);
  const s = mock<(g: EncodedGraph) => Promise<PropertyResult>>(async () => PASS);
  return { checkReachability: r, checkTermination: t, checkDeadlockFreedom: d, checkLoopBounds: l, checkStateDataFlow: s, checkModelValidation: async () => PASS, mocks: { r, t, d, l, s } };
}

describe("verifyWorkflow", () => {
  let mc: ReturnType<typeof createMockCheckers>;
  beforeEach(() => { mc = createMockCheckers(); });

  test("all pass => valid=true", async () => {
    const result = await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    expect(result.valid).toBe(true);
    expect(result.properties.reachability.verified).toBe(true);
    expect(result.properties.termination.verified).toBe(true);
    expect(result.properties.deadlockFreedom.verified).toBe(true);
    expect(result.properties.loopBounds.verified).toBe(true);
    expect(result.properties.stateDataFlow.verified).toBe(true);
  });

  test("reachability fail => valid=false", async () => {
    mc.mocks.r.mockImplementation(async () => FAIL_R);
    const result = await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    expect(result.valid).toBe(false);
    expect(result.properties.reachability.verified).toBe(false);
    expect(result.properties.termination.verified).toBe(true);
  });

  test("termination fail => valid=false", async () => {
    mc.mocks.t.mockImplementation(async () => FAIL_T);
    const result = await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    expect(result.valid).toBe(false);
    expect(result.properties.termination.verified).toBe(false);
  });

  test("deadlock fail => valid=false", async () => {
    mc.mocks.d.mockImplementation(async () => FAIL_D);
    const result = await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    expect(result.valid).toBe(false);
    expect(result.properties.deadlockFreedom.verified).toBe(false);
  });

  test("loop-bounds fail => valid=false", async () => {
    mc.mocks.l.mockImplementation(async () => FAIL_L);
    const result = await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    expect(result.valid).toBe(false);
    expect(result.properties.loopBounds.verified).toBe(false);
  });

  test("data-flow fail => valid=false", async () => {
    mc.mocks.s.mockImplementation(async () => FAIL_S);
    const result = await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    expect(result.valid).toBe(false);
    expect(result.properties.stateDataFlow.verified).toBe(false);
  });

  test("multiple fails => valid=false, passing ones still true", async () => {
    mc.mocks.r.mockImplementation(async () => FAIL_R);
    mc.mocks.t.mockImplementation(async () => FAIL_T);
    mc.mocks.d.mockImplementation(async () => FAIL_D);
    const result = await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    expect(result.valid).toBe(false);
    expect(result.properties.reachability.verified).toBe(false);
    expect(result.properties.termination.verified).toBe(false);
    expect(result.properties.deadlockFreedom.verified).toBe(false);
    expect(result.properties.loopBounds.verified).toBe(true);
    expect(result.properties.stateDataFlow.verified).toBe(true);
  });

  test("all fail => all properties false", async () => {
    mc.mocks.r.mockImplementation(async () => FAIL_R);
    mc.mocks.t.mockImplementation(async () => FAIL_T);
    mc.mocks.d.mockImplementation(async () => FAIL_D);
    mc.mocks.l.mockImplementation(async () => FAIL_L);
    mc.mocks.s.mockImplementation(async () => FAIL_S);
    const result = await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    expect(result.valid).toBe(false);
    expect(result.properties.reachability.verified).toBe(false);
    expect(result.properties.termination.verified).toBe(false);
    expect(result.properties.deadlockFreedom.verified).toBe(false);
    expect(result.properties.loopBounds.verified).toBe(false);
    expect(result.properties.stateDataFlow.verified).toBe(false);
  });

  test("passes encoded graph to all checkers", async () => {
    const g = makeEncodedGraph({ startNode: "x" });
    await verifyWorkflow(makeDummyGraph(), { encodedGraph: g, checkers: mc });
    expect(mc.mocks.r).toHaveBeenCalledWith(g);
    expect(mc.mocks.t).toHaveBeenCalledWith(g);
    expect(mc.mocks.d).toHaveBeenCalledWith(g);
    expect(mc.mocks.l).toHaveBeenCalledWith(g);
    expect(mc.mocks.s).toHaveBeenCalledWith(g);
  });

  test("each checker called exactly once", async () => {
    await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    for (const m of Object.values(mc.mocks)) expect(m).toHaveBeenCalledTimes(1);
  });

  test("preserves counterexample and details", async () => {
    mc.mocks.r.mockImplementation(async () => FAIL_R);
    const result = await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    expect(result.properties.reachability.counterexample).toBe(FAIL_R.counterexample);
    expect(result.properties.reachability.details).toEqual(FAIL_R.details);
  });

  test("result shape", async () => {
    const result: VerificationResult = await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    expect(result).toHaveProperty("valid");
    for (const k of ["reachability", "termination", "deadlockFreedom", "loopBounds", "stateDataFlow"]) {
      expect(result.properties).toHaveProperty(k);
    }
  });

  test("parallel execution", async () => {
    const order: string[] = [];
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    mc.mocks.r.mockImplementation(async () => { order.push("rs"); await delay(10); order.push("re"); return PASS; });
    mc.mocks.t.mockImplementation(async () => { order.push("ts"); await delay(10); order.push("te"); return PASS; });
    mc.mocks.d.mockImplementation(async () => { order.push("ds"); await delay(10); order.push("de"); return PASS; });
    mc.mocks.l.mockImplementation(async () => { order.push("ls"); await delay(10); order.push("le"); return PASS; });
    mc.mocks.s.mockImplementation(async () => { order.push("ss"); await delay(10); order.push("se"); return PASS; });
    await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    const starts = order.filter((e) => e.endsWith("s")).map((e) => order.indexOf(e));
    const ends = order.filter((e) => e.endsWith("e")).map((e) => order.indexOf(e));
    expect(Math.max(...starts)).toBeLessThan(Math.min(...ends));
  });

  test("pass with details preserved", async () => {
    const pw: PropertyResult = { verified: true, details: { info: "ok" } };
    mc.mocks.r.mockImplementation(async () => pw);
    const result = await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: mc });
    expect(result.valid).toBe(true);
    expect(result.properties.reachability.details).toEqual({ info: "ok" });
  });

  test("partial checker overrides", async () => {
    const custom = mock<(g: EncodedGraph) => Promise<PropertyResult>>(async () => FAIL_R);
    const result = await verifyWorkflow(makeDummyGraph(), { encodedGraph: makeEncodedGraph(), checkers: { ...mc, checkReachability: custom } });
    expect(result.valid).toBe(false);
    expect(custom).toHaveBeenCalledTimes(1);
  });
});
