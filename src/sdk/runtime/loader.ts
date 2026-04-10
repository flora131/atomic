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

import type { WorkflowDefinition, AgentType } from "../types.ts";
import type { DiscoveredWorkflow } from "./discovery.ts";
import { validateCopilotWorkflow } from "../providers/copilot.ts";
import { validateOpenCodeWorkflow } from "../providers/opencode.ts";
import { validateClaudeWorkflow } from "../providers/claude.ts";

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
