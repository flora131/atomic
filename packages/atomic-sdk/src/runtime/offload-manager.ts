/**
 * OffloadManager — workflow pane offload & resume state machine.
 * Spec: specs/2026-05-08-workflow-pane-offload-and-resume.md §5.2
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { OffloadResumeMetadata, MetadataJsonWithResume, AgentKind } from "./offload-types.ts";
import type { SessionData } from "../components/orchestrator-panel-types.ts";

// Telemetry event-name constants — kept in sync with
// packages/atomic/src/lib/telemetry/offload-events.ts (avoids cross-package dep).
const WORKFLOW_OFFLOAD_SCHEDULED = "workflow.offload.scheduled" as const;
const WORKFLOW_OFFLOAD_COMPLETED = "workflow.offload.completed" as const;
const WORKFLOW_OFFLOAD_RESUME_ATTEMPTED = "workflow.offload.resume.attempted" as const;
const WORKFLOW_OFFLOAD_RESUME_SUCCEEDED = "workflow.offload.resume.succeeded" as const;
const WORKFLOW_OFFLOAD_RESUME_FAILED = "workflow.offload.resume.failed" as const;

// ─── persistResume ──────────────────────────────────────────────────────────

/**
 * Per-stageDir mutex map.  Each entry holds the tail of the promise chain
 * for that stage; a new call appends onto the tail so concurrent writers
 * for the same stage serialize.
 */
const _stageMutex = new Map<string, Promise<void>>();

/** Defaults applied when the metadata has no `resume` block yet. */
const _resumeDefaults: Omit<OffloadResumeMetadata, "schemaVersion"> = {
  agentSessionId: "",
  tmuxSessionName: "",
  tmuxWindowName: "",
  spawnEnv: {},
  spawnCwd: "",
  lastPrompt: "",
  lastSeenAt: 0,
  offloadedAt: null,
};

/**
 * True iff `value` is a v1 `OffloadResumeMetadata` plain object.
 * Used by both `_doPersist` (to gate writes) and `doResume` (to gate spawn).
 */
function isValidResumeBlock(value: unknown): value is OffloadResumeMetadata {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1
  );
}

/**
 * Atomically read-modify-write the `resume` sub-object of
 * `${stageDir}/metadata.json` under a per-stageDir in-process mutex.
 *
 * Guarantees:
 * - Concurrent calls for the same `stageDir` are serialized.
 * - Top-level immutable fields (`name`, `description`, `agent`, `paneId`,
 *   `serverUrl`, `port`, `startedAt`) are written back verbatim.
 * - `patch` fields always win; other existing `resume` fields are retained.
 * - File is written atomically via a `.tmp` rename and mode 0o600.
 *
 * @throws Error("metadata.json not found at <path>") if the file is missing.
 * @throws Error("unsupported resume schemaVersion: <n>") if existing
 *   `resume.schemaVersion` is not 1.
 */
export async function persistResume(
  stageDir: string,
  patch: Partial<OffloadResumeMetadata>,
): Promise<void> {
  const metaPath = join(stageDir, "metadata.json");

  // Mutex-order writes via tail-chaining. Isolate each link from the previous
  // link's outcome so a queued caller's failure doesn't poison the chain.
  const prev = _stageMutex.get(stageDir) ?? Promise.resolve();
  const next: Promise<void> = prev
    .catch(() => undefined)
    .then(() => _doPersist(metaPath, patch));

  // Register the new tail synchronously so callers arriving after this point
  // append correctly.
  _stageMutex.set(stageDir, next);

  // Drop the map entry once this link settles. `.catch(() => {})` silences the
  // unhandled-rejection warning on the floating finally promise — the caller
  // observes the rejection via the returned `next`.
  next.finally(() => {
    if (_stageMutex.get(stageDir) === next) _stageMutex.delete(stageDir);
  }).catch(() => {});

  return next;
}

