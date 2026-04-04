/**
 * Tests for the verify-workflows script.
 *
 * Tests the discovery, verification, and reporting functions exported
 * from the script module.
 *
 * Uses the verifier DI parameter on verifySingleWorkflow instead of
 * mock.module to avoid global module contamination.
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import type { WorkflowDefinition } from "@/services/workflows/types/definition.ts";
import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types.ts";
import type { VerificationResult, PropertyResult, EncodedGraph } from "@/services/workflows/verification/types.ts";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  discoverBuiltinWorkflows,
  discoverCustomWorkflows,
  verifySingleWorkflow,
} from "@/scripts/verify-workflows.ts";
import type { DiscoveredWorkflow } from "@/scripts/verify-workflows.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PASS: PropertyResult = { verified: true };

function makeAllPassResult(): VerificationResult {
  return {
    valid: true,
    properties: {
      reachability: PASS,
      termination: PASS,
      deadlockFreedom: PASS,
      loopBounds: PASS,
      stateDataFlow: PASS,
    },
  };
}

const mockVerifyWorkflow = mock(async () => makeAllPassResult());

/** Create a minimal CompiledGraph for testing. */
function makeMinimalGraph(): CompiledGraph<BaseState> {
  const nodes = new Map<
    string,
    { type: string; agent: string | null; execute: () => Promise<Record<string, unknown>> }
  >();
  nodes.set("start", { type: "agent", agent: null, execute: async () => ({}) });
  nodes.set("end", { type: "agent", agent: null, execute: async () => ({}) });

  return {
    nodes: nodes as unknown as CompiledGraph<BaseState>["nodes"],
    edges: [{ from: "start", to: "end" }],
    startNode: "start",
    endNodes: new Set(["end"]),
  } as CompiledGraph<BaseState>;
}

/** Create a workflow definition with a graph factory. */
function makeWorkflowDefinition(
  name: string,
  opts?: { withConductorGraph?: boolean },
): WorkflowDefinition {
  const def: WorkflowDefinition = {
    name,
    description: `Test workflow: ${name}`,
  };

  if (opts?.withConductorGraph) {
    def.createConductorGraph = () => makeMinimalGraph();
  }

  return def;
}

// ---------------------------------------------------------------------------
// discoverBuiltinWorkflows
// ---------------------------------------------------------------------------

describe("discoverBuiltinWorkflows", () => {
  test("returns an array", async () => {
    const result = await discoverBuiltinWorkflows();
    expect(Array.isArray(result)).toBe(true);
  });

  test("handles Ralph import failure gracefully", async () => {
    // discoverBuiltinWorkflows should never throw, even if Ralph
    // module has missing dependencies (e.g., state.ts deleted)
    const result = await discoverBuiltinWorkflows();
    expect(Array.isArray(result)).toBe(true);
    // Result may or may not contain Ralph depending on module availability
  });

  test("discovered Ralph workflow (when available) has correct structure", async () => {
    const result = await discoverBuiltinWorkflows();
    const ralph = result.find((w) => w.id === "ralph");
    if (ralph) {
      // If Ralph loads successfully, validate its structure
      expect(ralph.definition.name).toBe("ralph");
      expect(typeof ralph.definition.description).toBe("string");
      expect(ralph.definition.createConductorGraph).toBeDefined();
    }
    // If Ralph is not found, that's acceptable -- the import error
    // is caught and logged by discoverBuiltinWorkflows
  });
});

// ---------------------------------------------------------------------------
// discoverCustomWorkflows
// ---------------------------------------------------------------------------

