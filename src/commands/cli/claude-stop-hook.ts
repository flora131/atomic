/**
 * Claude Stop Hook command — internal handler for Claude Code's Stop hook.
 *
 * Claude invokes `atomic _claude-stop-hook` at the end of every turn,
 * piping a JSON payload via stdin. This handler has two jobs:
 *
 *   1. Write a per-session marker file that the workflow runtime watches via
 *      `fs.watch` to detect turn completion (replacing tmux-pane scraping).
 *
 *   2. Deliver follow-up prompts without tmux send-keys. After the marker is
 *      written, this process block-polls `~/.atomic/claude-queue/<session_id>`.
 *      If the workflow enqueues a prompt there, we read it, delete the queue
 *      entry, and emit `{"decision":"block","reason":<prompt>}` on stdout.
 *      Claude Code treats `reason` as the next user message and keeps the
 *      agent loop running on the same session — no TUI keystrokes required.
 *      If the workflow instead signals session end via
 *      `~/.atomic/claude-release/<session_id>`, we exit 0 and let Claude stop.
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
import { existsSync } from "node:fs";
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
 * Directory paths used by the Stop hook and the workflow runtime to exchange
 * per-session signals.
 *
 * Exported so tests and `src/sdk/providers/claude.ts` share one source of truth.
 */
export function claudeHookDirs(): { marker: string; queue: string; release: string; hil: string } {
  const base = path.join(os.homedir(), ".atomic");
  return {
    marker: path.join(base, "claude-stop"),
    queue: path.join(base, "claude-queue"),
    release: path.join(base, "claude-release"),
    hil: path.join(base, "claude-hil"),
  };
}

/** Options for {@link claudeStopHookCommand}. Primarily used by tests to shrink the wait budget. */
export interface ClaudeStopHookOptions {
  /** Maximum time the hook waits for a queued follow-up prompt before letting Claude stop. */
  waitTimeoutMs?: number;
  /** Polling interval for queue/release detection. */
  pollIntervalMs?: number;
}

const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 100;

/**
 * Handler for the hidden `_claude-stop-hook` subcommand.
 *
 * Returns an exit code (0 on success or benign failure).  The caller
 * in src/cli.ts does `process.exit(exitCode)`, so we just return the code.
 *
 * We always return 0 — a non-zero exit would surface as a hook error in
 * Claude's transcript, which is not what we want.
 */
export async function claudeStopHookCommand(
  options: ClaudeStopHookOptions = {},
): Promise<number> {
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

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

  // NOTE: we intentionally do NOT early-exit on `stop_hook_active === true`.
  //
  // Claude Code sets `stopHookActive: true` in its query state after any Stop
  // hook returns a `{decision:"block"}` response, and that flag stays true for
  // every subsequent Stop hook invocation in the same session (see
  // `src/query.ts` → `transition: { reason: 'stop_hook_blocking' }`). In a
  // multi-turn workflow, every follow-up turn after the first is therefore
  // invoked with `stop_hook_active=true`. Returning early here would skip the
  // marker write, leaving `waitForIdle` hanging forever, and would skip the
  // queue poll so the workflow's next `s.session.query(...)` would never
  // reach Claude.
  //
  // Our design doesn't need the generic loop guard: the hook only emits a
  // `block` decision when the workflow runtime has written a prompt to the
  // queue file. Infinite loops are bounded by the workflow (which either
  // enqueues a finite number of prompts or writes a release marker on
  // teardown via `clearClaudeSession`).
  const dirs = claudeHookDirs();
  await Promise.all([
    fs.mkdir(dirs.marker, { recursive: true }),
    fs.mkdir(dirs.queue, { recursive: true }),
    fs.mkdir(dirs.release, { recursive: true }),
  ]);

  // 4. Write the marker file directly.
  //
  // We intentionally do NOT use a tmp+rename dance here. On Linux, inotify
  // emits the rename event with `filename=<session_id>.tmp` (the source),
  // which made `waitForIdle`'s `event.filename === session_id` filter miss
  // the event entirely and hang forever. A direct write on a tiny payload is
  // effectively atomic at the page-cache level and generates a single event
  // whose filename matches the session id — which is all `waitForIdle` needs.
  const markerPath = path.join(dirs.marker, payload.session_id);
  await Bun.write(markerPath, raw);

  // 5. Block-poll for either a queued follow-up prompt or a release signal.
  //
  // The workflow's `waitForIdle` has already been unblocked by the marker
  // write above and is now returning control to the user's stage callback.
  // One of three things happens next:
  //
  //   a. The callback calls `s.session.query(next)`, which writes the next
  //      prompt to `~/.atomic/claude-queue/<session_id>`. We read it, delete
  //      the queue entry, and emit `{"decision":"block","reason":<prompt>}`
  //      on stdout. Claude Code feeds `reason` back as the next user message
  //      and keeps the turn loop running — no tmux keystrokes involved.
  //
  //   b. The callback returns and the runtime writes a release marker at
  //      `~/.atomic/claude-release/<session_id>`. We exit 0 with no stdout
  //      payload and Claude stops as usual.
  //
  //   c. Neither happens within `waitTimeoutMs`. We exit 0 on timeout as a
  //      safety net — Claude stops rather than hanging its Stop hook forever.
  const queuePath = path.join(dirs.queue, payload.session_id);
  const releasePath = path.join(dirs.release, payload.session_id);

  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() <= deadline) {
    if (existsSync(releasePath)) {
      try { await fs.unlink(releasePath); } catch { /* ENOENT is fine */ }
      return 0;
    }
    if (existsSync(queuePath)) {
      let prompt: string;
      try {
        prompt = await fs.readFile(queuePath, "utf-8");
      } catch {
        return 0;
      }
      try { await fs.unlink(queuePath); } catch { /* ENOENT is fine */ }
      process.stdout.write(JSON.stringify({
        decision: "block",
        reason: prompt,
      }));
      return 0;
    }
    await Bun.sleep(pollIntervalMs);
  }

  // Timeout — no queued prompt arrived. Let Claude stop normally.
  return 0;
}
