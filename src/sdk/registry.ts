/**
 * Workflow Registry — immutable, chainable registry of WorkflowDefinition objects.
 *
 * Key scheme: `${agent}/${name}` — each (agent, name) pair is unique.
 * Registering the same key twice throws — no silent overwrites.
 * `register()` is immutable: returns a new Registry, original is unchanged.
 */

import type { AgentType, Registry, RegistrableWorkflow, WorkflowDefinition } from "./types.ts";
import { validateCopilotWorkflow } from "./providers/copilot.ts";
import { validateOpenCodeWorkflow } from "./providers/opencode.ts";
import { validateClaudeWorkflow } from "./providers/claude.ts";
import type { ValidationWarning } from "./types.ts";

// Registry type is declared in types.ts; re-export it from here for convenience.
export type { Registry };

// ─── Validator dispatch ──────────────────────────────────────────────────────

/** Map agent type to its provider validator. */
const providerValidators: Record<
  AgentType,
  (source: string) => ValidationWarning[]
> = {
  claude: validateClaudeWorkflow,
  opencode: validateOpenCodeWorkflow,
  copilot: validateCopilotWorkflow,
};

/**
 * Run provider-specific source validation for a workflow definition.
 *
 * Derives source text from `wf.run.toString()` — the function body contains
 * the SDK API calls the validators check via regex. Hard failures (thrown
 * errors from the validator itself) propagate; warnings are returned.
 */
function runProviderValidation(wf: WorkflowDefinition): ValidationWarning[] {
  const validator = providerValidators[wf.agent];
  const source = wf.run.toString();
  return validator(source);
}

/**
 * Validate a single workflow definition at registration time.
 * Throws on hard failures; logs warnings via console.warn with `[registry]` prefix.
 */
function validateAtRegistration(wf: WorkflowDefinition): void {
  const warnings = runProviderValidation(wf);
  for (const w of warnings) {
    console.warn(
      `[registry] workflow "${wf.agent}/${wf.name}" — ${w.rule}: ${w.message}`,
    );
  }
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Internal implementation — typed separately from the public `Registry<T>`
 * so the accumulating generic can be rebuilt on each `register()` call
 * without leaking the implementation detail.
 */
class RegistryImpl<T extends Record<string, WorkflowDefinition>> {
  /** Immutable snapshot of registered definitions, keyed by `${agent}/${name}`. */
  private readonly map: ReadonlyMap<string, WorkflowDefinition>;

  constructor(map: ReadonlyMap<string, WorkflowDefinition>) {
    this.map = map;
  }

  register<W extends RegistrableWorkflow>(
    wf: W,
  ): Registry<T & Record<`${W["agent"]}/${W["name"]}`, W>> {
    const key = `${wf.agent}/${wf.name}` as `${W["agent"]}/${W["name"]}`;

    if (this.map.has(key)) {
      throw new Error(
        `[atomic] Duplicate workflow registration: "${key}" is already registered. ` +
          `Each (agent, name) pair must be unique.`,
      );
    }

    validateAtRegistration(wf);

    const next = new Map(this.map);
    next.set(key, wf);
    return new RegistryImpl<T & Record<`${W["agent"]}/${W["name"]}`, W>>(next) as Registry<
      T & Record<`${W["agent"]}/${W["name"]}`, W>
    >;
  }

  get<K extends keyof T>(key: K): T[K] {
    const entry = this.map.get(key as string);
    if (!entry) {
      throw new Error(`[atomic] Workflow "${String(key)}" is not registered.`);
    }
    return entry as T[K];
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  list(): readonly WorkflowDefinition[] {
    return Object.freeze(Array.from(this.map.values()));
  }

  resolve(name: string, agent: AgentType): WorkflowDefinition | undefined {
    return this.map.get(`${agent}/${name}`);
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an empty workflow registry.
 *
 * @example
 * ```typescript
 * import { createRegistry } from "@bastani/atomic/workflows";
 * import { myWorkflow } from "./workflows/my-workflow.workflow";
 *
 * const registry = createRegistry()
 *   .register(myWorkflow);
 * ```
 */
export function createRegistry(): Registry<Record<string, never>> {
  return new RegistryImpl<Record<string, never>>(new Map()) as Registry<Record<string, never>>;
}

// ─── Re-export validators for external use ───────────────────────────────────
export { validateCopilotWorkflow, validateOpenCodeWorkflow, validateClaudeWorkflow };
