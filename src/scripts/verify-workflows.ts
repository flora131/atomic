/**
 * Workflow Verification
 *
 * Discovery and verification logic for workflows.
 * Used by `atomic workflow verify` CLI command.
 */

import { verifyWorkflow } from "@/services/workflows/verification/verifier.ts";
import { formatVerificationReport } from "@/services/workflows/verification/reporter.ts";
import { encodeGraph } from "@/services/workflows/verification/graph-encoder.ts";
import type { WorkflowDefinition } from "@/services/workflows/types/definition.ts";
import {
  buildAgentLookup,
  validateStageAgents,
} from "@/services/workflows/dsl/agent-resolution.ts";

export interface DiscoveredWorkflow {
  id: string;
  definition: WorkflowDefinition;
  /** Absolute path to the source .ts file (custom workflows only). */
  sourcePath?: string;
}

/**
 * Discover built-in workflows by importing known workflow definition modules.
 */
export async function discoverBuiltinWorkflows(): Promise<DiscoveredWorkflow[]> {
  const workflows: DiscoveredWorkflow[] = [];

  try {
    const ralphMod = await import("@/services/workflows/builtin/ralph/ralph-workflow.ts");
    const ralphExport = ralphMod.getRalphWorkflowDefinition();

    if (ralphExport && typeof ralphExport === "object" && "name" in ralphExport) {
      // CompiledWorkflow spreads WorkflowDefinition properties directly,
      // so it can be used as-is whether branded or legacy.
      const def = ralphExport as WorkflowDefinition;
      workflows.push({ id: def.name, definition: def });
    }
  } catch (error) {
    console.error(
      `Failed to load Ralph workflow: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return workflows;
}

/**
 * Discover custom workflows from .atomic/workflows/ directory.
 * Scans for .ts files and imports them, looking for CompiledWorkflow or
 * WorkflowDefinition exports.
 */
export async function discoverCustomWorkflows(): Promise<DiscoveredWorkflow[]> {
  const workflows: DiscoveredWorkflow[] = [];

  const glob = new Bun.Glob("*.ts");
  const { homedir } = await import("os");
  const { join } = await import("path");
  const { importWorkflowModule, cleanupTempWorkflowFiles } = await import(
    "@/commands/tui/workflow-commands/workflow-files.ts"
  );
  const workflowDirs = [
    ".atomic/workflows",
    join(homedir(), ".atomic", "workflows"),
  ];

  for (const dir of workflowDirs) {
    try {
      for await (const file of glob.scan({ cwd: dir, absolute: true })) {
        try {
          const mod = await importWorkflowModule(file);
          const exported =
            mod.default ?? (Object.values(mod)[0] as Record<string, unknown>);

          if (
            exported &&
            typeof exported === "object" &&
            "name" in exported &&
            typeof (exported as Record<string, unknown>).name === "string"
          ) {
            // CompiledWorkflow spreads definition properties directly
            const def = exported as WorkflowDefinition;
            workflows.push({ id: def.name, definition: def, sourcePath: file });
          }
        } catch {
          // Skip files that cannot be imported as workflow modules
        }
      }
    } catch {
      // Directory does not exist -- skip
    }
  }

  cleanupTempWorkflowFiles();
  return workflows;
}

/**
 * Verify a single discovered workflow and return a formatted report.
 * Returns { report, passed } or throws on error.
 *
 * @param workflow - The discovered workflow to verify
 * @param verifier - Optional verifier function override (for testing)
 */
export async function verifySingleWorkflow(
  workflow: DiscoveredWorkflow,
  verifier: typeof verifyWorkflow = verifyWorkflow,
): Promise<{ report: string; passed: boolean }> {
  const { id, definition } = workflow;
  const graph =
    definition.createConductorGraph?.() ?? definition.createGraph?.();

  if (!graph) {
    return {
      report: `Warning: Workflow "${id}": No graph to verify (skipped)`,
      passed: true,
    };
  }

  // ── Validate graph nodes ─────────────────────────────────────────────
  // 1. Every node must have a name (node.id).
  // 2. No two nodes may share the same name, regardless of type.
  // 3. Agent-type nodes must have `agent` defined (string or null).
  // 4. When `agent` is a non-null string, validate it against discovered agents.
  // 5. When `agent` is null, skip agent-definition validation.
  const agentLookup = buildAgentLookup();
  const nodeErrors: string[] = [];
  const agentNames: string[] = [];
  const seenNodeNames = new Map<string, number>();

  for (const [nodeId, node] of graph.nodes) {
    // Required field: name (node.id) — applies to ALL node types
    if (!nodeId) {
      nodeErrors.push(`A ${node.type ?? "unknown"}-type node is missing required "name" field.`);
    }

    // Track duplicate names across ALL node types
    seenNodeNames.set(nodeId, (seenNodeNames.get(nodeId) ?? 0) + 1);

    // Agent-specific validation
    if (node.type === "agent") {
      // Required field: agent (must be explicitly set, not undefined)
      if (node.agent === undefined) {
        nodeErrors.push(
          `Stage "${nodeId}" is missing required "agent" field. Set to an agent name or null.`,
        );
      } else if (typeof node.agent === "string") {
        // Non-null agent — collect for agent-definition validation
        agentNames.push(node.agent);
      }
      // agent === null is valid — intentionally no agent definition
    }
  }

  // Check for duplicate node names
  for (const [name, count] of seenNodeNames) {
    if (count > 1) {
      nodeErrors.push(
        `Duplicate node name "${name}" found ${count} times. Each node must have a unique name.`,
      );
    }
  }

  // Validate agent names against discovered agent definition files
  const agentWarnings = validateStageAgents(agentNames, agentLookup);

  const nodeErrorText = nodeErrors.length > 0
    ? `\n  Errors:\n${nodeErrors.map((e) => `    ✗ ${e}`).join("\n")}`
    : "";
  const agentWarningText = agentWarnings.length > 0
    ? `\n  Warnings:\n${agentWarnings.map((w) => `    ⚠ ${w}`).join("\n")}`
    : "";

  const encoded = encodeGraph(graph);
  const result = await verifier(graph, {
    encodedGraph: encoded,
    conductorStages: definition.conductorStages,
  });
  const report = formatVerificationReport(id, result) + nodeErrorText + agentWarningText;
  const passed = result.valid && nodeErrors.length === 0;

  return { report, passed };
}

/**
 * Main entry point: discover all workflows, verify each, and output results.
 * Returns true if all pass, false if any fail.
 */
export async function runVerification(): Promise<boolean> {
  console.log("Verifying workflows...\n");

  const builtinWorkflows = await discoverBuiltinWorkflows();
  const customWorkflows = await discoverCustomWorkflows();
  const allWorkflows = [...builtinWorkflows, ...customWorkflows];

  if (allWorkflows.length === 0) {
    console.log("No workflows found to verify.");
    return true;
  }

  let hasFailures = false;

  for (const workflow of allWorkflows) {
    try {
      const { report, passed } = await verifySingleWorkflow(workflow);
      console.log(report);
      console.log("");

      if (!passed) {
        hasFailures = true;
      }
    } catch (error) {
      console.error(
        `FAIL Workflow "${workflow.id}": Verification error: ${error instanceof Error ? error.message : String(error)}`,
      );
      hasFailures = true;
    }
  }

  if (hasFailures) {
    console.log("\nSome workflows failed verification.");
  } else {
    console.log("\nAll workflows passed verification.");
  }

  return !hasFailures;
}

