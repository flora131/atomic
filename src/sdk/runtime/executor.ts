/**
 * Workflow runtime executor.
 *
 * Architecture:
 * 1. `executeWorkflow()` is called by the CLI command
 * 2. It creates a tmux session with an orchestrator pane that runs
 *    `bun run executor-entry.ts` (a thin wrapper that calls `runOrchestrator()`)
 * 3. The CLI then attaches to the tmux session (user sees it live)
 * 4. The orchestrator pane calls `definition.run(workflowCtx)` — the
 *    user's callback uses `ctx.stage()` to spawn agent sessions
 *
 * The entry point is in executor-entry.ts (not this file) to avoid Bun's
 * dual-module-identity issue: Bun evaluates a file twice when it is both
 * the entry point and reached through package.json `exports` self-referencing.
 */

import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import type {
  WorkflowDefinition,
  WorkflowContext,
  SessionContext,
  SessionRunOptions,
  SessionHandle,
  SessionRef,
  AgentType,
  Transcript,
  SavedMessage,
  SaveTranscript,
  StageClientOptions,
  StageSessionOptions,
  ProviderClient,
  ProviderSession,
} from "../types.ts";
import {
  isValidAgent,
  type ProviderOverrides,
} from "../../services/config/definitions.ts";
import { getProviderOverrides } from "../../services/config/atomic-config.ts";
import { ensureDir } from "../../services/system/copy.ts";
import type { SessionEvent } from "@github/copilot-sdk";
import type { SessionPromptResponse } from "@opencode-ai/sdk/v2";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import * as tmux from "./tmux.ts";
import { spawnMuxAttach } from "./tmux.ts";
import { WorkflowLoader } from "./loader.ts";
import {
  clearClaudeSession,
  ClaudeClientWrapper,
  ClaudeSessionWrapper,
  HeadlessClaudeClientWrapper,
  HeadlessClaudeSessionWrapper,
} from "../providers/claude.ts";
import { OrchestratorPanel } from "./panel.tsx";
import { GraphFrontierTracker } from "./graph-inference.ts";
import { errorMessage } from "../errors.ts";

/** Maximum time (ms) to wait for an agent's server to become reachable. */
const SERVER_WAIT_TIMEOUT_MS = 60_000;

/** Agent CLI configuration for spawning in tmux panes. */
const AGENT_CLI: Record<
  AgentType,
  { cmd: string; chatFlags: string[]; envVars: Record<string, string> }
> = {
  copilot: {
    cmd: "copilot",
    chatFlags: ["--add-dir", ".", "--yolo", "--experimental"],
    envVars: {
      COPILOT_ALLOW_ALL: "true",
    },
  },
  opencode: { cmd: "opencode", chatFlags: [], envVars: {} },
  claude: {
    cmd: "claude",
    chatFlags: [
      "--allow-dangerously-skip-permissions",
      "--dangerously-skip-permissions",
    ],
    envVars: {
      // Enables session_state_changed events in the session JSONL transcript,
      // which the idle detection in claude.ts watches for to know when the
      // agent has finished processing a prompt.
      CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
    },
  },
};

/** Thrown when the user aborts a running workflow via `q` or `Ctrl+C`. */
class WorkflowAbortError extends Error {
  constructor() {
    super("Workflow aborted by user");
    this.name = "WorkflowAbortError";
  }
}

/** Compile-time exhaustiveness guard for discriminated unions. */
function assertNever(value: never): never {
  throw new Error(`Unhandled agent type: ${String(value)}`);
}

// Re-export for backward compatibility (tests import from here)
export { errorMessage } from "../errors.ts";

/** Runtime guard for deserialized SavedMessage objects. */
function isValidSavedMessage(msg: unknown): msg is SavedMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    m.provider === "copilot" ||
    m.provider === "opencode" ||
    m.provider === "claude"
  );
}

export interface WorkflowRunOptions {
  /** The compiled workflow definition */
  definition: WorkflowDefinition;
  /** Agent type */
  agent: AgentType;
  /**
   * Structured inputs for this run. Free-form workflows model their
   * single positional prompt as `{ prompt: "..." }` so workflow
   * authors can read `ctx.inputs.prompt` uniformly regardless of
   * whether the workflow declares a schema. Empty record is valid.
   */
  inputs?: Record<string, string>;
  /** Absolute path to the workflow's index.ts file (from discovery) */
  workflowFile: string;
  /** Project root (defaults to cwd) */
  projectRoot?: string;
}

interface SessionResult {
  name: string;
  sessionId: string;
  sessionDir: string;
  paneId: string;
}

/** A session that has been spawned but may not have completed yet. */
interface ActiveSession {
  name: string;
  paneId: string;
  /** Settles when the session finishes. Resolves on success, rejects on failure. */
  done: Promise<void>;
}

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function getSessionsBaseDir(): string {
  return join(homedir(), ".atomic", "sessions");
}

async function getRandomPort(): Promise<number> {
  const net = await import("node:net");

  const MAX_RETRIES = 3;
  let lastPort = 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, () => {
        const addr = server.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        server.close(() => resolve(p));
      });
      server.on("error", reject);
    });

    if (port > 0) return port;
    lastPort = port;
    await Bun.sleep(50);
  }

  throw new Error(
    `Failed to acquire a random port after ${MAX_RETRIES} attempts (last: ${lastPort})`,
  );
}

/**
 * Resolve a non-JS Copilot CLI binary on PATH.
 *
 * Under Bun, `@github/copilot-sdk` spawns its bundled JS entry via `node`
 * (see `getNodeExecPath` in the SDK). If `node` isn't installed — common in
 * minimal containers — the spawn fails silently with ENOENT and the SDK's
 * write to the child's stdin surfaces as "Cannot call write after a stream
 * was destroyed" from vscode-jsonrpc. Pointing the SDK at a standalone
 * `copilot` binary (the npm-installed ELF executable) sidesteps the
 * node-vs-bun problem because the SDK execs it directly when the path does
 * not end in `.js`.
 *
 * Returns undefined if no suitable binary is found.
 */
