/**
 * tmux session and pane management utilities.
 *
 * Provides low-level tmux operations for the workflow runtime:
 * creating sessions, splitting panes, spawning commands, capturing output,
 * sending keystrokes, and pane state detection.
 */

import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Subprocess } from "bun";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Dedicated tmux socket name — isolates Atomic sessions from the user's default server. */
export const SOCKET_NAME = "atomic";

/** Path to the bundled tmux config (shared by tmux and psmux). */
const CONFIG_PATH = join(import.meta.dir, "tmux.conf");

/** Discriminated result from a tmux command execution. */
export type TmuxResult =
  | { ok: true; stdout: string }
  | { ok: false; stderr: string };

// ---------------------------------------------------------------------------
// Core tmux primitives
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Default status-bar values — must match tmux.conf.
// Centralised here so restore logic in session-graph-panel stays in sync.
// ---------------------------------------------------------------------------

export const TMUX_DEFAULT_STATUS_LEFT = " ";
export const TMUX_DEFAULT_STATUS_LEFT_LENGTH = "10";
export const TMUX_DEFAULT_STATUS_RIGHT = " #{session_name} | %H:%M ";
export const TMUX_DEFAULT_STATUS_RIGHT_LENGTH = "60";

// Attached-mode status bar — agent list via tmux window list + shortcut hints.
// The window-status formats hide window 0 (orchestrator) and style agent names.
// tmux natively highlights the current window, so no React state sync is needed
// for agent cycling via Ctrl+\.
export const TMUX_ATTACHED_STATUS_RIGHT =
  "#[fg=#cdd6f4]ctrl+g #[fg=#6c7086]graph #[fg=#585b70]\u00b7 #[fg=#cdd6f4]ctrl+\\ #[fg=#6c7086]next ";
export const TMUX_ATTACHED_STATUS_RIGHT_LENGTH = "40";
export const TMUX_ATTACHED_WINDOW_FMT =
  "#{?#{==:#{window_index},0},, #W }";
export const TMUX_ATTACHED_WINDOW_STYLE = "fg=#6c7086";
export const TMUX_ATTACHED_WINDOW_CURRENT_STYLE = "fg=#cdd6f4,bold";

/**
 * Escape a string for safe interpolation into tmux format strings.
 * Replaces `#` with `##` to prevent tmux from interpreting `#[...]`
 * as style directives or `#(...)` as shell command expansions.
 */
