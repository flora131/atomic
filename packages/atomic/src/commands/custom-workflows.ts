/**
 * Custom workflow loader.
 *
 * Spawns each entry's command with `_emit-workflow-meta`, parses the emitted
 * JSON, and returns a `LoadCustomWorkflowsResult` containing successfully
 * loaded workflows and structured failure records.
 *
 * RFC §5.5 + §5.8.
 */

import { randomBytes } from "node:crypto";
import type { CustomWorkflowEntry } from "@bastani/atomic-sdk/services/config/atomic-config";
import type { AgentType, BrokenWorkflow, ExternalWorkflow, WorkflowInput } from "@bastani/atomic-sdk";
import type { createBuiltinRegistry } from "./builtin-registry.ts";

// ─── Public types ────────────────────────────────────────────────────────────

export interface LoadedWorkflow {
  alias: string;
  origin: "local" | "global";
  workflow: ExternalWorkflow;
}

// Re-export the canonical BrokenWorkflow from atomic-sdk so callers can
// import it from either package without creating a circular dependency.
export type { BrokenWorkflow };

export interface LoadCustomWorkflowsResult {
  loaded: LoadedWorkflow[];
  broken: BrokenWorkflow[];
}

// ─── Emitted meta shape (from the SDK's _emit-workflow-meta handler) ─────────

interface EmittedWorkflowDef {
  name: string;
  description?: string;
  agent: AgentType;
  inputs: WorkflowInput[];
  source: string;
  minSDKVersion: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const META_PREFIX = "ATOMIC_WORKFLOW_META: ";
const DEFAULT_TIMEOUT_MS = 5000;
const STDERR_TRUNCATE = 500;
const JSON_TRUNCATE = 200;

function resolveTimeoutMs(): number {
  const raw = process.env.ATOMIC_WORKFLOWS_META_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load custom workflows from a `settings.json` `workflows` map.
 *
 * Spawns each entry's command with `_emit-workflow-meta`, parses the output,
 * and returns loaded + broken workflows. Failures are isolated per-entry (and
 * per-agent for the "declared agent missing" case).
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
  const timeoutMs = resolveTimeoutMs();
  const args = entry.args ?? [];

  /**
   * Emit a §5.8 diagnostic to stderr and append a `BrokenWorkflow` to the
   * accumulator. Returns `{ loaded, broken }` so callers can early-return.
   */
  function fail(
    failedAgents: AgentType[],
    reason: string,
    fix: string,
  ): LoadCustomWorkflowsResult {
    process.stderr.write(`[atomic/workflows] ${reason}\n`);
    broken.push({ alias, origin, agents: failedAgents, reason, source: settingsPath, fix });
    return { loaded, broken };
  }

  // ── Spawn ────────────────────────────────────────────────────────────────

  const token = randomBytes(16).toString("hex");
  const argv = [entry.command, ...args, "_emit-workflow-meta", `--dispatch-token=${token}`];

  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(argv, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ATOMIC_HOST: "1", ATOMIC_DISPATCH_TOKEN: token },
    });
  } catch (err) {
    return fail(
      entry.agents,
      spawnErrorMessage(alias, entry.command, err),
      isNotFoundError(err)
        ? `install "${entry.command}" or use an absolute path`
        : "check file permissions and PATH",
    );
  }

  // ── Timeout race ─────────────────────────────────────────────────────────

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { child.kill(); } catch { /* ignore kill errors */ }
  }, timeoutMs);

  const [stdoutText, stderrText] = await Promise.all([
    readStream(child.stdout),
    readStream(child.stderr),
  ]);

  await child.exited;
  clearTimeout(timer);

  if (timedOut) {
    return fail(
      entry.agents,
      `"${alias}": metadata emission timed out after ${timeoutMs}ms — ensure the third-party CLI invokes hostWorkflows([…]) after compile()`,
      `add 'await hostWorkflows([wf])' after the .compile() call in "${entry.command}" (and verify it imports @bastani/atomic-sdk)`,
    );
  }

  // ── Exit code ────────────────────────────────────────────────────────────

  const exitCode = child.exitCode;
  if (exitCode !== 0) {
    const cmdStr = [entry.command, ...args, "_emit-workflow-meta"].join(" ");
    const capturedStderr = stderrText.slice(0, STDERR_TRUNCATE);
    return fail(
      entry.agents,
      `"${alias}": "${cmdStr}" exited ${exitCode}; stderr: ${capturedStderr}`,
      `check that "${entry.command}" supports _emit-workflow-meta`,
    );
  }

  // ── Parse meta line ───────────────────────────────────────────────────────

  const metaLine = stdoutText.split("\n").find((l) => l.startsWith(META_PREFIX));
  if (!metaLine) {
    return fail(
      entry.agents,
      `"${alias}": expected ATOMIC_WORKFLOW_META line — the third-party CLI may be missing the 'await hostWorkflows([wf])' call after compile() (or it is not importing @bastani/atomic-sdk)`,
      `add 'await hostWorkflows([wf])' after the .compile() call in "${entry.command}"`,
    );
  }

  const jsonStr = metaLine.slice(META_PREFIX.length);
  let emitted: unknown;
  try {
    emitted = JSON.parse(jsonStr);
  } catch (parseErr) {
    const snippet = jsonStr.slice(0, JSON_TRUNCATE);
    return fail(
      entry.agents,
      `"${alias}": failed to parse ATOMIC_WORKFLOW_META JSON — ${String(parseErr)}; offending substring: ${snippet}`,
      `ensure "${entry.command}" emits valid JSON on the ATOMIC_WORKFLOW_META line`,
    );
  }
  if (!Array.isArray(emitted)) {
    return fail(
      entry.agents,
      `"${alias}": ATOMIC_WORKFLOW_META payload must be a JSON array (got ${
        emitted === null ? "null" : typeof emitted
      })`,
      `ensure "${entry.command}" emits a JSON array on the ATOMIC_WORKFLOW_META line`,
    );
  }
  const list = emitted as EmittedWorkflowDef[];

  // ── Match per declared agent ──────────────────────────────────────────────

  for (const declaredAgent of entry.agents) {
    const def = list.find((d) => d.agent === declaredAgent);
    if (!def) {
      fail(
        [declaredAgent],
        `"${alias}/${declaredAgent}": command did not register a workflow for agent "${declaredAgent}"`,
        `add a .for("${declaredAgent}") branch to the workflow in "${entry.command}"`,
      );
      continue;
    }

    loaded.push({
      alias,
      origin,
      workflow: {
        kind: "external",
        name: def.name,
        agent: declaredAgent,
        description: def.description,
        inputs: def.inputs ?? [],
        source: { command: entry.command, args },
      },
    });
  }

  return { loaded, broken };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readStream(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>> | number | null | undefined,
): Promise<string> {
  if (!stream || typeof stream === "number") return "";
  return new Response(stream as ReadableStream<Uint8Array>).text();
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "ENOENT" || code === "MODULE_NOT_FOUND";
}

