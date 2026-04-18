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
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Session tracking — ensures createClaudeSession is called before claudeQuery
// ---------------------------------------------------------------------------

/** Per-pane state for Claude sessions. */
interface PaneState {
  /**
   * Claude Code's session ID. Pre-generated via `crypto.randomUUID()` in
   * `createClaudeSession` and passed to `claude --session-id <UUID>` on the
   * first query, so we know the JSONL filename without polling.
   */
  claudeSessionId: string;
  /** Whether the `claude` CLI has been spawned in this pane yet. */
  claudeStarted: boolean;
  /** CLI flags to pass to `claude` when it is spawned on the first query. */
  chatFlags: string[];
  /** Timeout in ms waiting for Claude TUI / JSONL file on first spawn. */
  readyTimeoutMs: number;
  /**
   * Workflow session directory (`~/.atomic/sessions/<runId>/<name>-<sid>`).
   * The first prompt is persisted here as `prompt.txt` so it appears in the
   * session log alongside `messages.json`, `metadata.json`, etc.
   */
  sessionDir: string;
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
  /**
   * Workflow session directory. The first prompt is written here as
   * `prompt.txt` and Claude is told to read from that path.
   */
  sessionDir: string;
  /** CLI flags to pass to the `claude` command (default: ["--allow-dangerously-skip-permissions", "--dangerously-skip-permissions"]) */
  chatFlags?: string[];
  /** Timeout in ms waiting for Claude TUI to be ready (default: 30s) */
  readyTimeoutMs?: number;
}

/**
 * Initialize per-pane Claude state. Does NOT spawn the `claude` CLI — the
 * pane is left as a bare shell. The CLI is spawned lazily on the first
 * `claudeQuery()` call, with the prompt baked into the spawn command:
 *
 *     claude [chatFlags] --session-id <UUID> 'Read the prompt in <tmpfile>'
 *
 * Pre-generating the session UUID here lets the first query pass it to the
 * CLI, so we know the JSONL filename up front and can skip discovery polling.
 *
 * Must be called before any `claudeQuery()` calls targeting the same pane.
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
    sessionDir,
    chatFlags = DEFAULT_CHAT_FLAGS,
    readyTimeoutMs = 30_000,
  } = options;

  initializedPanes.set(paneId, {
    claudeSessionId: randomUUID(),
    claudeStarted: false,
    chatFlags,
    readyTimeoutMs,
    sessionDir,
  });
}

/**
 * Spawn `claude` in the pane with the prompt baked in via the Read tool.
 *
 * The prompt is written to `${sessionDir}/prompt.txt` so it persists in the
 * workflow's session log alongside `messages.json`, `metadata.json`, etc.
 * The argv prompt is `Read the prompt in <path>`, so Claude's first action
 * is a Read tool call against that file. This sidesteps shell-escaping and
 * ARG_MAX entirely — the prompt bytes never traverse the shell parser or
 * the kernel argv cap.
 */
async function spawnClaudeWithPrompt(
  paneId: string,
  prompt: string,
  chatFlags: string[],
  sessionId: string,
  sessionDir: string,
  readyTimeoutMs: number,
): Promise<void> {
  const promptFile = join(sessionDir, "prompt.txt");
  writeFileSync(promptFile, prompt, "utf-8");

  // sessionDir is the workflow's `${name}-${sessionId}` directory under
  // ~/.atomic/sessions — slug-based, so single-quoting is sufficient on
  // POSIX and PowerShell alike.
  const argvPrompt = `'Read the prompt in ${promptFile}'`;
  const cmd = [
    "claude",
    ...chatFlags,
    "--session-id",
    sessionId,
    argvPrompt,
  ].join(" ");

  await sendKeysAndSubmit(paneId, cmd);

  // SDK-native readiness signal: wait for Claude to create its JSONL file
  // at the known UUID path. No pane scraping, no paneLooksReady check.
  await waitForSessionFileAt(sessionId, readyTimeoutMs);
}

/**
 * Wait for Claude's JSONL session file at a known UUID-named path to exist.
 *
 * Because we pass `--session-id <UUID>` to the spawn, the file's exact path
 * is deterministic — we just need to wait for it to appear. Uses `fs.watch`
 * for instant OS-native notification (inotify/kqueue in Bun) racing against
 * a polling fallback that handles the case where the session directory
 * doesn't exist yet on first run.
 */
