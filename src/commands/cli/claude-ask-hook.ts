/**
 * Claude AskUserQuestion Hook command — internal handler for PreToolUse /
 * PostToolUse / PostToolUseFailure hooks scoped to the `AskUserQuestion`
 * built-in tool.
 *
 * Invoked as:
 *   atomic _claude-ask-hook enter   (PreToolUse)
 *   atomic _claude-ask-hook exit    (PostToolUse + PostToolUseFailure)
 *
 * Writes or removes `~/.atomic/claude-hil/<session_id>`. The workflow runtime
 * (`src/sdk/providers/claude.ts`) `fs.watch`es that directory and fires
 * `onHIL(true|false)` on create/unlink, driving the blue "awaiting_input"
 * pulse on the node card.
 *
 * Returns exit 0 on every path — a non-zero exit would surface as a hook
 * error in Claude's transcript, which is worse than a silently-missed HIL
 * signal (the `onHIL?.(false)` safety call in `claudeQuery`'s finally block
 * recovers UI state in either case).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { claudeHookDirs } from "./claude-stop-hook.ts";

/** Shape of the JSON payload Claude pipes to the PreToolUse/PostToolUse hook via stdin. */
export interface ClaudeAskHookPayload {
  session_id: string;
  hook_event_name?: string;
  tool_name?: string;
  cwd?: string;
}

export type ClaudeAskHookMode = "enter" | "exit";

function isClaudeAskHookPayload(value: unknown): value is ClaudeAskHookPayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj["session_id"] === "string";
}

/**
 * Handler for the hidden `_claude-ask-hook` subcommand.
 *
 * Always returns 0 so a hook failure never shows up as a red "hook error"
 * in Claude's transcript.
 */
export async function claudeAskHookCommand(mode: ClaudeAskHookMode): Promise<number> {
  const raw = await Bun.stdin.text();

  let payload: ClaudeAskHookPayload;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isClaudeAskHookPayload(parsed)) {
      console.error("[claude-ask-hook] Invalid payload: missing or malformed 'session_id'");
      return 0;
    }
    payload = parsed;
  } catch {
    console.error("[claude-ask-hook] Failed to parse stdin as JSON");
    return 0;
  }

  const { hil } = claudeHookDirs();
  await fs.mkdir(hil, { recursive: true });
  const markerPath = path.join(hil, payload.session_id);

  if (mode === "enter") {
    // Direct write — tmp+rename would deliver an inotify event whose filename
    // is `<session_id>.tmp`, which would miss the watcher's filename match.
    // See the same rationale in claude-stop-hook.ts (marker write).
    await Bun.write(markerPath, raw);
  } else {
    try {
      await fs.unlink(markerPath);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException | null)?.code;
      if (code !== "ENOENT") {
        console.error(`[claude-ask-hook] Failed to unlink marker: ${String(e)}`);
      }
    }
  }

  return 0;
}
