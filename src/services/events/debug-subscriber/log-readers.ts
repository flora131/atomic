import { join } from "path";
import {
  DEFAULT_LOG_DIR,
  LOG_EVENTS_FILENAME,
  listLogSessionDirectories,
} from "./config.ts";
import type { EventLogEntry } from "./config.ts";

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

export async function listEventLogs(dir: string = DEFAULT_LOG_DIR): Promise<string[]> {
  const sessionDirs = await listLogSessionDirectories(dir);
  const sessionEventLogs = sessionDirs
    .map((sessionDir) => join(sessionDir, LOG_EVENTS_FILENAME));

  sessionEventLogs.sort();
  return sessionEventLogs.reverse();
}
