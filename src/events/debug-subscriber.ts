/**
 * Debug Event Subscriber with JSONL File Logging
 *
 * Provides file-based JSONL event logging with automatic rotation,
 * modeled after OpenCode's packages/opencode/src/util/log.ts pattern.
 *
 * Features:
 * - JSONL format (one JSON object per event per line)
 * - Automatic log rotation (retains 10 most recent files)
 * - Event replay from persisted log files
 * - Console.debug retained for real-time visibility
 * - Activated by DEBUG=1
 *
 * Usage:
 * ```typescript
 * const bus = new EventBus();
 * const { unsubscribe, logPath } = await attachDebugSubscriber(bus);
 *
 * // Events are now logged to JSONL files at ~/.local/share/atomic/log/events/
 *
 * unsubscribe(); // Stop logging and close file
 * ```
 */

import { join } from "path";
import { homedir } from "os";
import { mkdir, unlink } from "fs/promises";
import type { EventBus } from "./event-bus.ts";
import type { InternalBusError } from "./event-bus.ts";
import type { BusEvent } from "./bus-events.ts";

const DEFAULT_LOG_DIR = join(homedir(), ".local", "share", "atomic", "log", "events");
const MAX_LOG_FILES = 10;
const DEBUG_ENV = "DEBUG";
const LOG_DIR_ENV = "LOG_DIR";
const LEGACY_STREAM_DEBUG_LOG_ENV = "ATOMIC_STREAM_DEBUG_LOG";
const LEGACY_STREAM_DEBUG_LOG_DIR_ENV = "ATOMIC_STREAM_DEBUG_LOG_DIR";
const LEGACY_DEBUG_ENV = "ATOMIC_DEBUG";

function isTruthyEnvValue(value: string): boolean {
  return value === "1" || value === "true" || value === "on";
}

function isFalsyEnvValue(value: string): boolean {
  return value === "0" || value === "false" || value === "off";
}

export interface StreamDebugLogConfig {
  enabled: boolean;
  logDir?: string;
  consolePreviewEnabled: boolean;
}

export function resolveStreamDebugLogConfig(
  env: NodeJS.ProcessEnv = process.env,
): StreamDebugLogConfig {
  const rawDebugValue = env[DEBUG_ENV]?.trim();
  const normalizedDebugValue = rawDebugValue?.toLowerCase();
  const legacyRawDebugValue = env[LEGACY_STREAM_DEBUG_LOG_ENV]?.trim();
  const legacyNormalizedDebugValue = legacyRawDebugValue?.toLowerCase();
  const explicitDir =
    env[LOG_DIR_ENV]?.trim() ?? env[LEGACY_STREAM_DEBUG_LOG_DIR_ENV]?.trim();
  const legacyDebugEnabled = env[LEGACY_DEBUG_ENV] === "1";

  if (normalizedDebugValue) {
    if (isFalsyEnvValue(normalizedDebugValue)) {
      return {
        enabled: false,
        consolePreviewEnabled: false,
      };
    }

    return {
      enabled: true,
      ...(explicitDir ? { logDir: explicitDir } : {}),
      consolePreviewEnabled: true,
    };
  }

  if (!legacyNormalizedDebugValue) {
    return {
      enabled: legacyDebugEnabled,
      ...(explicitDir ? { logDir: explicitDir } : {}),
      consolePreviewEnabled: legacyDebugEnabled,
    };
  }

  if (isFalsyEnvValue(legacyNormalizedDebugValue)) {
    return {
      enabled: false,
      consolePreviewEnabled: false,
    };
  }

  if (isTruthyEnvValue(legacyNormalizedDebugValue)) {
    return {
      enabled: true,
      ...(explicitDir ? { logDir: explicitDir } : {}),
      consolePreviewEnabled: legacyDebugEnabled,
    };
  }

  return {
    enabled: true,
    logDir: explicitDir ?? legacyRawDebugValue,
    consolePreviewEnabled: legacyDebugEnabled,
  };
}

