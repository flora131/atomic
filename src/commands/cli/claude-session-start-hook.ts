/**
 * Claude SessionStart Hook command — internal handler for the `startup` matcher.
 *
 * Invoked as:
 *   atomic _claude-session-start-hook
 *
 * Writes `~/.atomic/claude-ready/<session_id>` as a positive readiness signal.
 * The workflow runtime (`src/sdk/providers/claude.ts`) `fs.watch`es that dir so
 * it can resolve the spawn wait the instant Claude dispatches SessionStart —
 * which fires before the JSONL transcript is created, making it a stricter and
 * more reliable readiness signal than polling for the transcript file.
 *
 * Always exits 0 so a hook failure never shows up as a red "hook error" in
 * Claude's transcript. The runtime's spawn timeout still protects against a
 * truly broken startup (bad binary, exec failure).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { claudeHookDirs } from "./claude-stop-hook.ts";

/** Shape of the JSON payload Claude pipes to the SessionStart hook via stdin. */
export interface ClaudeSessionStartHookPayload {
  session_id: string;
  source?: string;
  transcript_path?: string;
  cwd?: string;
}

function isClaudeSessionStartHookPayload(
  value: unknown,
): value is ClaudeSessionStartHookPayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj["session_id"] === "string";
}

export async function claudeSessionStartHookCommand(): Promise<number> {
  const raw = await Bun.stdin.text();

  let payload: ClaudeSessionStartHookPayload;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isClaudeSessionStartHookPayload(parsed)) {
      console.error(
        "[claude-session-start-hook] Invalid payload: missing or malformed 'session_id'",
      );
      return 0;
    }
    payload = parsed;
  } catch {
    console.error("[claude-session-start-hook] Failed to parse stdin as JSON");
    return 0;
  }

  const { ready } = claudeHookDirs();
  await fs.mkdir(ready, { recursive: true });
  await Bun.write(path.join(ready, payload.session_id), raw);

  return 0;
}
