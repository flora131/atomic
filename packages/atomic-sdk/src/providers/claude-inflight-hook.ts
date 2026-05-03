/**
 * Claude In-Flight Hook command — internal handler for the workflow's
 * `SubagentStart` / `SubagentStop` / `TeammateIdle` hooks.
 *
 * Invoked as:
 *   atomic _claude-inflight-hook start   (SubagentStart)
 *   atomic _claude-inflight-hook stop    (SubagentStop)
 *   atomic _claude-inflight-hook wait    (TeammateIdle)
 *
 * `start` / `stop` maintain a directory of one marker file per in-flight
 * subagent under `~/.atomic/claude-inflight/<root_session_id>/<agent_id>`.
 * `<root_session_id>` is the stage's top-level Claude session — for nested
 * subagents (a subagent spawning its own subagent) we resolve the root by
 * looking up the parent session's mapping, so all descendants of a stage
 * funnel into the same marker dir.
 *
 * `wait` is the focused completion-signal handler used for `TeammateIdle`:
 * read `session_id` from the payload, await `waitForInflightDrained`, exit
 * 0. We don't reuse the Stop hook handler here because Stop also writes
 * `~/.atomic/claude-stop/<session_id>` (which the runtime's `waitForIdle`
 * watches) and polls queue/release — those are tied to the stage's root
 * session, and TeammateIdle's `session_id` may be a teammate's session
 * that the runtime never enqueues to or releases.
 *
 * Two consumers gate on the in-flight dir being empty:
 *
 *   1. `claudeStopHookCommand` — won't consume the `claude-release` marker
 *      until in-flight is empty, so Claude itself doesn't exit while
 *      backgrounded subagents are still running.
 *
 *   2. `clearClaudeSession` — calls `waitForInflightDrained` before tearing
 *      down the pane, so the executor doesn't advance to the next stage
 *      while the previous stage's subagents still hold FDs/PTYs on the
 *      atomic tmux server.
 *
 * Always exits 0 — a non-zero exit would surface as a hook error in
 * Claude's transcript, and silent miss + stale-sweep recovery is preferable
 * to red noise on every workflow run.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { claudeHookDirs } from "./claude-stop-hook.ts";

/**
 * Shape of the JSON payload Claude pipes to the Subagent / TeammateIdle
 * lifecycle hooks via stdin.
 *
 *   SubagentStart / SubagentStop  → `agent_id` (uuid), `agent_type`
 *   TeammateIdle                  → `session_id` only (used by `wait` mode)
 *
 * `session_id` is the parent Claude session that triggered the event — for
 * a top-level subagent, that's the stage's root; for a nested subagent,
 * that's the spawning agent's session, and we look up its root via
 * `inflightRoots`.
 *
 * Extra fields are ignored; missing ones cause a graceful exit-0 no-op.
 */
export interface ClaudeInflightHookPayload {
  session_id: string;
  hook_event_name?: string;
  agent_id?: string;
  agent_type?: string;
  cwd?: string;
}

export type ClaudeInflightHookMode = "start" | "stop" | "wait";

function isClaudeInflightHookPayload(
  value: unknown,
): value is ClaudeInflightHookPayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj["session_id"] !== "string") return false;
  return true;
}

/**
 * Default TTL for stale-marker sweeps. A marker older than this is treated
 * as orphaned (subagent crashed without firing SubagentStop) and removed.
 *
 * 2 hours is conservative: real subagents researching docs or running tests
 * can exceed 30 minutes in ralph-style workflows, but no legitimate hook
 * lifecycle should leave a marker on disk longer than ~2 h. Override at the
 * environment via `ATOMIC_INFLIGHT_STALE_MS` for shorter runs in tests.
 */
const DEFAULT_INFLIGHT_STALE_MS = 2 * 60 * 60 * 1000;

function staleMs(): number {
  const raw = process.env["ATOMIC_INFLIGHT_STALE_MS"];
  if (!raw) return DEFAULT_INFLIGHT_STALE_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INFLIGHT_STALE_MS;
}

/** Pick the unique id this event represents — `agent_id` for Subagent events. */
function extractId(payload: ClaudeInflightHookPayload): string | null {
  if (typeof payload.agent_id === "string" && payload.agent_id.length > 0) {
    return payload.agent_id;
  }
  return null;
}

/** Path to the roots-mapping file for a given session. */
function rootsMapPath(sessionId: string): string {
  return path.join(claudeHookDirs().inflightRoots, sessionId);
}

/** Path to the marker dir for a given root session. */
function markerDirFor(rootSessionId: string): string {
  return path.join(claudeHookDirs().inflight, rootSessionId);
}

/** Path to a single marker file under a root session. */
function markerPathFor(rootSessionId: string, id: string): string {
  return path.join(markerDirFor(rootSessionId), id);
}

/**
 * Resolve the stage root for an event's `session_id`. If the parent has a
 * roots-mapping entry (it was itself spawned as a subagent), follow it.
 * Otherwise the parent IS the root.
 */
async function resolveRoot(parentSessionId: string): Promise<string> {
  try {
    const mapped = await fs.readFile(rootsMapPath(parentSessionId), "utf-8");
    const trimmed = mapped.trim();
    if (trimmed.length > 0) return trimmed;
  } catch {
    // ENOENT (parent has no mapping → it is the root) or any read error
    // falls through to the default.
  }
  return parentSessionId;
}

/**
 * Best-effort marker payload — gives the stale sweep something to read for
 * `ts`, and the Stop hook a way to log who got reaped.
 */
function markerBody(
  payload: ClaudeInflightHookPayload,
  rootSessionId: string,
): string {
  return JSON.stringify({
    kind: payload.hook_event_name ?? null,
    parent_session_id: payload.session_id,
    root: rootSessionId,
    agent_type: payload.agent_type ?? null,
    ts: Date.now(),
  });
}