export function discoverCopilotBinary(): string | undefined {
  const pathVar = process.env.PATH;
  if (!pathVar) return undefined;
  const exe = process.platform === "win32" ? "copilot.exe" : "copilot";
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of pathVar.split(sep)) {
    if (!dir) continue;
    const candidate = join(dir, exe);
    if (candidate.endsWith(".js")) continue;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return undefined;
}

/**
 * True when we need to override the SDK's default CLI path — i.e. running
 * under Bun, the user hasn't set COPILOT_CLI_PATH, and `node` is not
 * available to execute the SDK's bundled JS entry.
 */
export function shouldOverrideCopilotCliPath(): boolean {
  if (!process.versions.bun) return false;
  if (process.env.COPILOT_CLI_PATH) return false;
  return discoverCopilotBinary() !== undefined && !isNodeOnPath();
}

function isNodeOnPath(): boolean {
  const pathVar = process.env.PATH;
  if (!pathVar) return false;
  const exe = process.platform === "win32" ? "node.exe" : "node";
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of pathVar.split(sep)) {
    if (!dir) continue;
    try {
      if (statSync(join(dir, exe)).isFile()) return true;
    } catch {}
  }
  return false;
}

/**
 * Set safe env defaults for the orchestrator process before any SDK is
 * loaded. Must be called exactly once, as early as possible — headless
 * Copilot stages spawn the CLI as a subprocess and inherit this env.
 */
export function applyContainerEnvDefaults(): void {
  if (shouldOverrideCopilotCliPath()) {
    const bin = discoverCopilotBinary();
    if (bin) process.env.COPILOT_CLI_PATH = bin;
  }
}

function buildPaneCommand(
  agent: AgentType,
  port: number,
  overrides: ProviderOverrides = {},
): { command: string; envVars: Record<string, string> } {
  const {
    cmd,
    chatFlags: defaultFlags,
    envVars: defaultEnvVars,
  } = AGENT_CLI[agent];
  const chatFlags = overrides.chatFlags ?? defaultFlags;
  const envVars = overrides.envVars
    ? { ...defaultEnvVars, ...overrides.envVars }
    : defaultEnvVars;

  switch (agent) {
    case "copilot":
      return {
        command: [
          cmd,
          "--ui-server",
          "--port",
          String(port),
          ...chatFlags,
        ].join(" "),
        envVars,
      };
    case "opencode":
      return {
        command: [cmd, "--port", String(port), ...chatFlags].join(" "),
        envVars,
      };
    case "claude":
      // Claude is started via createClaudeSession() in the workflow's run()
      return {
        command:
          process.env.SHELL || (process.platform === "win32" ? "pwsh" : "sh"),
        envVars,
      };
    default:
      return assertNever(agent);
  }
}

async function waitForServer(
  agent: AgentType,
  port: number,
  paneId: string,
): Promise<string> {
  if (agent === "claude") return "";

  const serverUrl = `localhost:${port}`;
  const deadline = Date.now() + SERVER_WAIT_TIMEOUT_MS;

  // Wait for the TUI to render first
  while (Date.now() < deadline) {
    const content = tmux.capturePane(paneId);
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length >= 3) break;
    await Bun.sleep(1_000);
  }

  // Then verify the SDK can actually connect and list sessions
  if (agent === "copilot") {
    const { CopilotClient } = await import("@github/copilot-sdk");
    while (Date.now() < deadline) {
      try {
        const probe = new CopilotClient({ cliUrl: serverUrl });
        await probe.start();
        await probe.listSessions();
        await probe.stop();
        return serverUrl;
      } catch {
        await Bun.sleep(1_000);
      }
    }
  }

  // For OpenCode, give it extra time after TUI renders
  await Bun.sleep(3_000);
  return serverUrl;
}

/**
 * Escape a string for safe interpolation inside a bash double-quoted string.
 *
 * In bash `"..."` strings only `$`, `` ` ``, `\`, `"`, and `!` are special.
 * Single quotes are literal inside double quotes and need no escaping.
 * Null bytes are stripped because bash strings cannot contain them.
 */
