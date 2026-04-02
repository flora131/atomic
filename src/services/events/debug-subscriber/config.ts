import { join } from "path";
import { homedir } from "os";
import { readdir, rm, stat } from "fs/promises";
import type { BusEvent } from "@/services/events/bus-events/index.ts";

export const DEFAULT_LOG_DIR = join(homedir(), ".local", "share", "atomic", "log", "events");
export const MAX_LOG_SESSIONS = 10;
/** Maximum total size of the log directory in bytes (1 GB). */
export const MAX_LOG_DIR_SIZE_BYTES = 1024 * 1024 * 1024;
const DEBUG_ENV = "DEBUG";
const LOG_DIR_ENV = "LOG_DIR";
export const LOG_SESSION_NAME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{6}$/;
export const LOG_EVENTS_FILENAME = "events.jsonl";
export const LOG_RAW_STREAM_FILENAME = "raw-stream.log";
export const STREAM_CONTINUITY_GAP_THRESHOLD_MS = 1500;

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
  agentTreeSnapshot?: AgentTreeSnapshot;
  data: unknown;
}

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

export interface DiagnosticLogEntry {
  seq: number;
  ts: string;
  category: "bus_error" | "process_error" | "startup" | "key_press";
  kind?: string;
  eventType?: string;
  keyName?: string;
  modifiers?: {
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
  };
  owner?: string;
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

export interface SessionRunDebugState {
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

let activeSessionLogDir: string | undefined;

export function setActiveSessionLogDir(dir: string): void {
  activeSessionLogDir = dir;
}

export function clearActiveSessionLogDir(): void {
  activeSessionLogDir = undefined;
}

export function getActiveSessionLogDir(): string | undefined {
  return activeSessionLogDir;
}

type DiagnosticWriter = (entry: Omit<DiagnosticLogEntry, "seq" | "ts">) => void;

let activeDiagnosticWriter: DiagnosticWriter | undefined;

export function setActiveDiagnosticWriter(writer: DiagnosticWriter): void {
  activeDiagnosticWriter = writer;
}

export function clearActiveDiagnosticWriter(): void {
  activeDiagnosticWriter = undefined;
}

export function getActiveDiagnosticWriter(): DiagnosticWriter | undefined {
  return activeDiagnosticWriter;
}

export function buildLogSessionName(now: Date = new Date()): string {
  return now.toISOString().split(".")[0]!.replace(/:/g, "");
}

export function formatRawDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function truncateRawText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}… (+${value.length - maxChars} chars truncated)`;
}

export function buildSessionRunKey(event: BusEvent): string {
  return `${event.sessionId}::${event.runId}`;
}

export function isStreamEventType(type: string): boolean {
  return type.startsWith("stream.");
}

export function isSessionStartEventType(type: string): boolean {
  return type === "stream.session.start";
}

export function isSessionIdleEventType(type: string): boolean {
  return type === "stream.session.idle" || type === "session.idle";
}

export function isSessionErrorEventType(type: string): boolean {
  return type === "stream.session.error" || type === "session.error";
}

export function createSessionRunDebugState(loggedAtMs: number): SessionRunDebugState {
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

export async function listLogSessionDirectories(dir: string): Promise<string[]> {
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
 * Recursively compute the total size in bytes of all files under `dir`.
 */
export async function computeDirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await computeDirSize(fullPath);
    } else if (entry.isFile()) {
      const fileStat = await stat(fullPath).catch(() => null);
      if (fileStat) total += fileStat.size;
    }
  }
  return total;
}

export async function cleanup(dir: string): Promise<void> {
  let sessionDirs = await listLogSessionDirectories(dir);

  // Prune by session count.
  if (sessionDirs.length > MAX_LOG_SESSIONS) {
    const dirsToDelete = sessionDirs.slice(0, sessionDirs.length - MAX_LOG_SESSIONS);
    await Promise.all(
      dirsToDelete.map((sessionDir) =>
        rm(sessionDir, { recursive: true, force: true }).catch(() => {})),
    );
    sessionDirs = sessionDirs.slice(sessionDirs.length - MAX_LOG_SESSIONS);
  }

  // Prune oldest sessions until total size is under the cap.
  let totalSize = await computeDirSize(dir);
  while (totalSize > MAX_LOG_DIR_SIZE_BYTES && sessionDirs.length > 1) {
    const oldest = sessionDirs.shift()!;
    await rm(oldest, { recursive: true, force: true }).catch(() => {});
    totalSize = await computeDirSize(dir);
  }
}