async function waitForSessionFileAt(
  sessionId: string,
  timeoutMs: number,
): Promise<void> {
  const sessionDir = resolveSessionDir(process.cwd());
  const targetPath = `${sessionDir}/${sessionId}.jsonl`;

  if (existsSync(targetPath)) return;

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);

  try {
    await Promise.race([
      // fs.watch — instant OS-native notification when Claude writes the file
      (async (): Promise<void> => {
        try {
          for await (const event of watch(sessionDir, { signal: ac.signal })) {
            if (event.filename === `${sessionId}.jsonl` && existsSync(targetPath)) {
              return;
            }
          }
        } catch (e: unknown) {
          if (e instanceof Error && e.name === "AbortError") throw e;
          // Directory doesn't exist yet — let polling handle it
        }
        // Park this branch so polling can win the race
        return new Promise<void>(() => {});
      })(),

      // Polling fallback — handles directory-not-yet-created case
      (async (): Promise<void> => {
        while (!ac.signal.aborted) {
          if (existsSync(targetPath)) return;
          await Bun.sleep(500);
        }
        throw new DOMException("Aborted", "AbortError");
      })(),
    ]);
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(
        `Timed out waiting for Claude session file at ${targetPath}. ` +
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
// HIL detection helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the most recent assistant message contains an
 * `AskUserQuestion` tool_use block that has not yet been resolved
 * by a corresponding `tool_result` in a subsequent user message.
 *
 * Pure function — no side effects, safe to call from a watch loop.
 *
 * Exported as `_hasUnresolvedHILTool` for unit testing.
 */
export function _hasUnresolvedHILTool(messages: SessionMessage[]): boolean {
  const resolvedIds = new Set<string>();

  for (const msg of messages) {
    if (msg.type !== "user") continue;
    const content = (msg.message as { content: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_result" && block.tool_use_id) {
        resolvedIds.add(block.tool_use_id);
      }
    }
  }

  for (const msg of [...messages].reverse()) {
    if (msg.type !== "assistant") continue;
    const content = (msg.message as { content: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        block.type === "tool_use" &&
        block.name === "AskUserQuestion" &&
        block.id &&
        !resolvedIds.has(block.id)
      ) {
        return true;
      }
    }
    break;
  }

  return false;
}

/**
 * Core HIL watcher loop — pure logic, dependency-injected for testability.
 *
 * Iterates an async iterable of "file change" events (each event triggers a
 * transcript read via `readMessages`). Calls `onHIL(true)` when
 * `_hasUnresolvedHILTool` first returns true, `onHIL(false)` when it returns
 * false after having been true. The `wasHIL` guard prevents redundant
 * callbacks on repeated events with the same HIL state.  Read errors from
 * `readMessages` are swallowed so a single corrupt JSONL write doesn't kill
 * the watcher.
 *
 * Exported as `_runHILWatcher` for unit testing (event source and message
 * reader are injected rather than hard-coded to `fs.watch` / `getSessionMessages`).
 */
export async function _runHILWatcher(
  events: AsyncIterable<unknown>,
  readMessages: () => Promise<SessionMessage[]>,
  onHIL: (waiting: boolean) => void,
): Promise<void> {
  let wasHIL = false;

  for await (const _event of events) {
    try {
      const msgs = await readMessages();
      const isHIL = _hasUnresolvedHILTool(msgs);
      if (isHIL !== wasHIL) {
        onHIL(isHIL);
        wasHIL = isHIL;
      }
    } catch {
      // Transcript read failed — skip this event, try again on next write
    }
  }
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
  onHIL?: (waiting: boolean) => void,
): Promise<SessionMessage[]> {
  // Give Claude time to start processing before first poll
  await Bun.sleep(3_000);

  let hilActive = false;

  while (true) {
    const currentContent = normalizeTmuxLines(capturePaneScrollback(paneId));

    // Must have new content compared to before we sent
    if (currentContent !== beforeContent) {
      const visible = capturePaneVisible(paneId);
      if (paneLooksReady(visible) && !paneHasActiveTask(visible)) {
        // Pane looks idle — but it might be waiting for user input (HIL).
        // Check the transcript for an unresolved AskUserQuestion before
        // treating this as a true completion.
        if (claudeSessionId) {
          try {
            const msgs = await getSessionMessages(claudeSessionId, {
              dir: process.cwd(),
              includeSystemMessages: true,
            });

            if (_hasUnresolvedHILTool(msgs)) {
              // Agent is blocked on user input — signal HIL and keep waiting
              if (!hilActive && onHIL) {
                onHIL(true);
                hilActive = true;
              }
              await Bun.sleep(pollIntervalMs);
              continue;
            }

            // HIL was active but is now resolved — signal resumption
            if (hilActive && onHIL) {
              onHIL(false);
              hilActive = false;
              // Agent may still be processing after HIL resolution — keep
              // polling instead of returning immediately
              await Bun.sleep(pollIntervalMs);
              continue;
            }

            // Truly idle — return transcript messages from this turn
            if (msgs.length > transcriptBeforeCount) {
              return msgs.slice(transcriptBeforeCount);
            }
          } catch {
            // Transcript read failed — return empty
          }
        }
        return [];
      } else if (hilActive) {
        // Pane is active again (user responded, agent resumed processing).
        // Clear HIL state.
        if (onHIL) {
          onHIL(false);
          hilActive = false;
        }
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
  /**
   * Called when the agent's human-in-the-loop state changes.
   * `waiting=true`  → AskUserQuestion is pending (agent blocked on user input).
   * `waiting=false` → AskUserQuestion was resolved (agent resumed processing).
   */
  onHIL?: (waiting: boolean) => void;
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
    onHIL,
  } = options;

  const paneState = initializedPanes.get(paneId);
  if (!paneState) {
    throw new Error(
      "claudeQuery() called without a prior createClaudeSession() for this pane. " +
      "Call createClaudeSession({ paneId }) first to start the Claude CLI.",
    );
  }

  const dir = process.cwd();
  const claudeSessionId = paneState.claudeSessionId;

  // ── First query: spawn `claude --session-id <UUID> 'Read the prompt in <path>'`.
  // The prompt is delivered via Claude's Read tool on its first turn — no
  // paste-buffer, no submit retries. Subsequent queries fall through to the
  // existing paste-buffer flow against the now-running TUI.
  if (!paneState.claudeStarted) {
    await spawnClaudeWithPrompt(
      paneId,
      prompt,
      paneState.chatFlags,
      claudeSessionId,
      paneState.sessionDir,
      paneState.readyTimeoutMs,
    );
    paneState.claudeStarted = true;
  } else {
    // ── Transcript snapshot (before send) ──
    // Taken BEFORE sending so we get an accurate baseline for slicing the
    // returned messages to just this turn.
    let transcriptBeforeCount = 0;
    try {
      const msgs = await getSessionMessages(claudeSessionId, {
        dir,
        includeSystemMessages: true,
      });
      transcriptBeforeCount = msgs.length;
    } catch {
      // Best-effort — 0 means we scan all messages (correct, slightly less efficient)
    }

    const beforeContent = normalizeTmuxLines(capturePaneScrollback(paneId));
    const normalizedPrompt = normalizeTmuxCapture(prompt).slice(0, 100);

    // Step 1: Wait for pane readiness before sending
    await waitForPaneReady(paneId, readyTimeoutMs);

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

    // Wait for response completion via pane idle + transcript read.
    // HIL detection is integrated into waitForIdle.
    return await waitForIdle(
      paneId,
      claudeSessionId,
      transcriptBeforeCount,
      beforeContent,
      pollIntervalMs,
      onHIL,
    );
  }

  // First-query path: wait for Claude to finish the response. The prompt
  // file lives in the workflow's session dir as `prompt.txt` and is kept
  // as part of the session log — no cleanup needed.
  return await waitForIdle(
    paneId,
    claudeSessionId,
    0,
    "",
    pollIntervalMs,
    onHIL,
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
  private readonly sessionDir: string;

  constructor(
    paneId: string,
    opts: { chatFlags?: string[]; readyTimeoutMs?: number } = {},
    sessionDir: string,
  ) {
    this.paneId = paneId;
    this.opts = opts;
    this.sessionDir = sessionDir;
  }

  /** Start the Claude CLI in the tmux pane. Called by the runtime during init. */
  async start(): Promise<void> {
    await createClaudeSession({
      paneId: this.paneId,
      sessionDir: this.sessionDir,
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
  private readonly onHIL: ((waiting: boolean) => void) | undefined;

  constructor(
    paneId: string,
    sessionId: string,
    defaults: ClaudeQueryDefaults = {},
    onHIL?: (waiting: boolean) => void,
  ) {
    this.paneId = paneId;
    this.sessionId = sessionId;
    this.defaults = defaults;
    this.onHIL = onHIL;
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
      onHIL: this.onHIL,
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