/** JSONL log entry format — one per line in the log file */
export interface EventLogEntry {
  seq?: number;
  runSeq?: number;
  ts: string;
  loggedAt?: string;
  type: string;
  sessionId: string;
  runId: number;
  eventLagMs?: number;
  globalGapMs?: number | null;
  sessionRunGapMs?: number | null;
  continuityGapMs?: number;
  eventTimestampRegressionMs?: number;
  streamGapMs?: number | null;
  runAgeMs?: number;
  runDurationMs?: number;
  streamEventCount?: number;
  textDeltaCount?: number;
  thinkingDeltaCount?: number;
  toolStartCount?: number;
  toolCompleteCount?: number;
  pendingToolCalls?: number;
  maxPendingToolCalls?: number;
  lifecycleMarkers?: string[];
  payloadBytes?: number;
  /** Aggregate sub-agent tree state (present on agent lifecycle events) */
  agentTreeSnapshot?: AgentTreeSnapshot;
  data: unknown;
}

/**
 * Snapshot of all tracked sub-agents at a point in time.
 * Attached to agent lifecycle events (stream.agent.start/update/complete)
 * so that the debug log captures the full tree context.
 */
export interface AgentTreeSnapshot {
  agents: AgentTreeEntry[];
  totalCount: number;
  runningCount: number;
  completedCount: number;
  errorCount: number;
}

export interface AgentTreeEntry {
  agentId: string;
  agentType: string;
  task: string;
  status: "running" | "completed" | "error";
  isBackground: boolean;
  startedAt: string;
  toolUses?: number;
  currentTool?: string;
  error?: string;
  durationMs?: number;
}

/**
 * Error/metadata log entry written for internal bus errors,
 * process-level errors, and startup metadata.
 * Shares the same JSONL file but uses a different shape.
 */
export interface DiagnosticLogEntry {
  seq: number;
  ts: string;
  category: "bus_error" | "process_error" | "startup";
  kind?: string;
  eventType?: string;
  error?: string;
  stack?: string;
  agentTreeSnapshot?: AgentTreeSnapshot;
  data?: unknown;
}

const STREAM_CONTINUITY_GAP_THRESHOLD_MS = 1500;

interface SessionRunDebugState {
  firstSeenLoggedAtMs: number;
  firstStreamLoggedAtMs: number | null;
  firstTextDeltaLoggedAtMs: number | null;
  lastStreamLoggedAtMs: number | null;
  streamEventCount: number;
  textDeltaCount: number;
  thinkingDeltaCount: number;
  toolStartCount: number;
  toolCompleteCount: number;
  pendingToolCalls: number;
  maxPendingToolCalls: number;
  sawSessionStart: boolean;
  sawSessionIdle: boolean;
  sawSessionError: boolean;
}

function buildSessionRunKey(event: BusEvent): string {
  return `${event.sessionId}::${event.runId}`;
}

function isStreamEventType(type: string): boolean {
  return type.startsWith("stream.");
}

function isSessionStartEventType(type: string): boolean {
  return type === "stream.session.start";
}

function isSessionIdleEventType(type: string): boolean {
  return type === "stream.session.idle" || type === "session.idle";
}

function isSessionErrorEventType(type: string): boolean {
  return type === "stream.session.error" || type === "session.error";
}

function createSessionRunDebugState(loggedAtMs: number): SessionRunDebugState {
  return {
    firstSeenLoggedAtMs: loggedAtMs,
    firstStreamLoggedAtMs: null,
    firstTextDeltaLoggedAtMs: null,
    lastStreamLoggedAtMs: null,
    streamEventCount: 0,
    textDeltaCount: 0,
    thinkingDeltaCount: 0,
    toolStartCount: 0,
    toolCompleteCount: 0,
    pendingToolCalls: 0,
    maxPendingToolCalls: 0,
    sawSessionStart: false,
    sawSessionIdle: false,
    sawSessionError: false,
  };
}