function spawnErrorMessage(alias: string, cmd: string, err: unknown): string {
  if (isNotFoundError(err)) {
    return `"${alias}": command "${cmd}" not found on PATH; install it or use an absolute path`;
  }
  const errMsg = err instanceof Error ? err.message : String(err);
  return `"${alias}": ${errMsg}`;
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
  let registry = builtin;

  function applyOrigin(loaded: readonly LoadedWorkflow[], origin: "global" | "local"): void {
    for (const { workflow } of loaded) {
      registry = registry.upsert(workflow, (prior) => {
        const priorKind = prior.kind ?? "builtin";
        process.stderr.write(
          `[atomic/workflows] override: ${workflow.name}/${workflow.agent} (${origin}) > ${priorKind}\n`,
        );
      });
    }
  }
  applyOrigin(global.loaded, "global");
  applyOrigin(local.loaded, "local");

  // Build alias-keyed healthy set from LoadedWorkflow[], NOT from registry.resolve.
  const healthyAliasAgent = new Set<string>();
  for (const { alias, workflow } of [...global.loaded, ...local.loaded]) {
    healthyAliasAgent.add(`${workflow.agent}/${alias}`);
  }

  // brokenIndex: dispatch-gating map. Skip pairs subsumed by healthy override.
  const allBroken: BrokenWorkflow[] = [...global.broken, ...local.broken];
  const brokenIndex = new Map<string, BrokenWorkflow>();
  for (const b of allBroken) {
    for (const a of b.agents) {
      if (healthyAliasAgent.has(`${a}/${b.alias}`)) continue;
      brokenIndex.set(`${a}/${b.alias}`, b);
    }
  }

  // brokenList: filter out broken entries whose every (alias, agent) pair
  // is subsumed by a healthy override. Same predicate as brokenIndex,
  // applied at the entry level. Entries with at least one un-shadowed
  // agent stay visible.
  const filteredBrokenList: BrokenWorkflow[] = allBroken
    .map((b) => ({
      ...b,
      agents: b.agents.filter((a) => !healthyAliasAgent.has(`${a}/${b.alias}`)),
    }))
    .filter((b) => b.agents.length > 0);

  const loadedCount = global.loaded.length + local.loaded.length;
  const summary =
    loadedCount + filteredBrokenList.length > 0
      ? `[atomic/workflows] loaded ${loadedCount} custom workflow(s)` +
        (filteredBrokenList.length
          ? ` (${filteredBrokenList.length} skipped — see warnings above)`
          : "")
      : null;

  return { registry, brokenList: filteredBrokenList, brokenIndex, summary };
}
