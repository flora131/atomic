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
 * - Activated by ATOMIC_DEBUG=1 environment variable
 *
 * Usage:
 * ```typescript
 * const bus = new AtomicEventBus();
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
import type { AtomicEventBus } from "./event-bus.ts";
import type { BusEvent } from "./bus-events.ts";

const LOG_DIR = join(homedir(), ".local", "share", "atomic", "log", "events");
const MAX_LOG_FILES = 10;

/** JSONL log entry format — one per line in the log file */
export interface EventLogEntry {
  ts: string;
  type: string;
  sessionId: string;
  runId: number;
  data: unknown;
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
  dev?: boolean;
  logDir?: string;
}): Promise<{
  write: (event: BusEvent) => void;
  close: () => Promise<void>;
  logPath: string;
}> {
  const logDir = options?.logDir ?? LOG_DIR;
  await mkdir(logDir, { recursive: true });
  await cleanup(logDir);

  const filename = options?.dev
    ? "dev.events.jsonl"
    : new Date().toISOString().split(".")[0]!.replace(/:/g, "") +
      ".events.jsonl";

  const logPath = join(logDir, filename);
  const logFile = Bun.file(logPath);
  const writer = logFile.writer();

  const write = (event: BusEvent): void => {
    const entry: EventLogEntry = {
      ts: new Date(event.timestamp).toISOString(),
      type: event.type,
      sessionId: event.sessionId,
      runId: event.runId,
      data: event.data,
    };
    writer.write(JSON.stringify(entry) + "\n");
    writer.flush();
  };

  const close = async (): Promise<void> => {
    const result = writer.end();
    // Bun's writer.end() can return either number (sync) or Promise<number> (async)
    // We must await if it's a Promise to ensure all data is flushed
    if (result instanceof Promise) {
      await result;
    }
  };

  return { write, close, logPath };
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
export async function listEventLogs(dir: string = LOG_DIR): Promise<string[]> {
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
 * When ATOMIC_DEBUG=1, all events are written to a JSONL log file
 * with automatic rotation (10 most recent files retained).
 *
 * Also retains console.debug logging for real-time visibility.
 *
 * @param bus - The event bus to attach the debug subscriber to
 * @returns Promise with unsubscribe function and log file path
 */
export async function attachDebugSubscriber(bus: AtomicEventBus): Promise<{
  unsubscribe: () => Promise<void>;
  logPath: string | null;
}> {
  if (process.env.ATOMIC_DEBUG !== "1") {
    return { unsubscribe: async () => {}, logPath: null };
  }

  const { write, close, logPath } = await initEventLog({
    dev: process.env.NODE_ENV === "development",
  });

  const unsubBus = bus.onAll((event: BusEvent) => {
    write(event);
    const preview = JSON.stringify(event.data).slice(0, 100);
    console.debug(
      `[EventBus] ${event.type} run=${event.runId} ${preview}`,
    );
  });

  const unsubscribe = async (): Promise<void> => {
    unsubBus();
    await close();
  };

  return { unsubscribe, logPath };
}
