import { existsSync, readdirSync, unlinkSync, mkdirSync, rmdirSync } from "node:fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types.ts";
import { VERSION } from "@/version.ts";
import { getRalphWorkflowDefinition } from "@/services/workflows/builtin/ralph/ralph-workflow.ts";
import { compileWorkflow } from "@/services/workflows/dsl/compiler.ts";
import type { WorkflowBuilder } from "@/services/workflows/dsl/define-workflow.ts";
import type {
  WorkflowDefinition,
  WorkflowGraphConfig,
  WorkflowMetadata,
  WorkflowStateMigrator,
  WorkflowStateParams,
} from "./types.ts";

// ============================================================================
// CompiledWorkflow Brand Detection
// ============================================================================

/**
 * Checks whether a value is a CompiledWorkflow by looking for the
 * `__compiledWorkflow` brand property. The branded object also spreads
 * all WorkflowDefinition properties, so it can be used directly as a
 * WorkflowDefinition.
 */
function isCompiledWorkflow(value: unknown): value is WorkflowDefinition & { __compiledWorkflow: true } {
  return (
    value !== null &&
    typeof value === "object" &&
    "__compiledWorkflow" in value &&
    "name" in value &&
    typeof (value as Record<string, unknown>).name === "string"
  );
}

/**
 * Checks whether a branded value is an SDK blueprint (lightweight export
 * from `@bastani/atomic-workflows` SDK) rather than a fully compiled workflow.
 *
 * SDK blueprints carry a `__blueprint` object with the recorded builder
 * instructions and metadata. They need to be compiled by the binary's
 * internal compiler before use.
 */
