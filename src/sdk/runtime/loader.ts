/**
 * Workflow Loader — multi-stage pipeline for resolving and loading workflows.
 *
 * Pipeline: Discover → Resolve → Validate → Load
 *
 * Each stage returns a typed discriminated result so callers get structured
 * error information without try/catch guesswork.
 *
 * Discovery (finding workflow files on disk) remains in `discovery.ts`.
 * This module handles everything after a workflow is discovered.
 */

import { join, dirname } from "path";
import { existsSync } from "fs";
import type { WorkflowDefinition, AgentType } from "../types.ts";
import type { DiscoveredWorkflow } from "./discovery.ts";
import { validateCopilotWorkflow } from "../providers/copilot.ts";
import { validateOpenCodeWorkflow } from "../providers/opencode.ts";
import { validateClaudeWorkflow } from "../providers/claude.ts";

// ---------------------------------------------------------------------------
// SDK module resolver
// ---------------------------------------------------------------------------

// Absolute path to the currently-running atomic CLI's own SDK source tree
// (i.e. `<install_root>/src/sdk`). Computed from this file's URL so it always
// points at the actual installed atomic, regardless of how it was launched
// (dev checkout, global `bun install -g @bastani/atomic`, `bunx atomic`, etc).
const ATOMIC_SDK_DIR = Bun.fileURLToPath(new URL("..", import.meta.url));

// Directory of this loader file. Used as the parent for `Bun.resolveSync`
// when delegating non-`atomic/*` bare specifiers, so workflows resolve them
// against atomic's own `node_modules` tree.
const LOADER_DIR = Bun.fileURLToPath(new URL(".", import.meta.url));

// Common TypeScript/JavaScript extensions tried for `atomic/<subpath>`
// imports when the specifier doesn't already include one.
const ATOMIC_SUBPATH_EXTS = [".ts", ".tsx", ".js", ".jsx"];

// Workflow roots for which a Bun.plugin onLoad hook has already been
// registered. Deduped so repeated `load()` calls don't stack plugins.
const registeredRoots = new Set<string>();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve `atomic/<subpath>` (or bare `atomic`) to an absolute file path in
 * the running CLI's `src/sdk/` tree. Returns `null` if no matching file
 * exists so the caller can fall back to the original specifier.
 */
