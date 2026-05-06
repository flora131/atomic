/**
 * Thin wrapper around the SDK's `tmuxRun` for status-line option
 * writes. Lives in tui/ rather than runtime/ to keep the compile
 * pipeline self-contained — consumers of this module shouldn't need
 * to know about the broader tmux helper.
 *
 * Every setter accepts an optional session name. When provided, the
 * option is set scoped to that session (`-t <session>`) instead of
 * globally (`-g`). All footer machinery uses session-scope so that
 * concurrent atomic sessions on the shared psmux server (e.g. a chat
 * session and a workflow session) don't clobber each other's
 * status-line.
 */

import { tmuxRun, type TmuxResult } from "../runtime/tmux.ts";

function targetArgs(sessionName: string | undefined): string[] {
  return sessionName === undefined ? ["-g"] : ["-t", sessionName];
}

/** Set a tmux/psmux option, optionally scoped to a single session. */
export function setOption(
  name: string,
  value: string,
  sessionName?: string,
): TmuxResult {
  return tmuxRun(["set-option", ...targetArgs(sessionName), name, value]);
}

/** Set a value-only option (e.g. `status 2`), optionally session-scoped. */
export function setOptionRaw(
  name: string,
  value: string | number,
  sessionName?: string,
): TmuxResult {
  return tmuxRun([
    "set-option",
    ...targetArgs(sessionName),
    name,
    String(value),
  ]);
}

/** Set an option scoped to a single window (target = `<session>:<window>`). */
export function setWindowOption(
  windowTarget: string,
  name: string,
  value: string,
): TmuxResult {
  return tmuxRun(["set-option", "-w", "-t", windowTarget, name, value]);
}

/**
 * Push a value into the `@atomic-<id>` user-option namespace. The
 * format string can reference these via `#{@atomic-<id>}` and psmux
 * re-renders the status line on the next refresh tick. This is the
 * push-based escape hatch for content that changes after the initial
 * compile.
 */
export function setStatuslineState(
  id: string,
  value: string,
  sessionName?: string,
): TmuxResult {
  return setOption(`@atomic-${id}`, value, sessionName);
}