describe("discoverCustomWorkflows", () => {
  test("returns an array (possibly empty when no .atomic/workflows/ exists)", async () => {
    const result = await discoverCustomWorkflows();
    expect(Array.isArray(result)).toBe(true);
  });

  test("returns only valid workflow definitions", async () => {
    const result = await discoverCustomWorkflows();
    for (const wf of result) {
      expect(typeof wf.id).toBe("string");
      expect(wf.definition).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// discoverCustomWorkflows — helper / non-compiled file handling
// ---------------------------------------------------------------------------

describe("discoverCustomWorkflows with workflow directories", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wf-discover-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * discoverCustomWorkflows() currently scans $HOME/.atomic/workflows and
   * .atomic/workflows. To keep tests hermetic we write real TypeScript files
   * into a temp dir and exercise the underlying branded-extraction path via
   * a thin integration check: files without __compiledWorkflow brand must not
   * produce warnings and must not be included in the discovered list.
   *
   * Because we cannot easily redirect the hard-coded search paths in
   * discoverCustomWorkflows, these tests validate the extraction contract
   * (the same logic the function uses) rather than invoking it with the
   * temp dir injected.
   */

  test("extractWorkflowDefinition returns null for helper module (no brand) — discovery silently skips it", async () => {
    // Write a helper module to disk
    const helperFile = join(tempDir, "shared-helpers.ts");
    await writeFile(
      helperFile,
      `export function helper() { return 42; }
       export const name = "shared-helpers";`,
    );

    // Import and check via extractWorkflowDefinition — the same path
    // used inside discoverCustomWorkflows
    const { extractWorkflowDefinition } = await import(
      "@/commands/tui/workflow-commands/workflow-files.ts"
    );
    const mod = await import(helperFile);
    const result = extractWorkflowDefinition(mod);
    // No brand → must be null, meaning the file is silently skipped
    expect(result).toBeNull();
  });

  test("extractWorkflowDefinition returns null for plain-name object (no brand) — discovery silently skips it", async () => {
    const helperFile = join(tempDir, "config.ts");
    await writeFile(
      helperFile,
      `export default { name: "my-config", description: "Not a workflow" };`,
    );

    const { extractWorkflowDefinition } = await import(
      "@/commands/tui/workflow-commands/workflow-files.ts"
    );
    const mod = await import(helperFile);
    const result = extractWorkflowDefinition(mod);
    expect(result).toBeNull();
  });

  test("extractWorkflowDefinition succeeds for a compiled workflow — discovery includes it", async () => {
    const workflowFile = join(tempDir, "real-workflow.ts");
    await writeFile(
      workflowFile,
      `export const wf = {
        name: "real-workflow",
        description: "A real compiled workflow",
        __compiledWorkflow: true,
      };`,
    );

    const { extractWorkflowDefinition } = await import(
      "@/commands/tui/workflow-commands/workflow-files.ts"
    );
    const mod = await import(workflowFile);
    const result = extractWorkflowDefinition(mod);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("real-workflow");
  });
});

// ---------------------------------------------------------------------------
// verifySingleWorkflow
// ---------------------------------------------------------------------------

describe("verifySingleWorkflow", () => {
  beforeEach(() => {
    mockVerifyWorkflow.mockClear();
    mockVerifyWorkflow.mockImplementation(async () => makeAllPassResult());
  });

  test("returns passed=true and warning for workflow without a graph", async () => {
    const workflow: DiscoveredWorkflow = {
      id: "no-graph",
      definition: makeWorkflowDefinition("no-graph"),
    };

    const result = await verifySingleWorkflow(workflow, mockVerifyWorkflow);
    expect(result.passed).toBe(true);
    expect(result.report).toContain("Warning");
    expect(result.report).toContain("no-graph");
    expect(result.report).toContain("No graph to verify");
    // Should NOT call verifyWorkflow when there's no graph
    expect(mockVerifyWorkflow).not.toHaveBeenCalled();
  });

  test("returns a verification report for workflow with createConductorGraph", async () => {
    const workflow: DiscoveredWorkflow = {
      id: "conductor-wf",
      definition: makeWorkflowDefinition("conductor-wf", {
        withConductorGraph: true,
      }),
    };

    const result = await verifySingleWorkflow(workflow, mockVerifyWorkflow);
    expect(result.passed).toBe(true);
    expect(result.report).toContain("conductor-wf");
    expect(mockVerifyWorkflow).toHaveBeenCalledTimes(1);
  });

  test("returns passed=false when verification fails", async () => {
    mockVerifyWorkflow.mockImplementation(async () => ({
      valid: false,
      properties: {
        reachability: { verified: false, counterexample: 'Node "orphan" unreachable' },
        termination: PASS,
        deadlockFreedom: PASS,
        loopBounds: PASS,
        stateDataFlow: PASS,
      },
    }));

    const workflow: DiscoveredWorkflow = {
      id: "failing-wf",
      definition: makeWorkflowDefinition("failing-wf", { withConductorGraph: true }),
    };

    const result = await verifySingleWorkflow(workflow, mockVerifyWorkflow);
    expect(result.passed).toBe(false);
    expect(result.report).toContain("FAIL");
    expect(result.report).toContain("failing-wf");
  });

  test("report contains PASS for all properties when verification passes", async () => {
    const workflow: DiscoveredWorkflow = {
      id: "check-output",
      definition: makeWorkflowDefinition("check-output", { withConductorGraph: true }),
    };

    const result = await verifySingleWorkflow(workflow, mockVerifyWorkflow);
    expect(result.report).toContain("PASS  Reachability");
    expect(result.report).toContain("PASS  Termination");
    expect(result.report).toContain("PASS  Deadlock-Freedom");
    expect(result.report).toContain("PASS  Loop Bounds");
    expect(result.report).toContain("PASS  State Data-Flow");
  });

  test("passes encoded graph to verifyWorkflow", async () => {
    const workflow: DiscoveredWorkflow = {
      id: "encoding-test",
      definition: makeWorkflowDefinition("encoding-test", { withConductorGraph: true }),
    };

    await verifySingleWorkflow(workflow, mockVerifyWorkflow);

    expect(mockVerifyWorkflow).toHaveBeenCalledTimes(1);
    const calls = mockVerifyWorkflow.mock.calls as unknown[][];
    const callArgs = calls[0]!;
    // First arg is the graph
    expect(callArgs[0]).toBeDefined();
    // Second arg is { encodedGraph: ... }
    const options = callArgs[1] as unknown as { encodedGraph?: EncodedGraph };
    expect(options).toBeDefined();
    expect(options.encodedGraph).toBeDefined();
    expect(options.encodedGraph?.startNode).toBe("start");
    expect(options.encodedGraph?.endNodes).toContain("end");
  });
});

// ---------------------------------------------------------------------------
// package.json: verify:workflows script was removed (now `atomic workflow verify`)
// ---------------------------------------------------------------------------
