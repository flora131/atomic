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
import { sendKeysAndSubmit } from "../runtime/tmux.ts";
import { watch, unlink, mkdir, writeFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { claudeHookDirs } from "../../commands/cli/claude-stop-hook.ts";

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
}

const initializedPanes = new Map<string, PaneState>();

/**
 * Remove a pane from the initialized map and signal the currently-blocked
 * Stop hook that the session is over, so Claude stops promptly instead of
 * waiting out the hook's safety timeout.
 *
 * Called by the runtime when a Claude stage is being torn down. Idempotent.
 */
export async function clearClaudeSession(paneId: string): Promise<void> {
  const state = initializedPanes.get(paneId);
  if (state) {
    try {
      await releaseClaudeSession(state.claudeSessionId);
    } catch {
      // Best-effort — if release fails the hook will still exit on its
      // own safety timeout.
    }
  }
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
export async function createClaudeSession(options: ClaudeSessionOptions): Promise<string> {
  const {
    paneId,
    chatFlags = DEFAULT_CHAT_FLAGS,
    readyTimeoutMs = 30_000,
  } = options;

  const claudeSessionId = randomUUID();
  initializedPanes.set(paneId, {
    claudeSessionId,
    claudeStarted: false,
    chatFlags,
    readyTimeoutMs,
  });
  return claudeSessionId;
}

/**
 * Build the short, single-line natural-language prompt we send to Claude
 * (either as spawn argv or as a follow-up message). Claude's first action
 * is then a Read tool call against `promptFile` — which sidesteps shell
 * escaping, ARG_MAX, and tmux paste-buffer flakiness for large prompts.
 *
 * The session dir and filename are slug-based (`prompt-<N>.txt` under
 * `~/.atomic/sessions/...`), so they never contain shell-special characters.
 */
function readPromptInstruction(promptFile: string): string {
  return `Read ${promptFile} and follow the instructions inside.`;
}

/**
 * Spawn `claude` in the pane with the prompt baked in via the Read tool.
 *
 * The prompt is already written to `promptFile` by the caller. The spawn
 * argv is `'Read the prompt in <path>'`, so Claude's first action is a Read
 * tool call against that file.
 */
async function spawnClaudeWithPrompt(
  paneId: string,
  promptFile: string,
  chatFlags: string[],
  sessionId: string,
  readyTimeoutMs: number,
): Promise<void> {
  // sessionDir is the workflow's `${name}-${sessionId}` directory under
  // ~/.atomic/sessions — slug-based, so single-quoting is sufficient on
  // POSIX and PowerShell alike.
  const argvPrompt = `'${readPromptInstruction(promptFile)}'`;
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
 * Returns true when the most recent assistant message in the transcript
 * ended with `stop_reason: "tool_use"` — i.e. the agent stopped the current
 * API response to call a tool but has not yet produced its post-tool answer.
 *
 * Claude Code's Stop hook fires each time Claude "finishes responding",
 * which includes intermediate tool-use responses in a multi-step agent
 * loop (not just the final `end_turn`). If we return from `waitForIdle`
 * on the first Stop event, we capture the transcript mid-loop — the
 * final assistant text block is still being generated and won't be on
 * disk yet, so `inbox.md` drops the actual answer.
 *
 * We keep watching until we see an assistant message with a terminal
 * stop_reason (`end_turn`, `max_tokens`, `stop_sequence`, `refusal`),
 * which is the real end of the turn.
 *
 * Exported as `_isMidAgentLoop` for unit testing.
 */
export function _isMidAgentLoop(messages: SessionMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.type !== "assistant") continue;
    const inner = msg.message as { stop_reason?: unknown } | null;
    const stopReason = inner?.stop_reason;
    return stopReason === "tool_use";
  }
  // No assistant message yet — treat as mid-loop so we wait for one.
  return true;
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

/**
 * Path helpers for the transcript JSONL written by Claude Code.
 * @internal Exported for tests.
 */
export function transcriptDir(): string {
  return resolveSessionDir(process.cwd());
}

/** @internal Exported for tests. */
export function transcriptPath(claudeSessionId: string): string {
  return join(transcriptDir(), `${claudeSessionId}.jsonl`);
}

/**
 * Watch this session's transcript JSONL and call `onHIL` on every HIL-state
 * transition — independently of the Stop hook.
 *
 * Why not piggyback on the Stop hook? `AskUserQuestion` is a deferred tool
 * (`shouldDefer: true`, see Claude Code's
 * `src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`). While the question
 * is pending, Claude's agent loop blocks on the tool with
 * `needsFollowUp === true`, so `handleStopHooks` never runs
 * (`src/query.ts`: `if (!needsFollowUp)`). A watcher tied to the Stop-hook
 * marker would sleep through the entire HIL window and only wake up after
 * the user has already answered.
 *
 * Watches the parent session directory rather than the file itself so the
 * attach is safe before Claude has created the JSONL on first query. Events
 * are filtered by `<sessionId>.jsonl`. Returns when `signal` is aborted.
 *
 * @internal Exported for tests.
 */
export async function watchTranscriptForHIL(
  claudeSessionId: string,
  onHIL: (waiting: boolean) => void,
  signal: AbortSignal,
): Promise<void> {
  const dir = transcriptDir();

  const readMessages = async (): Promise<SessionMessage[]> => {
    try {
      return await getSessionMessages(claudeSessionId, {
        dir: process.cwd(),
        includeSystemMessages: true,
      });
    } catch {
      return [];
    }
  };

  let wasHIL = false;
  const check = async (): Promise<void> => {
    const msgs = await readMessages();
    const isHIL = _hasUnresolvedHILTool(msgs);
    if (isHIL !== wasHIL) {
      onHIL(isHIL);
      wasHIL = isHIL;
    }
  };

  await mkdir(dir, { recursive: true });

  // Attach the watcher BEFORE the initial check so any events that arrive
  // during the check are buffered by the iterator instead of being lost.
  const watcher = watch(dir, { signal });

  // Initial check: closes the race where the JSONL already contains an
  // unresolved AskUserQuestion by the time this watcher attaches (resumed
  // session, slow attach, etc.).
  await check();

  try {
    for await (const _event of watcher) {
      // We intentionally don't filter by `_event.filename`. On Linux, writes
      // can deliver events with unrelated or `.tmp` basenames, and Bun's
      // fs.watch behavior varies across OSes; `getSessionMessages` is keyed
      // by `claudeSessionId` so a cheap re-read is authoritative.
      await check();
    }
  } catch (e: unknown) {
    if (!(e instanceof Error && e.name === "AbortError")) {
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Path of the directory where the claude-stop-hook writes marker files.
 * Each Claude turn creates `~/.atomic/claude-stop/<session_id>` which
 * triggers the `fs.watch` event in `waitForIdle`.
 *
 * @internal Exported for unit tests.
 */
export function markerDir(): string {
  return claudeHookDirs().marker;
}

/**
 * Return the marker file path for a given Claude session ID.
 *
 * @internal Exported for unit tests.
 */
export function markerPath(claudeSessionId: string): string {
  return join(markerDir(), claudeSessionId);
}

/**
 * Directory where the workflow runtime writes queued follow-up prompts that
 * `atomic _claude-stop-hook` picks up and feeds back to Claude as
 * `{decision:"block", reason:<prompt>}`. @internal Exported for unit tests.
 */
export function queueDir(): string {
  return claudeHookDirs().queue;
}

/** Return the queue file path for a given Claude session ID. @internal */
export function queuePath(claudeSessionId: string): string {
  return join(queueDir(), claudeSessionId);
}

/**
 * Directory where the runtime writes session-release signals. When the Stop
 * hook sees `~/.atomic/claude-release/<session_id>` it exits 0 without
 * emitting a block decision — the signal used by `clearClaudeSession` to
 * tell Claude it's safe to actually stop. @internal Exported for unit tests.
 */
export function releaseDir(): string {
  return claudeHookDirs().release;
}

/** Return the release file path for a given Claude session ID. @internal */
export function releasePath(claudeSessionId: string): string {
  return join(releaseDir(), claudeSessionId);
}

/**
 * Ensure the marker directory exists and remove any stale marker left from a
 * previous turn of this session. Call this BEFORE submitting the prompt so
 * the subsequent `waitForIdle` watch loop doesn't fire on a stale file.
 *
 * Ignores ENOENT on `unlink` — the file simply doesn't exist yet.
 */
async function clearStaleMarker(claudeSessionId: string): Promise<void> {
  await mkdir(markerDir(), { recursive: true });
  try {
    await unlink(markerPath(claudeSessionId));
  } catch (e: unknown) {
    // ENOENT is expected — ignore it; rethrow anything else
    if (!(e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT")) {
      throw e;
    }
  }
}

/**
 * Ensure the queue directory exists and remove any stale entry from a prior
 * turn so the Stop hook doesn't race on it. Ignores ENOENT.
 */
async function clearStaleQueue(claudeSessionId: string): Promise<void> {
  await mkdir(queueDir(), { recursive: true });
  try {
    await unlink(queuePath(claudeSessionId));
  } catch (e: unknown) {
    if (!(e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT")) {
      throw e;
    }
  }
}

/**
 * Write the next prompt to the session queue file. The currently-running
 * Stop hook process (blocked on poll from the previous turn) picks it up,
 * emits `{decision:"block", reason:<prompt>}` on stdout, and Claude feeds
 * it back as the next user message — no tmux keystrokes required.
 */
async function enqueuePrompt(claudeSessionId: string, prompt: string): Promise<void> {
  await mkdir(queueDir(), { recursive: true });
  await writeFile(queuePath(claudeSessionId), prompt, "utf-8");
}

/**
 * Signal the Stop hook's blocking wait that this session is done. Called
 * during session teardown so the final hook invocation exits 0 promptly.
 * Safe to call more than once.
 */
export async function releaseClaudeSession(claudeSessionId: string): Promise<void> {
  await mkdir(releaseDir(), { recursive: true });
  await writeFile(releasePath(claudeSessionId), "");
}

// ---------------------------------------------------------------------------
// Idle detection via marker file watch
// ---------------------------------------------------------------------------

/**
 * Wait for the Claude session to become idle using `fs.watch` on the
 * `~/.atomic/claude-stop/` marker directory.
 *
 * When Claude finishes a turn, the `atomic _claude-stop-hook` Stop hook writes
 * `~/.atomic/claude-stop/<session_id>`. The write triggers an OS-native
 * `fs.watch` event on the parent directory — far more reliable than polling
 * tmux pane glyphs, which vary between Claude Code versions.
 *
 * This function is strictly about *idle detection*. HIL is detected separately
 * by {@link watchTranscriptForHIL}; the Stop hook does not fire while
 * `AskUserQuestion` is pending (the agent loop blocks on deferred tools), so
 * mixing the two would silently miss the HIL window.
 *
 * Algorithm:
 * 1. Attach the directory watcher, then check for the marker file on disk —
 *    this closes the race where the Stop hook fires between prompt submission
 *    and watcher attach.
 * 2. On any event, re-check the marker file on disk (we intentionally do NOT
 *    filter by `event.filename`, because on Linux a write can deliver multiple
 *    events with varying filenames and editor tools may race us).
 * 3. Read the session transcript via `getSessionMessages` and slice messages
 *    from `transcriptBeforeCount`.
 * 4. Clean up the `fs.watch` watcher on any exit path via AbortController.
 *
 * @param claudeSessionId       - Claude's session UUID (used to identify marker file)
 * @param transcriptBeforeCount - number of messages in transcript before this turn
 */
/** Safety timeout so the workflow's next stage still fires if the Stop hook
 * never runs (misconfigured settings, killed Claude process, etc.). 15 min
 * covers any reasonable single-turn run without hanging forever. */
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * @internal Exported for unit tests.
 */
export async function waitForIdle(
  claudeSessionId: string,
  transcriptBeforeCount: number,
): Promise<SessionMessage[]> {

  const dir = markerDir();
  const sessionId = claudeSessionId;
  const target = markerPath(sessionId);
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), IDLE_TIMEOUT_MS);

  // Process a marker that has appeared on disk. Returns a tuple:
  //   [resolved, result] — when resolved=true, waitForIdle should return.
  const readMessages = async (): Promise<SessionMessage[] | null> => {
    try {
      return await getSessionMessages(sessionId, {
        dir: process.cwd(),
        includeSystemMessages: true,
      });
    } catch {
      return null;
    }
  };

  const handleMarker = async (): Promise<[boolean, SessionMessage[]]> => {
    let msgs = await readMessages();
    if (msgs === null) {
      // Transcript read failed — keep watching; the next event will retry.
      return [false, []];
    }

    // The Stop hook fires only once per agent loop completion (when there
    // are no more tool_use blocks to resolve — see Claude Code's
    // `src/query/stopHooks.ts` / `query.ts`: `if (!needsFollowUp)`). But
    // Claude Code writes to the JSONL transcript asynchronously via
    // `enqueueWrite()` with a batched ~100ms flush, so the final
    // `assistant[text]` message can still be in the page-cache when our
    // marker watcher fires. Reading the transcript at that moment races
    // the writer and returns a prefix ending at `user[tool_result]`.
    //
    // Because no further marker events are coming, we can't just "keep
    // watching the marker dir". Instead, poll the transcript file directly
    // until it either settles on a terminal stop_reason or the poll budget
    // expires. The budget covers Claude Code's flush interval plus headroom
    // for slow disks and buffered `fs/promises` writes.
    if (_isMidAgentLoop(msgs)) {
      const pollIntervalMs = 50;
      const pollBudgetMs = 3_000;
      const start = Date.now();
      while (_isMidAgentLoop(msgs) && Date.now() - start < pollBudgetMs) {
        await Bun.sleep(pollIntervalMs);
        const next = await readMessages();
        if (next) msgs = next;
      }
      // Whether we recovered or ran out of budget, fall through — returning
      // what we have beats hanging forever if the writer really did drop a
      // message (e.g. max-tokens collapse, abort mid-stream).
    }

    const sliced = msgs.length > transcriptBeforeCount
      ? msgs.slice(transcriptBeforeCount)
      : [];
    return [true, sliced];
  };

  try {
    // Attach the watcher FIRST; fs.watch returns an iterable whose underlying
    // inotify/FSEvent subscription is live from this point on.
    const watcher = watch(dir, { signal: ac.signal });

    // Close the race: if the Stop hook fired between clearStaleMarker() and
    // the watcher attach above, the marker is already on disk and no further
    // events will be emitted. Handle it synchronously.
    if (existsSync(target)) {
      const [done, result] = await handleMarker();
      if (done) {
        ac.abort();
        return result;
      }
    }

    for await (const _event of watcher) {
      // We don't trust event.filename — on Linux, a tmp+rename write emits
      // events with the `.tmp` basename, and other files in the marker dir
      // can race us. The marker file's existence on disk is authoritative.
      if (!existsSync(target)) continue;

      const [done, result] = await handleMarker();
      if (done) {
        ac.abort();
        return result;
      }
    }
  } catch (e: unknown) {
    // AbortError is expected when we call ac.abort() to stop watching, or
    // when the safety timeout fires.
    if (!(e instanceof Error && e.name === "AbortError")) {
      throw e;
    }
  } finally {
    clearTimeout(timeout);
  }

  return [];
}

// ---------------------------------------------------------------------------
// claudeQuery
// ---------------------------------------------------------------------------

export interface ClaudeQueryOptions {
  /** tmux pane ID where Claude is running */
  paneId: string;
  /** The prompt to send */
  prompt: string;
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
 * First query and follow-up queries use different delivery channels:
 *
 *   - **First query**: stages the prompt in a tmp file and spawns
 *     `claude --session-id <UUID> 'Read the prompt in <path>'` into the
 *     empty pane. Claude's first action is a Read tool call, which
 *     sidesteps ARG_MAX on the spawn argv.
 *
 *   - **Follow-up query**: writes the prompt to
 *     `~/.atomic/claude-queue/<session_id>`. The Stop hook from the
 *     previous turn is blocked in a poll loop there; it reads the queue
 *     entry and emits `{"decision":"block","reason":<prompt>}` on stdout,
 *     which Claude Code feeds back as the next user message. No tmux
 *     keystrokes, no paste-buffer dance, no pane-state polling — the
 *     whole delivery rides Claude's own continuation API.
 *
 * Both paths converge on `waitForIdle`, which watches the Stop-hook marker
 * file for this session and returns the transcript slice for the turn.
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
  const { paneId, prompt, onHIL } = options;

  const paneState = initializedPanes.get(paneId);
  if (!paneState) {
    throw new Error(
      "claudeQuery() called without a prior createClaudeSession() for this pane. " +
      "Call createClaudeSession({ paneId }) first to start the Claude CLI.",
    );
  }

  const dir = process.cwd();
  const claudeSessionId = paneState.claudeSessionId;

  // Clear stale marker AND stale queue entry before submitting so the
  // Stop-hook for the previous turn (if any) cannot race this one.
  await clearStaleMarker(claudeSessionId);
  await clearStaleQueue(claudeSessionId);

  let transcriptBeforeCount = 0;
  let spawnPromptFile: string | undefined;

  try {
    if (paneState.claudeStarted) {
      // Follow-up query: snapshot the transcript length so waitForIdle can
      // slice out the messages produced by THIS turn, then enqueue the
      // prompt for the Stop hook to pick up.
      try {
        const msgs = await getSessionMessages(claudeSessionId, {
          dir,
          includeSystemMessages: true,
        });
        transcriptBeforeCount = msgs.length;
      } catch {
        // Best-effort — 0 means we scan all messages (correct, slightly less efficient)
      }

      await enqueuePrompt(claudeSessionId, prompt);
    } else {
      // First query: spawn claude with the prompt baked into argv via the
      // Read-tool indirection. The tmp file only has to live long enough
      // for Claude's first Read tool call, so we delete it once waitForIdle
      // returns (the turn is complete by then).
      spawnPromptFile = join(
        os.tmpdir(),
        `atomic-claude-prompt-${claudeSessionId}-${randomUUID()}.txt`,
      );
      writeFileSync(spawnPromptFile, prompt, "utf-8");

      await spawnClaudeWithPrompt(
        paneId,
        spawnPromptFile,
        paneState.chatFlags,
        claudeSessionId,
        paneState.readyTimeoutMs,
      );
      paneState.claudeStarted = true;
    }

    // HIL detection runs in parallel with idle detection. The Stop hook
    // (which drives waitForIdle) doesn't fire while `AskUserQuestion` is
    // pending, so we watch the transcript JSONL directly for HIL transitions.
    const hilAc = new AbortController();
    if (onHIL) {
      void watchTranscriptForHIL(claudeSessionId, onHIL, hilAc.signal).catch(
        () => {
          // Best-effort — never fail the query over HIL detection.
        },
      );
    }

    try {
      return await waitForIdle(claudeSessionId, transcriptBeforeCount);
    } finally {
      hilAc.abort();
      // Safety: waitForIdle only returns at true turn-idle (no unresolved
      // AskUserQuestion by Claude's own `!needsFollowUp` gate). If the
      // transcript watcher missed the final tool_result flush due to
      // Claude's batched JSONL writes, the UI could be stuck on
      // awaiting_input. `resumeSession` in the panel store is idempotent
      // (no-op when the session isn't in awaiting_input), so this is
      // always safe.
      onHIL?.(false);
    }
  } finally {
    if (spawnPromptFile) {
      try {
        await unlink(spawnPromptFile);
      } catch {
        // ENOENT / already removed is fine.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Synthetic wrappers — uniform s.client / s.session API for Claude stages
// ---------------------------------------------------------------------------

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

  /**
   * Start the Claude CLI in the tmux pane. Returns the Claude session UUID
   * so the caller can pass it to `ClaudeSessionWrapper` (and thus expose it
   * as `s.sessionId` to workflows). This is the UUID used by Claude Code to
   * name its JSONL transcript file and to key the Stop-hook marker — workflows
   * pass it to `s.save(s.sessionId)` so the save path reads the correct
   * transcript even when many Claude sessions run in parallel.
   */
  async start(): Promise<string> {
    return await createClaudeSession({
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
  private readonly onHIL: ((waiting: boolean) => void) | undefined;

  constructor(
    paneId: string,
    sessionId: string,
    onHIL?: (waiting: boolean) => void,
  ) {
    this.paneId = paneId;
    this.sessionId = sessionId;
    this.onHIL = onHIL;
  }

  /**
   * Send a prompt to Claude and wait for the response.
   *
   * The `_options` parameter exists for signature compatibility with
   * {@link HeadlessClaudeSessionWrapper.query} (which forwards SDK options
   * like `agent`, `permissionMode`, etc. to the Agent SDK). In the
   * interactive pane path these options don't apply — we're driving the
   * `claude` CLI binary, not the SDK — so they are silently ignored.
   */
  async query(
    prompt: string,
    _options?: Partial<SDKOptions>,
  ): Promise<SessionMessage[]> {
    return claudeQuery({
      paneId: this.paneId,
      prompt,
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
  /**
   * Headless Claude stages don't pre-allocate a session — each `query()` call
   * to {@link HeadlessClaudeSessionWrapper} spawns a fresh Agent SDK run that
   * emits its own `session_id`. We still return an empty string here so the
   * method signature matches {@link ClaudeClientWrapper.start}.
   */
  async start(): Promise<string> {
    return "";
  }
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
  /**
   * The Claude session UUID of the most recently completed `query()`. Exposed
   * via `s.sessionId` so workflows can pass it to `s.save(s.sessionId)` and
   * have the save path read the correct transcript, even when several headless
   * Claude stages run in parallel (each call gets its own SDK-assigned UUID).
   */
  private _lastSessionId: string = "";

  get sessionId(): string {
    return this._lastSessionId;
  }

  async query(
    prompt: string | AsyncIterable<SDKUserMessage>,
    options?: Partial<SDKOptions>,
  ): Promise<SessionMessage[]> {
    let sdkSessionId = "";
    for await (const msg of sdkQuery({ prompt, options: options ?? {} })) {
      if (msg.type === "result") {
        sdkSessionId = String((msg as Record<string, unknown>).session_id ?? "");
      }
    }
    // Read the transcript to return native SessionMessage[]
    if (sdkSessionId) {
      this._lastSessionId = sdkSessionId;
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
