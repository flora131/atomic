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
 * - File-based idle detection via session JSONL watching
 */

import {
  listSessions,
  getSessionMessages,
  query as sdkQuery,
  type SessionMessage,
  type SDKUserMessage,
  type Options as SDKOptions,
} from "@anthropic-ai/claude-agent-sdk";
import {
  sendViaPasteBuffer,
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
import { watch } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Session tracking — ensures createClaudeSession is called before claudeQuery
// ---------------------------------------------------------------------------

/** Per-pane state for Claude sessions. */
interface PaneState {
  /** Claude Code's own session ID. Resolved after the first query is sent. */
  claudeSessionId: string | undefined;
  /** Session IDs that existed before this pane's Claude instance started. */
  knownSessionIds: Set<string>;
}

const initializedPanes = new Map<string, PaneState>();

/**
 * Remove a pane from the initialized map, freeing memory.
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

  // Snapshot existing Claude sessions BEFORE starting, so we can identify the
  // new session later by diffing against this set. The directory may not exist
  // on first run — that's fine, the known set is just empty.
  let knownSessionIds = new Set<string>();
  try {
    const existing = await listSessions({ dir: process.cwd() });
    knownSessionIds = new Set(existing.map((s) => s.sessionId));
  } catch {
    // No session directory yet — all sessions will be "new"
  }

  const cmd = ["claude", ...chatFlags].join(" ");
  await sendKeysAndSubmit(paneId, cmd);

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

  // Session ID is resolved lazily in claudeQuery — Claude doesn't write its
  // session file until it receives the first message.
  initializedPanes.set(paneId, {
    claudeSessionId: undefined,
    knownSessionIds,
  });
}

/**
 * Find a session ID that isn't in the known set.
 * Returns `undefined` if no new session exists yet.
 */
async function findNewSessionId(
  knownSessionIds: Set<string>,
  cwd: string,
): Promise<string | undefined> {
  try {
    const sessions = await listSessions({ dir: cwd });
    return sessions.find((s) => !knownSessionIds.has(s.sessionId))?.sessionId;
  } catch {
    return undefined;
  }
}

/**
 * Watch for a new Claude session JSONL file to appear on disk.
 *
 * Uses the `fs/promises` `watch()` async iterator (backed by inotify/kqueue
 * in Bun — OS-native, no polling) for instant notification when Claude writes
 * its session file. A `Bun.sleep`-based polling loop runs concurrently to
 * handle the case where the session directory doesn't exist yet (first run).
 *
 * An `AbortController` coordinates the timeout and cleanup across both
 * watchers — whichever detects the session first wins the `Promise.race`,
 * and the abort signal tears down the other.
 */
async function waitForSessionFile(
  knownSessionIds: Set<string>,
  timeoutMs: number,
): Promise<string> {
  const cwd = process.cwd();
  const sessionDir = resolveSessionDir(cwd);
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);

  try {
    return await Promise.race([
      // fs.watch — instant OS-native notification (inotify/kqueue in Bun)
      (async (): Promise<string> => {
        try {
          for await (const event of watch(sessionDir, {
            signal: ac.signal,
          })) {
            if (event.filename?.endsWith(".jsonl")) {
              const id = await findNewSessionId(knownSessionIds, cwd);
              if (id) return id;
            }
          }
        } catch (e: unknown) {
          if (e instanceof Error && e.name === "AbortError") throw e;
          // Directory doesn't exist yet — let polling handle it
        }
        // Park this branch so polling can win the race
        return new Promise<string>(() => {});
      })(),

      // Polling fallback — handles directory-not-yet-created case
      (async (): Promise<string> => {
        while (!ac.signal.aborted) {
          const id = await findNewSessionId(knownSessionIds, cwd);
          if (id) return id;
          await Bun.sleep(500);
        }
        throw new DOMException("Aborted", "AbortError");
      })(),
    ]);
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(
        "Timed out waiting for Claude to write its session file. " +
        "Verify the `claude` command started successfully.",
      );
    }
    throw e;
  } finally {
    clearTimeout(timeout);
    ac.abort();
  }
}

/**
 * Resolve the session directory for a given cwd.
 * Session files live at `~/.claude/projects/<encoded-cwd>/`.
 */
