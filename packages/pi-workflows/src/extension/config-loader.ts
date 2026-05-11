/**
 * Workflow extension config loader.
 *
 * Reads project-local and user-global workflow extension config files,
 * validates their shape, and returns a merged config plus diagnostics.
 *
 * Config file candidates (first readable wins per scope):
 *   Project-local (checked in order):
 *     <projectRoot>/.pi/extensions/workflow/config.json
 *     <projectRoot>/.pi/agent/extensions/workflow/config.json
 *   User-global:
 *     <homeDir>/.pi/agent/extensions/workflow/config.json
 *
 * Invalid JSON or invalid shape → CONFIG_INVALID diagnostic (not silent success).
 * Missing file → silently skipped (not an error).
 *
 * Merge strategy: project-local values override global values.
 * The `workflows` map is merged key-by-key (project entries win on conflict).
 */

import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single explicit workflow entry from config. */
export interface WorkflowConfigEntry {
  /** Absolute or relative path to the workflow module. */
  readonly path: string;
}

/**
 * The parsed shape of a workflow extension config file.
 * All fields optional; absence means "use default".
 */
export interface WorkflowExtensionConfig {
  /** Explicit named workflows to register by module path. */
  readonly workflows?: Readonly<Record<string, WorkflowConfigEntry>>;
  /** Maximum workflow recursion depth. Default: 4. */
  readonly maxDepth?: number;
  /** Default stage concurrency. Default: 4. */
  readonly defaultConcurrency?: number;
  /** Persist runs via pi.appendEntry. Default: true. */
  readonly persistRuns?: boolean;
  /** Emit derived status.json for CI polling. Default: false. */
  readonly statusFile?: boolean;
  /** Behaviour on session_start for in-flight runs. Default: "ask". */
  readonly resumeInFlight?: "ask" | "auto" | "never";
}

/** Severity of a config diagnostic. */
export type ConfigDiagnosticLevel = "error" | "warn";

/** A diagnostic emitted while loading config. */
export interface ConfigDiagnostic {
  readonly level: ConfigDiagnosticLevel;
  /** Machine-readable code. */
  readonly code: "CONFIG_INVALID";
  readonly message: string;
  /** The config file path associated with this diagnostic. */
  readonly source?: string;
}

/** Result of a config load operation. */
export interface ConfigLoadResult {
  /**
   * Merged config from all valid sources.
   * null only if no config file existed and no defaults apply.
   * Present (possibly empty object) when at least one valid file loaded.
   */
  readonly config: WorkflowExtensionConfig | null;
  /** CONFIG_INVALID diagnostics from all sources. Empty when all is well. */
  readonly diagnostics: readonly ConfigDiagnostic[];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LoadWorkflowConfigOpts {
  /**
   * Project root directory. Defaults to process.cwd().
   * Project-local config is resolved relative to this path.
   */
  readonly projectRoot?: string;
  /**
   * User home directory. Defaults to os.homedir().
   * Global config is resolved relative to this path.
   */
  readonly homeDir?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to read a file as text.
 * Returns the text content, or null if the file does not exist.
 * Throws on unexpected I/O errors.
 */
async function tryReadFile(filePath: string): Promise<string | null> {
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) return null;
  return file.text();
}

/**
 * Validate a parsed JSON value as a WorkflowExtensionConfig.
 * Returns null when valid, or a human-readable rejection reason.
 */
function validateConfig(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "config must be a JSON object";
  }
  const c = value as Record<string, unknown>;

  if ("maxDepth" in c && (typeof c["maxDepth"] !== "number" || !Number.isInteger(c["maxDepth"]) || (c["maxDepth"] as number) < 0)) {
    return `"maxDepth" must be a non-negative integer, got ${JSON.stringify(c["maxDepth"])}`;
  }

  if ("defaultConcurrency" in c && (typeof c["defaultConcurrency"] !== "number" || !Number.isInteger(c["defaultConcurrency"]) || (c["defaultConcurrency"] as number) < 1)) {
    return `"defaultConcurrency" must be a positive integer, got ${JSON.stringify(c["defaultConcurrency"])}`;
  }

  if ("persistRuns" in c && typeof c["persistRuns"] !== "boolean") {
    return `"persistRuns" must be a boolean, got ${JSON.stringify(c["persistRuns"])}`;
  }

  if ("statusFile" in c && typeof c["statusFile"] !== "boolean") {
    return `"statusFile" must be a boolean, got ${JSON.stringify(c["statusFile"])}`;
  }

  if ("resumeInFlight" in c) {
    const v = c["resumeInFlight"];
    if (v !== "ask" && v !== "auto" && v !== "never") {
      return `"resumeInFlight" must be "ask", "auto", or "never", got ${JSON.stringify(v)}`;
    }
  }

  if ("workflows" in c) {
    if (c["workflows"] === null || typeof c["workflows"] !== "object" || Array.isArray(c["workflows"])) {
      return `"workflows" must be a JSON object, got ${JSON.stringify(typeof c["workflows"])}`;
    }
    const wf = c["workflows"] as Record<string, unknown>;
    for (const [name, entry] of Object.entries(wf)) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        return `"workflows.${name}" must be an object with a "path" field`;
      }
      const e = entry as Record<string, unknown>;
      if (typeof e["path"] !== "string" || (e["path"] as string).trim().length === 0) {
        return `"workflows.${name}.path" must be a non-empty string, got ${JSON.stringify(e["path"])}`;
      }
    }
  }

  return null;
}

