/**
 * Custom workflow loader.
 *
 * Clean-break daemon mode supports only direct-import workflow source files
 * registered in settings.json. Legacy subprocess metadata/dispatch helpers
 * (`_emit-workflow-meta`, `_atomic-run`, hostLocalWorkflows) are intentionally
 * not supported.
 */

import { resolve } from "node:path";
import {
  getGlobalSettingsPath,
  getLocalSettingsPath,
  readAtomicConfigSplit,
  type CustomWorkflowEntry,
} from "@bastani/atomic-sdk/services/config/atomic-config";
import type { AgentType, BrokenWorkflow, WorkflowDefinition } from "@bastani/atomic-sdk";
import { listWorkflows } from "@bastani/atomic-sdk";
import { extractWorkflowDefinitions, isMode1Source } from "@bastani/atomic-sdk/runtime/registry";
import { createBuiltinRegistry } from "./builtin-registry.ts";

// ─── Public types ────────────────────────────────────────────────────────────

export interface LoadedWorkflow {
  alias: string;
  origin: "local" | "global";
  workflow: WorkflowDefinition;
}

// Re-export the canonical BrokenWorkflow from atomic-sdk so callers can
// import it from either package without creating a circular dependency.
export type { BrokenWorkflow };

export interface LoadCustomWorkflowsResult {
  loaded: LoadedWorkflow[];
  broken: BrokenWorkflow[];
}

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load custom workflows from a `settings.json` `workflows` map.
 *
 * Each entry's `command` must be an importable workflow source file (.ts/.tsx/
 * .js/.mjs/.cjs or an existing extensionless file). Failures are isolated
 * per-entry and per-agent.
 */
export async function loadCustomWorkflows(
  workflows: Record<string, CustomWorkflowEntry> | undefined,
  origin: "local" | "global",
  settingsPath: string,
): Promise<LoadCustomWorkflowsResult> {
  if (!workflows) return { loaded: [], broken: [] };

  const results = await Promise.all(
    Object.entries(workflows).map(([alias, entry]) =>
      loadOne(alias, entry, origin, settingsPath),
    ),
  );

  return {
    loaded: results.flatMap((r) => r.loaded),
    broken: results.flatMap((r) => r.broken),
  };
}

// ─── Single-entry loader ─────────────────────────────────────────────────────

