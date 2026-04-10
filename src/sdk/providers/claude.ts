/**
 * Claude Code query abstraction.
 *
 * Sends a prompt to an interactive Claude Code session running in a tmux pane
 * using `tmux send-keys -l --` (literal text) + `C-m` (raw carriage return).
 * Verifies delivery by polling `capture-pane` and retries if needed.
 *
 * This is NOT headless — Claude runs as a full interactive TUI in the pane.
 * We're automating keyboard input and reading pane output.
 *
 * Reliability hardened from oh-my-codex's sendToWorker implementation:
 * - Pre-send readiness wait with exponential backoff
 * - CLI-specific submit plan (Claude: 1 C-m per round)
 * - Per-round capture verification (6 rounds)
 * - Adaptive retry with C-u clear + retype
 * - Post-submit active-task detection
 * - Whitespace-collapsing normalization
 */

import {
  sendLiteralText,
  sendSpecialKey,
  sendKeysAndSubmit,
  capturePaneVisible,
  capturePaneScrollback,
  normalizeTmuxCapture,
  normalizeTmuxLines,
  paneLooksReady,
  paneHasActiveTask,
  waitForPaneReady,
  attemptSubmitRounds,
} from "../runtime/tmux.ts";

// ---------------------------------------------------------------------------
// Session tracking — ensures createClaudeSession is called before claudeQuery
// ---------------------------------------------------------------------------

const initializedPanes = new Set<string>();

/**
 * Remove a pane from the initialized set, freeing memory.
 * Call when a Claude session is killed or no longer needed.
 */
export function clearClaudeSession(paneId: string): void {
  initializedPanes.delete(paneId);
}

/** Default CLI flags passed to the `claude` command. */
const DEFAULT_CHAT_FLAGS = [
  "--allow-dangerously-skip-permissions",
  "--dangerously-skip-permissions",
];

// ---------------------------------------------------------------------------
// createClaudeSession
// ---------------------------------------------------------------------------

export interface ClaudeSessionOptions {
  /** tmux pane ID where Claude should be started */
  paneId: string;
  /** CLI flags to pass to the `claude` command (default: ["--allow-dangerously-skip-permissions", "--dangerously-skip-permissions"]) */
  chatFlags?: string[];
  /** Timeout in ms waiting for Claude TUI to be ready (default: 30s) */
  readyTimeoutMs?: number;
}

/**
 * Start Claude Code in a tmux pane with configurable CLI flags.
 *
 * Must be called before any `claudeQuery()` calls targeting the same pane.
 * The pane should be a bare shell — `createClaudeSession` sends the `claude`
 * command with the given flags and waits for the TUI to become ready.
 *
 * @example
 * ```typescript
 * import { createClaudeSession, claudeQuery } from "@bastani/atomic/workflows";
 *
 * await createClaudeSession({ paneId: ctx.paneId });
 * await claudeQuery({ paneId: ctx.paneId, prompt: "Describe this project" });
 * ```
 *
 * @example
 * ```typescript
 * // With custom flags
 * await createClaudeSession({
 *   paneId: ctx.paneId,
 *   chatFlags: ["--model", "opus", "--dangerously-skip-permissions"],
 * });
 * ```
 */
export async function createClaudeSession(options: ClaudeSessionOptions): Promise<void> {
  const {
    paneId,
    chatFlags = DEFAULT_CHAT_FLAGS,
    readyTimeoutMs = 30_000,
  } = options;

  const cmd = ["claude", ...chatFlags].join(" ");
  sendKeysAndSubmit(paneId, cmd);

  // Give the shell time to exec before polling for TUI readiness
  await Bun.sleep(1_000);
  await waitForPaneReady(paneId, readyTimeoutMs);

  // Verify Claude TUI actually rendered — a bare shell or crash won't show
  // the expected prompt/task indicators
  const visible = capturePaneVisible(paneId);
  if (!paneLooksReady(visible) && !paneHasActiveTask(visible)) {
    throw new Error(
      "createClaudeSession() timed out waiting for the Claude TUI to start. " +
      "Verify the `claude` command is installed and the flags are valid.",
    );
  }

  initializedPanes.add(paneId);
}

// ---------------------------------------------------------------------------
// claudeQuery
// ---------------------------------------------------------------------------

export interface ClaudeQueryOptions {
  /** tmux pane ID where Claude is running */
  paneId: string;
  /** The prompt to send */
  prompt: string;
  /** Timeout in ms waiting for Claude to finish responding (default: 300s) */
  timeoutMs?: number;
  /** Polling interval in ms (default: 2000) */
  pollIntervalMs?: number;
  /** Number of C-m presses per submit round (default: 1 for Claude) */
  submitPresses?: number;
  /** Max submit rounds if text isn't consumed (default: 6) */
  maxSubmitRounds?: number;
  /** Timeout in ms waiting for pane to be ready before sending (default: 30s) */
  readyTimeoutMs?: number;
}

