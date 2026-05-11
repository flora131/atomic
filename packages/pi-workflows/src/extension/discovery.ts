/**
 * Workflow discovery for pi-workflows extension startup.
 *
 * Loads bundled workflow definitions from the package manifest, validates
 * each definition, registers valid ones into a shared WorkflowRegistry, and
 * returns a DiscoveryResult with the registry, source records, and diagnostics.
 *
 * Usage:
 *   const result = await discoverBundledWorkflows();
 *   result.registry  // WorkflowRegistry with all valid bundled workflows
 *   result.sources   // per-workflow source metadata
 *   result.errors    // validation + duplicate diagnostics
 *
 * Future: custom root discovery can be added without changing this API.
 */

import type { WorkflowDefinition } from "../shared/types.js";
import { createRegistry } from "../workflows/registry.js";
import type { WorkflowRegistry } from "../workflows/registry.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Identifies the origin of a discovered workflow definition. */
export interface DiscoverySource {
  /** The workflow's normalizedName (registry key). */
  readonly id: string;
  /**
   * Discovery kind.  "bundled" = shipped with the pi-workflows package.
   * Future kinds: "custom-root", "plugin".
   */
  readonly kind: "bundled";
  /** Human-readable display name as authored. */
  readonly name: string;
}

/** Severity of a discovery diagnostic. */
export type DiagnosticLevel = "error" | "warn";

/**
 * A diagnostic emitted during discovery.
 * Errors indicate a definition was rejected; warnings indicate a recoverable
 * condition (e.g. a duplicate that was skipped).
 */
export interface DiscoveryDiagnostic {
  readonly level: DiagnosticLevel;
  /**
   * Short machine-readable code.
   * Defined codes:
   *   INVALID_DEFINITION   — failed structural validation
   *   DUPLICATE_NAME       — normalizedName already registered; skipped
   */
  readonly code: "INVALID_DEFINITION" | "DUPLICATE_NAME";
  readonly message: string;
  /** The export key or workflow name associated with this diagnostic, if known. */
  readonly source?: string;
}

/** Result returned by discoverBundledWorkflows(). */
export interface DiscoveryResult {
  /** Registry populated with all valid, non-duplicate bundled definitions. */
  readonly registry: WorkflowRegistry;
  /** One record per successfully registered workflow. */
  readonly sources: readonly DiscoverySource[];
  /** Validation errors and duplicate warnings. Empty when all is well. */
  readonly errors: readonly DiscoveryDiagnostic[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a candidate value as a WorkflowDefinition.
 * Returns null when valid, or a human-readable rejection reason string.
 */
function validateDefinition(value: unknown): string | null {
  if (value === null || typeof value !== "object") {
    return "export is not an object";
  }
  const d = value as Record<string, unknown>;

  if (d["__piWorkflow"] !== true) {
    return "missing or incorrect __piWorkflow sentinel (expected true)";
  }
  if (typeof d["name"] !== "string" || (d["name"] as string).trim().length === 0) {
    return "name must be a non-empty string";
  }
  if (typeof d["normalizedName"] !== "string" || (d["normalizedName"] as string).trim().length === 0) {
    return "normalizedName must be a non-empty string";
  }
  if (typeof d["run"] !== "function") {
    return "run must be a function";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bundled manifest import
// ---------------------------------------------------------------------------

/**
 * Statically import the bundled workflows manifest.
 * Resolved at module load time — no dynamic eval or TS loader required.
 */
async function loadBundledManifest(): Promise<Record<string, unknown>> {
  // Static import keeps bundler-friendliness; the module is always present.
  const mod = await import("../../workflows/index.js");
  return mod as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Core discovery logic
// ---------------------------------------------------------------------------

/**
 * Discover all bundled workflow definitions, validate them, and register valid
 * ones into a new WorkflowRegistry.
 *
 * Duplicate policy: first-seen wins (insertion order of the manifest export).
 * Subsequent definitions with the same normalizedName are skipped and a
 * DUPLICATE_NAME warning is appended to errors.
 *
 * @example
 * const { registry, sources, errors } = await discoverBundledWorkflows();
 * if (errors.length) console.warn(errors);
 * const workflow = registry.get("ralph");
 */
export async function discoverBundledWorkflows(): Promise<DiscoveryResult> {
  const manifest = await loadBundledManifest();
  const diagnostics: DiscoveryDiagnostic[] = [];
  const sources: DiscoverySource[] = [];
  let registry = createRegistry();

  for (const [exportKey, value] of Object.entries(manifest)) {
    const reason = validateDefinition(value);
    if (reason !== null) {
      diagnostics.push({
        level: "error",
        code: "INVALID_DEFINITION",
        message: `Bundled export "${exportKey}" rejected: ${reason}`,
        source: exportKey,
      });
      continue;
    }

    // Safe cast — validation passed.
    const def = value as WorkflowDefinition;
    const key = def.normalizedName;

    if (registry.has(key)) {
      // Duplicate — first-seen wins, emit warning.
      diagnostics.push({
        level: "warn",
        code: "DUPLICATE_NAME",
        message: `Bundled export "${exportKey}" skipped: normalizedName "${key}" already registered`,
        source: exportKey,
      });
      continue;
    }

    registry = registry.register(def);
    sources.push({
      id: key,
      kind: "bundled",
      name: def.name,
    });
  }

  return {
    registry,
    sources,
    errors: diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Re-export types needed by callers (avoids them importing from registry.ts)
// ---------------------------------------------------------------------------
export type { WorkflowRegistry };