async function loadOne(
  alias: string,
  entry: CustomWorkflowEntry,
  origin: "local" | "global",
  settingsPath: string,
): Promise<LoadCustomWorkflowsResult> {
  const loaded: LoadedWorkflow[] = [];
  const broken: BrokenWorkflow[] = [];

  function fail(
    failedAgents: AgentType[],
    reason: string,
    fix: string,
  ): LoadCustomWorkflowsResult {
    process.stderr.write(`[atomic/workflows] ${reason}
`);
    broken.push({ alias, origin, agents: failedAgents, reason, source: settingsPath, fix });
    return { loaded, broken };
  }

  if (!isMode1Source(entry.command)) {
    return fail(
      entry.agents,
      `"${alias}": command must be an importable workflow source file in daemon mode (got "${entry.command}")`,
      `replace "${alias}.command" with a .ts/.tsx/.js/.mjs/.cjs workflow file that exports a compiled workflow`,
    );
  }

  const source = resolve(entry.command);

  let mod: unknown;
  try {
    mod = await import(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(
      entry.agents,
      `"${alias}": failed to import workflow source "${source}": ${message}`,
      `fix the import error in "${source}" or update "${alias}.command"`,
    );
  }

  const definitions = extractWorkflowDefinitions(mod);
  if (definitions.length === 0) {
    return fail(
      entry.agents,
      `"${alias}": workflow source did not export any compiled WorkflowDefinition`,
      `export default defineWorkflow(...).for(...).run(...).compile() from "${source}"`,
    );
  }

  for (const declaredAgent of entry.agents) {
    const def = definitions.find((d) => d.agent === declaredAgent);
    if (!def) {
      fail(
        [declaredAgent],
        `"${alias}/${declaredAgent}": workflow source did not export a WorkflowDefinition for agent "${declaredAgent}"`,
        `add a .for("${declaredAgent}") workflow export to "${source}" or remove that agent from settings`,
      );
      continue;
    }

    loaded.push({ alias, origin, workflow: def });
  }

  return { loaded, broken };
}

// ─── Registry merge ───────────────────────────────────────────────────────────

export interface MergeResult {
  registry: ReturnType<typeof createBuiltinRegistry>;
  brokenList: readonly BrokenWorkflow[];
  brokenIndex: ReadonlyMap<string, BrokenWorkflow>;
  summary: string | null;
}

/**
 * Merge global and local custom workflow results into a builtin registry.
 *
 * Precedence: local > global > builtin.
 * Override events are written to stderr as audit lines.
 * Broken entries are indexed by `${agent}/${alias}`.
 *
 * RFC §5.7.
 */
export function mergeIntoRegistry(
  builtin: ReturnType<typeof createBuiltinRegistry>,
  global: LoadCustomWorkflowsResult,
  local: LoadCustomWorkflowsResult,
): MergeResult {
  // Apply global first, then local — so local entries override on collision.
  const allLoaded: readonly LoadedWorkflow[] = [...global.loaded, ...local.loaded];
  let registry = builtin;
  for (const { workflow, origin } of allLoaded) {
    registry = registry.upsert(workflow, (prior) => {
      const priorKind = prior.kind ?? "builtin";
      process.stderr.write(
        `[atomic/workflows] override: ${workflow.name}/${workflow.agent} (${origin}) > ${priorKind}\n`,
      );
    });
  }

  // TWO healthy sets for RFC §5.7.2 shadow-subtraction (alias ∪ name).
  //
  // Set 1: keyed by `${agent}/${alias}` — covers healthy custom externals
  // where the compiled name happens to differ from the alias used in the
  // broken entry.
  const healthyAliasAgent = new Set<string>();
  for (const { alias, workflow } of allLoaded) {
    healthyAliasAgent.add(`${workflow.agent}/${alias}`);
  }

  // Set 2: keyed by compiled `${agent}/${name}` from the fully-merged
  // registry.  Covers BOTH custom externals AND builtins — `blockIfBroken`
  // looks up by name, so any resolvable name (custom OR builtin) must unmask
  // a colliding broken alias.
  const healthyNameAgent = new Set<string>();
  for (const def of listWorkflows(registry)) {
    healthyNameAgent.add(`${def.agent}/${def.name}`);
  }

  // A broken (agent, alias) pair is shadowed when either healthy set matches.
  function isShadowed(a: AgentType, alias: string): boolean {
    const key = `${a}/${alias}`;
    return healthyAliasAgent.has(key) || healthyNameAgent.has(key);
  }

  // Single pass builds both:
  //   brokenIndex (dispatch gate): un-shadowed (agent, alias) → BrokenWorkflow.
  //   brokenList  (display):       entries whose every agent is shadowed drop
  //                                out; surviving entries narrow to visible agents.
  const allBroken: BrokenWorkflow[] = [...global.broken, ...local.broken];
  const brokenIndex = new Map<string, BrokenWorkflow>();
  const brokenList: BrokenWorkflow[] = [];
  for (const b of allBroken) {
    const visibleAgents = b.agents.filter((a) => !isShadowed(a, b.alias));
    if (visibleAgents.length === 0) continue;
    for (const a of visibleAgents) {
      brokenIndex.set(`${a}/${b.alias}`, b);
    }
    brokenList.push({ ...b, agents: visibleAgents });
  }

  // §5.7.2 invariant: brokenIndex must never expose a key that the healthy
  // registry can resolve. If this fires, shadow-subtraction broke and CLI
  // dispatch would emit a false-positive hard-block. Dev-only guard.
  if (process.env.NODE_ENV !== "production") {
    for (const key of brokenIndex.keys()) {
      const slash = key.indexOf("/");
      const agent = key.slice(0, slash) as AgentType;
      const name = key.slice(slash + 1);
      if (registry.resolve(name, agent) !== undefined) {
        throw new Error(
          `[atomic/workflows] §5.7.2 invariant violated: brokenIndex key "${key}" ` +
            `resolves to a healthy workflow; shadow-subtraction missed a collision`,
        );
      }
    }
  }

  const loadedCount = allLoaded.length;
  const summary =
    loadedCount + brokenList.length > 0
      ? `[atomic/workflows] loaded ${loadedCount} custom workflow(s)` +
        (brokenList.length ? ` (${brokenList.length} skipped — see warnings above)` : "")
      : null;

  return { registry, brokenList, brokenIndex, summary };
}

// ─── Bootstrap (read settings → load → merge) ────────────────────────────────

/**
 * Result of `bootstrapCustomWorkflows`. Extends `MergeResult` with the raw
 * `LoadedWorkflow` list so callers (refresh CLI, telemetry) can render
 * per-entry detail (alias, origin) that isn't preserved on the merged registry.
 *
 * Also includes the resolved settings paths so diagnostics can name the
 * exact file the user must edit to fix a broken entry.
 */
export interface BootstrapResult extends MergeResult {
  loaded: LoadedWorkflow[];
  paths: { global: string; local: string };
}

/**
 * Read global + local `settings.json`, spawn each entry's metadata
 * subprocess, and merge the results into a builtin-seeded registry.
 *
 * Pure data flow — does not mutate the active workflow command. Callers
 * are responsible for invoking `rebuildWorkflowCommand(...)` with the
 * returned `registry` and `brokenIndex` if they need the singleton CLI
 * to reflect the new state.
 */
export async function bootstrapCustomWorkflows(
  projectDir: string = process.cwd(),
): Promise<BootstrapResult> {
  const globalPath = getGlobalSettingsPath();
  const localPath = getLocalSettingsPath(projectDir);

  const { global: globalCfg, local: localCfg } =
    await readAtomicConfigSplit(projectDir);

  const [globalRes, localRes] = await Promise.all([
    loadCustomWorkflows(globalCfg?.workflows, "global", globalPath),
    loadCustomWorkflows(localCfg?.workflows, "local", localPath),
  ]);

  const merge = mergeIntoRegistry(createBuiltinRegistry(), globalRes, localRes);

  return {
    ...merge,
    loaded: [...globalRes.loaded, ...localRes.loaded],
    paths: { global: globalPath, local: localPath },
  };
}