/**
 * Handler for the hidden `_claude-inflight-hook` subcommand.
 *
 * Always returns 0 — silently swallows all errors. A buggy tracker must
 * never kill stages.
 */
export async function claudeInflightHookCommand(
  mode: ClaudeInflightHookMode,
): Promise<number> {
  let raw: string;
  try {
    raw = await Bun.stdin.text();
  } catch {
    return 0;
  }

  let payload: ClaudeInflightHookPayload;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isClaudeInflightHookPayload(parsed)) {
      return 0;
    }
    payload = parsed;
  } catch {
    return 0;
  }

  // `wait` is the TeammateIdle path — gate on the root session's in-flight
  // dir draining and exit. No marker write, no queue/release polling: the
  // event's `session_id` may be a teammate's session that the runtime never
  // enqueues to or releases, so reusing the Stop hook would risk hanging
  // for the whole 24-day timeout.
  if (mode === "wait") {
    try {
      const root = await resolveRoot(payload.session_id);
      await waitForInflightDrained(root);
    } catch {
      // Best-effort — the wait swallows internal errors and resolves on
      // timeout. A throw here would only happen on a path bug.
    }
    return 0;
  }

  const id = extractId(payload);
  if (!id) return 0;

  try {
    const dirs = claudeHookDirs();
    await fs.mkdir(dirs.inflight, { recursive: true });
    await fs.mkdir(dirs.inflightRoots, { recursive: true });

    const root = await resolveRoot(payload.session_id);

    if (mode === "start") {
      // Record the new agent's mapping so its own future descendants can
      // resolve the same root via `resolveRoot`.
      try {
        await Bun.write(rootsMapPath(id), root);
      } catch {
        // Best-effort: a missing mapping just means a nested subagent of
        // this id would mark under its immediate parent instead of the
        // ultimate root. Stale sweep cleans up either way.
      }

      await fs.mkdir(markerDirFor(root), { recursive: true });
      await Bun.write(markerPathFor(root, id), markerBody(payload, root));
    } else {
      // mode === "stop"
      try {
        await fs.unlink(markerPathFor(root, id));
      } catch (e: unknown) {
        const code = (e as NodeJS.ErrnoException | null)?.code;
        if (code !== "ENOENT") {
          // Ignore other errors silently — exit 0 is the contract.
        }
      }
    }
  } catch {
    // Catch-all: any FS or path failure → silent exit 0.
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Helpers exported for the Stop hook and clearClaudeSession
// ---------------------------------------------------------------------------

/** True when the per-root marker dir is missing or contains no marker files. */
export async function inflightDirIsEmpty(rootSessionId: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(markerDirFor(rootSessionId));
    return entries.length === 0;
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") return true;
    // On any other error, assume non-empty so we wait — wedging the wait is
    // worse than letting it advance with leaked FDs only when the FS is
    // genuinely broken.
    return false;
  }
}

/**
 * Remove markers older than `thresholdMs` (default `ATOMIC_INFLIGHT_STALE_MS`
 * or 2 h). Returns the number of markers reaped. Used by the Stop hook and
 * `waitForInflightDrained` to recover from subagents that crashed without
 * firing `SubagentStop`.
 */
export async function sweepStaleInflight(
  rootSessionId: string,
  thresholdMs?: number,
): Promise<number> {
  const dir = markerDirFor(rootSessionId);
  const cutoff = Date.now() - (thresholdMs ?? staleMs());
  let reaped = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry);
    try {
      const stat = await fs.stat(file);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(file);
        reaped += 1;
      }
    } catch {
      // ignore
    }
  }
  return reaped;
}

export interface WaitForInflightOptions {
  /** How long to wait before giving up. Default 30 minutes. */
  timeoutMs?: number;
  /** Poll cadence. Default 100 ms. */
  pollIntervalMs?: number;
  /** Stale-marker TTL. Default `ATOMIC_INFLIGHT_STALE_MS` or 2 h. */
  staleMs?: number;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_DRAIN_POLL_MS = 100;

/**
 * Resolve when the per-root marker dir is empty. Sweeps stale markers on
 * every tick. Resolves silently on timeout — the caller can't usefully
 * recover, so wedging vs. leaking is the only trade.
 */
export async function waitForInflightDrained(
  rootSessionId: string,
  options: WaitForInflightOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_DRAIN_POLL_MS;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (await inflightDirIsEmpty(rootSessionId)) return;
    if (Date.now() >= deadline) return;
    await sweepStaleInflight(rootSessionId, options.staleMs);
    if (await inflightDirIsEmpty(rootSessionId)) return;
    if (Date.now() >= deadline) return;
    await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * Remove the per-root marker dir and any roots-mapping entries that point
 * at this root. Called by `clearClaudeSession` on stage teardown so
 * leftovers cannot bleed into a future session that reuses the same id
 * (UUID collision is astronomically unlikely, but stale-sweep + cleanup
 * costs nothing).
 */
export async function clearInflightTracking(rootSessionId: string): Promise<void> {
  try {
    await fs.rm(markerDirFor(rootSessionId), { recursive: true, force: true });
  } catch {
    // ignore
  }
  // Sweep roots-mapping entries that point at this root.
  const dirs = claudeHookDirs();
  let entries: string[];
  try {
    entries = await fs.readdir(dirs.inflightRoots);
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(dirs.inflightRoots, entry);
      try {
        const value = (await fs.readFile(file, "utf-8")).trim();
        if (value === rootSessionId || entry === rootSessionId) {
          await fs.unlink(file);
        }
      } catch {
        // ignore
      }
    }),
  );
}