function resolveAtomicSubpath(subpath: string): string | null {
  const direct = join(ATOMIC_SDK_DIR, subpath);
  if (existsSync(direct)) return direct;
  for (const ext of ATOMIC_SUBPATH_EXTS) {
    const candidate = join(ATOMIC_SDK_DIR, subpath + ext);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve a bare import specifier to an absolute file path. `atomic/<x>`
 * maps onto the SDK source tree; everything else delegates to atomic's own
 * module resolution context (so `@github/copilot-sdk`, `zod`, etc. resolve
 * from atomic's installed `node_modules`).
 */
const ATOMIC_PKG = "@bastani/atomic";
const ATOMIC_PKG_PREFIX = `${ATOMIC_PKG}/`;

function resolveBareSpecifier(spec: string): string | null {
  if (spec === ATOMIC_PKG) return resolveAtomicSubpath("index");
  if (spec.startsWith(ATOMIC_PKG_PREFIX)) {
    return resolveAtomicSubpath(spec.slice(ATOMIC_PKG_PREFIX.length));
  }
  try {
    return Bun.resolveSync(spec, LOADER_DIR);
  } catch {
    return null;
  }
}

/**
 * Rewrite bare `import`/`from` specifiers in workflow source to absolute
 * file paths resolved from atomic's own context. Relative and absolute
 * paths are left untouched. Unresolvable specifiers are also left alone so
 * Bun produces its standard "module not found" error instead of a silent
 * miss.
 */
function rewriteBareImports(source: string): string {
  // Matches:  from "spec"  |  from 'spec'  |  import "spec"  |  import 'spec'
  // The backreference (\2) ensures matched quotes are balanced.
  const importRe = /(\bfrom\s*|\bimport\s*)(["'])([^"']+)\2/g;
  return source.replace(importRe, (match, kw: string, quote: string, spec: string) => {
    if (spec.startsWith(".") || spec.startsWith("/")) return match;
    const resolved = resolveBareSpecifier(spec);
    return resolved ? `${kw}${quote}${resolved}${quote}` : match;
  });
}

/**
 * Register a Bun `onLoad` plugin that rewrites bare imports inside any TS
 * file under the given workflow root. This lets workflow authors write
 * `import { defineWorkflow } from "@bastani/atomic/workflows"` (and import
 * atomic's transitive deps like `@github/copilot-sdk`) without maintaining
 * their own `package.json` / `node_modules`.
 *
 * Why source rewriting via `onLoad` instead of `onResolve`?
 * Bun's runtime plugin API honors `onLoad` but silently ignores `onResolve`
 * hooks for dynamic `await import()` calls — `onResolve` only fires during
 * `Bun.build`. Source rewriting is the only mechanism that actually changes
 * how the runtime loader resolves imports inside workflow files today.
 *
 * Each distinct workflow root installs its own plugin (deduped via
 * `registeredRoots`). The plugin's filter is a path-prefix regex so we
 * don't incur the cost of reading every `.ts` file in the process — only
 * files under active workflow roots are intercepted.
 */
function installAtomicLoader(workflowRoot: string): void {
  if (registeredRoots.has(workflowRoot)) return;
  registeredRoots.add(workflowRoot);

  // Match `<workflowRoot>/<...>/*.ts(x)`. Uses a character class for the
  // separator so the same filter works on both POSIX and Windows paths.
  const filter = new RegExp(
    "^" + escapeRegex(workflowRoot) + "[/\\\\].*\\.tsx?$",
  );

  Bun.plugin({
    name: `atomic-sdk-rewriter:${workflowRoot}`,
    setup(build) {
      build.onLoad({ filter }, async (args) => {
        const source = await Bun.file(args.path).text();
        const contents = rewriteBareImports(source);
        const loader = args.path.endsWith("x") ? "tsx" : "ts";
        return { contents, loader };
      });
    },
  });
}

export namespace WorkflowLoader {
  // ---------------------------------------------------------------------------
  // Result types
  // ---------------------------------------------------------------------------

  /** Successful pipeline result. */
  export type Ok<T> = { ok: true; value: T };

  /** Failed pipeline result with stage and error context. */
  export type StageError<S extends string> = {
    ok: false;
    stage: S;
    error: unknown;
    message: string;
  };

  export type StageResult<T, S extends string> = Ok<T> | StageError<S>;

  // ---------------------------------------------------------------------------
  // Stage data types
  // ---------------------------------------------------------------------------

  /** Input to the pipeline — a discovered workflow from disk. */
  export type Plan = DiscoveredWorkflow;

  /** Output of the resolve stage. */
  export type Resolved = Plan;

  /** A source validation warning (agent-specific). */
  export interface ValidationWarning {
    rule: string;
    message: string;
  }

  /** Output of the validate stage. */
  export type Validated = Resolved & {
    warnings: ValidationWarning[];
  };

  /** Output of the load stage — the final result. */
  export type Loaded = Validated & {
    definition: WorkflowDefinition;
  };

  // ---------------------------------------------------------------------------
  // Report callbacks — callers provide these for logging/UI
  // ---------------------------------------------------------------------------

  export interface Report {
    /** Called when a stage begins. */
    start?: (stage: "resolve" | "validate" | "load") => void;
    /** Called when source validation produces warnings. */
    warn?: (warnings: ValidationWarning[]) => void;
    /** Called when a stage fails. */
    error?: (stage: "resolve" | "validate" | "load", error: unknown, message: string) => void;
  }

  // ---------------------------------------------------------------------------
  // Stage 1: Resolve
  // ---------------------------------------------------------------------------

  /** Verify the workflow file exists. */
  export async function resolve(
    plan: Plan,
  ): Promise<StageResult<Resolved, "resolve">> {
    try {
      const file = Bun.file(plan.path);
      if (!(await file.exists())) {
        return {
          ok: false,
          stage: "resolve",
          error: new Error(`Workflow file not found: ${plan.path}`),
          message: `Workflow file not found: ${plan.path}`,
        };
      }
      return { ok: true, value: plan };
    } catch (error) {
      return {
        ok: false,
        stage: "resolve",
        error,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Stage 2: Validate
  // ---------------------------------------------------------------------------

  /** Run agent-specific source validation. */
  function validateSource(source: string, agent: AgentType): ValidationWarning[] {
    switch (agent) {
      case "copilot":
        return validateCopilotWorkflow(source);
      case "opencode":
        return validateOpenCodeWorkflow(source);
      case "claude":
        return validateClaudeWorkflow(source);
      default:
        return [];
    }
  }

  /**
   * Read the workflow source and run agent-specific validation checks.
   * Validation warnings are non-fatal — the pipeline continues.
   */
  export async function validate(
    resolved: Resolved,
  ): Promise<StageResult<Validated, "validate">> {
    try {
      const source = await Bun.file(resolved.path).text();
      const warnings = validateSource(source, resolved.agent);

      return {
        ok: true,
        value: { ...resolved, warnings },
      };
    } catch (error) {
      return {
        ok: false,
        stage: "validate",
        error,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Stage 3: Load
  // ---------------------------------------------------------------------------

  /**
   * Import the workflow module and extract the WorkflowDefinition.
   * Checks for common authoring mistakes (missing `.compile()`, wrong export).
   */
  export async function load(
    validated: Validated,
  ): Promise<StageResult<Loaded, "load">> {
    try {
      // The workflow root is two levels up from <root>/<agent>/index.ts,
      // which covers agent dirs and any sibling `helpers/` folders.
      installAtomicLoader(dirname(dirname(validated.path)));
      const mod = await import(validated.path);
      const definition = mod.default ?? mod;

      if (!definition || definition.__brand !== "WorkflowDefinition") {
        if (definition && definition.__brand === "WorkflowBuilder") {
          return {
            ok: false,
            stage: "load",
            error: new Error("Workflow not compiled"),
            message:
              `Workflow at ${validated.path} was defined but not compiled.\n` +
              `  Add .compile() at the end of your defineWorkflow() chain:\n\n` +
              `    export default defineWorkflow({ ... })\n` +
              `      .run(async (ctx) => { ... })\n` +
              `      .compile();`,
          };
        }

        return {
          ok: false,
          stage: "load",
          error: new Error("Invalid workflow export"),
          message:
            `${validated.path} does not export a valid WorkflowDefinition.\n` +
            `  Make sure it exports defineWorkflow(...).run(...).compile() as the default export.`,
        };
      }

      return {
        ok: true,
        value: { ...validated, definition: definition as WorkflowDefinition },
      };
    } catch (error) {
      return {
        ok: false,
        stage: "load",
        error,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Full pipeline
  // ---------------------------------------------------------------------------

  /**
   * Run the full pipeline: resolve → validate → load.
   *
   * Returns a structured result with the loaded WorkflowDefinition on success,
   * or a stage-specific error on failure.
   */
  export async function loadWorkflow(
    plan: Plan,
    report?: Report,
  ): Promise<StageResult<Loaded, "resolve" | "validate" | "load">> {
    // Stage 1: Resolve
    report?.start?.("resolve");
    const resolved = await resolve(plan);
    if (!resolved.ok) {
      report?.error?.("resolve", resolved.error, resolved.message);
      return resolved;
    }

    // Stage 2: Validate
    report?.start?.("validate");
    const validated = await validate(resolved.value);
    if (!validated.ok) {
      report?.error?.("validate", validated.error, validated.message);
      return validated;
    }
    if (validated.value.warnings.length > 0) {
      report?.warn?.(validated.value.warnings);
    }

    // Stage 3: Load
    report?.start?.("load");
    const loaded = await load(validated.value);
    if (!loaded.ok) {
      report?.error?.("load", loaded.error, loaded.message);
      return loaded;
    }

    return loaded;
  }
}
