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
import { watch as watchDir } from "node:fs/promises";
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
export function claudeHookDirs(): {
  marker: string;
  queue: string;
  release: string;
  hil: string;
  pid: string;
} {
  const base = path.join(os.homedir(), ".atomic");
  return {
    marker: path.join(base, "claude-stop"),
    queue: path.join(base, "claude-queue"),
    release: path.join(base, "claude-release"),
    hil: path.join(base, "claude-hil"),
    // Holds the PID of the atomic workflow process that owns each session.
    // The Stop hook polls `process.kill(pid, 0)` against this value so that
    // if atomic is SIGKILL'd (no chance to write a release marker), the hook
    // can detect the orphaned session and self-exit instead of sitting in
    // its wait loop for ~24 days.
    pid: path.join(base, "claude-pid"),
  };
}

/** Options for {@link claudeStopHookCommand}. Primarily used by tests to shrink the wait budget. */
export interface ClaudeStopHookOptions {
  /** Maximum time the hook waits for a queued follow-up prompt before letting Claude stop. */
  waitTimeoutMs?: number;
  /**
   * Interval for the polling fallback that runs alongside the `fs.watch`
   * watchers in case an inotify/FSEvent notification gets dropped. In the
   * happy path, watcher events fire on create and the poll never matches.
   */
  pollIntervalMs?: number;
  /**
   * Interval at which the hook checks whether the atomic workflow process
   * that owns this session is still alive. Coarser than `pollIntervalMs`
   * because atomic crashing is rare and `process.kill(pid, 0)` is a syscall.
   */
  livenessIntervalMs?: number;
}

/**
 * Effectively-unbounded default wait budget for the queue/release poll loop.
 *
 * The hook holds Claude Code in the Stop phase while the workflow runtime
 * decides what to do next — either enqueueing a follow-up prompt (delivered
 * back to Claude as `{decision:"block", reason:...}`) or writing a release
 * marker on teardown. Any finite default here caps the time the workflow has
 * between turns: when it expires, the hook exits 0, Claude stops, and the
 * next `enqueuePrompt` writes to a file nobody's reading — the workflow
 * hangs on `waitForIdle` for a turn that will never come.
 *
 * The Claude-side hook timeout (see `STOP_HOOK_TIMEOUT_SECONDS` in
 * `src/sdk/providers/claude.ts`) is already set to ~24 days, so matching it
 * here keeps the two bounds aligned — the hook either runs until the
 * workflow releases it or until Claude Code itself gives up. Tests override
 * `waitTimeoutMs` via options to keep runs fast.
 *
 * Expressed in ms: 2_147_483 s × 1000 = 2_147_483_000 ms, just under the
 * max safe `setTimeout` value (2^31 - 1).
 */
const DEFAULT_WAIT_TIMEOUT_MS = 2_147_483_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_LIVENESS_INTERVAL_MS = 5_000;

/**
 * Read the atomic PID that owns this session from `~/.atomic/claude-pid/<id>`,
 * or return null if the file is missing / malformed. Missing is fine: older
 * runtimes didn't write one, and we just skip the liveness check in that case.
 */
