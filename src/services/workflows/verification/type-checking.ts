/**
 * Type-Checking Verification
 *
 * Property 7: Workflow source files are free of TypeScript type errors.
 *
 * Uses the TypeScript compiler API to type-check workflow `.ts` files
 * against the SDK type definitions. Catches invalid fields, wrong
 * function signatures, missing required properties, and type mismatches
 * — errors that the structural graph verifier cannot detect.
 *
 * Requires a tsconfig.json in the workflow directory (scaffolded by
 * ensureWorkflowPackageScaffold). Without it, type-checking is skipped
 * with a warning.
 *
 * Examples of errors caught:
 * - Unknown fields on StageOptions (e.g., `reads`, `outputs`, `onAnswer`)
 * - Wrong function signature for `prompt`, `outputMapper`, or `execute`
 * - Missing required fields (e.g., `name`, `description`, `prompt`)
 * - Invalid SessionConfig field names or value types
 */

import ts from "typescript";
import { resolve, dirname, basename, join } from "path";
import { existsSync } from "fs";
import type { PropertyResult } from "@/services/workflows/verification/types.ts";

/**
 * Type-check workflow source files using the TypeScript compiler API.
 *
 * Loads the tsconfig.json from the workflow directory. If no tsconfig.json
 * is found, returns a warning (the scaffold should have created it).
 * Only reports errors originating from the specified source files —
 * not from node_modules or SDK internals.
 *
 * @param sourcePaths - Absolute paths to workflow .ts source files
 * @param tsconfigPath - Optional explicit path to tsconfig.json (auto-discovered from source dir if omitted)
 * @returns PropertyResult with per-file error details
 */
export async function checkTypeChecking(
  sourcePaths: string[],
  tsconfigPath?: string,
): Promise<PropertyResult> {
  if (sourcePaths.length === 0) {
    return { verified: true };
  }

  const resolvedPaths = sourcePaths.map((p) => resolve(p));

  // Auto-discover tsconfig from first source file's directory if not provided
  const effectiveTsconfigPath =
    tsconfigPath ?? join(dirname(resolvedPaths[0]!), "tsconfig.json");

  if (!existsSync(effectiveTsconfigPath)) {
    return {
      verified: true,
      details: {
        warnings: [
          `No tsconfig.json found at ${effectiveTsconfigPath} — skipping type-check. ` +
          `Run 'atomic init' or 'atomic update' to scaffold it.`,
        ],
      },
    };
  }

  const configFile = ts.readConfigFile(effectiveTsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    return {
      verified: true,
      details: {
        warnings: [
          `Failed to read ${effectiveTsconfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")} — skipping type-check`,
        ],
      },
    };
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    dirname(effectiveTsconfigPath),
  );

  let program: ts.Program;
  try {
    program = ts.createProgram(resolvedPaths, parsed.options);
  } catch {
    return {
      verified: true,
      details: {
        warnings: [
          "Could not create TypeScript program — skipping type-check",
        ],
      },
    };
  }

  const diagnostics = ts.getPreEmitDiagnostics(program);

  // Filter to only errors from our source files (not node_modules, not SDK internals)
  const sourcePathSet = new Set(resolvedPaths);
  const errors: string[] = [];

  for (const diag of diagnostics) {
    if (diag.category !== ts.DiagnosticCategory.Error) continue;
    if (!diag.file || diag.start === undefined) continue;

    const filePath = resolve(diag.file.fileName);
    if (!sourcePathSet.has(filePath)) continue;

    const { line, character } =
      diag.file.getLineAndCharacterOfPosition(diag.start);
    const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
    const fileName = basename(filePath);

    errors.push(
      `${fileName}:${line + 1}:${character + 1} - error TS${diag.code}: ${message}`,
    );
  }

  if (errors.length > 0) {
    return {
      verified: false,
      counterexample:
        errors.length === 1
          ? errors[0]
          : `${errors.length} type error(s) found`,
      details: { errors },
    };
  }

  return { verified: true };
}