export interface ClaudeQueryResult {
  /** The full pane content after the response completed */
  output: string;
  /** Whether delivery was confirmed (text disappeared from input) */
  delivered: boolean;
}

/**
 * Send a prompt to a Claude Code interactive session running in a tmux pane.
 *
 * Flow (hardened from OMX's sendToWorker):
 * 1. Wait for pane readiness with exponential backoff
 * 2. Capture pane content before sending
 * 3. Send literal text via `send-keys -l --`
 * 4. Submit with C-m rounds and per-round capture verification
 * 5. Adaptive retry: clear line (C-u), re-type, re-submit
 * 6. Post-submit verification via active-task detection
 * 7. Wait for response by polling for output stabilization + prompt return
 *
 * @example
 * ```typescript
 * import { claudeQuery } from "@bastani/atomic/workflows";
 *
 * const result = await claudeQuery({
 *   paneId: ctx.paneId,
 *   prompt: "Describe this project",
 * });
 * ctx.log(result.output);
 * ```
 */
export async function claudeQuery(options: ClaudeQueryOptions): Promise<ClaudeQueryResult> {
  const {
    paneId,
    prompt,
    timeoutMs = 300_000,
    pollIntervalMs = 2_000,
    submitPresses = 1,
    maxSubmitRounds = 6,
    readyTimeoutMs = 30_000,
  } = options;

  if (!initializedPanes.has(paneId)) {
    throw new Error(
      "claudeQuery() called without a prior createClaudeSession() for this pane. " +
      "Call createClaudeSession({ paneId }) first to start the Claude CLI.",
    );
  }

  const normalizedPrompt = normalizeTmuxCapture(prompt).slice(0, 100);

  // Step 1: Wait for pane readiness before sending (deducted from response timeout)
  const waitElapsed = await waitForPaneReady(paneId, readyTimeoutMs);
  const responseTimeoutMs = Math.max(0, timeoutMs - waitElapsed);

  if (waitElapsed > timeoutMs * 0.5) {
    console.warn(
      `claudeQuery: readiness wait consumed ${Math.round(waitElapsed / 1000)}s ` +
      `of ${Math.round(timeoutMs / 1000)}s total timeout budget`,
    );
  }

  const beforeContent = normalizeTmuxLines(capturePaneScrollback(paneId));

  // Step 2: Send literal text
  sendLiteralText(paneId, prompt);
  await Bun.sleep(150);

  // Step 3: Submit with per-round capture verification
  let delivered = await attemptSubmitRounds(paneId, normalizedPrompt, maxSubmitRounds, submitPresses);

  // Step 4: Adaptive retry — clear line, re-type, re-submit
  if (!delivered) {
    const visibleCapture = capturePaneVisible(paneId);
    const visibleNorm = normalizeTmuxCapture(visibleCapture);

    // Only retry if text is still visible and pane is idle (not mid-task)
    if (visibleNorm.includes(normalizedPrompt) && !paneHasActiveTask(visibleCapture) && paneLooksReady(visibleCapture)) {
      sendSpecialKey(paneId, "C-u");
      await Bun.sleep(80);
      sendLiteralText(paneId, prompt);
      await Bun.sleep(120);
      delivered = await attemptSubmitRounds(paneId, normalizedPrompt, 4, submitPresses);
    }
  }

  // Step 5: Final fallback — double C-m nudge + post-submit verification
  if (!delivered) {
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(120);
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(300);

    const verifyCapture = capturePaneVisible(paneId);
    if (paneHasActiveTask(verifyCapture)) {
      delivered = true;
    } else {
      delivered = !normalizeTmuxCapture(verifyCapture).includes(normalizedPrompt);
    }

    // One more attempt if text is still stuck
    if (!delivered) {
      sendSpecialKey(paneId, "C-m");
      await Bun.sleep(150);
      sendSpecialKey(paneId, "C-m");
    }
  }

  // Step 6: Wait for response by detecting output stabilization or prompt return
  const deadline = Date.now() + responseTimeoutMs;
  let lastContent = "";
  let stableCount = 0;

  // Give Claude time to start processing
  await Bun.sleep(3_000);

  while (Date.now() < deadline) {
    const currentContent = normalizeTmuxLines(capturePaneScrollback(paneId));

    // Must have new content compared to before we sent
    if (currentContent === beforeContent) {
      await Bun.sleep(pollIntervalMs);
      continue;
    }

    // Use visible capture for state detection to avoid stale scrollback matches
    const visible = capturePaneVisible(paneId);
    if (paneLooksReady(visible) && !paneHasActiveTask(visible)) {
      return { output: currentContent, delivered };
    }

    if (currentContent === lastContent) {
      stableCount++;
      if (stableCount >= 3) {
        return { output: currentContent, delivered };
      }
    } else {
      stableCount = 0;
    }

    lastContent = currentContent;
    await Bun.sleep(pollIntervalMs);
  }

  // Timeout — return whatever we have
  return { output: lastContent || capturePaneScrollback(paneId), delivered };
}

