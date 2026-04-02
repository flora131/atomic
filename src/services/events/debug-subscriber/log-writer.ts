import { join } from "path";
import { ensureDir } from "@/services/system/copy.ts";
import type { BusEvent } from "@/services/events/bus-events/index.ts";
import {
  buildLogSessionName,
  buildSessionRunKey,
  cleanup,
  createSessionRunDebugState,
  DEFAULT_LOG_DIR,
  formatRawDuration,
  isSessionErrorEventType,
  isSessionIdleEventType,
  isSessionStartEventType,
  isStreamEventType,
  LOG_EVENTS_FILENAME,
  LOG_RAW_STREAM_FILENAME,
  STREAM_CONTINUITY_GAP_THRESHOLD_MS,
  truncateRawText,
} from "./config.ts";
import { formatToolStartLines } from "./raw-formatters.ts";
import type {
  AgentTreeEntry,
  AgentTreeSnapshot,
  DiagnosticLogEntry,
  EventLogEntry,
  RawStreamLogEntry,
  SessionRunDebugState,
} from "./config.ts";

export async function initEventLog(options?: {
  logDir?: string;
  /** Reuse a pre-created session directory instead of generating a new one. */
  sessionDir?: string;
}): Promise<{
  write: (event: BusEvent) => void;
  writeDiagnostic: (entry: Omit<DiagnosticLogEntry, "seq" | "ts">) => void;
  writeRawLine: (
    line: string,
    metadata?: {
      sessionId?: string;
      runId?: number;
      component?: RawStreamLogEntry["component"];
    },
  ) => void;
  getAgentTreeSnapshot: () => AgentTreeSnapshot;
  close: () => Promise<void>;
  logPath: string;
  rawLogPath: string;
  logDirPath: string;
}> {
  const logDir = options?.logDir ?? DEFAULT_LOG_DIR;
  await ensureDir(logDir);
  await cleanup(logDir);

  // Reuse a pre-created session directory when provided (e.g. the dir was
  // created early in chatCommand so that SDK options builders like Copilot
  // OTel trace config can read it before the full subscriber is attached).
  const logDirPath = options?.sessionDir ?? join(logDir, buildLogSessionName());
  await ensureDir(logDirPath);

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
        if (data.currentTool !== undefined) {
          existing.currentTool = data.currentTool as string;
        }
        if (data.toolUses !== undefined) {
          existing.toolUses = data.toolUses as number;
        }
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
      runningCount: agents.filter((agent) => agent.status === "running").length,
      completedCount: agents.filter((agent) => agent.status === "completed")
        .length,
      errorCount: agents.filter((agent) => agent.status === "error").length,
    };
  }

  const isAgentLifecycleEvent = (type: string): boolean =>
    type === "stream.agent.start" ||
    type === "stream.agent.update" ||
    type === "stream.agent.complete";

  const writeRawLine = (
    line: string,
    metadata?: {
      sessionId?: string;
      runId?: number;
      component?: RawStreamLogEntry["component"];
    },
  ): void => {
    void metadata;
    const normalizedLine = line.replace(/\r/g, "");
    if (!normalizedLine.trim()) return;
    rawWriter.write(`${normalizedLine}\n`);
    rawWriter.flush();
  };

  const writeRawLines = (
    lines: string[],
    metadata?: {
      sessionId?: string;
      runId?: number;
      component?: RawStreamLogEntry["component"];
    },
  ): void => {
    for (const line of lines) {
      writeRawLine(line, metadata);
    }
  };

  const flushRawTextBuffer = (
    event: BusEvent,
    runState: SessionRunDebugState,
  ): void => {
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
      const completeLines = newlineChunks.slice(0, -1).map((line) =>
        line.trim()
      ).filter(Boolean);
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
      const toolInput =
        (data.toolInput as Record<string, unknown> | undefined) ?? {};
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

    if (
      event.type === "stream.session.idle" ||
      event.type === "stream.session.error"
    ) {
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
      ? previousStreamLoggedAtMs === null
        ? null
        : Math.max(0, loggedAtMs - previousStreamLoggedAtMs)
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
      streamGapMs !== null &&
      streamGapMs >= STREAM_CONTINUITY_GAP_THRESHOLD_MS
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

    updateAgentTree(event);

    const previousSessionLoggedAtMs =
      previousLoggedAtBySessionRun.get(sessionRunKey) ?? null;
    const previousSessionEventTimestampMs =
      previousEventTimestampBySessionRun.get(sessionRunKey) ?? null;
    const globalGapMs =
      previousLoggedAtMs === null
        ? null
        : Math.max(0, loggedAtMs - previousLoggedAtMs);
    const sessionRunGapMs =
      previousSessionLoggedAtMs === null
        ? null
        : Math.max(0, loggedAtMs - previousSessionLoggedAtMs);
    const eventTimestampRegressionMs =
      previousSessionEventTimestampMs !== null &&
        event.timestamp < previousSessionEventTimestampMs
        ? previousSessionEventTimestampMs - event.timestamp
        : undefined;
    const continuityGapMs =
      sessionRunGapMs !== null &&
        sessionRunGapMs >= STREAM_CONTINUITY_GAP_THRESHOLD_MS &&
        event.type.startsWith("stream.")
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
      runState.sawSessionIdle || runState.sawSessionError
        ? runAgeMs
        : undefined;

    if (toolCompleteWithoutStart) {
      runState.pendingToolCalls = 0;
    }

    const includeTreeSnapshot =
      isAgentLifecycleEvent(event.type) || isSessionErrorEventType(event.type);
    const treeSnapshot = includeTreeSnapshot
      ? buildAgentTreeSnapshot()
      : undefined;

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
      ...(eventTimestampRegressionMs !== undefined
        ? { eventTimestampRegressionMs }
        : {}),
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
    rawWriter.flush();
    writer.flush();
    writeRawForEvent(event, runState, loggedAtMs);
  };

  const writeDiagnostic = (
    partial: Omit<DiagnosticLogEntry, "seq" | "ts">,
  ): void => {
    const entry: DiagnosticLogEntry = {
      seq: ++seq,
      ts: new Date().toISOString(),
      ...partial,
      agentTreeSnapshot: partial.agentTreeSnapshot ?? buildAgentTreeSnapshot(),
    };
    writer.write(JSON.stringify(entry) + "\n");
    writer.flush();
    const diagnosticMessage = partial.error
      ? `[${partial.category}] ${partial.error}`
      : partial.keyName
        ? `[${partial.category}] ${partial.keyName}`
        : `[${partial.category}]`;
    writeRawLine(diagnosticMessage, { component: "diagnostic" });
  };

  const getAgentTreeSnapshot = (): AgentTreeSnapshot => buildAgentTreeSnapshot();

  const close = async (): Promise<void> => {
    const eventWriterResult = writer.end();
    const rawWriterResult = rawWriter.end();
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