export function escBash(s: string): string {
  return s
    .replace(/\x00/g, "")
    .replace(/[\n\r]+/g, " ")
    .replace(/[\\"$`!]/g, "\\$&");
}

/**
 * Escape a string for safe interpolation inside a PowerShell double-quoted string.
 *
 * In PowerShell `"..."` strings, backtick is the escape character and `$` triggers
 * variable expansion.  Null bytes are stripped for safety.
 */
export function escPwsh(s: string): string {
  return s
    .replace(/\x00/g, "")
    .replace(/[`"$]/g, "`$&")
    .replace(/\n/g, "`n")
    .replace(/\r/g, "`r");
}

/**
 * Decode the ATOMIC_WF_INPUTS env var (base64-encoded JSON) into a
 * `Record<string, string>`. Returns an empty record when the variable
 * is missing, malformed, or does not decode to a string-map object —
 * structured inputs are optional, so a corrupt payload must never
 * prevent free-form workflows from running.
 */
export function parseInputsEnv(
  raw: string | undefined,
): Record<string, string> {
  if (!raw) return {};
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// ============================================================================
// Entry point called by the CLI command
// ============================================================================

/**
 * Called by `atomic workflow -n <name> -a <agent> <prompt>`.
 *
 * Always creates a tmux session in the atomic socket with the
 * orchestrator as the initial pane, then attaches so the user sees
 * everything live — even when invoked from inside another tmux session.
 */
export async function executeWorkflow(
  options: WorkflowRunOptions,
): Promise<void> {
  const {
    definition,
    agent,
    inputs = {},
    workflowFile,
    projectRoot = process.cwd(),
  } = options;

  const workflowRunId = generateId();
  const tmuxSessionName = `atomic-wf-${agent}-${definition.name}-${workflowRunId}`;
  const sessionsBaseDir = join(getSessionsBaseDir(), workflowRunId);
  await ensureDir(sessionsBaseDir);

  // Write a launcher script for the orchestrator pane.
  // Points to executor-entry.ts (not executor.ts) to avoid Bun's
  // dual-module-identity issue: entry points and package self-references
  // are evaluated as separate module instances in Bun.
  const thisFile = resolve(import.meta.dir, "executor-entry.ts");
  const isWin = process.platform === "win32";
  const launcherExt = isWin ? "ps1" : "sh";
  const launcherPath = join(sessionsBaseDir, `orchestrator.${launcherExt}`);
  const logPath = join(sessionsBaseDir, "orchestrator.log");

  // Inputs are passed through as base64-encoded JSON so long multiline
  // text values survive shell quoting without any further escaping.
  // Free-form workflows ride the same pipe — their single positional
  // prompt is stored under the `prompt` key so workflow authors always
  // read the user's prompt via `ctx.inputs.prompt`.
  const inputsB64 = Buffer.from(JSON.stringify(inputs)).toString("base64");

  const launcherScript = isWin
    ? [
        `Set-Location "${escPwsh(projectRoot)}"`,
        `$env:ATOMIC_WF_ID = "${escPwsh(workflowRunId)}"`,
        `$env:ATOMIC_WF_TMUX = "${escPwsh(tmuxSessionName)}"`,
        `$env:ATOMIC_WF_AGENT = "${escPwsh(agent)}"`,
        `$env:ATOMIC_WF_INPUTS = "${escPwsh(inputsB64)}"`,
        `$env:ATOMIC_WF_FILE = "${escPwsh(workflowFile)}"`,
        `$env:ATOMIC_WF_CWD = "${escPwsh(projectRoot)}"`,
        `bun run "${escPwsh(thisFile)}" 2>"${escPwsh(logPath)}"`,
      ].join("\n")
    : [
        "#!/bin/bash",
        `cd "${escBash(projectRoot)}"`,
        `export ATOMIC_WF_ID="${escBash(workflowRunId)}"`,
        `export ATOMIC_WF_TMUX="${escBash(tmuxSessionName)}"`,
        `export ATOMIC_WF_AGENT="${escBash(agent)}"`,
        `export ATOMIC_WF_INPUTS="${escBash(inputsB64)}"`,
        `export ATOMIC_WF_FILE="${escBash(workflowFile)}"`,
        `export ATOMIC_WF_CWD="${escBash(projectRoot)}"`,
        `bun run "${escBash(thisFile)}" 2>"${escBash(logPath)}"`,
      ].join("\n");

  await writeFile(launcherPath, launcherScript, { mode: 0o755 });

  const shellCmd = isWin
    ? `pwsh -NoProfile -File "${escPwsh(launcherPath)}"`
    : `bash "${escBash(launcherPath)}"`;
  tmux.createSession(tmuxSessionName, shellCmd, "orchestrator");
  tmux.setSessionEnv(tmuxSessionName, "ATOMIC_AGENT", agent);

  if (tmux.isInsideAtomicSocket()) {
    // Already on the atomic server — just switch to the new session.
    tmux.switchClient(tmuxSessionName);
  } else if (tmux.isInsideTmux()) {
    // Inside a different tmux server — detach and replace the client
    // with an attach to the atomic socket (no nesting).
    tmux.detachAndAttachAtomic(tmuxSessionName);
  } else {
    const attachProc = spawnMuxAttach(tmuxSessionName);
    await attachProc.exited;
  }
}

/**
 * Small buffer (ms) subtracted from `Date.now()` when recording the Claude
 * session start timestamp.  Protects against fast sequential runs where
 * the system clock granularity could cause a just-created session's
 * `lastModified` to fall slightly before our recorded timestamp.
 */
const CLAUDE_SESSION_TIMESTAMP_BUFFER_MS = 100;

// ============================================================================
// Session execution helpers
// ============================================================================

/** Type guard for objects with a string `content` property (Copilot assistant.message data). */
export function hasContent(value: unknown): value is { content: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    typeof (value as { content: unknown }).content === "string"
  );
}

export function renderMessagesToText(messages: SavedMessage[]): string {
  return messages
    .map((m) => {
      switch (m.provider) {
        case "copilot": {
          if (m.data.type !== "assistant.message") return "";
          // SessionEvent["data"] for assistant.message has a typed `content: string`
          return hasContent(m.data.data) ? m.data.data.content : "";
        }
        case "opencode": {
          // Part is a discriminated union; filter to TextPart which has { type: "text", text: string }
          return m.data.parts
            .filter(
              (p): p is Extract<typeof p, { type: "text" }> =>
                p.type === "text",
            )
            .map((p) => p.text)
            .join("\n");
        }
        case "claude": {
          if (m.data.type !== "assistant") return "";
          const msg = m.data.message;
          if (typeof msg === "string") return msg;
          if (msg && typeof msg === "object" && "content" in msg) {
            const { content } = msg as { content: unknown };
            if (typeof content === "string") return content;
            // Claude messages often have mixed content arrays (text +
            // tool_use + thinking blocks). Filter for text blocks instead
            // of requiring ALL blocks to be text — the old isTextBlockArray
            // check caused a JSON.stringify fallback that embedded raw
            // message objects into downstream prompts.
            if (Array.isArray(content)) {
              const textParts = content
                .filter(
                  (b): b is { type: "text"; text: string } =>
                    typeof b === "object" &&
                    b !== null &&
                    b.type === "text" &&
                    typeof b.text === "string",
                )
                .map((b) => b.text);
              if (textParts.length > 0) return textParts.join("\n");
            }
          }
          return "";
        }
      }
    })
    .filter((txt): txt is string => typeof txt === "string" && txt.length > 0)
    .join("\n\n");
}

/** Resolve a SessionRef (string or SessionHandle) to the session name. */
function resolveRef(ref: SessionRef): string {
  return typeof ref === "string" ? ref : ref.name;
}

/**
 * Minimal Copilot session surface required by `wrapCopilotSend()`.
 * Uses a generic `on` signature to remain compatible with both the real
 * CopilotSession and lightweight test mocks.
 */
export interface CopilotSendSessionSurface {
  on(eventType: string, handler: (event: { data?: unknown }) => void): () => void;
}

/**
 * Wraps a Copilot session's `send()` to block until `session.idle` fires.
 *
 * Copilot's `send()` is fire-and-forget — it returns immediately after
 * queuing the message.  This wrapper blocks the returned promise until the
 * session emits `session.idle` (turn complete) or `session.error`.
 *
 * HIL detection for Copilot is handled separately by
 * `watchCopilotSessionForHIL()`, which subscribes to the session's
 * `tool.execution_start` / `tool.execution_complete` events for the
 * `ask_user` built-in tool.  Those events fire regardless of whether
 * an `onUserInputRequest` handler is registered, so we can detect HIL
 * via native SDK events while the CLI continues to handle user input
 * locally in the tmux pane.
 *
 * Exported for unit testing.
 */
export function wrapCopilotSend<O, R>(
  session: CopilotSendSessionSurface,
  nativeSend: (options: O) => Promise<R>,
): (options: O) => Promise<R> {
  return async (options: O): Promise<R> => {
    const idle = new Promise<void>((resolve, reject) => {
      let unsubIdle: (() => void) | undefined;
      let unsubError: (() => void) | undefined;
      const cleanup = () => {
        unsubIdle?.();
        unsubError?.();
      };
      unsubIdle = session.on("session.idle", () => {
        cleanup();
        resolve();
      });
      unsubError = session.on("session.error", (event) => {
        cleanup();
        const data = event.data as { message?: string } | undefined;
        reject(new Error(data?.message ?? "Copilot session error"));
      });
    });
    const result = await nativeSend(options);
    await idle;
    return result;
  };
}

/**
 * Minimal shape of an event as produced by the OpenCode v2 SDK event stream.
 * Using a structural interface rather than the SDK's generated union type keeps
 * this helper independently unit-testable with plain objects.
 *
 * `sessionID` is optional because many OpenCode event types (e.g.
 * `file.edited`, `session.compacted`) carry properties without that field.
 * The `watchOpencodeStreamForHIL` implementation guards with a runtime check.
 */
export interface OpenCodeHILEvent {
  type: string;
  properties: { sessionID?: string; [key: string]: unknown };
}

/**
 * Consume an OpenCode SSE event stream and call `onHIL` whenever the session
 * with `sessionId` enters or exits a human-in-the-loop (HIL) state:
 *
 *   - `question.asked`    → `onHIL(true)`   (agent awaiting user input)
 *   - `question.replied`  → `onHIL(false)`  (user answered, agent resumes)
 *   - `question.rejected` → `onHIL(false)`  (user dismissed, agent resumes)
 *
 * Events for other sessions are silently ignored.  The function returns when
 * the stream is exhausted (i.e. the server closes the connection).
 *
 * Exported for unit testing.
 */
export async function watchOpencodeStreamForHIL(
  stream: AsyncIterable<OpenCodeHILEvent>,
  sessionId: string,
  onHIL: (waiting: boolean) => void,
): Promise<void> {
  for await (const event of stream) {
    if (
      event.type === "question.asked" &&
      event.properties.sessionID === sessionId
    ) {
      onHIL(true);
    } else if (
      (event.type === "question.replied" ||
        event.type === "question.rejected") &&
      event.properties.sessionID === sessionId
    ) {
      onHIL(false);
    }
  }
}

/**
 * Minimal Copilot session surface required by `watchCopilotSessionForHIL()`.
 * A structural `on()` signature keeps this helper independently unit-testable
 * with plain objects and compatible with both the real CopilotSession and
 * test mocks.
 */
export interface CopilotHILSessionSurface {
  on(
    eventType: string,
    handler: (event: { data?: unknown }) => void,
  ): () => void;
}

/**
 * Subscribe to a Copilot session's tool-execution events to track HIL state
 * for the `ask_user` built-in tool:
 *
 *   - `tool.execution_start`    with `toolName === "ask_user"` → `onHIL(true)`
 *   - `tool.execution_complete` with matching `toolCallId`     → `onHIL(false)`
 *
 * These events fire regardless of whether an `onUserInputRequest` handler is
 * registered, so we can detect HIL without providing one — letting the CLI
 * keep its native tmux-pane dialog.
 *
 * Overlapping `ask_user` invocations are tracked by `toolCallId` so
 * `onHIL(false)` only fires after the last active request resolves.
 *
 * Returns an unsubscribe function that removes both listeners.
 *
 * Exported for unit testing.
 */
export function watchCopilotSessionForHIL(
  session: CopilotHILSessionSurface,
  onHIL: (waiting: boolean) => void,
): () => void {
  const active = new Set<string>();
  const unsubStart = session.on("tool.execution_start", (event) => {
    const data = event.data as
      | { toolName?: string; toolCallId?: string }
      | undefined;
    if (data?.toolName === "ask_user" && data.toolCallId) {
      const wasEmpty = active.size === 0;
      active.add(data.toolCallId);
      if (wasEmpty) onHIL(true);
    }
  });
  const unsubComplete = session.on("tool.execution_complete", (event) => {
    const data = event.data as { toolCallId?: string } | undefined;
    if (
      data?.toolCallId &&
      active.delete(data.toolCallId) &&
      active.size === 0
    ) {
      onHIL(false);
    }
  });
  return () => {
    unsubStart();
    unsubComplete();
  };
}

// ============================================================================
// Shared transcript / message readers
// ============================================================================

/**
 * Create a `transcript(ref)` function bound to a completed-session registry.
 * Used by both the top-level WorkflowContext and per-session SessionContext
 * so the implementation is defined once.
 */
function createTranscriptReader(
  completedRegistry: Map<string, SessionResult>,
): (ref: SessionRef) => Promise<Transcript> {
  return async (ref) => {
    const refName = resolveRef(ref);
    const prev = completedRegistry.get(refName);
    if (!prev) {
      const available = [...completedRegistry.keys()].join(", ") || "(none)";
      throw new Error(
        `No transcript for "${refName}". Available: ${available}`,
      );
    }
    const filePath = join(prev.sessionDir, "inbox.md");
    const content = await Bun.file(filePath).text();
    return { path: filePath, content };
  };
}

/**
 * Create a `getMessages(ref)` function bound to a completed-session registry.
 * Used by both the top-level WorkflowContext and per-session SessionContext.
 */
function createMessagesReader(
  completedRegistry: Map<string, SessionResult>,
): (ref: SessionRef) => Promise<SavedMessage[]> {
  return async (ref) => {
    const refName = resolveRef(ref);
    const prev = completedRegistry.get(refName);
    if (!prev) {
      const available = [...completedRegistry.keys()].join(", ") || "(none)";
      throw new Error(`No messages for "${refName}". Available: ${available}`);
    }
    const filePath = join(prev.sessionDir, "messages.json");
    const raw = await Bun.file(filePath).text();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid messages file for "${refName}": expected array`);
    }
    return parsed.filter(isValidSavedMessage);
  };
}

// ============================================================================
// Session runner — implements ctx.stage() lifecycle
// ============================================================================

/** Shared state passed to session runners by the orchestrator. */
interface SharedRunnerState {
  tmuxSessionName: string;
  sessionsBaseDir: string;
  agent: AgentType;
  /**
   * Structured inputs for this workflow run. Free-form workflows use
   * `{ prompt: "..." }`; structured workflows use their declared field
   * names. Workflow authors read both shapes via `ctx.inputs` — and
   * specifically via `ctx.inputs.prompt` for the free-form case.
   */
  inputs: Record<string, string>;
  /** User-configured provider overrides (global + local merged). */
  providerOverrides: ProviderOverrides;
  panel: OrchestratorPanel;
  /** Sessions that have been spawned (for name uniqueness + cleanup). */
  activeRegistry: Map<string, ActiveSession>;
  /** Sessions that completed successfully (for transcript reads). */
  completedRegistry: Map<string, SessionResult>;
  /** Sessions that already failed before completing successfully. */
  failedRegistry: Set<string>;
}

/**
 * Create the provider-specific client and session for a stage.
 * Called by the session runner after server readiness is confirmed.
 *
 * Generic over `A` so callers receive typed `ProviderClient<A>` /
 * `ProviderSession<A>` without unsafe casts. The internal `switch`
 * branches know the concrete types being constructed, so the `as`
 * assertions here are producer-side (correct by construction) rather
 * than consumer-side (trusting the caller to guess right).
 */
async function initProviderClientAndSession<A extends AgentType>(
  agent: A,
  serverUrl: string,
  paneId: string,
  sessionId: string,
  clientOpts: StageClientOptions<A>,
  sessionOpts: StageSessionOptions<A>,
  headless = false,
  onHIL?: (waiting: boolean) => void,
): Promise<{
  client: ProviderClient<A>;
  session: ProviderSession<A>;
  /** Optional cleanup for SDK-managed resources (e.g. headless OpenCode server). */
  cleanup?: () => void;
}> {
  type Result = {
    client: ProviderClient<A>;
    session: ProviderSession<A>;
    cleanup?: () => void;
  };

  switch (agent) {
    case "copilot": {
      const { CopilotClient, approveAll } = await import("@github/copilot-sdk");
      const copilotClientOpts = clientOpts as StageClientOptions<"copilot">;
      const copilotSessionOpts = sessionOpts as StageSessionOptions<"copilot">;
      // Headless: let the SDK spawn its own CLI process (no cliUrl).
      // Non-headless: connect to the CLI server running in a tmux pane.
      const client = headless
        ? new CopilotClient({ ...copilotClientOpts })
        : new CopilotClient({ ...copilotClientOpts, cliUrl: serverUrl });
      await client.start();
      const session = await client.createSession({
        onPermissionRequest: approveAll,
        ...copilotSessionOpts,
      });
      if (!headless) {
        await client.setForegroundSessionId(session.sessionId);
      }
      return { client, session } as Result;
    }
    case "opencode": {
      const ocSessionOpts = sessionOpts as StageSessionOptions<"opencode">;
      if (headless) {
        const { createOpencode } = await import("@opencode-ai/sdk/v2");
        const oc = await createOpencode({ port: 0 });
        const sessionResult = await oc.client.session.create(ocSessionOpts);
        return {
          client: oc.client,
          session: sessionResult.data!,
          cleanup: () => oc.server.close(),
        } as Result;
      }
      const { createOpencodeClient } = await import("@opencode-ai/sdk/v2");
      const ocClientOpts = clientOpts as StageClientOptions<"opencode">;
      const client = createOpencodeClient({
        ...ocClientOpts,
        baseUrl: serverUrl,
      });
      const sessionResult = await client.session.create(ocSessionOpts);
      await client.tui.selectSession({ sessionID: sessionResult.data!.id });
      return { client, session: sessionResult.data! } as Result;
    }
    case "claude": {
      if (headless) {
        // Headless Claude stages use the Agent SDK directly — no tmux pane.
        const client = new HeadlessClaudeClientWrapper();
        await client.start();
        const session = new HeadlessClaudeSessionWrapper(sessionId);
        return { client, session } as Result;
      }
      const claudeClientOpts = clientOpts as StageClientOptions<"claude">;
      const claudeSessionOpts = sessionOpts as StageSessionOptions<"claude">;
      const client = new ClaudeClientWrapper(paneId, claudeClientOpts);
      await client.start();
      const session = new ClaudeSessionWrapper(paneId, sessionId, claudeSessionOpts, onHIL);
      return { client, session } as Result;
    }
    default:
      return assertNever(agent);
  }
}

/**
 * Clean up provider-specific resources after a stage callback completes.
 * Errors are silently caught — cleanup must not mask callback errors.
 *
 * The `switch (agent)` already narrows the type, so we call
 * disconnect/stop directly without redundant `instanceof` checks or
 * dynamic imports.
 */
async function cleanupProvider<A extends AgentType>(
  agent: A,
  providerClient: ProviderClient<A>,
  providerSession: ProviderSession<A>,
  paneId: string,
): Promise<void> {
  switch (agent) {
    case "copilot": {
      const session = providerSession as ProviderSession<"copilot">;
      const client = providerClient as ProviderClient<"copilot">;
      try {
        await session.disconnect();
      } catch (e) {
        console.warn(
          `[cleanup] copilot session disconnect failed: ${errorMessage(e)}`,
        );
      }
      try {
        await client.stop();
      } catch (e) {
        console.warn(
          `[cleanup] copilot client stop failed: ${errorMessage(e)}`,
        );
      }
      break;
    }
    case "opencode":
      // Stateless HTTP client — no cleanup needed
      break;
    case "claude":
      // Headless Claude stages have no tmux pane to clear.
      if (!paneId.startsWith("headless-")) {
        clearClaudeSession(paneId);
      }
      break;
    default:
      assertNever(agent);
  }
}

/**
 * Create a `ctx.stage()` function bound to a parent name for graph edges.
 *
 * Graph topology is auto-inferred from JavaScript's execution order:
 * - **Sequential** (`await`): the completed stage is in the frontier when the
 *   next stage spawns → parent-child edge.
 * - **Parallel** (`Promise.all`): both calls fire in the same synchronous
 *   frame → frontier is empty for the second call → sibling edges.
 * - **Fan-in**: after `Promise.all` resolves, all parallel stages are in the
 *   frontier → the next stage depends on all of them.
 *
 * The returned function manages the full session lifecycle:
 * spawn → init client/session → run callback → flush saves → cleanup → complete/error.
 */
function createSessionRunner(
  shared: SharedRunnerState,
  parentName: string,
): <T = void>(
  options: SessionRunOptions,
  clientOpts: StageClientOptions<AgentType>,
  sessionOpts: StageSessionOptions<AgentType>,
  run: (ctx: SessionContext) => Promise<T>,
) => Promise<SessionHandle<T>> {
  const graphTracker = new GraphFrontierTracker(parentName);

  return async <T = void>(
    options: SessionRunOptions,
    clientOpts: StageClientOptions<AgentType>,
    sessionOpts: StageSessionOptions<AgentType>,
    run: (ctx: SessionContext) => Promise<T>,
  ): Promise<SessionHandle<T>> => {
    const { name } = options;

    // ── 1. Validate name uniqueness (synchronous, before any await) ──
    if (!name || name.trim() === "") {
      throw new Error("Session name is required.");
    }
    if (
      shared.activeRegistry.has(name) ||
      shared.completedRegistry.has(name) ||
      shared.failedRegistry.has(name)
    ) {
      throw new Error(`Duplicate session name: "${name}"`);
    }

    const isHeadless = options.headless === true;

    // ── 2. Auto-infer graph parents from frontier (synchronous) ──
    // Headless stages are invisible in the graph — they must not consume or
    // update the frontier, otherwise the next visible stage gets orphaned
    // parent refs that don't exist in the panel.
    const graphParents = isHeadless ? [] : graphTracker.onSpawn();

    // ── 3. Create done promise so dependent sessions can await this one ──
    let resolveDone!: () => void;
    let rejectDone!: (err: unknown) => void;
    const donePromise = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    // Prevent "unhandled rejection" noise when no dependent awaits us.
    donePromise.catch(() => {});

    // ── 4. Register in active registry (synchronous) ──
    // Placeholder paneId — filled in after tmux window creation.
    shared.activeRegistry.set(name, { name, paneId: "", done: donePromise });

    const sessionId = generateId();
    let paneId = "";
    let panelSessionAdded = false;

    try {
      // ── 6. Allocate port ──
      const port = await getRandomPort();
      const { command: paneCmd, envVars: paneEnvVars } = buildPaneCommand(
        shared.agent,
        port,
        shared.providerOverrides,
      );

      // ── 7. Create tmux window or headless execution ──
      let serverUrl: string;
      if (isHeadless) {
        // Headless stages use their SDKs directly — no tmux window.
        // Claude Agent SDK runs in-process; Copilot SDK spawns its own CLI;
        // OpenCode SDK starts both server and client via createOpencode().
        paneId = `headless-${name}-${sessionId}`;
        shared.activeRegistry.set(name, { name, paneId, done: donePromise });
        serverUrl = "";

        shared.panel.backgroundTaskStarted();
        panelSessionAdded = true;
      } else {
        // Standard tmux window for visible stages.
        paneId = tmux.createWindow(
          shared.tmuxSessionName,
          name,
          paneCmd,
          undefined,
          paneEnvVars,
        );
        shared.activeRegistry.set(name, { name, paneId, done: donePromise });

        serverUrl = await waitForServer(shared.agent, port, paneId);

        shared.panel.addSession(name, graphParents);
        panelSessionAdded = true;
      }

      // ── 9. Create session directory ──
      const sessionDirName = `${name}-${sessionId}`;
      const sessionDir = join(shared.sessionsBaseDir, sessionDirName);
      await ensureDir(sessionDir);

      const messagesPath = join(sessionDir, "messages.json");
      const inboxPath = join(sessionDir, "inbox.md");

      // ── 11. Claude session snapshot (for identifying new sessions later) ──
      let knownClaudeSessionIds: Set<string> | undefined;
      if (shared.agent === "claude") {
        const { listSessions } = await import("@anthropic-ai/claude-agent-sdk");
        const existing = await listSessions({ dir: process.cwd() });
        knownClaudeSessionIds = new Set(existing.map((s) => s.sessionId));
      }
      const claudeSessionStartedAfter =
        shared.agent === "claude"
          ? Date.now() - CLAUDE_SESSION_TIMESTAMP_BUFFER_MS
          : 0;

      // ── Message wrapping (Claude/Copilot/OpenCode) ──
      async function wrapMessages(
        arg: SessionEvent[] | SessionPromptResponse | string,
      ): Promise<SavedMessage[]> {
        if (typeof arg === "string") {
          const { getSessionMessages, listSessions } =
            await import("@anthropic-ai/claude-agent-sdk");
          const dir = process.cwd();
          const sessions = await listSessions({ dir });

          const newSessions = knownClaudeSessionIds
            ? sessions.filter((s) => !knownClaudeSessionIds!.has(s.sessionId))
            : sessions.filter(
                (s) => s.lastModified >= claudeSessionStartedAfter,
              );

          const candidates = newSessions.sort(
            (a, b) => b.lastModified - a.lastModified,
          );

          const candidate = candidates[0];
          if (!candidate) {
            throw new Error(
              `wrapMessages: no new Claude session found for ${dir}`,
            );
          }

          const msgs: SessionMessage[] = await getSessionMessages(
            candidate.sessionId,
            { dir },
          );
          return msgs.map((m) => ({ provider: "claude" as const, data: m }));
        }

        if (!Array.isArray(arg) && "info" in arg && "parts" in arg) {
          return [
            {
              provider: "opencode" as const,
              data: arg as SessionPromptResponse,
            },
          ];
        }

        if (Array.isArray(arg)) {
          return (arg as SessionEvent[]).map((m) => ({
            provider: "copilot" as const,
            data: m,
          }));
        }

        return [];
      }

      // ── Save function ──
      const pendingSaves: Promise<void>[] = [];

      const save: SaveTranscript = ((
        arg: SessionEvent[] | SessionPromptResponse | string,
      ) => {
        const p = (async () => {
          const wrapped = await wrapMessages(arg);
          await Bun.write(messagesPath, JSON.stringify(wrapped, null, 2));
          const text = renderMessagesToText(wrapped);
          await Bun.write(inboxPath, text);
        })();
        pendingSaves.push(p);
        return p;
      }) as SaveTranscript;

      // ── Transcript/messages access (reads only from completedRegistry) ──
      const transcriptFn = createTranscriptReader(shared.completedRegistry);
      const getMessagesFn = createMessagesReader(shared.completedRegistry);

      // ── HIL (human-in-the-loop) callback ──
      // Unified callback passed to provider-specific HIL detection so that any
      // provider can signal when the agent is waiting for user input or has
      // resumed processing. Both `name` and `shared.panel` are guaranteed to
      // be in scope here: `name` is validated above and `shared.panel` is
      // always present on the shared runner state.
      const onHIL = (waiting: boolean) => {
        if (waiting) shared.panel.sessionAwaitingInput(name);
        else shared.panel.sessionResumed(name);
      };

      // ── 12. Auto-create provider client and session ──
      const {
        client: providerClient,
        session: providerSession,
        cleanup: providerCleanup,
      } = await initProviderClientAndSession(
        shared.agent,
        serverUrl,
        paneId,
        sessionId,
        clientOpts,
        sessionOpts,
        isHeadless,
        onHIL,
      );

      // ── 12a. Copilot: wrap send() to await session.idle ──
      // Copilot's send() is fire-and-forget — it returns immediately after
      // queuing the message. Without this wrapper, stage callbacks complete
      // before the agent finishes processing, causing getMessages() to
      // return incomplete data and the stage to be marked done prematurely.
      // We intercept send() to block until the session emits "session.idle",
      // matching the blocking behavior of Claude's query() and OpenCode's
      // session.prompt().
      //
      // Compatible with sendAndWait(): the SDK's _dispatchEvent broadcasts
      // to all handlers (typed + wildcard), so both this wrapper's listener
      // and sendAndWait's internal wildcard handler observe the same event.
      // Unsubscribe fn for the Copilot HIL event listeners; invoked in the
      // `finally` block so the handlers are removed when the stage ends.
      let hilUnsubscribe: (() => void) | undefined;

      if (shared.agent === "copilot") {
        const copilotSession = providerSession as ProviderSession<"copilot">;
        const nativeSend = copilotSession.send.bind(copilotSession);
        copilotSession.send = wrapCopilotSend(copilotSession, nativeSend);

        // Copilot HIL detection via native SDK events.
        //
        // `tool.execution_start` / `tool.execution_complete` fire for the
        // `ask_user` built-in tool regardless of whether `onUserInputRequest`
        // is registered, so we can detect HIL via the SDK's event stream and
        // still let the CLI render its native tmux-pane dialog.
        hilUnsubscribe = watchCopilotSessionForHIL(copilotSession, onHIL);
      }

      // ── 12b. OpenCode: SSE event stream for HIL detection ──
      //
      // `client.event.subscribe()` yields `question.asked`, `question.replied`,
      // and `question.rejected` events in real time.  The subscription is
      // **awaited** before the stage callback runs so the stream is guaranteed
      // to be open when the first prompt fires.
      if (shared.agent === "opencode") {
        const ocClient = providerClient as ProviderClient<"opencode">;
        const ocSession = providerSession as ProviderSession<"opencode">;
        const ocSessionId = ocSession.id;

        try {
          const { stream } = await ocClient.event.subscribe();
          watchOpencodeStreamForHIL(stream, ocSessionId, onHIL).catch((err) => {
            console.warn(
              `[opencode] HIL event stream disconnected for session ${ocSessionId}: ${errorMessage(err)}`,
            );
          });
        } catch (err) {
          console.warn(
            `[opencode] HIL event stream failed to subscribe for session ${ocSessionId}: ${errorMessage(err)}`,
          );
        }
      }

      // ── 13. Construct SessionContext ──
      // Free-form workflows read their prompt via `s.inputs.prompt`;
      // structured workflows read their declared fields the same way.
      // A single uniform access pattern means workflow code never has
      // to branch on "is this workflow structured or free-form".
      const ctx: SessionContext = {
        client: providerClient,
        session: providerSession,
        inputs: shared.inputs,
        agent: shared.agent,
        sessionDir,
        paneId,
        sessionId,
        save,
        transcript: transcriptFn,
        getMessages: getMessagesFn,
        stage: createSessionRunner(shared, name) as SessionContext["stage"],
      };

      // ── Write session metadata ──
      await Bun.write(
        join(sessionDir, "metadata.json"),
        JSON.stringify(
          {
            name,
            description: options.description ?? "",
            agent: shared.agent,
            paneId,
            serverUrl,
            port,
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      // ── 14. Run user callback ──
      let callbackResult: T;
      try {
        callbackResult = await run(ctx);
        if (pendingSaves.length > 0) await Promise.all(pendingSaves);
      } catch (error) {
        const message = errorMessage(error);
        await Bun.write(join(sessionDir, "error.txt"), message).catch(() => {});
        if (!isHeadless) shared.panel.sessionError(name, message);
        throw error;
      } finally {
        // ── 14a. Stop background HIL watcher (if any) ──
        hilUnsubscribe?.();

        // ── 14b. Auto-cleanup provider resources ──
        await cleanupProvider(
          shared.agent,
          providerClient,
          providerSession,
          paneId,
        );
        if (providerCleanup) {
          try {
            providerCleanup();
          } catch {}
        }
      }

      // ── 15. Mark session complete ──
      if (isHeadless) {
        shared.panel.backgroundTaskFinished();
      } else {
        shared.panel.sessionSuccess(name);
      }
      const result: SessionResult = { name, sessionId, sessionDir, paneId };
      shared.completedRegistry.set(name, result);
      shared.activeRegistry.delete(name);
      resolveDone();

      // Update frontier so the next stage in this scope chains from us.
      // Headless stages are transparent — they don't touch the frontier.
      if (!isHeadless) graphTracker.onSettle(name);
      return { name, id: sessionId, result: callbackResult! };
    } catch (error) {
      const message = errorMessage(error);
      if (panelSessionAdded) {
        if (isHeadless) {
          shared.panel.backgroundTaskFinished();
        } else {
          shared.panel.sessionError(name, message);
        }
      }
      // Kill the tmux window if one was created (visible stages and headless OpenCode).
      // Headless Claude/Copilot have virtual paneIds ("headless-...") — no window to kill.
      if (paneId && !paneId.startsWith("headless-")) {
        try {
          tmux.killWindow(shared.tmuxSessionName, name);
        } catch {}
      }
      // Ensure the done promise settles and the active entry is cleared.
      shared.activeRegistry.delete(name);
      shared.failedRegistry.add(name);
      rejectDone(error);
      // Update frontier even on failure — if the caller catches and
      // continues, the next stage should still chain from this one.
      // Headless stages are transparent — they don't touch the frontier.
      if (!isHeadless) graphTracker.onSettle(name);
      throw error;
    }
  };
}

// ============================================================================
// Orchestrator logic — runs inside a tmux pane
// ============================================================================

export async function runOrchestrator(): Promise<void> {
  const requiredEnvVars = [
    "ATOMIC_WF_ID",
    "ATOMIC_WF_TMUX",
    "ATOMIC_WF_AGENT",
    "ATOMIC_WF_FILE",
    "ATOMIC_WF_CWD",
  ] as const;
  for (const key of requiredEnvVars) {
    if (process.env[key] === undefined) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const workflowRunId = process.env.ATOMIC_WF_ID!;
  const tmuxSessionName = process.env.ATOMIC_WF_TMUX!;
  const rawAgent = process.env.ATOMIC_WF_AGENT!;
  if (!isValidAgent(rawAgent)) {
    throw new Error(
      `Invalid ATOMIC_WF_AGENT: "${rawAgent}". Expected one of: copilot, opencode, claude`,
    );
  }
  const agent: AgentType = rawAgent;
  // ATOMIC_WF_INPUTS carries the full input payload. Free-form
  // workflows store their single positional prompt under the `prompt`
  // key so workflow authors always read it via `ctx.inputs.prompt`.
  // An unset, missing, or malformed payload falls back to an empty
  // record so `ctx.inputs.prompt` gracefully becomes `undefined`.
  const inputs = parseInputsEnv(process.env.ATOMIC_WF_INPUTS);
  // A bare prompt string is still useful for the panel header and the
  // session-dir metadata.json — both just want something displayable.
  const prompt = inputs.prompt ?? "";
  const workflowFile = process.env.ATOMIC_WF_FILE!;
  const cwd = process.env.ATOMIC_WF_CWD!;

  process.chdir(cwd);

  const providerOverrides = await getProviderOverrides(agent, cwd);
  const sessionsBaseDir = join(getSessionsBaseDir(), workflowRunId);
  await ensureDir(sessionsBaseDir);

  const panel = await OrchestratorPanel.create({
    tmuxSession: tmuxSessionName,
  });

  // Idempotent shutdown guard
  let shutdownCalled = false;
  const shutdown = (exitCode = 0) => {
    if (shutdownCalled) return;
    shutdownCalled = true;
    panel.destroy();
    try {
      tmux.killSession(tmuxSessionName);
    } catch {}
    process.exitCode = exitCode;
  };

  // Wire SIGINT so the terminal is always restored.
  // SIGTERM and other signals are handled by OpenTUI's exitSignals.
  const signalHandler = () => shutdown(1);
  process.on("SIGINT", signalHandler);

  // Shared state for all session runners
  const shared: SharedRunnerState = {
    tmuxSessionName,
    sessionsBaseDir,
    agent,
    inputs,
    providerOverrides,
    panel,
    activeRegistry: new Map(),
    completedRegistry: new Map(),
    failedRegistry: new Set(),
  };

  try {
    const plan: WorkflowLoader.Plan = {
      name: workflowFile.split("/").at(-3) ?? "unknown",
      agent,
      path: workflowFile,
      source: "local",
    };

    const loaded = await WorkflowLoader.loadWorkflow(plan, {
      warn(warnings) {
        for (const w of warnings) {
          console.warn(`⚠ [${w.rule}] ${w.message}`);
        }
      },
    });
    if (!loaded.ok) {
      throw new Error(loaded.message);
    }
    const definition = loaded.value.definition;

    await Bun.write(
      join(sessionsBaseDir, "metadata.json"),
      JSON.stringify(
        {
          workflowName: definition.name,
          agent,
          prompt,
          projectRoot: cwd,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    // Initialize panel with just the orchestrator node (sessions added dynamically)
    panel.showWorkflowInfo(definition.name, agent, [], prompt);

    // Build the WorkflowContext — top-level context for the .run() callback
    const sessionRunner = createSessionRunner(shared, "orchestrator");

    const workflowCtx: WorkflowContext = {
      inputs,
      agent,
      stage: sessionRunner as WorkflowContext["stage"],
      transcript: createTranscriptReader(shared.completedRegistry),
      getMessages: createMessagesReader(shared.completedRegistry),
    };

    // Run the workflow, racing against user abort (q / Ctrl+C)
    const abortPromise = panel.waitForAbort().then(() => {
      throw new WorkflowAbortError();
    });
    await Promise.race([definition.run(workflowCtx), abortPromise]);

    panel.showCompletion(definition.name, sessionsBaseDir);
    await panel.waitForExit();
    shutdown(0);
  } catch (error) {
    // Kill any active tmux windows that didn't complete.
    // Headless Claude/Copilot have virtual paneIds ("headless-...") — their
    // SDK-managed processes are cleaned up by cleanupProvider().
    for (const [, active] of shared.activeRegistry) {
      try {
        if (active.paneId && !active.paneId.startsWith("headless-")) {
          tmux.killWindow(tmuxSessionName, active.name);
        }
      } catch {}
    }

    if (error instanceof WorkflowAbortError) {
      shutdown(0);
    } else {
      const message = errorMessage(error);
      try {
        panel.showFatalError(message);
        await panel.waitForExit();
      } catch {}
      shutdown(1);
    }
  } finally {
    process.off("SIGINT", signalHandler);
  }
}