async function _doPersist(
  metaPath: string,
  patch: Partial<OffloadResumeMetadata>,
): Promise<void> {
  // Read
  let raw: string;
  try {
    raw = await fs.readFile(metaPath, "utf8");
  } catch {
    throw new Error(`metadata.json not found at ${metaPath}`);
  }

  const existing = JSON.parse(raw) as MetadataJsonWithResume;

  // The `resume` slot must be either absent or a v1 plain object. Anything
  // else (null, primitive, array, foreign schemaVersion) is a schema mismatch.
  if (existing.resume !== undefined && !isValidResumeBlock(existing.resume)) {
    const r = existing.resume as unknown;
    const reported =
      r !== null && typeof r === "object" && !Array.isArray(r)
        ? (r as { schemaVersion?: unknown }).schemaVersion
        : r;
    throw new Error(`unsupported resume schemaVersion: ${reported}`);
  }

  // Merge precedence: defaults < existing.resume < patch; schemaVersion
  // always pinned to 1. Spreading `undefined` is a JS no-op.
  const nextResume: OffloadResumeMetadata = {
    ..._resumeDefaults,
    ...existing.resume,
    ...patch,
    schemaVersion: 1,
  };

  // Top-level fields (immutable per write-once contract) are echoed verbatim;
  // only `resume` mutates.
  const nextMeta: MetadataJsonWithResume = {
    name: existing.name,
    description: existing.description,
    agent: existing.agent,
    paneId: existing.paneId,
    serverUrl: existing.serverUrl,
    port: existing.port,
    startedAt: existing.startedAt,
    resume: nextResume,
  };

  // Atomic write: 0o600 tmp file + rename over the destination.
  const tmpPath = `${metaPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(nextMeta, null, 2), {
    mode: 0o600,
    encoding: "utf8",
  });
  await fs.rename(tmpPath, metaPath);
}

// ─── Public interfaces ──────────────────────────────────────────────────────

export interface OffloadManager {
  registerSession(input: {
    name: string;
    runId: string;
    stageDir: string;
    agent: AgentKind;
    agentSessionId: string;
    tmuxSession: string;
    tmuxWindow: string;
    spawnEnv: Record<string, string>;
    spawnCwd: string;
    headless: boolean;
  }): void;
  onWorkflowCompletion(): Promise<void>;
  requestResume(name: string): Promise<void>;
  getStatus(name: string): "alive" | "offloaded" | "resuming";
}

export interface OffloadManagerDeps {
  panelStore: {
    /** Live array reference — caller must not mutate. */
    readonly sessions: readonly SessionData[];
    /** Empty-string sentinel for "no agent attached" — never null. */
    readonly activeAgentId: string;
    setSessionStatus(name: string, status: SessionData["status"]): void;
  };
  tmux: {
    killWindow(session: string, window: string): Promise<void>;
    createWindow(session: string, name: string, cwd: string): Promise<void>;
    sendKeys(session: string, window: string, keys: string[]): Promise<void>;
    selectWindow(session: string, window: string): Promise<void>;
  };
  providers: {
    claude: {
      buildResumeArgs(
        meta: Pick<OffloadResumeMetadata, "agentSessionId">,
        hookSettingsPath: string,
      ): string[];
    };
    opencode: { buildResumeArgs(meta: Pick<OffloadResumeMetadata, "agentSessionId">): string[] };
    copilot: { buildResumeArgs(meta: Pick<OffloadResumeMetadata, "agentSessionId">): string[] };
  };
  /** Resolve Claude hook-settings path lazily; only called on Claude resume. */
  hookSettingsPath(): string;
  now(): number;
  /** Telemetry sink — `event` is one of WORKFLOW_OFFLOAD_* constants. */
  emit(event: string, payload: Record<string, unknown>): void;
}

// ─── Internal state ─────────────────────────────────────────────────────────

type SessionState = "alive" | "offloaded" | "resuming";

interface RegisteredSession {
  name: string;
  runId: string;
  stageDir: string;
  agent: AgentKind;
  agentSessionId: string;
  tmuxSession: string;
  tmuxWindow: string;
  spawnEnv: Record<string, string>;
  spawnCwd: string;
  headless: boolean;
  state: SessionState;
}

// ─── Idempotency primitive ──────────────────────────────────────────────────

const _moduleOpQueue = new Map<string, Promise<void>>();

/**
 * Idempotency primitive: if an operation is already running for `name`,
 * return the same Promise.  Otherwise start a new one, register it, and
 * clear it from the map when it settles (success or failure).
 *
 * Exported as `_testOnlyGetOrStartOp` for unit testing only.
 * Production callers use the instance-level wrapper returned by createOffloadManager.
 */
export function _testOnlyGetOrStartOp(
  name: string,
  op: () => Promise<void>,
  queue: Map<string, Promise<void>> = _moduleOpQueue,
): Promise<void> {
  const existing = queue.get(name);
  if (existing !== undefined) return existing;

  const promise = op().finally(() => {
    if (queue.get(name) === promise) {
      queue.delete(name);
    }
  });
  queue.set(name, promise);
  return promise;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createOffloadManager(deps: OffloadManagerDeps): OffloadManager {
  const sessions = new Map<string, RegisteredSession>();
  // Per-pane operation queue scoped to this manager so concurrent test
  // instances do not share state.
  const opQueue = new Map<string, Promise<void>>();

  function getOrStartOp(name: string, op: () => Promise<void>): Promise<void> {
    return _testOnlyGetOrStartOp(name, op, opQueue);
  }

  /** Offload a single registered session. */
  async function killOnePane(sess: RegisteredSession): Promise<void> {
    await persistResume(sess.stageDir, { offloadedAt: deps.now() });
    await deps.tmux.killWindow(sess.tmuxSession, sess.tmuxWindow);
    deps.panelStore.setSessionStatus(sess.name, "offloaded");
    sess.state = "offloaded";
    deps.emit(WORKFLOW_OFFLOAD_COMPLETED, {
      runId: sess.runId,
      name: sess.name,
      agent: sess.agent,
    });
  }

  /** True iff `sess` is eligible for offload right now. */
  function isEligibleForOffload(sess: RegisteredSession): boolean {
    if (sess.headless) return false;
    const { activeAgentId } = deps.panelStore;
    if (activeAgentId !== "" && activeAgentId === sess.name) return false;
    const panelEntry = deps.panelStore.sessions.find((s) => s.name === sess.name);
    return panelEntry?.status === "complete";
  }

  /** Re-spawn an offloaded session. */
  async function doResume(sess: RegisteredSession): Promise<void> {
    const baseEvent = { runId: sess.runId, name: sess.name, agent: sess.agent };
    sess.state = "resuming";
    deps.panelStore.setSessionStatus(sess.name, "resuming");
    deps.emit(WORKFLOW_OFFLOAD_RESUME_ATTEMPTED, baseEvent);

    try {
      // Read + validate metadata.
      const metaPath = join(sess.stageDir, "metadata.json");
      const parsed = JSON.parse(await fs.readFile(metaPath, "utf8")) as MetadataJsonWithResume;
      if (!isValidResumeBlock(parsed.resume)) {
        throw new Error("SCHEMA_MISMATCH");
      }
      const meta: Pick<OffloadResumeMetadata, "agentSessionId"> = {
        agentSessionId: parsed.resume.agentSessionId,
      };

      // Build argv per agent.
      let argv: string[];
      let binary: string;
      switch (sess.agent) {
        case "claude":
          argv = deps.providers.claude.buildResumeArgs(meta, deps.hookSettingsPath());
          binary = "claude";
          break;
        case "opencode":
          argv = deps.providers.opencode.buildResumeArgs(meta);
          binary = "opencode";
          break;
        case "copilot":
          argv = deps.providers.copilot.buildResumeArgs(meta);
          binary = "copilot";
          break;
        default:
          throw new Error(`unsupported agent kind: ${sess.agent as string}`);
      }

      // Recreate the tmux window, send the resume command, and switch focus.
      // TODO(spec §5.2.4 step 2.e): poll a per-agent readiness signal before
      // selectWindow. Deferred — introduces per-provider I/O deps out of scope.
      await deps.tmux.createWindow(sess.tmuxSession, sess.tmuxWindow, sess.spawnCwd);
      await deps.tmux.sendKeys(sess.tmuxSession, sess.tmuxWindow, [binary, ...argv, "Enter"]);
      await deps.tmux.selectWindow(sess.tmuxSession, sess.tmuxWindow);

      sess.state = "alive";
      deps.panelStore.setSessionStatus(sess.name, "complete");
      deps.emit(WORKFLOW_OFFLOAD_RESUME_SUCCEEDED, baseEvent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorCode = msg === "SCHEMA_MISMATCH" ? "SCHEMA_MISMATCH" : "RESUME_FAILED";

      // Best-effort error persistence — never mask the original failure.
      try {
        await persistResume(sess.stageDir, { error: msg });
      } catch {}

      sess.state = "offloaded";
      deps.panelStore.setSessionStatus(sess.name, "offloaded");
      deps.emit(WORKFLOW_OFFLOAD_RESUME_FAILED, { ...baseEvent, errorCode, error: msg });
      throw err;
    }
  }

  return {
    registerSession(input) {
      sessions.set(input.name, {
        ...input,
        state: "alive",
      });
    },

    getStatus(name) {
      return sessions.get(name)?.state ?? "alive";
    },

    async onWorkflowCompletion(): Promise<void> {
      const eligible = Array.from(sessions.values()).filter(isEligibleForOffload);

      deps.emit(WORKFLOW_OFFLOAD_SCHEDULED, {
        runId: eligible[0]?.runId ?? "",
        count: eligible.length,
      });

      await Promise.all(
        eligible.map((sess) => getOrStartOp(sess.name, () => killOnePane(sess))),
      );
    },

    async requestResume(name: string): Promise<void> {
      const sess = sessions.get(name);
      if (!sess || sess.state === "alive") return;
      // "offloaded" → start resume; "resuming" → coalesce onto in-flight op.
      const op = sess.state === "offloaded" ? () => doResume(sess) : () => Promise.resolve();
      return getOrStartOp(name, op);
    },
  };
}
