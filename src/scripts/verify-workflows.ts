#!/usr/bin/env bun
/**
 * Workflow Verification CLI
 *
 * Discovers all workflows (built-in + custom .atomic/workflows/*.ts),
 * runs Z3 verification on each, and outputs full PASS/FAIL diagnostics.
 *
 * Usage: bun run verify:workflows
 * Exit code: 0 if all pass, 1 if any fail
 */

import { verifyWorkflow } from "@/services/workflows/verification/verifier.ts";
import { formatVerificationReport } from "@/services/workflows/verification/reporter.ts";
import { encodeGraph } from "@/services/workflows/verification/graph-encoder.ts";
import type { WorkflowDefinition } from "@/services/workflows/types/definition.ts";
import type { CompiledWorkflow } from "@/services/workflows/dsl/types.ts";

export interface DiscoveredWorkflow {
  id: string;
  definition: WorkflowDefinition;
}

/**
 * Discover built-in workflows by importing known workflow definition modules.
 */
export async function discoverBuiltinWorkflows(): Promise<DiscoveredWorkflow[]> {
  const workflows: DiscoveredWorkflow[] = [];

  try {
    const ralphMod = await import("@/services/workflows/ralph/definition.ts");
    const ralphExport = ralphMod.ralphWorkflowDefinition;

    if (
      ralphExport &&
      typeof ralphExport === "object" &&
      "__compiledWorkflow" in ralphExport
    ) {
      // DSL-compiled workflow: unwrap the branded type
      const inner = (ralphExport as CompiledWorkflow)
        .__compiledWorkflow as unknown as WorkflowDefinition;
      workflows.push({
        id: inner.name ?? "ralph",
        definition: inner,
      });
    } else if (
      ralphExport &&
      typeof ralphExport === "object" &&
      "name" in ralphExport
    ) {
      // Legacy WorkflowDefinition export
      workflows.push({
        id: (ralphExport as WorkflowDefinition).name,
        definition: ralphExport as WorkflowDefinition,
      });
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
  const workflowDirs = [".atomic/workflows"];

  for (const dir of workflowDirs) {
    try {
      for await (const file of glob.scan({ cwd: dir, absolute: true })) {
        try {
          const mod = await import(file);
          const exported =
            mod.default ?? (Object.values(mod)[0] as Record<string, unknown>);

          if (
            exported &&
            typeof exported === "object" &&
            "__compiledWorkflow" in exported
          ) {
            const def = (exported as CompiledWorkflow)
              .__compiledWorkflow as unknown as WorkflowDefinition;
            workflows.push({ id: def.name ?? file, definition: def });
          } else if (
            exported &&
            typeof exported === "object" &&
            "name" in exported &&
            ("createConductorGraph" in exported || "createGraph" in exported)
          ) {
            const def = exported as WorkflowDefinition;
            workflows.push({ id: def.name, definition: def });
          }
        } catch {
          // Skip files that cannot be imported as workflow modules
        }
      }
    } catch {
      // Directory does not exist -- skip
    }
  }

  return workflows;
}

/**
 * Verify a single discovered workflow and return a formatted report.
 * Returns { report, passed } or throws on error.
 */
export async function verifySingleWorkflow(
  workflow: DiscoveredWorkflow,
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

  const encoded = encodeGraph(graph);
  const result = await verifyWorkflow(graph, { encodedGraph: encoded });
  const report = formatVerificationReport(id, result);

  return { report, passed: result.valid };
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

// CLI entry point: run verification and set exit code
if (import.meta.main) {
  runVerification()
    .then((allPassed) => {
      process.exit(allPassed ? 0 : 1);
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}
