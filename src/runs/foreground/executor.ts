/**
 * Main DAG executor: run(def, inputs, opts) → RunResult
 */

import type {
  WorkflowDefinition,
  WorkflowRunContext,
  WorkflowUIContext,
  WorkflowUIAdapter,
  WorkflowInputSchema,
  StageContext,
  StageOptions,
  WorkflowMcpPort,
  WorkflowPersistencePort,
  WorkflowRuntimeConfig,
} from "../../shared/types.js";
import type { InternalStageContext, StageAdapters } from "./stage-runner.js";
import type { RunStatus, StageSnapshot, RunSnapshot, WorkflowOverlayAdapter } from "../../shared/store-types.js";
import type { Store } from "../../shared/store.js";
import type { CancellationRegistry } from "../background/cancellation-registry.js";
import { createStageContext } from "./stage-runner.js";
import { GraphFrontierTracker } from "../shared/graph-inference.js";
import { createRunLimiter } from "../shared/concurrency.js";
import { store as defaultStore } from "../../shared/store.js";
import {
  appendRunStart,
  appendStageStart,
  appendStageEnd,
  appendRunEnd,
} from "../../shared/persistence-session-entries.js";

export interface ResolvedInputs extends Record<string, unknown> {}

export interface RunOpts {
  adapters?: StageAdapters;
  /** HIL adapter injected by the pi runtime or test harness. */
  ui?: WorkflowUIAdapter;
  /** Store override (for testing; defaults to singleton store) */
  store?: Store;
  /** Persistence port for writing session entries (run.start, stage.start, etc.). */
  persistence?: WorkflowPersistencePort;
  /** MCP scope-gating port; forwards per-stage allow/deny to the MCP adapter. */
  mcp?: WorkflowMcpPort;
  /** Cancellation registry; the executor registers an ActiveRunController per run. */
  cancellation?: CancellationRegistry;
  /** Overlay adapter for displaying run progress in the UI layer. */
  overlay?: WorkflowOverlayAdapter;
  /** AbortSignal that requests cancellation from the caller side. */
  signal?: AbortSignal;
  /**
   * Resolved runtime configuration. Injected by the composition root after
   * merging file config with defaults. Downstream tasks (maxDepth, concurrency,
   * status writer) consume this; values are threaded here but not yet acted on.
   */
  config?: WorkflowRuntimeConfig;
  /**
   * Current nesting depth of this workflow run. Starts at 0 for top-level runs.
   * Callers that spawn nested runs must increment this by 1 before passing to
   * run()/runDetached() so the maxDepth guard can reject runs that exceed the
   * configured limit.
   */
  depth?: number;
  /**
   * Pre-allocated runId. When provided, the executor uses this ID instead of
   * generating a new UUID. The detached runner uses this seam to preallocate
   * the runId before starting the background promise.
   */
  runId?: string;
  onRunStart?: (snapshot: RunSnapshot) => void;
  onStageStart?: (runId: string, snapshot: StageSnapshot) => void;
  onStageEnd?: (runId: string, snapshot: StageSnapshot) => void;
  onRunEnd?: (runId: string, status: RunStatus, result?: Record<string, unknown>, error?: string) => void;
}

export interface RunResult {
  readonly runId: string;
  readonly status: RunStatus;
  readonly result?: Record<string, unknown>;
  readonly error?: string;
  readonly stages: StageSnapshot[];
}

// ---------------------------------------------------------------------------
// Input resolution / validation
// ---------------------------------------------------------------------------

