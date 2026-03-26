/**
 * Workflow CLI Commands
 *
 * Handlers for `atomic workflow verify [path]`.
 */

import { resolve, dirname, join } from "path";
import { existsSync } from "fs";
import { COLORS } from "@/theme/colors.ts";
import {
  importWorkflowModule,
  cleanupTempWorkflowFiles,
} from "@/commands/tui/workflow-commands/workflow-files.ts";

/**
 * Run TypeScript type checking on a workflow file.
 *
 * Looks for a tsconfig.json in the workflow file's directory
 * (e.g. `.atomic/workflows/tsconfig.json`) and runs `bunx tsc --noEmit`.
 * Returns diagnostic output on failure, or null on success/skip.
 */
async function typecheckWorkflowFile(filePath: string): Promise<string | null> {
  const dir = dirname(filePath);
  const tsconfigPath = join(dir, "tsconfig.json");

  if (!existsSync(tsconfigPath)) {
    return null; // No tsconfig — skip type checking
  }

  const result = Bun.spawnSync(["bunx", "tsc", "--noEmit", "--project", tsconfigPath], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    const stdout = result.stdout.toString().trim();
    return stderr || stdout || "TypeScript type checking failed";
  }

  return null;
}

/**
 * Entry point for `atomic workflow verify [path]`.
 *
 * - No path: verify all discoverable workflows (built-in + custom)
 * - With path: verify a single workflow .ts file
 */
export async function workflowVerifyCommand(path?: string): Promise<void> {
  if (path) {
    await verifySingleFile(path);
  } else {
    await verifyAll();
  }
}

async function verifyAll(): Promise<void> {
  const { runVerification } = await import("@/scripts/verify-workflows.ts");
  const allPassed = await runVerification();
  process.exit(allPassed ? 0 : 1);
}

async function verifySingleFile(filePath: string): Promise<void> {
  const resolved = resolve(filePath);

  const file = Bun.file(resolved);
  if (!(await file.exists())) {
    console.error(`${COLORS.red}Error: File not found: ${resolved}${COLORS.reset}`);
    process.exit(1);
  }

  // Phase 1: TypeScript type checking (if tsconfig.json present)
  const typecheckError = await typecheckWorkflowFile(resolved);
  if (typecheckError) {
    console.error(`${COLORS.red}TypeScript type errors:${COLORS.reset}\n${typecheckError}`);
    process.exit(1);
  }

  let mod: Record<string, unknown>;
  try {
    mod = await importWorkflowModule(resolved);
  } catch (error) {
    cleanupTempWorkflowFiles();
    console.error(
      `${COLORS.red}Error: Failed to import ${resolved}: ${error instanceof Error ? error.message : String(error)}${COLORS.reset}`,
    );
    process.exit(1);
  }

  const { extractWorkflowDefinition } = await import(
    "@/commands/tui/workflow-commands/workflow-files.ts"
  );

  let definition = extractWorkflowDefinition(mod);

  if (!definition) {
    // Fall back: check for any named export that looks like a definition
    const candidate = mod.default ?? Object.values(mod).find(
      (v) => v && typeof v === "object" && "name" in v,
    );
    if (candidate && typeof candidate === "object" && "name" in candidate) {
      definition = candidate as unknown as NonNullable<typeof definition>;
    }
  }

  if (!definition) {
    console.error(
      `${COLORS.red}Error: No workflow definition found in ${filePath}${COLORS.reset}`,
    );
    console.error(
      "The file must export a defineWorkflow().compile() result or a WorkflowDefinition.",
    );
    process.exit(1);
  }

  const { verifySingleWorkflow } = await import("@/scripts/verify-workflows.ts");

  try {
    const { report, passed } = await verifySingleWorkflow({
      id: definition.name ?? filePath,
      definition,
    });
    cleanupTempWorkflowFiles();
    console.log(report);

    if (!passed) {
      console.log(`\n${COLORS.red}Verification failed.${COLORS.reset}`);
      process.exit(1);
    } else {
      console.log(`\n${COLORS.green}Verification passed.${COLORS.reset}`);
    }
  } catch (error) {
    cleanupTempWorkflowFiles();
    console.error(
      `${COLORS.red}Verification error: ${error instanceof Error ? error.message : String(error)}${COLORS.reset}`,
    );
    process.exit(1);
  }
}
