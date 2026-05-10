/**
 * Daemon workflow registry.
 *
 * Reads ~/.atomic/settings.json and (cwd-relative) .atomic/settings.json,
 * merges workflow registrations, dynamically imports each registered Mode 1
 * workflow file, and caches WorkflowDefinition objects with metadata.
 *
 * Direct-import daemon-mode workflow discovery. §4.3 / §5.7 of the
 * 2026-05-09 UI server RFC.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentType, WorkflowDefinition, WorkflowInput } from "../types.ts";
import {
  readAtomicConfigSplit,
  getGlobalSettingsPath,
  getLocalSettingsPath,
} from "../services/config/atomic-config.ts";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Slim descriptor returned by `workflow/list` — enough for the UI to render
 * a picker row without sending the full WorkflowDefinition over the wire.
 */
export interface WorkflowDescriptor {
  /** Unique workflow name (the alias used to start the workflow). */
  name: string;
  /** Optional human-readable display name. */
  displayName?: string;
  /** Absolute path to the source file. */
  source: string;
  /** Agent this workflow targets. */
  agent: AgentType;
  /** Declared input schema for this workflow. */
  inputs?: readonly WorkflowInput[];
}

/**
 * A workflow registration that failed to import or produced no usable
 * definition. Surfaced by `load()` and `refresh()`.
 */
export interface BrokenEntry {
  /** Absolute path (or command string) of the failed source. */
  source: string;
  /** Human-readable failure reason. */
  error: string;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface CacheEntry {
  definition: WorkflowDefinition;
  descriptor: WorkflowDescriptor;
  /** Resolved absolute path used as the cache key. */
  source: string;
}

interface SourceRegistration {
  source: string;
  agents: readonly AgentType[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Runtime guard — checks the compiled workflow brand. */
export function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __brand?: unknown }).__brand === "WorkflowDefinition"
  );
}

/**
 * Extract WorkflowDefinition(s) from a dynamically-imported module.
 *
 * Resolution order (mirrors orchestrator-entry.ts):
 *   1. `mod.default` — traditional export-default pattern.
 *   2. Named exports — any WorkflowDefinition branded object.
 *   3. `getCompiledWorkflows()` side-effect registry — for modules that call
 *      compile() but don't re-export the result.
 *
 * Returns all definitions found (a single file may compile multiple agents).
 */
export function extractWorkflowDefinitions(mod: unknown): WorkflowDefinition[] {
  if (!mod || typeof mod !== "object") return [];

  const record = mod as Record<string, unknown> & {
    getCompiledWorkflows?: () => readonly WorkflowDefinition[];
  };
  const found: WorkflowDefinition[] = [];

  if (isWorkflowDefinition(record.default)) {
    found.push(record.default);
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === "default") continue;
    if (isWorkflowDefinition(value) && !found.includes(value)) {
      found.push(value);
    }
  }

  if (found.length === 0 && typeof record.getCompiledWorkflows === "function") {
    for (const wf of record.getCompiledWorkflows()) {
      if (!found.includes(wf)) found.push(wf);
    }
  }

  return found;
}

/**
 * Dynamically import a single source file and return all WorkflowDefinitions
 * found inside it, or a BrokenEntry on failure.
 */