function resolveSessionDir(cwd: string): string {
  const encodedCwd = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return `${home}/.claude/projects/${encodedCwd}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Idle detection via pane capture
// ---------------------------------------------------------------------------

/**
 * Wait for the Claude session to become idle by polling the tmux pane.
 *
 * Interactive Claude Code sessions don't write idle or result events to the
 * JSONL session file (those only flow through the SDK streaming output for
 * headless consumers). The pane prompt indicator is the only reliable idle
 * signal for interactive sessions.
 *
 * Once idle is detected, assistant output is extracted from the session
 * transcript via `getSessionMessages()` rather than scraping the pane —
 * the transcript has structured content blocks, not terminal escape codes.
 *
 * No timeout is imposed. The loop runs until the pane shows the idle prompt.
 */
async function waitForIdle(
  paneId: string,
  claudeSessionId: string | undefined,
  transcriptBeforeCount: number,
  beforeContent: string,
  pollIntervalMs: number,
): Promise<SessionMessage[]> {
  // Give Claude time to start processing before first poll
  await Bun.sleep(3_000);

  while (true) {
    const currentContent = normalizeTmuxLines(capturePaneScrollback(paneId));

    // Must have new content compared to before we sent
    if (currentContent !== beforeContent) {
      const visible = capturePaneVisible(paneId);
      if (paneLooksReady(visible) && !paneHasActiveTask(visible)) {
        // Pane is idle — return transcript messages from this turn
        if (claudeSessionId) {
          try {
            const msgs = await getSessionMessages(claudeSessionId, {
              dir: process.cwd(),
              includeSystemMessages: true,
            });
            if (msgs.length > transcriptBeforeCount) {
              return msgs.slice(transcriptBeforeCount);
            }
          } catch {
            // Transcript read failed — return empty
          }
        }
        return [];
      }
    }

    await Bun.sleep(pollIntervalMs);
  }
}

// ---------------------------------------------------------------------------
// claudeQuery
// ---------------------------------------------------------------------------

export interface ClaudeQueryOptions {
  /** tmux pane ID where Claude is running */
  paneId: string;
  /** The prompt to send */
  prompt: string;
  /** Polling interval in ms (default: 2000) */
  pollIntervalMs?: number;
  /** Number of C-m presses per submit round (default: 1 for Claude) */
  submitPresses?: number;
  /** Max submit rounds if text isn't consumed (default: 6) */
  maxSubmitRounds?: number;
  /** Timeout in ms waiting for pane to be ready before sending (default: 30s) */
  readyTimeoutMs?: number;
}

/**
 * Extract text content from assistant messages in a transcript slice.
 *
 * Walks messages from `afterIndex` forward, pulls `TextBlock.text` from each
 * assistant message's content array, and joins them. The `message` payload is
 * `unknown` in the SDK type so we do runtime narrowing.
 *
 * Exported so workflow authors can extract text from `SessionMessage[]`
 * returned by `s.session.query()`.
 */
export function extractAssistantText(
  msgs: ReadonlyArray<{ type: string; message: unknown }>,
  afterIndex: number,
): string {
  const parts: string[] = [];
  for (let i = afterIndex; i < msgs.length; i++) {
    const msg = msgs[i];
    if (!msg || msg.type !== "assistant") continue;
    const m = msg.message;
    if (!m || typeof m !== "object") continue;
    const content = (m as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text"
      ) {
        parts.push(String((block as Record<string, unknown>).text ?? ""));
      }
    }
  }
  return parts.join("\n");
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
export async function claudeQuery(options: ClaudeQueryOptions): Promise<SessionMessage[]> {
  const {
    paneId,
    prompt,
    pollIntervalMs = 2_000,
    submitPresses = 1,
    maxSubmitRounds = 6,
    readyTimeoutMs = 30_000,
  } = options;

  const paneState = initializedPanes.get(paneId);
  if (!paneState) {
    throw new Error(
      "claudeQuery() called without a prior createClaudeSession() for this pane. " +
      "Call createClaudeSession({ paneId }) first to start the Claude CLI.",
    );
  }

  const normalizedPrompt = normalizeTmuxCapture(prompt).slice(0, 100);
  const dir = process.cwd();
  let { claudeSessionId } = paneState;

  // Step 1: Wait for pane readiness before sending
  await waitForPaneReady(paneId, readyTimeoutMs);

  // ── Transcript snapshot (before send) ──
  // Must be taken BEFORE sending so we get an accurate baseline. On the
  // first query the session ID is unknown (Claude hasn't written its file
  // yet), so transcriptBeforeCount stays 0 and we extract all messages.
  let transcriptBeforeCount = 0;
  if (claudeSessionId) {
    try {
      const msgs = await getSessionMessages(claudeSessionId, {
        dir,
        includeSystemMessages: true,
      });
      transcriptBeforeCount = msgs.length;
    } catch {
      // Best-effort — 0 means we scan all messages (correct, slightly less efficient)
    }
  }

  const beforeContent = normalizeTmuxLines(capturePaneScrollback(paneId));

  // Step 2: Send text via paste buffer (atomic, handles large prompts)
  sendViaPasteBuffer(paneId, prompt);
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
      sendViaPasteBuffer(paneId, prompt);
      await Bun.sleep(120);
      delivered = await attemptSubmitRounds(paneId, normalizedPrompt, maxSubmitRounds, submitPresses);
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

  // ── Resolve session ID (after send, first query only) ──
  // Claude doesn't write its session file until it receives the first message.
  if (!claudeSessionId) {
    try {
      claudeSessionId = await waitForSessionFile(
        paneState.knownSessionIds,
        readyTimeoutMs,
      );
      paneState.claudeSessionId = claudeSessionId;
    } catch {
      // Session file not found — output will fall back to pane content
    }
  }

  // Step 6: Wait for response completion via pane capture
  //
  // Interactive Claude Code sessions don't write idle/result events to the
  // JSONL. The pane prompt indicator is the only reliable idle signal.
  // Once idle, output is extracted from the transcript when available.
  return waitForIdle(
    paneId,
    claudeSessionId,
    transcriptBeforeCount,
    beforeContent,
    pollIntervalMs,
  );
}

// ---------------------------------------------------------------------------
// Synthetic wrappers — uniform s.client / s.session API for Claude stages
// ---------------------------------------------------------------------------

/**
 * Default query options the user can set per-stage via the `sessionOpts` arg.
 * These become defaults for every `s.session.query()` call within that stage.
 */
export interface ClaudeQueryDefaults {
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
    opts?: Partial<ClaudeQueryDefaults & SDKOptions>,
  ): Promise<SessionMessage[]> {
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
// Headless wrappers — use the Agent SDK directly (no tmux pane)
// ---------------------------------------------------------------------------

/**
 * Headless client wrapper for Claude stages. No tmux pane — noop start/stop.
 * Used when `options.headless` is true in `ctx.stage()`.
 */
export class HeadlessClaudeClientWrapper {
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

/**
 * Headless session wrapper for Claude stages. Uses the Agent SDK's `query()`
 * directly instead of tmux pane operations. Implements the same `query()`
 * interface as {@link ClaudeSessionWrapper} so workflow callbacks work
 * identically for headless and interactive stages.
 *
 * The `query()` method accepts the full Agent SDK parameter types —
 * `prompt` can be a plain string or an `AsyncIterable<SDKUserMessage>`
 * for multi-turn streaming, and `options` passes through SDK-level
 * configuration (abort controllers, allowed tools, agents, etc.).
 */
export class HeadlessClaudeSessionWrapper {
  readonly paneId = "";
  readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async query(
    prompt: string | AsyncIterable<SDKUserMessage>,
    options?: Partial<ClaudeQueryDefaults & SDKOptions>,
  ): Promise<SessionMessage[]> {
    // Strip query-defaults fields; the rest are SDK options
    const {
      pollIntervalMs: _a,
      submitPresses: _b,
      maxSubmitRounds: _c,
      readyTimeoutMs: _d,
      ...sdkOpts
    } = options ?? {};

    let sdkSessionId = "";
    for await (const msg of sdkQuery({ prompt, options: sdkOpts })) {
      if (msg.type === "result") {
        sdkSessionId = String((msg as Record<string, unknown>).session_id ?? "");
      }
    }
    // Read the transcript to return native SessionMessage[]
    if (sdkSessionId) {
      return getSessionMessages(sdkSessionId, { dir: process.cwd() });
    }
    return [];
  }

  async disconnect(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Static source validation
// ---------------------------------------------------------------------------

import { createProviderValidator } from "../types.ts";

/**
 * Validate a Claude workflow source file for common mistakes.
 *
 * Warns on direct usage of createClaudeSession/claudeQuery — the runtime
 * now handles init/cleanup automatically via s.client and s.session.
 */
export const validateClaudeWorkflow = createProviderValidator([
  {
    pattern: /\bcreateClaudeSession\b/,
    rule: "claude/manual-session",
    message:
      "Manual createClaudeSession() call detected. The runtime auto-starts the Claude CLI — " +
      "use s.session.query() instead of claudeQuery(). Pass chatFlags via the second arg to ctx.stage().",
  },
  {
    pattern: /\bclaudeQuery\b/,
    rule: "claude/manual-query",
    message:
      "Direct claudeQuery() call detected. Use s.session.query(prompt) instead — " +
      "it wraps claudeQuery with the correct paneId.",
  },
]);
