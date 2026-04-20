#!/usr/bin/env bun
/**
 * Ctrl+C debounce helper for Atomic-managed tmux panes.
 *
 * Invoked from `tmux.conf` on every root-table Ctrl+C:
 *
 *   bind -n C-c run-shell -b '"#{@atomic-bun}" "#{@atomic-cc-debounce}" "#{pane_id}"'
 *
 * The binding sits on the shared atomic tmux server, so the debounce
 * applies uniformly to every pane — Claude Code, OpenCode, and Copilot
 * CLI, in both chat and workflow sessions.
 *
 * Rule: forward Ctrl+C only if the previous press is more than QUIET_MS
 * ago. The state file is touched on *every* press (forwarded or
 * swallowed) so sustained spam keeps extending the cooldown instead of
 * letting a press leak through every QUIET_MS interval — which is what
 * would otherwise still trigger an agent CLI's "double-tap to exit"
 * confirmation.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

/** Quiet period (ms) the user must leave between presses for the next
 *  one to be forwarded. Must exceed every integrated agent's exit-confirm
 *  window — Claude Code's is the widest (~1.5 s), so 1200 ms is a safe
 *  margin that still feels responsive for legitimate double-interrupts. */
export const QUIET_MS = 1200;

/** Pure decision helper — exported so tests can exercise it without
 *  touching the filesystem or spawning tmux. Returns `true` when the
 *  press should be forwarded, `false` when it should be swallowed. */
export function shouldForward(
  nowMs: number,
  lastMs: number,
  quietMs: number = QUIET_MS,
): boolean {
  return nowMs - lastMs > quietMs;
}

/** Filesystem-safe transform for a tmux pane id (typically `%0`, `%12`).
 *  A defensive sanitise keeps the path portable if tmux ever hands us
 *  something with shell metacharacters. */
function stateFileFor(paneId: string): string {
  const safe = paneId.replace(/[^a-zA-Z0-9_%-]/g, "_");
  return join(tmpdir(), `atomic-cc-${safe}`);
}

function readLastPress(stateFile: string): number {
  try {
    const parsed = Number.parseInt(readFileSync(stateFile, "utf8").trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/** Resolve the multiplexer binary for `tmux send-keys`. When `run-shell`
 *  spawns this script the `TMUX` / `PSMUX` env var is already set to the
 *  atomic socket, so plain `tmux` / `psmux` routes correctly without
 *  `-L`. We only need to pick the right executable name for the host. */
function resolveMuxBinary(): string {
  if (process.platform === "win32") {
    for (const candidate of ["psmux", "pmux", "tmux"]) {
      if (Bun.which(candidate)) return candidate;
    }
    return "psmux";
  }
  return "tmux";
}

function main(): number {
  const paneId = process.argv[2];
  if (!paneId) return 0;

  const stateFile = stateFileFor(paneId);
  const now = Date.now();
  const last = readLastPress(stateFile);

  // Always bump the timestamp so held-down or spammed presses keep
  // extending the cooldown — this is what turns the single-press gate
  // into a true quiet-period debounce.
  try {
    writeFileSync(stateFile, String(now));
  } catch {
    // Best-effort: if the tmp dir is read-only we'd rather forward every
    // press than drop them silently.
  }

  if (!shouldForward(now, last)) return 0;

  const proc = Bun.spawnSync({
    cmd: [resolveMuxBinary(), "send-keys", "-t", paneId, "C-c"],
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  return proc.exitCode ?? 0;
}

if (import.meta.main) {
  process.exit(main());
}