export function resolveInputs(
  schema: Readonly<Record<string, WorkflowInputSchema>>,
  provided: Record<string, unknown>,
): ResolvedInputs {
  const resolved: Record<string, unknown> = { ...provided };

  for (const [key, schemaDef] of Object.entries(schema)) {
    if (resolved[key] === undefined && "default" in schemaDef && schemaDef.default !== undefined) {
      resolved[key] = schemaDef.default;
    }
  }

  for (const [key, schemaDef] of Object.entries(schema)) {
    if (schemaDef.required === true && resolved[key] === undefined) {
      throw new TypeError(`pi-workflows: required input "${key}" not provided`);
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// HIL unavailable fallback — rejects with precise per-primitive error
// ---------------------------------------------------------------------------

function makeUnavailableUIContext(): WorkflowUIContext {
  const msg = (primitive: string): string =>
    `pi-workflows: HIL ctx.ui.${primitive} is unavailable because pi runtime did not provide a UI adapter`;
  return {
    input: () => Promise.reject(new Error(msg("input"))),
    confirm: () => Promise.reject(new Error(msg("confirm"))),
    select: () => Promise.reject(new Error(msg("select"))),
    editor: () => Promise.reject(new Error(msg("editor"))),
  };
}

// ---------------------------------------------------------------------------
// raceAbort — races a promise against an AbortSignal
// ---------------------------------------------------------------------------

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("workflow killed", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason ?? new DOMException("workflow killed", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (val) => { signal.removeEventListener("abort", onAbort); resolve(val); },
      (err: unknown) => { signal.removeEventListener("abort", onAbort); reject(err); },
    );
  });
}

function appendRunEndWhenRecorded(
  persistence: WorkflowPersistencePort | undefined,
  recorded: boolean,
  payload: {
    readonly runId: string;
    readonly status: RunStatus;
    readonly result?: Record<string, unknown>;
    readonly ts: number;
  },
): void {
  if (!persistence || !recorded) return;
  appendRunEnd(persistence, payload);
}

// ---------------------------------------------------------------------------
// Shared killed finalizer — used for catch-abort and post-body abort check
// ---------------------------------------------------------------------------

function finalizeKilled(
  runId: string,
  runSnapshot: RunSnapshot,
  activeStore: Store,
  persistence: WorkflowPersistencePort | undefined,
  onRunEnd: RunOpts["onRunEnd"],
): RunResult {
  const recorded = activeStore.recordRunEnd(runId, "killed", undefined, "workflow killed");
  onRunEnd?.(runId, "killed", undefined, "workflow killed");
  appendRunEndWhenRecorded(persistence, recorded, {
    runId,
    status: "killed",
    ts: Date.now(),
  });
  return {
    runId,
    status: "killed",
    error: "workflow killed",
    stages: [...runSnapshot.stages],
  };
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function run(
  def: WorkflowDefinition,
  inputs: Record<string, unknown>,
  opts: RunOpts = {},
): Promise<RunResult> {
  const activeStore = opts.store ?? defaultStore;
  const adapters = opts.adapters ?? {};

  // 0. maxDepth guard — reject before any store/persistence side effects.
  const depth = opts.depth ?? 0;
  if (opts.config !== undefined && depth >= opts.config.maxDepth) {
    const max = opts.config.maxDepth;
    return {
      runId: opts.runId ?? crypto.randomUUID(),
      status: "failed",
      error: `pi-workflows: maxDepth exceeded (max ${max})`,
      stages: [],
    };
  }

  // 1. Resolve + validate inputs
  const resolvedInputs = resolveInputs(def.inputs, inputs);

  // 2. Generate runId (or use pre-allocated seam from caller)
  const runId = opts.runId ?? crypto.randomUUID();

  // 2a. Create own AbortController; forward caller signal if provided
  const ownController = new AbortController();
  const callerSignal = opts.signal;
  if (callerSignal) {
    if (callerSignal.aborted) {
      ownController.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener("abort", () => { ownController.abort(callerSignal.reason); }, { once: true });
    }
  }

  // 3. Create RunSnapshot + register
  const runSnapshot: RunSnapshot = {
    id: runId,
    name: def.name,
    inputs: Object.freeze(resolvedInputs),
    status: "running",
    stages: [],
    startedAt: Date.now(),
  };

  activeStore.recordRunStart(runSnapshot);
  // When the caller already has a controller registered (the detached runner
  // pre-registers before calling run() so abort() can hit the run during
  // executor setup), avoid overwriting it. Two registrations for the same
  // runId means `cancellation.abort(runId)` only hits one controller, and
  // listeners on the other never fire — which is exactly the leak that
  // wedges HIL waiters in background runs.
  if (!opts.signal) {
    opts.cancellation?.register(runId, ownController);
  }
  opts.onRunStart?.(runSnapshot);

  // Persistence: append run.start entry
  if (opts.persistence) {
    appendRunStart(opts.persistence, {
      runId,
      name: def.name,
      inputs: resolvedInputs,
      ts: runSnapshot.startedAt,
    });
  }

  // 4. Create GraphFrontierTracker and per-run ConcurrencyLimiter
  const tracker = new GraphFrontierTracker();
  const limiter = createRunLimiter(opts.config?.defaultConcurrency);

  // 5. Build WorkflowRunContext
  const ctx: WorkflowRunContext = {
    inputs: resolvedInputs,
    ui: opts.ui ?? makeUnavailableUIContext(),

    stage(name: string, options?: StageOptions) {
      // a. Generate stageId
      const stageId = crypto.randomUUID();

      // b. tracker.onSpawn → parentIds
      const parentIds = tracker.onSpawn(stageId, name);

      // c. Create StageSnapshot as "pending"
      const stageSnapshot: StageSnapshot = {
        id: stageId,
        name,
        status: "pending",
        parentIds: Object.freeze(parentIds),
        toolEvents: [],
        // Store mcp scope options on snapshot when provided
        ...(options?.mcp !== undefined
          ? { mcpScope: { allow: options.mcp.allow ?? null, deny: options.mcp.deny ?? null } }
          : {}),
      };

      // d. Record stage start in store (as pending), call onStageStart
      activeStore.recordStageStart(runId, stageSnapshot);
      opts.onStageStart?.(runId, stageSnapshot);

      // e. Create inner AgentSession-like StageContext (raw, without lifecycle wrapping)
      const innerCtx: InternalStageContext = createStageContext({
        stageId,
        stageName: name,
        adapters,
        runId,
        signal: ownController.signal,
        stageOptions: options,
      });

      const runTrackedStageCall = async (call: () => Promise<string>): Promise<string> => {
        // Block here until a concurrency slot is available for this run.
        await limiter.acquire();

        stageSnapshot.status = "running";
        stageSnapshot.startedAt = Date.now();
        activeStore.recordStageStart(runId, stageSnapshot);

        // Persistence: append stage.start entry
        if (opts.persistence) {
          appendStageStart(opts.persistence, {
            runId,
            stageId,
            name,
            parentIds: stageSnapshot.parentIds,
            ts: stageSnapshot.startedAt,
          });
        }

        const mcpAllow = options?.mcp?.allow ?? null;
        const mcpDeny = options?.mcp?.deny ?? null;
        const hasMcpScope = mcpAllow !== null || mcpDeny !== null;

        if (opts.mcp && hasMcpScope) {
          opts.mcp.setScope(stageId, mcpAllow, mcpDeny);
        }

        try {
          const abortSession = (): void => {
            void innerCtx.abort().catch(() => {});
          };
          if (ownController.signal.aborted) abortSession();
          else ownController.signal.addEventListener("abort", abortSession, { once: true });
          let result = "";
          try {
            result = await raceAbort(call(), ownController.signal);
          } finally {
            ownController.signal.removeEventListener("abort", abortSession);
          }
          stageSnapshot.status = "completed";
          const assistantText = innerCtx.__getLastAssistantText();
          if (assistantText !== undefined) {
            stageSnapshot.result = assistantText;
          }
          return result;
        } catch (err) {
          stageSnapshot.status = "failed";
          stageSnapshot.error = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          stageSnapshot.endedAt = Date.now();
          stageSnapshot.durationMs =
            stageSnapshot.startedAt !== undefined
              ? stageSnapshot.endedAt - stageSnapshot.startedAt
              : undefined;

          if (opts.mcp && hasMcpScope) {
            opts.mcp.clearScope(stageId);
          }

          activeStore.recordStageEnd(runId, stageSnapshot);
          opts.onStageEnd?.(runId, stageSnapshot);

          // Persistence: append stage.end entry
          if (opts.persistence) {
            appendStageEnd(opts.persistence, {
              runId,
              stageId,
              status: stageSnapshot.status,
              durationMs: stageSnapshot.durationMs,
            });
          }

          tracker.onSettle(stageId);
          innerCtx.__dispose();
          limiter.release();
        }
      };

      const stageContext: StageContext = {
        name: innerCtx.name,
        prompt: (text, promptOptions) => runTrackedStageCall(() => innerCtx.prompt(text, promptOptions)),
        complete: (text, completeOptions) => runTrackedStageCall(() => innerCtx.complete(text, completeOptions)),
        subagent: (subagentOptions) => runTrackedStageCall(() => innerCtx.subagent(subagentOptions)),
        steer: (text) => innerCtx.steer(text),
        followUp: (text) => innerCtx.followUp(text),
        subscribe: (listener) => innerCtx.subscribe(listener),
        get sessionFile() { return innerCtx.sessionFile; },
        get sessionId() { return innerCtx.sessionId; },
        setModel: (model) => innerCtx.setModel(model),
        setThinkingLevel: (level) => innerCtx.setThinkingLevel(level),
        cycleModel: () => innerCtx.cycleModel(),
        cycleThinkingLevel: () => innerCtx.cycleThinkingLevel(),
        get agent() { return innerCtx.agent; },
        get model() { return innerCtx.model; },
        get thinkingLevel() { return innerCtx.thinkingLevel; },
        get messages() { return innerCtx.messages; },
        get isStreaming() { return innerCtx.isStreaming; },
        navigateTree: (targetId, treeOptions) => innerCtx.navigateTree(targetId, treeOptions),
        compact: (customInstructions) => innerCtx.compact(customInstructions),
        abortCompaction: () => innerCtx.abortCompaction(),
        abort: () => innerCtx.abort(),
      };
      const stageHandle = Promise.resolve(stageContext) as Promise<StageContext> & StageContext;
      for (const key of Reflect.ownKeys(stageContext)) {
        const descriptor = Object.getOwnPropertyDescriptor(stageContext, key);
        if (descriptor) Object.defineProperty(stageHandle, key, descriptor);
      }
      return stageHandle;
    },
  };

  // 6. Call def.run(ctx)
  try {
    const result = await def.run(ctx);

    // Post-body abort check: if signal was aborted at any point before we record
    // completion, the run must be finalized as "killed", never "completed".
    if (ownController.signal.aborted) {
      return finalizeKilled(runId, runSnapshot, activeStore, opts.persistence, opts.onRunEnd);
    }

    const recorded = activeStore.recordRunEnd(runId, "completed", result);
    opts.onRunEnd?.(runId, "completed", result);

    appendRunEndWhenRecorded(opts.persistence, recorded, {
      runId,
      status: "completed",
      result,
      ts: Date.now(),
    });

    return {
      runId,
      status: "completed",
      result,
      stages: [...runSnapshot.stages],
    };
  } catch (err) {
    if (ownController.signal.aborted) {
      return finalizeKilled(runId, runSnapshot, activeStore, opts.persistence, opts.onRunEnd);
    }

    const errorMessage = err instanceof Error ? err.message : String(err);

    const recorded = activeStore.recordRunEnd(runId, "failed", undefined, errorMessage);
    opts.onRunEnd?.(runId, "failed", undefined, errorMessage);

    appendRunEndWhenRecorded(opts.persistence, recorded, {
      runId,
      status: "failed",
      ts: Date.now(),
    });

    return {
      runId,
      status: "failed",
      error: errorMessage,
      stages: [...runSnapshot.stages],
    };
  } finally {
    opts.cancellation?.unregister(runId);
  }
}
