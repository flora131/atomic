/**
 * Claude Stop Hook command — internal handler for Claude Code's Stop hook.
 *
 * Claude invokes `atomic _claude-stop-hook` at the end of every turn,
 * piping a JSON payload via stdin. This handler writes a marker file that
 * another part of the system watches via `fs.watch`, replacing tmux-pane-
 * scraping idle detection with a clean event-driven approach.
 *
 * Usage (configured in Claude's Stop hook):
 *   atomic _claude-stop-hook
 *
 * Payload (JSON via stdin):
 *   {
 *     "session_id": "abc123",
 *     "transcript_path": "/path/to/transcript",
 *     "cwd": "/path/to/cwd",
 *     "stop_hook_active": false
 *   }
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/** Shape of the JSON payload Claude pipes to the Stop hook via stdin. */
export interface ClaudeStopHookPayload {
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  stop_hook_active?: boolean;
}

/**
 * Type guard to verify that a parsed value conforms to ClaudeStopHookPayload.
 */
function isClaudeStopHookPayload(value: unknown): value is ClaudeStopHookPayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj["session_id"] !== "string") return false;
  if (obj["transcript_path"] !== undefined && typeof obj["transcript_path"] !== "string") return false;
  if (obj["cwd"] !== undefined && typeof obj["cwd"] !== "string") return false;
  if (obj["stop_hook_active"] !== undefined && typeof obj["stop_hook_active"] !== "boolean") return false;
  return true;
}

/**
 * Handler for the hidden `_claude-stop-hook` subcommand.
 *
 * Returns an exit code (0 on success or benign failure).  The caller
 * in src/cli.ts does `process.exit(exitCode)`, so we just return the code.
 *
 * We always return 0 — a non-zero exit would surface as a hook error in
 * Claude's transcript, which is not what we want.
 */
export async function claudeStopHookCommand(): Promise<number> {
  // 1. Read stdin
  const raw = await Bun.stdin.text();

  // 2. Parse JSON
  let payload: ClaudeStopHookPayload;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isClaudeStopHookPayload(parsed)) {
      console.error("[claude-stop-hook] Invalid payload: missing or malformed 'session_id'");
      return 0;
    }
    payload = parsed;
  } catch {
    console.error("[claude-stop-hook] Failed to parse stdin as JSON");
    return 0;
  }

  // 3. Guard against infinite Stop-hook loops
  if (payload.stop_hook_active === true) {
    return 0;
  }

  // 4. Write the marker file atomically
  const markerDir = path.join(os.homedir(), ".atomic", "claude-stop");
  await fs.mkdir(markerDir, { recursive: true });

  const tmpPath = path.join(markerDir, `${payload.session_id}.tmp`);
  const finalPath = path.join(markerDir, payload.session_id);

  // Write contents — the watcher only cares that the file appears.
  await Bun.write(tmpPath, raw);
  await fs.rename(tmpPath, finalPath);

  return 0;
}