/**
 * Parse and validate a config file at the given path.
 * Returns one of three outcomes:
 *   { kind: "missing" }               — file doesn't exist; silently skip
 *   { kind: "ok"; parsed }            — file valid
 *   { kind: "error"; diagnostic }     — file invalid; emit diagnostic
 */
type LoadFileOutcome =
  | { kind: "missing" }
  | { kind: "ok"; parsed: WorkflowExtensionConfig }
  | { kind: "error"; diagnostic: ConfigDiagnostic };

async function loadConfigFile(filePath: string): Promise<LoadFileOutcome> {
  let text: string | null;
  try {
    text = await tryReadFile(filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      kind: "error",
      diagnostic: {
        level: "error",
        code: "CONFIG_INVALID",
        message: `Failed to read config file: ${msg}`,
        source: filePath,
      },
    };
  }

  if (text === null) {
    return { kind: "missing" };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      kind: "error",
      diagnostic: {
        level: "error",
        code: "CONFIG_INVALID",
        message: `Invalid JSON in config file: ${msg}`,
        source: filePath,
      },
    };
  }

  const reason = validateConfig(value);
  if (reason !== null) {
    return {
      kind: "error",
      diagnostic: {
        level: "error",
        code: "CONFIG_INVALID",
        message: `Invalid config shape: ${reason}`,
        source: filePath,
      },
    };
  }

  return { kind: "ok", parsed: value as WorkflowExtensionConfig };
}

/**
 * Merge two configs: `override` values win over `base`.
 * The `workflows` map is merged key-by-key (override wins on conflict).
 */
function mergeConfigs(
  base: WorkflowExtensionConfig,
  override: WorkflowExtensionConfig,
): WorkflowExtensionConfig {
  const mergedWorkflows: Record<string, WorkflowConfigEntry> | undefined =
    base.workflows || override.workflows
      ? { ...(base.workflows ?? {}), ...(override.workflows ?? {}) }
      : undefined;

  return {
    ...(base.maxDepth !== undefined ? { maxDepth: base.maxDepth } : {}),
    ...(base.defaultConcurrency !== undefined ? { defaultConcurrency: base.defaultConcurrency } : {}),
    ...(base.persistRuns !== undefined ? { persistRuns: base.persistRuns } : {}),
    ...(base.statusFile !== undefined ? { statusFile: base.statusFile } : {}),
    ...(base.resumeInFlight !== undefined ? { resumeInFlight: base.resumeInFlight } : {}),
    // Override wins on scalar fields
    ...(override.maxDepth !== undefined ? { maxDepth: override.maxDepth } : {}),
    ...(override.defaultConcurrency !== undefined ? { defaultConcurrency: override.defaultConcurrency } : {}),
    ...(override.persistRuns !== undefined ? { persistRuns: override.persistRuns } : {}),
    ...(override.statusFile !== undefined ? { statusFile: override.statusFile } : {}),
    ...(override.resumeInFlight !== undefined ? { resumeInFlight: override.resumeInFlight } : {}),
    ...(mergedWorkflows !== undefined ? { workflows: mergedWorkflows } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and merge workflow extension config from all candidate locations.
 *
 * Candidate paths (in resolution order):
 *   Global (lowest priority):
 *     <homeDir>/.pi/agent/extensions/workflow/config.json
 *   Project-local (highest priority, two candidates — first found wins):
 *     <projectRoot>/.pi/extensions/workflow/config.json
 *     <projectRoot>/.pi/agent/extensions/workflow/config.json
 *
 * Merge: project-local overrides global. Key-level merge for `workflows` map.
 * Missing files: silently ignored. Invalid files: CONFIG_INVALID diagnostic.
 */
export async function loadWorkflowConfig(
  opts: LoadWorkflowConfigOpts = {},
): Promise<ConfigLoadResult> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const home = opts.homeDir ?? homedir();

  const diagnostics: ConfigDiagnostic[] = [];

  // Global config path
  const globalPath = join(home, ".pi", "agent", "extensions", "workflow", "config.json");

  // Project-local candidates (checked in order; first existing file wins)
  const projectCandidates: string[] = [
    join(projectRoot, ".pi", "extensions", "workflow", "config.json"),
    join(projectRoot, ".pi", "agent", "extensions", "workflow", "config.json"),
  ];

  // Load global config
  let globalConfig: WorkflowExtensionConfig | null = null;
  {
    const outcome = await loadConfigFile(globalPath);
    if (outcome.kind === "error") {
      diagnostics.push(outcome.diagnostic);
    } else if (outcome.kind === "ok") {
      globalConfig = outcome.parsed;
    }
    // "missing" → silently skip
  }

  // Load first existing project-local config
  let projectConfig: WorkflowExtensionConfig | null = null;
  for (const candidatePath of projectCandidates) {
    const file = Bun.file(candidatePath);
    const exists = await file.exists();
    if (!exists) continue;

    const outcome = await loadConfigFile(candidatePath);
    if (outcome.kind === "error") {
      diagnostics.push(outcome.diagnostic);
    } else if (outcome.kind === "ok") {
      projectConfig = outcome.parsed;
    }
    break; // Only first existing candidate
  }

  // Merge: start from global, apply project override
  let merged: WorkflowExtensionConfig | null = null;
  if (globalConfig !== null && projectConfig !== null) {
    merged = mergeConfigs(globalConfig, projectConfig);
  } else if (projectConfig !== null) {
    merged = projectConfig;
  } else if (globalConfig !== null) {
    merged = globalConfig;
  }

  // If we had any valid source (even empty object), return it
  // If only diagnostics and no valid config, return null
  return {
    config: merged,
    diagnostics,
  };
}