export function escapeTmuxFormat(value: string): string {
  return value.replace(/#/g, "##");
}

// ---------------------------------------------------------------------------
// Core tmux primitives
// ---------------------------------------------------------------------------

/** Cached resolved multiplexer binary path. Resolved once on first use. */
let resolvedMuxBinary: string | null | undefined; // undefined = not yet resolved

/**
 * Resolve the terminal multiplexer binary for the current platform.
 *
 * On Windows, tries psmux → pmux → tmux (psmux ships all three as aliases).
 * On Unix/macOS, uses tmux directly.
 *
 * Returns the binary name (not the full path) or null if none is found.
 * The result is cached after the first call.
 */
export function getMuxBinary(): string | null {
  if (resolvedMuxBinary !== undefined) return resolvedMuxBinary;

  if (process.platform === "win32") {
    for (const candidate of ["psmux", "pmux", "tmux"]) {
      if (Bun.which(candidate)) {
        resolvedMuxBinary = candidate;
        return resolvedMuxBinary;
      }
    }
    resolvedMuxBinary = null;
    return null;
  }

  // Unix / macOS
  resolvedMuxBinary = Bun.which("tmux") ? "tmux" : null;
  return resolvedMuxBinary;
}

/**
 * Reset the cached multiplexer binary resolution.
 * Call after installing tmux/psmux to force re-detection.
 */
export function resetMuxBinaryCache(): void {
  resolvedMuxBinary = undefined;
}

/**
 * Check if tmux is installed and available.
 */
export function isTmuxInstalled(): boolean {
  return getMuxBinary() !== null;
}

/**
 * Check if we're currently inside a tmux session.
 */
export function isInsideTmux(): boolean {
  return process.env.TMUX !== undefined || process.env.PSMUX !== undefined;
}

/**
 * Run a tmux command and return a result object.
 * Prefers this over the throwing `tmux()` for cases where callers
 * need to handle failure gracefully.
 */
export function tmuxRun(args: string[]): TmuxResult {
  const binary = getMuxBinary();
  if (!binary) {
    return { ok: false, stderr: "No terminal multiplexer (tmux/psmux) found on PATH" };
  }
  const fullArgs = ["-f", CONFIG_PATH, "-L", SOCKET_NAME, ...args];
  const result = Bun.spawnSync({
    cmd: [binary, ...fullArgs],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!result.success) {
    return { ok: false, stderr: result.stderr.toString().trim() };
  }
  return { ok: true, stdout: result.stdout.toString().trim() };
}

/**
 * Run a tmux command and return stdout. Throws on failure.
 */
function tmux(args: string[]): string {
  const result = tmuxRun(args);
  if (!result.ok) {
    throw new Error(`tmux ${args[0]} failed: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Run a tmux command, ignoring output. Throws on failure.
 */
function tmuxExec(args: string[]): void {
  const result = tmuxRun(args);
  if (!result.ok) {
    throw new Error(`tmux ${args[0]} failed: ${result.stderr}`);
  }
}

// ---------------------------------------------------------------------------
// Session and pane management
// ---------------------------------------------------------------------------

/**
 * Build `-e KEY=VALUE` argument pairs for tmux environment flags.
 * Supported by tmux new-session/new-window since tmux 3.2.
 */
function buildEnvArgs(envVars?: Record<string, string>): string[] {
  if (!envVars) return [];
  const args: string[] = [];
  for (const [key, value] of Object.entries(envVars)) {
    args.push("-e", `${key}=${value}`);
  }
  return args;
}

/**
 * Create a new tmux session with the given name.
 * The session starts detached with an initial command in the first pane.
 *
 * @param sessionName - Unique session name
 * @param initialCommand - Shell command to run in the initial pane
 * @param windowName - Optional name for the initial window
 * @param cwd - Optional working directory for the initial pane
 * @param envVars - Optional environment variables for the initial pane
 * @returns The pane ID of the initial pane (e.g., "%0")
 */
export function createSession(
  sessionName: string,
  initialCommand: string,
  windowName?: string,
  cwd?: string,
  envVars?: Record<string, string>,
): string {
  const args = [
    "new-session",
    "-d",
    "-s", sessionName,
    "-P", "-F", "#{pane_id}",
    ...buildEnvArgs(envVars),
  ];
  if (windowName) {
    args.push("-n", windowName);
  }
  if (cwd) {
    args.push("-c", cwd);
  }
  args.push(initialCommand);
  const paneId = tmux(args);
  // Reload config into the running server so keybindings are always current
  // (tmux only loads -f on first server start; source-file updates a running server).
  tmuxRun(["source-file", CONFIG_PATH]);
  return paneId || tmux(["list-panes", "-t", sessionName, "-F", "#{pane_id}"]).split("\n")[0]!;
}

/**
 * Create a new window in an existing session without switching focus.
 *
 * @param sessionName - Target session name
 * @param windowName - Name for the new window
 * @param command - Shell command to run in the new window
 * @param cwd - Optional working directory for the new window
 * @param envVars - Optional environment variables for the new window
 * @returns The pane ID of the new window's pane
 */
export function createWindow(
  sessionName: string,
  windowName: string,
  command: string,
  cwd?: string,
  envVars?: Record<string, string>,
): string {
  const args = [
    "new-window",
    "-d",
    "-t", sessionName,
    "-n", windowName,
    "-P", "-F", "#{pane_id}",
    ...buildEnvArgs(envVars),
  ];
  if (cwd) {
    args.push("-c", cwd);
  }
  args.push(command);
  return tmux(args);
}

/**
 * Create a new pane in an existing session by splitting.
 *
 * @returns The pane ID of the new pane
 */
export function createPane(sessionName: string, command: string): string {
  return tmux([
    "split-window",
    "-t", sessionName,
    "-P", "-F", "#{pane_id}",
    command,
  ]);
}

// ---------------------------------------------------------------------------
// Keystroke sending
// ---------------------------------------------------------------------------

/**
 * Maximum bytes per `send-keys -l` invocation.
 *
 * tmux passes the text as a single command-line argument to the child
 * process. On Linux the per-argument limit (`MAX_ARG_STRLEN`) is 128 KB;
 * on macOS the total `ARG_MAX` is ~1 MB but shared across all args.
 * We stay well under both limits with 50 KB chunks.
 */
const SEND_KEYS_CHUNK_SIZE = 50_000;

/**
 * Send literal text to a tmux pane using `-l` flag (no special key interpretation).
 * Uses `--` to prevent text starting with `-` from being parsed as flags.
 *
 * Long texts are chunked to avoid OS `ARG_MAX` / `MAX_ARG_STRLEN` limits
 * that cause `tmux send-keys` to fail with "command too long".
 */
export function sendLiteralText(paneId: string, text: string): void {
  // Replace newlines with spaces to avoid premature submission
  const normalized = text.replace(/[\r\n]+/g, " ");

  if (normalized.length <= SEND_KEYS_CHUNK_SIZE) {
    tmuxExec(["send-keys", "-t", paneId, "-l", "--", normalized]);
    return;
  }

  for (let offset = 0; offset < normalized.length; offset += SEND_KEYS_CHUNK_SIZE) {
    const chunk = normalized.slice(offset, offset + SEND_KEYS_CHUNK_SIZE);
    tmuxExec(["send-keys", "-t", paneId, "-l", "--", chunk]);
  }
}

/**
 * Send text to a tmux pane via the paste buffer.
 *
 * More reliable than `send-keys -l` for large text:
 * - No OS ARG_MAX / MAX_ARG_STRLEN limits (text goes through a temp file)
 * - Atomic delivery — the entire text is pasted at once
 * - No chunking needed
 *
 * Newlines are normalized to spaces to prevent premature submission,
 * matching `sendLiteralText`'s behavior.
 */
export function sendViaPasteBuffer(paneId: string, text: string): void {
  const normalized = text.replace(/[\r\n]+/g, " ");
  const tmp = join(tmpdir(), `atomic-paste-${process.pid}-${Date.now()}.txt`);

  writeFileSync(tmp, normalized, "utf-8");
  try {
    tmuxExec(["load-buffer", tmp]);
    tmuxExec(["paste-buffer", "-t", paneId, "-d"]);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // Temp file cleanup is best-effort
    }
  }
}

/**
 * Send a special key (C-m, C-c, C-u, Tab, etc.) to a tmux pane.
 */
export function sendSpecialKey(paneId: string, key: string): void {
  tmuxExec(["send-keys", "-t", paneId, key]);
}

/**
 * Send literal text and submit with C-m (carriage return).
 * Uses C-m instead of Enter for raw-mode TUI compatibility.
 *
 * @param presses - Number of C-m presses (default: 1)
 * @param delayMs - Delay between presses in ms (default: 100)
 */
export async function sendKeysAndSubmit(
  paneId: string,
  text: string,
  presses = 1,
  delayMs = 100
): Promise<void> {
  sendLiteralText(paneId, text);

  for (let i = 0; i < presses; i++) {
    if (i > 0 && delayMs > 0) {
      await Bun.sleep(delayMs);
    }
    sendSpecialKey(paneId, "C-m");
  }
}

// ---------------------------------------------------------------------------
// Pane capture
// ---------------------------------------------------------------------------

/**
 * Capture the visible content of a tmux pane.
 *
 * @param paneId - The pane ID (e.g., "%0")
 * @param start - Start line (negative = from bottom, default: capture visible only)
 */
export function capturePane(paneId: string, start?: number): string {
  const args = ["capture-pane", "-t", paneId, "-p"];
  if (start !== undefined) {
    args.push("-S", String(start));
  }
  return tmux(args);
}

/** Internal capture helper — returns empty string on failure. */
function capturePaneRaw(paneId: string, scrollbackLines?: number): string {
  const args = ["capture-pane", "-t", paneId, "-p"];
  if (scrollbackLines !== undefined) {
    args.push("-S", `-${scrollbackLines}`);
  }
  const result = tmuxRun(args);
  return result.ok ? result.stdout : "";
}

/**
 * Capture only the visible portion of a pane (no scrollback).
 * Preferred for state detection (ready/busy) to avoid stale prompt lines
 * or old activity indicators in scrollback triggering false positives.
 * Returns empty string on failure instead of throwing.
 */
export function capturePaneVisible(paneId: string): string {
  return capturePaneRaw(paneId);
}

/**
 * Capture last N lines of scrollback from a pane.
 * Preferred for output collection where you need recent history.
 * Returns empty string on failure instead of throwing.
 */
export function capturePaneScrollback(paneId: string, lines = 200): string {
  return capturePaneRaw(paneId, lines);
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Kill a tmux session.
 */
export function killSession(sessionName: string): void {
  try {
    tmuxExec(["kill-session", "-t", sessionName]);
  } catch {
    // Session may already be dead
  }
}

/** Kill a specific tmux window within a session. Silences errors if already dead. */
export function killWindow(sessionName: string, windowName: string): void {
  try {
    tmuxExec(["kill-window", "-t", `${sessionName}:${windowName}`]);
  } catch {
    // Window may already be dead
  }
}

/**
 * Check if a tmux session exists.
 */
export function sessionExists(sessionName: string): boolean {
  const result = tmuxRun(["has-session", "-t", sessionName]);
  return result.ok;
}

/** Build the full argument list for an attach-session command. */
function buildAttachArgs(sessionName: string): string[] {
  const binary = getMuxBinary();
  if (!binary) {
    throw new Error("No terminal multiplexer (tmux/psmux) found on PATH");
  }
  return [binary, "-f", CONFIG_PATH, "-L", SOCKET_NAME, "attach-session", "-t", sessionName];
}

/**
 * Attach to an existing tmux session (takes over the current terminal).
 */
export function attachSession(sessionName: string): void {
  const cmd = buildAttachArgs(sessionName);
  const proc = Bun.spawnSync({
    cmd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "pipe",
  });
  if (!proc.success) {
    const stderr = proc.stderr.toString().trim();
    throw new Error(`Failed to attach to session: ${sessionName}${stderr ? ` (${stderr})` : ""}`);
  }
}

/**
 * Spawn an interactive attach-session process.
 * Encapsulates binary resolution, config injection, and socket isolation.
 * Used by all async attach call sites (executor, chat).
 */
export function spawnMuxAttach(sessionName: string): Subprocess {
  return Bun.spawn(buildAttachArgs(sessionName), {
    stdio: ["inherit", "inherit", "inherit"],
  });
}

/**
 * Switch the current tmux client to a different session.
 * Use this instead of `attachSession` when already inside tmux to avoid
 * creating a nested tmux client.
 */
export function switchClient(sessionName: string): void {
  tmuxExec(["switch-client", "-t", sessionName]);
}

/**
 * Get the name of the current tmux session (when running inside tmux).
 * Returns null if not inside tmux or if the query fails.
 */
export function getCurrentSession(): string | null {
  if (!isInsideTmux()) return null;
  const result = tmuxRun(["display-message", "-p", "#{session_name}"]);
  if (!result.ok) return null;
  return result.stdout || null;
}

/**
 * Attach or switch to a tmux session depending on whether we're already
 * inside tmux. Avoids nested tmux clients.
 *
 * - Outside tmux: spawns `attach-session` (blocks until session ends).
 * - Inside tmux: runs `switch-client` (returns immediately).
 */
export function attachOrSwitch(sessionName: string): void {
  if (isInsideTmux()) {
    switchClient(sessionName);
  } else {
    attachSession(sessionName);
  }
}

/**
 * Select (switch to) a window within the current tmux session.
 */
export function selectWindow(target: string): void {
  tmuxExec(["select-window", "-t", target]);
}

// ---------------------------------------------------------------------------
// Normalization (ported from oh-my-codex's normalizeTmuxCapture)
// ---------------------------------------------------------------------------

/**
 * Collapse all whitespace to single spaces for robust capture comparison.
 * Prevents false negatives from tmux inserting/stripping whitespace.
 */
export function normalizeTmuxCapture(text: string): string {
  return text.replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Normalize captured text preserving line structure (for display output).
 */
export function normalizeTmuxLines(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

/** Split capture into cleaned, non-empty lines. */
function toPaneLines(captured: string): string[] {
  return captured
    .split("\n")
    .map((l) => l.replace(/\r/g, "").trimEnd())
    .filter((l) => l.trim() !== "");
}

// ---------------------------------------------------------------------------
// Pane state detection (ported from oh-my-codex's tmux-hook-engine.ts)
// ---------------------------------------------------------------------------

/** Returns true when the pane is still bootstrapping (loading/initializing). */
function paneIsBootstrapping(lines: string[]): boolean {
  return lines.some(
    (line) =>
      /\b(loading|initializing|starting up)\b/i.test(line) ||
      /\bmodel:\s*loading\b/i.test(line) ||
      /\bconnecting\s+to\b/i.test(line),
  );
}

/**
 * Returns true when the pane shows an agent prompt ready for input.
 * Detects Claude Code (❯), Codex (›), and generic (>) prompts.
 */
export function paneLooksReady(captured: string): boolean {
  const content = captured.trimEnd();
  if (content === "") return false;

  const lines = toPaneLines(content);
  if (paneIsBootstrapping(lines)) return false;

  if (lines.some((line) => /^\s*[›>❯]\s*/u.test(line))) return true;
  if (lines.some((line) => /\bhow can i help(?: you)?\b/i.test(line))) return true;

  return false;
}

/**
 * Returns true when the agent has an active task in progress.
 * Checks last 40 lines for known busy indicators.
 */
export function paneHasActiveTask(captured: string): boolean {
  const tail = toPaneLines(captured)
    .map((line) => line.trim())
    .slice(-40);

  return tail.some((l) =>
    /\b\d+\s+background terminal running\b/i.test(l) ||
    /esc to interrupt/i.test(l) ||
    /\bbackground terminal running\b/i.test(l) ||
    /^[·✻]\s+[A-Za-z][A-Za-z0-9''-]*(?:\s+[A-Za-z][A-Za-z0-9''-]*){0,3}(?:…|\.{3})$/u.test(l),
  );
}

/**
 * Returns true when the pane is idle — showing a prompt and not processing.
 * Uses visible-only capture to avoid stale scrollback matches.
 */
export function paneIsIdle(paneId: string): boolean {
  const visible = capturePaneVisible(paneId);
  return paneLooksReady(visible) && !paneHasActiveTask(visible);
}

// ---------------------------------------------------------------------------
// Readiness wait
// ---------------------------------------------------------------------------

/**
 * Wait for the pane to be idle (prompt visible, no active task) with
 * exponential backoff. Returns the time spent waiting (ms).
 */
export async function waitForPaneReady(paneId: string, timeoutMs: number = 30_000): Promise<number> {
  const startedAt = Date.now();
  let delayMs = 150;
  const maxDelayMs = 8_000;

  while (Date.now() - startedAt < timeoutMs) {
    if (paneIsIdle(paneId)) return Date.now() - startedAt;

    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    await Bun.sleep(Math.min(delayMs, remaining));
    delayMs = Math.min(maxDelayMs, delayMs * 2);
  }

  return Date.now() - startedAt;
}

// ---------------------------------------------------------------------------
// Submit rounds with per-round verification
// ---------------------------------------------------------------------------

/**
 * Attempt to submit by pressing C-m, verifying after each round.
 * Returns true as soon as the trigger text disappears from the visible
 * capture or an active task is detected.
 */
export async function attemptSubmitRounds(
  paneId: string,
  normalizedPrompt: string,
  rounds: number,
  pressesPerRound: number = 1,
): Promise<boolean> {
  const presses = Math.max(1, Math.floor(pressesPerRound));

  for (let round = 0; round < rounds; round++) {
    await Bun.sleep(100);

    for (let press = 0; press < presses; press++) {
      sendSpecialKey(paneId, "C-m");
      if (press < presses - 1) await Bun.sleep(200);
    }

    await Bun.sleep(140);

    const visible = capturePaneVisible(paneId);
    if (!normalizeTmuxCapture(visible).includes(normalizedPrompt)) return true;
    if (paneHasActiveTask(visible)) return true;

    await Bun.sleep(140);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Output waiting
// ---------------------------------------------------------------------------

/**
 * Wait for a pattern to appear in a tmux pane's output.
 * Polls the pane content at the given interval until the pattern matches
 * or the timeout is reached.
 *
 * @returns The full pane content when the pattern was found
 */
export async function waitForOutput(
  paneId: string,
  pattern: RegExp,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<string> {
  const { timeoutMs = 30_000, pollIntervalMs = 500 } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const content = capturePane(paneId);
    if (pattern.test(content)) {
      return content;
    }
    await Bun.sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for pattern ${pattern} in pane ${paneId}`);
}