/**
 * Clean up old event log files, retaining the most recent MAX_LOG_FILES.
 * Mirrors OpenCode's cleanup() in packages/opencode/src/util/log.ts.
 */
export async function cleanup(dir: string): Promise<void> {
  const glob = new Bun.Glob("????-??-??T??????.events.jsonl");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: dir, absolute: true })) {
    files.push(file);
  }
  files.sort();
  if (files.length <= MAX_LOG_FILES) return;
  const filesToDelete = files.slice(0, files.length - MAX_LOG_FILES);
  await Promise.all(
    filesToDelete.map((file) => unlink(file).catch(() => {})),
  );
}

/**
 * Initialize the event log file writer.
 * Mirrors OpenCode's Log.init() in packages/opencode/src/util/log.ts.
 */
export async function initEventLog(options?: {
  logDir?: string;
}): Promise<{
  write: (event: BusEvent) => void;
  writeDiagnostic: (entry: Omit<DiagnosticLogEntry, "seq" | "ts">) => void;
  getAgentTreeSnapshot: () => AgentTreeSnapshot;
  close: () => Promise<void>;
  logPath: string;
}> {
  const logDir = options?.logDir ?? DEFAULT_LOG_DIR;
  await mkdir(logDir, { recursive: true });
  await cleanup(logDir);

  const filename =
    new Date().toISOString().split(".")[0]!.replace(/:/g, "") +
    ".events.jsonl";

  const logPath = join(logDir, filename);
  const logFile = Bun.file(logPath);
  const writer = logFile.writer();
  const textEncoder = new TextEncoder();
  let seq = 0;
  let previousLoggedAtMs: number | null = null;
  const previousLoggedAtBySessionRun = new Map<string, number>();
  const previousEventTimestampBySessionRun = new Map<string, number>();
  const runSeqBySessionRun = new Map<string, number>();
  const runStateBySessionRun = new Map<string, SessionRunDebugState>();

  // Agent tree state tracking
  const agentTreeState = new Map<string, AgentTreeEntry>();

  function updateAgentTree(event: BusEvent): void {
    const data = event.data as Record<string, unknown>;
    const agentId = data.agentId as string | undefined;
    if (!agentId) return;

    if (event.type === "stream.agent.start") {
      agentTreeState.set(agentId, {
        agentId,
        agentType: (data.agentType as string) ?? "unknown",
        task: (data.task as string) ?? "",
        status: "running",
        isBackground: (data.isBackground as boolean) ?? false,
        startedAt: new Date().toISOString(),
      });
    } else if (event.type === "stream.agent.update") {
      const existing = agentTreeState.get(agentId);
      if (existing) {
        if (data.currentTool !== undefined) existing.currentTool = data.currentTool as string;
        if (data.toolUses !== undefined) existing.toolUses = data.toolUses as number;
      }
    } else if (event.type === "stream.agent.complete") {
      const existing = agentTreeState.get(agentId);
      if (existing) {
        existing.status = (data.success as boolean) ? "completed" : "error";
        if (data.error) existing.error = data.error as string;
        existing.currentTool = undefined;
      }
    }
  }

  function buildAgentTreeSnapshot(): AgentTreeSnapshot {
    const agents = Array.from(agentTreeState.values());
    return {
      agents,
      totalCount: agents.length,
      runningCount: agents.filter(a => a.status === "running").length,
      completedCount: agents.filter(a => a.status === "completed").length,
      errorCount: agents.filter(a => a.status === "error").length,
    };
  }

  const isAgentLifecycleEvent = (type: string): boolean =>
    type === "stream.agent.start" ||
    type === "stream.agent.update" ||
    type === "stream.agent.complete";

  const write = (event: BusEvent): void => {
    const loggedAtMs = Date.now();
    const sessionRunKey = buildSessionRunKey(event);
    let runState = runStateBySessionRun.get(sessionRunKey);
    const isFirstRunEvent = !runState;
    if (!runState) {
      runState = createSessionRunDebugState(loggedAtMs);
      runStateBySessionRun.set(sessionRunKey, runState);
    }

    const lifecycleMarkers: string[] = [];
    if (isFirstRunEvent) {
      lifecycleMarkers.push("run-first-seen");
    }

    const isStreamEvent = isStreamEventType(event.type);
    const previousStreamLoggedAtMs = runState.lastStreamLoggedAtMs;
    const streamGapMs = isStreamEvent
      ? (previousStreamLoggedAtMs === null
          ? null
          : Math.max(0, loggedAtMs - previousStreamLoggedAtMs))
      : null;

    if (isSessionStartEventType(event.type)) {
      runState.sawSessionStart = true;
      lifecycleMarkers.push("session-start");
    }

    if (isStreamEvent) {
      runState.streamEventCount += 1;
      runState.lastStreamLoggedAtMs = loggedAtMs;
      if (runState.firstStreamLoggedAtMs === null) {
        runState.firstStreamLoggedAtMs = loggedAtMs;
        lifecycleMarkers.push("first-stream-event");
      }
    }

    if (event.type === "stream.text.delta") {
      runState.textDeltaCount += 1;
      if (runState.firstTextDeltaLoggedAtMs === null) {
        runState.firstTextDeltaLoggedAtMs = loggedAtMs;
        lifecycleMarkers.push("first-text-delta");
      }
    }

    if (event.type === "stream.thinking.delta") {
      runState.thinkingDeltaCount += 1;
    }

    if (event.type === "stream.tool.start") {
      runState.toolStartCount += 1;
      runState.pendingToolCalls += 1;
      runState.maxPendingToolCalls = Math.max(
        runState.maxPendingToolCalls,
        runState.pendingToolCalls,
      );
    }

    let toolCompleteWithoutStart = false;
    if (event.type === "stream.tool.complete") {
      runState.toolCompleteCount += 1;
      if (runState.pendingToolCalls === 0) {
        toolCompleteWithoutStart = true;
        lifecycleMarkers.push("tool-complete-without-start");
      } else {
        runState.pendingToolCalls = Math.max(0, runState.pendingToolCalls - 1);
      }
    }

    if (
      streamGapMs !== null
      && streamGapMs >= STREAM_CONTINUITY_GAP_THRESHOLD_MS
    ) {
      lifecycleMarkers.push("stream-gap");
    }

    if (isSessionIdleEventType(event.type)) {
      runState.sawSessionIdle = true;
      lifecycleMarkers.push("session-idle");
      if (runState.pendingToolCalls > 0) {
        lifecycleMarkers.push("idle-with-pending-tools");
      }
    }

    if (isSessionErrorEventType(event.type)) {
      runState.sawSessionError = true;
      lifecycleMarkers.push("session-error");
    }

    // Track agent tree state before building the entry
    updateAgentTree(event);

    const previousSessionLoggedAtMs = previousLoggedAtBySessionRun.get(sessionRunKey) ?? null;
    const previousSessionEventTimestampMs =
      previousEventTimestampBySessionRun.get(sessionRunKey) ?? null;
    const globalGapMs =
      previousLoggedAtMs === null ? null : Math.max(0, loggedAtMs - previousLoggedAtMs);
    const sessionRunGapMs =
      previousSessionLoggedAtMs === null ? null : Math.max(0, loggedAtMs - previousSessionLoggedAtMs);
    const eventTimestampRegressionMs =
      previousSessionEventTimestampMs !== null && event.timestamp < previousSessionEventTimestampMs
        ? previousSessionEventTimestampMs - event.timestamp
        : undefined;
    const continuityGapMs =
      sessionRunGapMs !== null
      && sessionRunGapMs >= STREAM_CONTINUITY_GAP_THRESHOLD_MS
      && event.type.startsWith("stream.")
        ? sessionRunGapMs
        : undefined;
    if (continuityGapMs !== undefined) {
      lifecycleMarkers.push("continuity-gap");
    }
    if (eventTimestampRegressionMs !== undefined) {
      lifecycleMarkers.push("timestamp-regression");
    }
    const nextRunSeq = (runSeqBySessionRun.get(sessionRunKey) ?? 0) + 1;
    runSeqBySessionRun.set(sessionRunKey, nextRunSeq);
    previousLoggedAtMs = loggedAtMs;
    previousLoggedAtBySessionRun.set(sessionRunKey, loggedAtMs);
    previousEventTimestampBySessionRun.set(sessionRunKey, event.timestamp);

    const payloadJson = JSON.stringify(event.data);
    const payloadBytes = textEncoder.encode(payloadJson).byteLength;
    const runAgeMs = Math.max(0, loggedAtMs - runState.firstSeenLoggedAtMs);
    const runDurationMs =
      runState.sawSessionIdle || runState.sawSessionError ? runAgeMs : undefined;

    if (toolCompleteWithoutStart) {
      runState.pendingToolCalls = 0;
    }

    // Include agent tree snapshot on agent lifecycle events and session errors
    const includeTreeSnapshot =
      isAgentLifecycleEvent(event.type) || isSessionErrorEventType(event.type);
    const treeSnapshot = includeTreeSnapshot ? buildAgentTreeSnapshot() : undefined;

    const entry: EventLogEntry = {
      seq: ++seq,
      runSeq: nextRunSeq,
      ts: new Date(event.timestamp).toISOString(),
      loggedAt: new Date(loggedAtMs).toISOString(),
      type: event.type,
      sessionId: event.sessionId,
      runId: event.runId,
      eventLagMs: loggedAtMs - event.timestamp,
      globalGapMs,
      sessionRunGapMs,
      ...(continuityGapMs !== undefined ? { continuityGapMs } : {}),
      ...(eventTimestampRegressionMs !== undefined ? { eventTimestampRegressionMs } : {}),
      streamGapMs,
      runAgeMs,
      ...(runDurationMs !== undefined ? { runDurationMs } : {}),
      streamEventCount: runState.streamEventCount,
      textDeltaCount: runState.textDeltaCount,
      thinkingDeltaCount: runState.thinkingDeltaCount,
      toolStartCount: runState.toolStartCount,
      toolCompleteCount: runState.toolCompleteCount,
      pendingToolCalls: runState.pendingToolCalls,
      maxPendingToolCalls: runState.maxPendingToolCalls,
      ...(lifecycleMarkers.length > 0 ? { lifecycleMarkers } : {}),
      payloadBytes,
      ...(treeSnapshot ? { agentTreeSnapshot: treeSnapshot } : {}),
      data: event.data,
    };
    writer.write(JSON.stringify(entry) + "\n");
    writer.flush();
  };

  const writeDiagnostic = (partial: Omit<DiagnosticLogEntry, "seq" | "ts">): void => {
    const entry: DiagnosticLogEntry = {
      seq: ++seq,
      ts: new Date().toISOString(),
      ...partial,
      agentTreeSnapshot: partial.agentTreeSnapshot ?? buildAgentTreeSnapshot(),
    };
    writer.write(JSON.stringify(entry) + "\n");
    writer.flush();
  };

  const getAgentTreeSnapshot = (): AgentTreeSnapshot => buildAgentTreeSnapshot();

  const close = async (): Promise<void> => {
    const result = writer.end();
    // Bun's writer.end() can return either number (sync) or Promise<number> (async)
    // We must await if it's a Promise to ensure all data is flushed
    if (result instanceof Promise) {
      await result;
    }
  };

  return { write, writeDiagnostic, getAgentTreeSnapshot, close, logPath };
}

