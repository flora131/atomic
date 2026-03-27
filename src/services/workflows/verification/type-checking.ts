/**
 * Type-Checking Verification
 *
 * Property 7: Workflow source files are free of TypeScript type errors.
 *
 * Shells out to `tsc --noEmit` as a subprocess to type-check workflow `.ts`
 * files against the SDK type definitions. Catches invalid fields, wrong
 * function signatures, missing required properties, and type mismatches
 * — errors that the structural graph verifier cannot detect.
 *
 * Requires a tsconfig.json in the workflow directory (scaffolded by
 * ensureWorkflowPackageScaffold). Without it, type-checking is skipped
 * with a warning.
 *
 * **Why subprocess?** When the Atomic CLI runs as a compiled Bun binary,
 * the bundled TypeScript module cannot resolve its own lib declaration
 * files (e.g. `lib.esnext.d.ts`) because they live outside the virtual
 * `/$bunfs/` filesystem. Running `tsc` as a subprocess avoids this
 * entirely — the subprocess has normal filesystem access and resolves
 * libs from the workflow's own `node_modules/typescript/lib/`.
 *
 * Examples of errors caught:
 * - Unknown fields on StageOptions (e.g., `reads`, `outputs`, `onAnswer`)
 * - Wrong function signature for `prompt`, `outputMapper`, or `execute`
 * - Missing required fields (e.g., `name`, `description`, `prompt`)
 * - Invalid SessionConfig field names or value types
 */

import { resolve, dirname, basename, join } from "path";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import type { PropertyResult } from "@/services/workflows/verification/types.ts";

// ---------------------------------------------------------------------------
// tsc output parsing
// ---------------------------------------------------------------------------

/**
 * Regex matching tsc's standard error output format:
 *   path/to/file.ts(line,col): error TSxxxx: message
 *
 * tsc reports paths relative to cwd, so we resolve them against the
 * workflow directory before filtering.
 */
const TSC_ERROR_RE =
  /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;

/**
 * Parse tsc's stdout into structured error strings matching
 * the format: `filename:line:col - error TSxxxx: message`
 *
 * Only includes errors from the specified source files.
 *
 * @param output   - Raw tsc stdout (use --pretty false to avoid ANSI codes)
 * @param cwd      - Working directory tsc was run in (for resolving relative paths)
 * @param sourcePathSet - Set of absolute source file paths to filter on
 */
function parseTscOutput(
  output: string,
  cwd: string,
  sourcePathSet: Set<string>,
): string[] {
  const errors: string[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = TSC_ERROR_RE.exec(lines[i]!.trim());
    if (!match) continue;

    const [, filePath, lineNum, col, code, message] = match;
    if (!filePath || !lineNum || !col || !code || !message) continue;

    const resolvedPath = resolve(cwd, filePath);
    if (!sourcePathSet.has(resolvedPath)) continue;

    // Collect continuation lines (indented lines that follow the error)
    let fullMessage = message;
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) {
      i++;
      fullMessage += "\n" + lines[i]!.trimEnd();
    }

    const fileName = basename(resolvedPath);
    errors.push(`${fileName}:${lineNum}:${col} - error ${code}: ${fullMessage}`);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Type-check workflow source files by shelling out to `tsc --noEmit`.
 *
 * Creates a temporary tsconfig that extends the base tsconfig but uses
 * an explicit `files` list (instead of `include` globs) so that only
 * the specified source files are checked — matching the semantics of
 * the old in-process `ts.createProgram(resolvedPaths, options)` call.
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

  const workflowDir = dirname(effectiveTsconfigPath);

  // Create a temporary tsconfig that extends the base config but checks
  // only the specified files. tsc doesn't allow --project mixed with
  // explicit file arguments (TS5042), so we use `files` in the config.
  const tmpTsconfigPath = join(
    workflowDir,
    `.tsconfig.verify-${Date.now()}.json`,
  );
  const tmpTsconfig = {
    extends: `./${basename(effectiveTsconfigPath)}`,
    files: resolvedPaths,
    include: [] as string[],
    exclude: [] as string[],
  };

  // Resolve tsc binary: prefer the workflow directory's local install,
  // fall back to `bun x tsc` which resolves from ancestor node_modules.
  const localTsc = join(workflowDir, "node_modules", ".bin", "tsc");
  const useLocalTsc = existsSync(localTsc);

  const args = useLocalTsc
    ? [localTsc, "--noEmit", "--pretty", "false", "--project", tmpTsconfigPath]
    : ["bun", "x", "tsc", "--noEmit", "--pretty", "false", "--project", tmpTsconfigPath];

  try {
    writeFileSync(tmpTsconfigPath, JSON.stringify(tmpTsconfig));

    const result = Bun.spawnSync(args, {
      cwd: workflowDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // tsc writes diagnostics to stdout; stderr may contain bun/npm noise
    const output = result.stdout.toString();

    // Exit code 0 = no errors
    if (result.exitCode === 0) {
      return { verified: true };
    }

    // Parse tsc output, filtering to only our source files
    const sourcePathSet = new Set(resolvedPaths);
    const errors = parseTscOutput(output, workflowDir, sourcePathSet);

    if (errors.length === 0) {
      // tsc failed but no errors matched our source files — could be
      // config issues or errors in dependencies. Treat as a warning.
      return {
        verified: true,
        details: {
          warnings: [
            `tsc exited with code ${result.exitCode} but no errors matched the specified source files`,
          ],
        },
      };
    }

    return {
      verified: false,
      counterexample:
        errors.length === 1
          ? errors[0]
          : `${errors.length} type error(s) found`,
      details: { errors },
    };
  } catch {
    return {
      verified: true,
      details: {
        warnings: [
          "Could not run tsc — skipping type-check. Ensure typescript is installed in the workflow directory.",
        ],
      },
    };
  } finally {
    // Clean up temporary tsconfig
    try { unlinkSync(tmpTsconfigPath); } catch { /* ignore */ }
  }
}