async function readAtomicPid(pidFilePath: string): Promise<number | null> {
  let raw: string;
  try {
    raw = await fs.readFile(pidFilePath, "utf-8");
  } catch {
    return null;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Sleep that resolves early when `signal` is aborted. Used by the hook's
 * wait loops so `ac.abort()` unblocks everything immediately instead of
 * waiting for the next wake-up tick — otherwise a task that detects a hit
 * (e.g. liveness check) can't meaningfully cancel its siblings.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * True when a process with `pid` exists. Uses signal `0`, which performs the
 * permission/existence check without delivering a signal. ESRCH means gone,
 * EPERM means alive-but-not-ours (still alive for our purposes).
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    if (e instanceof Error && "code" in e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EPERM") return true;
      if (code === "ESRCH") return false;
    }
    // Unknown error — assume alive to avoid false-positive teardown.
    return true;
  }
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
export async function claudeStopHookCommand(
  options: ClaudeStopHookOptions = {},
): Promise<number> {
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const livenessIntervalMs =
    options.livenessIntervalMs ?? DEFAULT_LIVENESS_INTERVAL_MS;

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
    fs.mkdir(dirs.pid, { recursive: true }),
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

  // 5. Wait for either a queued follow-up prompt or a release signal.
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
  //   c. Neither happens within `waitTimeoutMs`. We exit 0 so Claude Code
  //      doesn't hang past its own per-hook timeout. The production default
  //      for `waitTimeoutMs` is aligned with the Claude-side hook timeout
  //      (~24 days), so this path is effectively unreachable in real runs —
  //      it only fires in tests that pass a short override.
  //
  // Delivery uses `fs.watch` on the queue and release dirs for ~0-latency
  // wake-up on create events, with a slower `existsSync` polling fallback
  // in case a watcher notification gets dropped under fs load (same pattern
  // as `watchHILMarker` in `src/sdk/providers/claude.ts`).
  const queuePath = path.join(dirs.queue, payload.session_id);
  const releasePath = path.join(dirs.release, payload.session_id);

  type Hit = { kind: "release" } | { kind: "queue"; prompt: string };

  const check = async (): Promise<Hit | null> => {
    if (existsSync(releasePath)) {
      try { await fs.unlink(releasePath); } catch { /* ENOENT is fine */ }
      return { kind: "release" };
    }
    if (existsSync(queuePath)) {
      let prompt: string;
      try {
        prompt = await fs.readFile(queuePath, "utf-8");
      } catch {
        // Treat a failed read as a graceful release so the hook still exits.
        return { kind: "release" };
      }
      try { await fs.unlink(queuePath); } catch { /* ENOENT is fine */ }
      return { kind: "queue", prompt };
    }
    return null;
  };

  const emit = (hit: Hit): number => {
    if (hit.kind === "queue") {
      process.stdout.write(JSON.stringify({
        decision: "block",
        reason: hit.prompt,
      }));
    }
    return 0;
  };

  // Initial synchronous check — the runtime may have enqueued/released before
  // we attached watchers, and without this the hook could hang until the
  // polling fallback fires.
  const early = await check();
  if (early) return emit(early);

  const ac = new AbortController();
  const overallTimer = setTimeout(() => ac.abort(), waitTimeoutMs);
  let hit: Hit | null = null;

  // Read the atomic workflow's PID (if the runtime wrote one for this
  // session). Used by the liveness task below to detect an atomic crash.
  const atomicPid = await readAtomicPid(
    path.join(dirs.pid, payload.session_id),
  );

  // Watch a single directory for change events and resolve `hit` on the
  // first one that matches. `event.filename` is unreliable across OSes
  // (see the comment in `watchHILMarker`), so disk state is authoritative.
  const runWatcher = async (dir: string): Promise<void> => {
    try {
      for await (const _event of watchDir(dir, { signal: ac.signal })) {
        const result = await check();
        if (result) {
          hit = result;
          ac.abort();
          return;
        }
      }
    } catch (e: unknown) {
      if (!(e instanceof Error && e.name === "AbortError")) throw e;
    }
  };

  // Polling fallback — catches the rare dropped inotify/FSEvent event.
  // Only runs while the watchers are live; `ac.abort()` shuts it down.
  const runPollFallback = async (): Promise<void> => {
    while (!ac.signal.aborted) {
      await abortableSleep(pollIntervalMs, ac.signal);
      if (ac.signal.aborted) return;
      const result = await check();
      if (result) {
        hit = result;
        ac.abort();
        return;
      }
    }
  };

  // Liveness check — if the atomic workflow process died without writing a
  // release marker (e.g. SIGKILL), this task abandons the wait and lets
  // Claude stop. No-op when there's no pid file (older sessions or non-
  // runtime spawns) so the hook still functions standalone.
  const runLivenessCheck = async (): Promise<void> => {
    if (atomicPid === null) return;
    while (!ac.signal.aborted) {
      await abortableSleep(livenessIntervalMs, ac.signal);
      if (ac.signal.aborted) return;
      if (!isProcessAlive(atomicPid)) {
        // hit stays null → the hook exits 0 without emitting a block decision.
        ac.abort();
        return;
      }
    }
  };

  try {
    await Promise.all([
      runWatcher(dirs.queue),
      runWatcher(dirs.release),
      runPollFallback(),
      runLivenessCheck(),
    ]);
  } finally {
    clearTimeout(overallTimer);
    ac.abort();
  }

  if (hit) return emit(hit);

  // Timeout — no queued prompt arrived. Let Claude stop normally.
  return 0;
}