function isWorkflowBlueprint(
  value: unknown,
): value is { __compiledWorkflow: true; __blueprint: BlueprintData; name: string; description: string } {
  if (!isCompiledWorkflow(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return (
    "__blueprint" in record &&
    typeof record.__blueprint === "object" &&
    record.__blueprint !== null
  );
}

interface BlueprintData {
  name: string;
  description: string;
  instructions: unknown[];
  version?: string;
  argumentHint?: string;
  stateSchema?: Record<string, unknown>;
}

/**
 * Compile an SDK blueprint into a full WorkflowDefinition.
 *
 * Reconstructs a builder-like object from the blueprint data and passes
 * it to the internal `compileWorkflow()` function. This works because
 * `compileWorkflow` uses structural typing — it only accesses `name`,
 * `description`, `instructions`, `getVersion()`, `getArgumentHint()`,
 * and `getStateSchema()`.
 */
function compileBlueprintToDefinition(blueprint: BlueprintData): WorkflowDefinition {
  const builderLike = {
    name: blueprint.name,
    description: blueprint.description,
    instructions: blueprint.instructions,
    getVersion: () => blueprint.version,
    getArgumentHint: () => blueprint.argumentHint,
    getStateSchema: () => blueprint.stateSchema,
  };
  return compileWorkflow(builderLike as unknown as WorkflowBuilder);
}

/**
 * Extract a WorkflowDefinition from a dynamically imported module by
 * detecting the `__compiledWorkflow` brand on any named or default export.
 *
 * Supports two kinds of branded exports:
 * - **SDK blueprints** (`@bastani/atomic-workflows` SDK): carry a `__blueprint`
 *   property with recorded instructions. Compiled at load time by the
 *   binary's internal compiler.
 * - **Internal compiled workflows**: spread all WorkflowDefinition
 *   properties directly (used by builtin workflows like Ralph).
 *
 * Checks three locations in priority order:
 * 1. Module itself (if the module IS a CompiledWorkflow)
 * 2. `default` export that is a CompiledWorkflow
 * 3. Named exports that are CompiledWorkflow values
 *
 * @returns The extracted WorkflowDefinition, or `null` if no branded export is found.
 */
export function extractWorkflowDefinition(mod: unknown): WorkflowDefinition | null {
  if (!mod || typeof mod !== "object") {
    return null;
  }

  const branded = findBrandedExport(mod);
  if (!branded) return null;

  // SDK blueprint: compile at load time
  if (isWorkflowBlueprint(branded)) {
    return compileBlueprintToDefinition(branded.__blueprint);
  }

  // Internal compiled workflow: already a full WorkflowDefinition
  return branded;
}

function findBrandedExport(mod: object): (WorkflowDefinition & { __compiledWorkflow: true }) | null {
  // Check if the module itself is a CompiledWorkflow
  if (isCompiledWorkflow(mod)) {
    return mod;
  }

  // Check for default export with brand
  const moduleRecord = mod as Record<string, unknown>;
  if ("default" in moduleRecord && isCompiledWorkflow(moduleRecord.default)) {
    return moduleRecord.default;
  }

  // Check named exports for any CompiledWorkflow value
  for (const key of Object.keys(moduleRecord)) {
    if (key === "default") continue;
    if (isCompiledWorkflow(moduleRecord[key])) {
      return moduleRecord[key] as WorkflowDefinition & { __compiledWorkflow: true };
    }
  }

  return null;
}

export const CUSTOM_WORKFLOW_SEARCH_PATHS = [
  ".atomic/workflows",
  "~/.atomic/workflows",
];

// ============================================================================
// Workflow File Import via Subprocess Bundler
// ============================================================================

const HOME = homedir();
const WORKFLOW_TMP_DIR = join(HOME, ".atomic", ".tmp", "workflows");

/** Bundled workflow files pending cleanup */
const tempBundledFiles: string[] = [];

/**
 * Import a workflow .ts file by first bundling it with `bun build`.
 *
 * Compiled Bun binaries cannot resolve node_modules for dynamically imported
 * files. Bundling the workflow file resolves all dependencies (SDK, user deps)
 * at bundle time, producing a self-contained JS file that the binary can
 * import with zero external resolution.
 */
export async function importWorkflowModule(
  workflowFilePath: string,
): Promise<Record<string, unknown>> {
  mkdirSync(WORKFLOW_TMP_DIR, { recursive: true });
  const basename = workflowFilePath.split("/").pop() ?? "workflow.ts";
  const bundledFile = join(
    WORKFLOW_TMP_DIR,
    `${Date.now()}-${basename.replace(/\.ts$/, ".js")}`,
  );

  const result = Bun.spawnSync(
    ["bun", "build", workflowFilePath, "--outfile", bundledFile, "--target", "bun"],
    { cwd: dirname(workflowFilePath), stderr: "pipe" },
  );

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(
      `Failed to bundle workflow ${basename}: ${stderr || "unknown error"}`,
    );
  }

  tempBundledFiles.push(bundledFile);

  try {
    return await import(bundledFile);
  } catch (error) {
    throw new Error(
      `Failed to import bundled workflow ${basename}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Clean up temporary bundled workflow files.
 */
export function cleanupTempWorkflowFiles(): void {
  for (const tmpFile of tempBundledFiles) {
    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
  tempBundledFiles.length = 0;

  try {
    rmdirSync(WORKFLOW_TMP_DIR);
  } catch {
    /* ignore if not empty or missing */
  }
}

function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(process.env.HOME || "", path.slice(2));
  }
  if (path.startsWith("~")) {
    return join(process.env.HOME || "", path.slice(1));
  }
  if (!path.startsWith("/")) {
    return join(process.cwd(), path);
  }
  return path;
}

const SEMVER_PATTERN =
  /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseSemver(version: string): [number, number, number] | null {
  const normalized = version.trim();

  if (!SEMVER_PATTERN.test(normalized)) {
    return null;
  }

  const coreVersion =
    normalized.replace(/^v/i, "").split(/[+-]/, 1)[0] ?? "0.0.0";
  const [major = "0", minor = "0", patch = "0"] = coreVersion.split(".");

  return [
    Number.parseInt(major, 10),
    Number.parseInt(minor, 10),
    Number.parseInt(patch, 10),
  ];
}

function isWorkflowMinSdkNewerThanCurrent(
  minSdkVersion: string,
  currentSdkVersion: string,
): boolean {
  const minVersion = parseSemver(minSdkVersion);
  const currentVersion = parseSemver(currentSdkVersion);

  if (!minVersion || !currentVersion) {
    return false;
  }

  const [minMajor, minMinor, minPatch] = minVersion;
  const [curMajor, curMinor, curPatch] = currentVersion;

  if (minMajor !== curMajor) return minMajor > curMajor;
  if (minMinor !== curMinor) return minMinor > curMinor;
  return minPatch > curPatch;
}

export function discoverWorkflowFiles(): {
  path: string;
  source: "local" | "global";
}[] {
  const discovered: { path: string; source: "local" | "global" }[] = [];

  for (let i = 0; i < CUSTOM_WORKFLOW_SEARCH_PATHS.length; i++) {
    const rawPath = CUSTOM_WORKFLOW_SEARCH_PATHS[i]!;
    const searchPath = expandPath(rawPath);
    const source = i === 0 ? "local" : "global";

    if (existsSync(searchPath)) {
      try {
        const files = (readdirSync(searchPath) as string[]).sort();
        for (const file of files) {
          if (file.endsWith(".ts")) {
            discovered.push({
              path: join(searchPath, file),
              source,
            });
          }
        }
      } catch {
        // Skip directories we can't read.
      }
    }
  }

  return discovered;
}

let loadedWorkflows: WorkflowDefinition[] = [];

export async function loadWorkflowsFromDisk(): Promise<WorkflowDefinition[]> {
  const discovered = discoverWorkflowFiles();
  const loaded: WorkflowDefinition[] = [];
  const loadedNames = new Set<string>();
  const startupWarnings: string[] = [];

  for (const { path, source } of discovered) {
    try {
      const module = await importWorkflowModule(path);
      const filename =
        path.split("/").pop()?.replace(".ts", "") ?? "unknown";

      // -- New DSL path: detect __compiledWorkflow brand --
      const compiledDefinition = extractWorkflowDefinition(module);
      if (compiledDefinition) {
        const name = compiledDefinition.name;

        if (loadedNames.has(name.toLowerCase())) {
          continue;
        }

        // Override source to match discovery location
        const definition: WorkflowDefinition = {
          ...compiledDefinition,
          source,
        };

        if (typeof definition.minSDKVersion === "string") {
          if (!parseSemver(definition.minSDKVersion)) {
            console.warn(
              `Workflow "${definition.name}" has invalid minSDKVersion "${definition.minSDKVersion}". Expected semver format like "1.2.3".`,
            );
          } else if (
            isWorkflowMinSdkNewerThanCurrent(
              definition.minSDKVersion,
              VERSION,
            )
          ) {
            console.warn(
              `Workflow "${definition.name}" requires SDK ${definition.minSDKVersion}, but current SDK is ${VERSION}.`,
            );
          }
        }

        loaded.push(definition);
        loadedNames.add(name.toLowerCase());

        if (definition.aliases) {
          for (const alias of definition.aliases) {
            loadedNames.add(alias.toLowerCase());
          }
        }
        continue;
      }

      // -- Legacy path: extract raw module properties --
      const mod = module as Record<string, any>;
      const name = mod.name ?? filename;

      if (loadedNames.has(name.toLowerCase())) {
        continue;
      }

      const migrateState =
        typeof mod.migrateState === "function"
          ? (mod.migrateState as WorkflowStateMigrator)
          : undefined;

      const graphConfig = mod.graphConfig as WorkflowGraphConfig | undefined;
      const createGraph = typeof mod.createGraph === "function"
        ? (mod.createGraph as () => CompiledGraph<BaseState>)
        : undefined;
      const createState = mod.createState as ((params: WorkflowStateParams) => BaseState) | undefined;
      const nodeDescriptions = mod.nodeDescriptions as Record<string, string> | undefined;
      const runtime = mod.runtime as WorkflowDefinition["runtime"] | undefined;

      if (graphConfig) {
        const nodeIds = new Set(graphConfig.nodes.map((n) => n.id));

        if (!nodeIds.has(graphConfig.startNode)) {
          console.warn(`[workflow:${name}] startNode "${graphConfig.startNode}" not found in nodes`);
        }

        for (const edge of graphConfig.edges) {
          if (!nodeIds.has(edge.from)) {
            console.warn(`[workflow:${name}] edge from "${edge.from}" references unknown node`);
          }
          if (!nodeIds.has(edge.to)) {
            console.warn(`[workflow:${name}] edge to "${edge.to}" references unknown node`);
          }
        }

        const nodesWithEdges = new Set<string>();
        for (const edge of graphConfig.edges) {
          nodesWithEdges.add(edge.from);
          nodesWithEdges.add(edge.to);
        }

        for (const node of graphConfig.nodes) {
          if (node.id !== graphConfig.startNode && !nodesWithEdges.has(node.id)) {
            console.warn(`[workflow:${name}] node "${node.id}" is orphaned (no edges to/from it)`);
          }
        }
      }

      const definition: WorkflowDefinition = {
        name,
        description: mod.description ?? `Custom workflow: ${name}`,
        aliases: mod.aliases,
        defaultConfig: mod.defaultConfig,
        version: mod.version,
        minSDKVersion: mod.minSDKVersion,
        stateVersion: mod.stateVersion,
        migrateState,
        source,
        graphConfig,
        createGraph,
        createState,
        nodeDescriptions,
        runtime,
      };

      if (typeof definition.minSDKVersion === "string") {
        if (!parseSemver(definition.minSDKVersion)) {
          console.warn(
            `Workflow "${definition.name}" has invalid minSDKVersion "${definition.minSDKVersion}". Expected semver format like "1.2.3".`,
          );
        } else if (
          isWorkflowMinSdkNewerThanCurrent(
            definition.minSDKVersion,
            VERSION,
          )
        ) {
          console.warn(
            `Workflow "${definition.name}" requires SDK ${definition.minSDKVersion}, but current SDK is ${VERSION}.`,
          );
        }
      }

      loaded.push(definition);
      loadedNames.add(name.toLowerCase());

      if (definition.aliases) {
        for (const alias of definition.aliases) {
          loadedNames.add(alias.toLowerCase());
        }
      }
    } catch (error) {
      const workflowId = path.split("/").pop()?.replace(".ts", "") ?? path;
      startupWarnings.push(workflowId);
      console.warn(`Failed to load workflow from ${path}:`, error);
    }
  }

  // Emit startup warnings for workflows that failed to load
  for (const id of startupWarnings) {
    console.warn(`\x1b[33m● Warning: Failed to load workflow: ${id}\x1b[0m`);
  }

  // Clean up temporary bundled files
  cleanupTempWorkflowFiles();

  loadedWorkflows = loaded;
  return loaded;
}

/**
 * Builtin workflow definitions, lazily compiled.
 * `getRalphWorkflowDefinition()` defers `.compile()` (which triggers agent
 * discovery + YAML parsing, ~60ms) until the workflow is actually accessed.
 */
function getBuiltinWorkflowDefinitionsLazy(): WorkflowDefinition[] {
  return [getRalphWorkflowDefinition()];
}

export function getAllWorkflows(): WorkflowMetadata[] {
  const allWorkflows: WorkflowMetadata[] = [];
  const seenNames = new Set<string>();

  for (const workflow of loadedWorkflows) {
    const lowerName = workflow.name.toLowerCase();
    if (!seenNames.has(lowerName)) {
      allWorkflows.push(workflow);
      seenNames.add(lowerName);
      if (workflow.aliases) {
        for (const alias of workflow.aliases) {
          seenNames.add(alias.toLowerCase());
        }
      }
    }
  }

  for (const workflow of getBuiltinWorkflowDefinitionsLazy()) {
    const lowerName = workflow.name.toLowerCase();
    if (!seenNames.has(lowerName)) {
      allWorkflows.push(workflow);
      seenNames.add(lowerName);
    }
  }

  return allWorkflows;
}

export function getBuiltinWorkflowDefinitions(): WorkflowDefinition[] {
  return getBuiltinWorkflowDefinitionsLazy();
}
