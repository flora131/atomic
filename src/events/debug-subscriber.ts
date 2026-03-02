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
import { mkdir, readdir, rm } from "fs/promises";
import type { EventBus } from "./event-bus.ts";
import type { BusEvent } from "./bus-events.ts";

const DEFAULT_LOG_DIR = join(homedir(), ".local", "share", "atomic", "log", "events");
const MAX_LOG_SESSIONS = 10;
const DEBUG_ENV = "DEBUG";
const LOG_DIR_ENV = "LOG_DIR";
const LOG_SESSION_NAME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{6}$/;
const LOG_EVENTS_FILENAME = "events.jsonl";
const LOG_RAW_STREAM_FILENAME = "raw-stream.log";

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
  const explicitDir = env[LOG_DIR_ENV]?.trim();

  if (normalizedDebugValue && !isFalsyEnvValue(normalizedDebugValue)) {
    return {
      enabled: true,
      ...(explicitDir ? { logDir: explicitDir } : {}),
      consolePreviewEnabled: true,
    };
  }

  return {
    enabled: false,
    ...(explicitDir ? { logDir: explicitDir } : {}),
    consolePreviewEnabled: false,
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

export interface RawStreamLogEntry {
  seq: number;
  ts: string;
  sessionId?: string;
  runId?: number;
  component:
    | "prompt"
    | "status"
    | "thinking"
    | "assistant"
    | "tool"
    | "agent"
    | "diagnostic";
  text: string;
}

const STREAM_CONTINUITY_GAP_THRESHOLD_MS = 1500;

function buildLogSessionName(now: Date = new Date()): string {
  return now.toISOString().split(".")[0]!.replace(/:/g, "");
}

function formatRawDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function truncateRawText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}… (+${value.length - maxChars} chars truncated)`;
}

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
  rawStatusLogged: boolean;
  rawThinkingLogged: boolean;
  rawTextBuffer: string;
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
    rawStatusLogged: false,
    rawThinkingLogged: false,
    rawTextBuffer: "",
  };
}

async function listLogSessionDirectories(dir: string): Promise<string[]> {
  const sessionDirs: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!LOG_SESSION_NAME_REGEX.test(entry.name)) continue;
    sessionDirs.push(join(dir, entry.name));
  }
  sessionDirs.sort();
  return sessionDirs;
}

/**
 * Clean up old debug log sessions, retaining the most recent MAX_LOG_SESSIONS.
 */
export async function cleanup(dir: string): Promise<void> {
  const sessionDirs = await listLogSessionDirectories(dir);
  if (sessionDirs.length > MAX_LOG_SESSIONS) {
    const dirsToDelete = sessionDirs.slice(0, sessionDirs.length - MAX_LOG_SESSIONS);
    await Promise.all(
      dirsToDelete.map((sessionDir) =>
        rm(sessionDir, { recursive: true, force: true }).catch(() => {})),
    );
  }
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
  writeRawLine: (line: string, metadata?: { sessionId?: string; runId?: number; component?: RawStreamLogEntry["component"] }) => void;
  getAgentTreeSnapshot: () => AgentTreeSnapshot;
  close: () => Promise<void>;
  logPath: string;
  rawLogPath: string;
  logDirPath: string;
}> {
  const logDir = options?.logDir ?? DEFAULT_LOG_DIR;
  await mkdir(logDir, { recursive: true });
  await cleanup(logDir);

  const sessionName = buildLogSessionName();
  const logDirPath = join(logDir, sessionName);
  await mkdir(logDirPath, { recursive: true });

  const logPath = join(logDirPath, LOG_EVENTS_FILENAME);
  const rawLogPath = join(logDirPath, LOG_RAW_STREAM_FILENAME);
  const logFile = Bun.file(logPath);
  const writer = logFile.writer();
  const rawFile = Bun.file(rawLogPath);
  const rawWriter = rawFile.writer();
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

  const writeRawLine = (
    line: string,
    metadata?: { sessionId?: string; runId?: number; component?: RawStreamLogEntry["component"] },
  ): void => {
    void metadata;
    const normalizedLine = line.replace(/\r/g, "");
    if (!normalizedLine.trim()) return;
    rawWriter.write(`${normalizedLine}\n`);
    rawWriter.flush();
  };

  const writeRawLines = (
    lines: string[],
    metadata?: { sessionId?: string; runId?: number; component?: RawStreamLogEntry["component"] },
  ): void => {
    for (const line of lines) {
      writeRawLine(line, metadata);
    }
  };

  const flushRawTextBuffer = (event: BusEvent, runState: SessionRunDebugState): void => {
    const buffered = runState.rawTextBuffer.trim();
    if (buffered.length === 0) {
      runState.rawTextBuffer = "";
      return;
    }
    writeRawLine(buffered, {
      sessionId: event.sessionId,
      runId: event.runId,
      component: "assistant",
    });
    runState.rawTextBuffer = "";
  };

  const formatTaskToolLines = (toolInput: Record<string, unknown>): string[] => {
    const lines: string[] = [];
    const task = String(toolInput.description ?? "").trim();
    const prompt = String(toolInput.prompt ?? "").trim();
    const agent = String(
      toolInput.agent_type ?? toolInput.subagent_type ?? toolInput.agent ?? "",
    ).trim();
    const title = [agent, task].filter(Boolean).join(": ") || "Sub-agent task";
    lines.push(`task ${truncateRawText(title, 180)}`);
    if (agent) lines.push(`Agent: ${truncateRawText(agent, 160)}`);
    if (task) lines.push(`Task: ${truncateRawText(task, 160)}`);
    if (prompt) lines.push(`Prompt: ${truncateRawText(prompt, 160)}`);
    return lines;
  };

  const formatToolStartLines = (
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string[] => {
    const normalizedName = toolName.toLowerCase();
    if (
      normalizedName === "task"
      || normalizedName === "launch_agent"
      || normalizedName === "launch-agent"
    ) {
      return ["◉", ...formatTaskToolLines(toolInput)];
    }

    const lines: string[] = [`◉ ${toolName}`];
    const summaryParts = Object.entries(toolInput)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${truncateRawText(String(value), 80)}`);
    if (summaryParts.length > 0) {
      lines.push(summaryParts.join(", "));
    }
    return lines;
  };

  const writeRawForEvent = (
    event: BusEvent,
    runState: SessionRunDebugState,
    loggedAtMs: number,
  ): void => {
    if (!runState.rawStatusLogged && event.type.startsWith("stream.")) {
      runState.rawStatusLogged = true;
      writeRawLine("⣯ Composing…", {
        sessionId: event.sessionId,
        runId: event.runId,
        component: "status",
      });
    }

    if (event.type === "stream.thinking.delta" && !runState.rawThinkingLogged) {
      runState.rawThinkingLogged = true;
      writeRawLine("∴ Thinking...", {
        sessionId: event.sessionId,
        runId: event.runId,
        component: "thinking",
      });
      return;
    }

    if (event.type === "stream.text.delta") {
      const delta = String((event.data as Record<string, unknown>).delta ?? "");
      if (delta.length === 0) return;
      runState.rawTextBuffer += delta;
      const newlineChunks = runState.rawTextBuffer.split("\n");
      if (newlineChunks.length <= 1) return;
      const completeLines = newlineChunks.slice(0, -1).map((line) => line.trim()).filter(Boolean);
      runState.rawTextBuffer = newlineChunks.at(-1) ?? "";
      writeRawLines(completeLines, {
        sessionId: event.sessionId,
        runId: event.runId,
        component: "assistant",
      });
      return;
    }

    if (event.type === "stream.tool.start") {
      flushRawTextBuffer(event, runState);
      const data = event.data as Record<string, unknown>;
      const toolName = String(data.toolName ?? "tool");
      const toolInput = (data.toolInput as Record<string, unknown> | undefined) ?? {};
      writeRawLines(formatToolStartLines(toolName, toolInput), {
        sessionId: event.sessionId,
        runId: event.runId,
        component: "tool",
      });
      return;
    }

    if (event.type === "stream.agent.start") {
      const data = event.data as Record<string, unknown>;
      const agentType = String(data.agentType ?? "agent");
      const task = String(data.task ?? "sub-agent task");
      writeRawLine(`● ${agentType}: ${truncateRawText(task, 160)}`, {
        sessionId: event.sessionId,
        runId: event.runId,
        component: "agent",
      });
      return;
    }

    if (event.type === "stream.session.idle" || event.type === "stream.session.error") {
      flushRawTextBuffer(event, runState);
      const runAgeMs = Math.max(0, loggedAtMs - runState.firstSeenLoggedAtMs);
      writeRawLine(`⣯ Composing… (${formatRawDuration(runAgeMs)})`, {
        sessionId: event.sessionId,
        runId: event.runId,
        component: "status",
      });
    }
  };

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
    writeRawForEvent(event, runState, loggedAtMs);
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
    const diagnosticMessage =
      partial.error
        ? `[${partial.category}] ${partial.error}`
        : `[${partial.category}]`;
    writeRawLine(diagnosticMessage, { component: "diagnostic" });
  };

  const getAgentTreeSnapshot = (): AgentTreeSnapshot => buildAgentTreeSnapshot();

  const close = async (): Promise<void> => {
    const eventWriterResult = writer.end();
    const rawWriterResult = rawWriter.end();
    // Bun's writer.end() can return either number (sync) or Promise<number> (async)
    // We must await when it is a Promise to ensure all data is flushed.
    if (eventWriterResult instanceof Promise) {
      await eventWriterResult;
    }
    if (rawWriterResult instanceof Promise) {
      await rawWriterResult;
    }
  };

  return {
    write,
    writeDiagnostic,
    writeRawLine,
    getAgentTreeSnapshot,
    close,
    logPath,
    rawLogPath,
    logDirPath,
  };
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
 * Read raw UI stream log lines.
 */