/**
 * Read and parse events from a JSONL event log file.
 * Replaces the in-memory EventReplayBuffer with file-based replay.
 */
export async function readEventLog(
  logPath: string,
  filter?: (entry: EventLogEntry) => boolean,
): Promise<EventLogEntry[]> {
  const file = Bun.file(logPath);
  const exists = await file.exists();
  if (!exists) return [];
  const content = await file.text();
  const entries = content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EventLogEntry);
  return filter ? entries.filter(filter) : entries;
}

/**
 * List all available event log files, most recent first.
 */
export async function listEventLogs(dir: string = DEFAULT_LOG_DIR): Promise<string[]> {
  const glob = new Bun.Glob("????-??-??T??????.events.jsonl");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: dir, absolute: true })) {
    files.push(file);
  }
  files.sort();
  return files.reverse();
}

/**
 * Attach a file-based debug subscriber to the event bus.
 * When stream debug logging is enabled, all events are written to a JSONL log file
 * with automatic rotation (10 most recent files retained).
 *
 * Also retains console.debug logging for real-time visibility.
 *
 * @param bus - The event bus to attach the debug subscriber to
 * @returns Promise with unsubscribe function and log file path
 */
export async function attachDebugSubscriber(bus: EventBus): Promise<{
  unsubscribe: () => Promise<void>;
  logPath: string | null;
}> {
  const debugConfig = resolveStreamDebugLogConfig();
  if (!debugConfig.enabled) {
    return { unsubscribe: async () => {}, logPath: null };
  }

  const { write, writeDiagnostic, close, logPath } = await initEventLog({
    logDir: debugConfig.logDir,
  });

  // Write startup metadata as the first entry
  writeDiagnostic({
    category: "startup",
    data: {
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      bunVersion: typeof Bun !== "undefined" ? Bun.version : undefined,
      cwd: process.cwd(),
      debugConfig,
      env: {
        DEBUG: process.env.DEBUG,
        ATOMIC_DEBUG: process.env.ATOMIC_DEBUG,
        ATOMIC_STREAM_DEBUG_LOG: process.env.ATOMIC_STREAM_DEBUG_LOG,
        NODE_ENV: process.env.NODE_ENV,
      },
      argv: process.argv,
      memoryUsage: process.memoryUsage(),
    },
  });

  const unsubBus = bus.onAll((event: BusEvent) => {
    write(event);
    if (debugConfig.consolePreviewEnabled) {
      const preview = JSON.stringify(event.data).slice(0, 100);
      console.debug(
        `[EventBus] ${event.type} run=${event.runId} ${preview}`,
      );
    }
  });

  // Capture internal bus errors (schema drops, handler failures)
  const unsubInternalError = bus.onInternalError((busError) => {
    writeDiagnostic({
      category: "bus_error",
      error: busError.error instanceof Error ? busError.error.message : String(busError.error),
      stack: busError.error instanceof Error ? busError.error.stack : undefined,
      data: {
        kind: busError.kind,
        eventType: busError.eventType,
        eventData: busError.eventData,
      },
    });
  });

  // Capture process-level errors
  const onUncaughtException = (error: Error): void => {
    writeDiagnostic({
      category: "process_error",
      error: error.message,
      stack: error.stack,
      data: { kind: "uncaughtException", name: error.name },
    });
  };

  const onUnhandledRejection = (reason: unknown): void => {
    writeDiagnostic({
      category: "process_error",
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      data: { kind: "unhandledRejection" },
    });
  };

  process.on("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);

  const unsubscribe = async (): Promise<void> => {
    unsubBus();
    unsubInternalError();
    process.removeListener("uncaughtException", onUncaughtException);
    process.removeListener("unhandledRejection", onUnhandledRejection);
    await close();
  };

  return { unsubscribe, logPath };
}
