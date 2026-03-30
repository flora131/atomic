/**
 * Conductor Executor Debug Logger
 *
 * Writes JSONL entries to ~/.local/share/atomic/log/conductor-debug.jsonl
 * when DEBUG=1. Each entry captures a conductor lifecycle event, stage
 * transition, or error with structured data.
 *
 * Follows the same pattern as tool-debug-log.ts for consistency.
 *
 * Usage:
 *   import { conductorDebug } from "./conductor-debug-log.ts";
 *   conductorDebug("workflow_start", { workflow: "ralph", sessionId });
 */

import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

const LOG_DIR = join(homedir(), ".local", "share", "atomic", "log");
const LOG_FILE = join(LOG_DIR, "conductor-debug.jsonl");

let _enabled: boolean | null = null;
let _writer: ReturnType<
  typeof Bun.file extends (...args: never[]) => infer R
    ? R extends { writer: () => infer W }
      ? () => W
      : never
    : never
> | null = null;

function isEnabled(): boolean {
  if (_enabled === null) {
    const v = process.env.DEBUG?.trim().toLowerCase();
    _enabled = !!v && v !== "0" && v !== "false" && v !== "off";
  }
  return _enabled;
}

function getWriter() {
  if (_writer) return _writer;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const file = Bun.file(LOG_FILE);
    _writer = file.writer();
    return _writer;
  } catch {
    _enabled = false;
    return null;
  }
}

export function conductorDebug(
  action: string,
  data: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  const w = getWriter();
  if (!w) return;
  const entry = {
    ts: new Date().toISOString(),
    action,
    ...data,
  };
  w.write(JSON.stringify(entry) + "\n");
  w.flush();
}

export function conductorDebugFlush(): void {
  if (_writer) {
    _writer.flush();
  }
}