export async function readRawStreamLog(rawLogPath: string): Promise<string[]> {
  const file = Bun.file(rawLogPath);
  const exists = await file.exists();
  if (!exists) return [];
  const content = await file.text();
  if (!content.trim()) return [];
  return content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

/**
 * List all available event log files, most recent first.
 */
export async function listEventLogs(dir: string = DEFAULT_LOG_DIR): Promise<string[]> {
  const sessionDirs = await listLogSessionDirectories(dir);
  const sessionEventLogs = sessionDirs
    .map((sessionDir) => join(sessionDir, LOG_EVENTS_FILENAME));

  sessionEventLogs.sort();
  return sessionEventLogs.reverse();
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
  rawLogPath: string | null;
  logDirPath: string | null;
  writeRawLine: (line: string, metadata?: { sessionId?: string; runId?: number; component?: RawStreamLogEntry["component"] }) => void;
}> {
  const debugConfig = resolveStreamDebugLogConfig();
  if (!debugConfig.enabled) {
    return {
      unsubscribe: async () => {},
      logPath: null,
      rawLogPath: null,
      logDirPath: null,
      writeRawLine: () => {},
    };
  }

  const {
    write,
    writeDiagnostic,
    writeRawLine,
    close,
    logPath,
    rawLogPath,
    logDirPath,
  } = await initEventLog({
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
        LOG_DIR: process.env.LOG_DIR,
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

  return { unsubscribe, logPath, rawLogPath, logDirPath, writeRawLine };
}