async function importSource(
  sourcePath: string,
): Promise<{ definitions: WorkflowDefinition[]; broken: BrokenEntry | null }> {
  let mod: unknown;
  try {
    mod = await import(sourcePath);
  } catch (err) {
    return {
      definitions: [],
      broken: {
        source: sourcePath,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const definitions = extractWorkflowDefinitions(mod);

  if (definitions.length === 0) {
    const record = mod as Record<string, unknown>;
    const hasDefault = "default" in record;
    const reason = hasDefault
      ? `missing compile() — default export is not a WorkflowDefinition`
      : `no default export`;
    return {
      definitions: [],
      broken: { source: sourcePath, error: reason },
    };
  }

  return { definitions, broken: null };
}

/** Build a WorkflowDescriptor from a WorkflowDefinition + resolved source path. */
function toDescriptor(def: WorkflowDefinition, source: string): WorkflowDescriptor {
  return {
    name: def.name,
    displayName: def.description || undefined,
    source,
    agent: def.agent,
    inputs: def.inputs.length > 0 ? def.inputs : undefined,
  };
}

function workflowKey(name: string, agent: AgentType): string {
  return `${agent}/${name}`;
}

// ─── WorkflowRegistry ─────────────────────────────────────────────────────────

/**
 * Daemon-side workflow registry.
 *
 * On `load()` / `refresh()`:
 *   - Reads global (~/.atomic/settings.json) and local (.atomic/settings.json).
 *   - Merges workflow registrations (local > global precedence for same alias).
 *   - Dynamically imports each registered source file.
 *   - Caches WorkflowDefinition + WorkflowDescriptor pairs in memory.
 *
 * All read operations (`list`, `get`, `getDescriptor`, `getBySource`) are O(N)
 * over the in-memory cache — no subprocess spawn, no disk I/O after load.
 */
export class WorkflowRegistry {
  /** Keyed by `${agent}/${workflowName}`. */
  private readonly byKey = new Map<string, CacheEntry>();
  /** Keyed by resolved source path. */
  private readonly bySource = new Map<string, CacheEntry[]>();

  private loaded = false;

  /** Shared in-flight Promises so concurrent callers don't race; nulled on settle. */
  private loadInFlight: Promise<{ count: number; broken: BrokenEntry[] }> | null = null;
  private refreshInFlight: Promise<{ count: number; broken: BrokenEntry[] }> | null = null;

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Read settings files and import all registered workflow sources.
   * Idempotent — calling `load()` a second time is a no-op (use `refresh()`
   * for hot-reload). Concurrent callers share one in-flight Promise; if a
   * `refresh()` is in-flight, `load()` adopts its result rather than racing
   * a parallel import pass.
   */
  async load(): Promise<{ count: number; broken: BrokenEntry[] }> {
    if (this.loaded) return { count: this.byKey.size, broken: [] };
    if (this.refreshInFlight) return this.refreshInFlight;
    if (this.loadInFlight) return this.loadInFlight;

    this.loadInFlight = this._importAll()
      .then((r) => { this.loaded = true; return r; })
      .finally(() => { this.loadInFlight = null; });
    return this.loadInFlight;
  }

  /** Return all cached workflow descriptors. */
  list(): WorkflowDescriptor[] {
    const seen = new Set<WorkflowDefinition>();
    const result: WorkflowDescriptor[] = [];
    for (const entry of this.byKey.values()) {
      if (!seen.has(entry.definition)) {
        seen.add(entry.definition);
        result.push(entry.descriptor);
      }
    }
    return result;
  }

  /**
   * Look up a WorkflowDefinition by workflow name and optional agent.
   * When `agent` is omitted, returns the first matching name for legacy callers.
   */
  get(name: string, agent?: AgentType): WorkflowDefinition | null {
    if (agent) return this.byKey.get(workflowKey(name, agent))?.definition ?? null;
    for (const entry of this.byKey.values()) {
      if (entry.definition.name === name) return entry.definition;
    }
    return null;
  }

  /**
   * Look up a WorkflowDescriptor by workflow name and optional agent.
   * When `agent` is omitted, returns the first matching name for legacy callers.
   */
  getDescriptor(name: string, agent?: AgentType): WorkflowDescriptor | null {
    if (agent) return this.byKey.get(workflowKey(name, agent))?.descriptor ?? null;
    for (const entry of this.byKey.values()) {
      if (entry.definition.name === name) return entry.descriptor;
    }
    return null;
  }

  /**
   * Look up a WorkflowDefinition by source path, optionally narrowed by
   * workflowName + agent. When a source exports multiple definitions and no
   * narrowing is provided, returns the first one.
   */
  getBySource(source: string, workflowName?: string, agent?: AgentType): WorkflowDefinition | null {
    const entries = this.bySource.get(resolve(source)) ?? this.bySource.get(source);
    if (!entries || entries.length === 0) return null;
    if (workflowName && agent) {
      return entries.find((entry) =>
        entry.definition.name === workflowName && entry.definition.agent === agent,
      )?.definition ?? null;
    }
    return entries[0]!.definition;
  }

  /**
   * Re-import all registered source files from scratch.
   * Clears the existing cache before re-importing so stale entries don't persist.
   *
   * Queue semantics (RFC §9): if a `load()` is in-flight, refresh() waits for
   * it to settle before clearing caches and starting its own import pass.
   * Concurrent `refresh()` callers share one in-flight Promise.
   */
  async refresh(): Promise<{ count: number; broken: BrokenEntry[] }> {
    if (this.refreshInFlight) return this.refreshInFlight;

    // Wait for any in-flight load to complete before we clear caches.
    const predecessor = this.loadInFlight ?? Promise.resolve();

    this.refreshInFlight = predecessor
      .catch(() => { /* ignore load errors — we're refreshing regardless */ })
      .then(() => {
        this.byKey.clear();
        this.bySource.clear();
        this.loaded = false;
        return this._importAll();
      })
      .then((r) => { this.loaded = true; return r; })
      .finally(() => { this.refreshInFlight = null; });

    return this.refreshInFlight;
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  /**
   * Read settings, collect unique source paths, import each, populate cache.
   */
  private async _importAll(): Promise<{ count: number; broken: BrokenEntry[] }> {
    const sources = await this._collectSources();
    if (sources.length === 0) {
      return { count: 0, broken: [] };
    }

    const broken: BrokenEntry[] = [];
    let count = 0;

    await Promise.all(
      sources.map(async (registration) => {
        const result = await importSource(registration.source);

        if (result.broken) {
          broken.push(result.broken);
          return;
        }

        const allowedAgents = new Set(registration.agents);
        const matchingDefinitions = result.definitions.filter((def) => allowedAgents.has(def.agent));
        if (matchingDefinitions.length === 0) {
          broken.push({
            source: registration.source,
            error: `no WorkflowDefinition for configured agent(s): ${registration.agents.join(", ")}`,
          });
          return;
        }

        for (const def of matchingDefinitions) {
          const entry: CacheEntry = {
            definition: def,
            descriptor: toDescriptor(def, registration.source),
            source: registration.source,
          };

          // Last-write wins on exact workflow identity. This preserves the
          // JSON-RPC refactor's `{ workflowName, agent, source }` identity and
          // avoids dropping same-named workflows for different agents.
          this.byKey.set(workflowKey(def.name, def.agent), entry);

          const existing = this.bySource.get(registration.source) ?? [];
          existing.push(entry);
          this.bySource.set(registration.source, existing);

          count++;
        }
      }),
    );

    return { count, broken };
  }

  /**
   * Read global and local settings.json, merge workflow registrations, return
   * deduplicated list of absolute source paths to import.
   *
   * Precedence: local > global — same alias key in local replaces global entry.
   * Missing settings files are treated as empty (not an error).
   *
   * Mode 2 (external subprocess) entries are skipped; the daemon registry
   * only imports Mode 1 (direct import) workflow files.
   */
  private async _collectSources(): Promise<SourceRegistration[]> {
    let split: Awaited<ReturnType<typeof readAtomicConfigSplit>>;
    try {
      split = await readAtomicConfigSplit(process.cwd());
    } catch {
      return [];
    }

    // Merge alias → source registration. Global first, local overrides on
    // collision. Preserve the configured agent list so daemon discovery does
    // not expose extra definitions that happen to live in the same module.
    const merged: Record<string, { source: string; agents: readonly AgentType[] }> = {};
    for (const cfg of [split.global, split.local]) {
      for (const [alias, entry] of Object.entries(cfg?.workflows ?? {})) {
        if (isMode1Source(entry.command)) {
          merged[alias] = { source: resolve(entry.command), agents: entry.agents };
        }
      }
    }

    // Deduplicate source paths (multiple aliases may point to same file) while
    // unioning their configured agents.
    const bySource = new Map<string, Set<AgentType>>();
    for (const registration of Object.values(merged)) {
      const agents = bySource.get(registration.source) ?? new Set<AgentType>();
      for (const agent of registration.agents) agents.add(agent);
      bySource.set(registration.source, agents);
    }

    return [...bySource.entries()].map(([source, agents]) => ({
      source,
      agents: [...agents],
    }));
  }
}

/**
 * Determine whether a workflow `command` string is a Mode 1 source — a
 * TypeScript/JavaScript file path that the daemon can import() directly —
 * as opposed to a legacy external binary command (e.g. `bunx my-tool`).
 *
 * Resolution order (RFC §5.5):
 *   1. Filesystem check: if the path resolves to an actual file on disk,
 *      it is Mode 1 (handles Windows absolute paths like `C:\workflows\my-wf`
 *      and extensionless scripts that already exist).
 *   2. Extension check: recognise .ts/.tsx/.js/.mjs/.cjs suffixes for
 *      tilde-paths, glob inputs that haven't expanded yet, and pre-bundled
 *      paths that don't yet exist on disk in the current cwd.
 *
 * Mode 2 commands (`bunx my-tool`, `node dist/runner`, etc.) return `false`.
 */
export function isMode1Source(command: string): boolean {
  try {
    if (existsSync(command)) return true;
  } catch {
    // existsSync rarely throws; fall through to the extension check.
  }
  return /\.(ts|tsx|js|mjs|cjs)$/.test(command);
}

// ─── Convenience path exports (re-export for callers that want them) ──────────

export { getGlobalSettingsPath, getLocalSettingsPath };