// ---------------------------------------------------------------------------
// Synthetic wrappers — uniform s.client / s.session API for Claude stages
// ---------------------------------------------------------------------------

/**
 * Default query options the user can set per-stage via the `sessionOpts` arg.
 * These become defaults for every `s.session.query()` call within that stage.
 */
export interface ClaudeQueryDefaults {
  /** Timeout in ms waiting for Claude to finish responding (default: 300s) */
  timeoutMs?: number;
  /** Polling interval in ms (default: 2000) */
  pollIntervalMs?: number;
  /** Number of C-m presses per submit round (default: 1) */
  submitPresses?: number;
  /** Max submit rounds if text isn't consumed (default: 6) */
  maxSubmitRounds?: number;
  /** Timeout in ms waiting for pane to be ready before sending (default: 30s) */
  readyTimeoutMs?: number;
}

/**
 * Synthetic client wrapper for Claude stages.
 * Auto-starts the Claude CLI in the tmux pane during `start()`.
 */
export class ClaudeClientWrapper {
  readonly paneId: string;
  private readonly opts: { chatFlags?: string[]; readyTimeoutMs?: number };

  constructor(
    paneId: string,
    opts: { chatFlags?: string[]; readyTimeoutMs?: number } = {},
  ) {
    this.paneId = paneId;
    this.opts = opts;
  }

  /** Start the Claude CLI in the tmux pane. Called by the runtime during init. */
  async start(): Promise<void> {
    await createClaudeSession({
      paneId: this.paneId,
      chatFlags: this.opts.chatFlags,
      readyTimeoutMs: this.opts.readyTimeoutMs,
    });
  }

  /** Noop — cleanup is handled by the runtime via `clearClaudeSession`. */
  async stop(): Promise<void> {}
}

/**
 * Synthetic session wrapper for Claude stages.
 * Wraps `claudeQuery()` so users call `s.session.query(prompt)`.
 */
export class ClaudeSessionWrapper {
  readonly paneId: string;
  readonly sessionId: string;
  private readonly defaults: ClaudeQueryDefaults;

  constructor(
    paneId: string,
    sessionId: string,
    defaults: ClaudeQueryDefaults = {},
  ) {
    this.paneId = paneId;
    this.sessionId = sessionId;
    this.defaults = defaults;
  }

  /** Send a prompt to Claude and wait for the response. */
  async query(
    prompt: string,
    opts?: Partial<ClaudeQueryDefaults>,
  ): Promise<ClaudeQueryResult> {
    return claudeQuery({
      paneId: this.paneId,
      prompt,
      ...this.defaults,
      ...opts,
    });
  }

  /** Noop — for API symmetry with CopilotSession.disconnect(). */
  async disconnect(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Static source validation
// ---------------------------------------------------------------------------

export interface ClaudeValidationWarning {
  rule: string;
  message: string;
}

/**
 * Validate a Claude workflow source file for common mistakes.
 *
 * Warns on direct usage of createClaudeSession/claudeQuery — the runtime
 * now handles init/cleanup automatically via s.client and s.session.
 */
export function validateClaudeWorkflow(source: string): ClaudeValidationWarning[] {
  const warnings: ClaudeValidationWarning[] = [];

  if (/\bcreateClaudeSession\b/.test(source)) {
    warnings.push({
      rule: "claude/manual-session",
      message:
        "Manual createClaudeSession() call detected. The runtime auto-starts the Claude CLI — " +
        "use s.session.query() instead of claudeQuery(). Pass chatFlags via the second arg to ctx.stage().",
    });
  }

  if (/\bclaudeQuery\b/.test(source)) {
    warnings.push({
      rule: "claude/manual-query",
      message:
        "Direct claudeQuery() call detected. Use s.session.query(prompt) instead — " +
        "it wraps claudeQuery with the correct paneId.",
    });
  }

  return warnings;
}
