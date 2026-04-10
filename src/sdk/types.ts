/**
 * Workflow SDK Types
 *
 * Uses native SDK types directly — no re-definitions.
 */

import type { SessionEvent } from "@github/copilot-sdk";
import type { SessionPromptResponse } from "@opencode-ai/sdk/v2";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";

/** Supported agent types */
export type AgentType = "copilot" | "opencode" | "claude";

/**
 * A transcript from a completed session.
 * Provides both the file path and rendered text content.
 */
export interface Transcript {
  /** Absolute path to the transcript file on disk */
  path: string;
  /** The transcript content (assistant text extracted from messages) */
  content: string;
}

/**
 * A saved message from any provider, stored as JSON.
 * Uses native SDK types directly.
 */
export type SavedMessage =
  | { provider: "copilot"; data: SessionEvent }
  | { provider: "opencode"; data: SessionPromptResponse }
  | { provider: "claude"; data: SessionMessage };

/**
 * Save native message objects from the provider SDK.
 *
 * - **Copilot**: `s.save(await session.getMessages())`
 * - **OpenCode**: `s.save(result.data)` — the full `{ info, parts }` response
 * - **Claude**: `s.save(sessionId)` — auto-reads via `getSessionMessages()`
 */
export interface SaveTranscript {
  /** Save Copilot SessionEvent[] from session.getMessages() */
  (messages: SessionEvent[]): Promise<void>;
  /** Save OpenCode prompt response `{ info, parts }` from session.prompt().data */
  (response: SessionPromptResponse): Promise<void>;
  /** Save Claude messages — pass the session ID to auto-read transcript */
  (claudeSessionId: string): Promise<void>;
}

/** A reference to a completed session — either a handle or a session name string. */
export type SessionRef = string | SessionHandle<unknown>;

/**
 * Handle returned by `ctx.session()`. Used for type-safe transcript references
 * and carries the callback's return value.
 */
export interface SessionHandle<T = void> {
  /** The session's unique name */
  readonly name: string;
  /** The session's generated UUID */
  readonly id: string;
  /** The value returned by the session callback */
  readonly result: T;
}

/**
 * Options for spawning a session via `ctx.session()`.
 */
export interface SessionRunOptions {
  /** Unique name for this session (used for transcript references and graph display) */
  name: string;
  /** Human-readable description */
  description?: string;
  /**
   * Names of sessions this one depends on. Serves two purposes:
   *
   * 1. **Graph rendering** — each named session becomes a parent edge in the
   *    graph, so chains and fan-ins show up as real topology instead of
   *    sibling-under-root.
   * 2. **Runtime ordering** — at spawn time, the runtime waits for every
   *    named dep to finish before starting. This makes dependency-driven
   *    `Promise.all([...])` patterns safe: you can kick off many sessions
   *    concurrently and let `dependsOn` serialize only the edges that matter.
   *
   * Each name must refer to a session that has already been spawned (either
   * active or completed) at the time the dependent session is created.
   * Unknown names throw a clear error.
   *
   * When omitted, the session falls back to the default parent (the
   * enclosing `ctx.session()` scope, or `orchestrator` at the top level).
   */
  dependsOn?: string[];
}

/**
 * Context provided to each session's callback.
 * Created by `ctx.session(opts, fn)` — the callback receives this as its argument.
 */
export interface SessionContext {
  /** The agent's server URL (Copilot --ui-server / OpenCode built-in server) */
  serverUrl: string;
  /** The original user prompt from the CLI invocation */
  userPrompt: string;
  /** Which agent is running */
  agent: AgentType;
  /**
   * Get a completed session's transcript as rendered text.
   * Accepts a SessionHandle (recommended) or session name string.
   */
  transcript(ref: SessionRef): Promise<Transcript>;
  /**
   * Get a completed session's raw native messages.
   * Accepts a SessionHandle (recommended) or session name string.
   */
  getMessages(ref: SessionRef): Promise<SavedMessage[]>;
  /**
   * Save this session's output for subsequent sessions.
   * Accepts native SDK message objects only.
   */
  save: SaveTranscript;
  /** Path to this session's storage directory on disk */
  sessionDir: string;
  /** tmux pane ID for this session */
  paneId: string;
  /** Session UUID */
  sessionId: string;
  /**
   * Spawn a nested sub-session with its own tmux window and graph node.
   * The sub-session is a child of this session in the graph.
   * The callback's return value is available as `handle.result`.
   */
  session<T = void>(
    options: SessionRunOptions,
    run: (ctx: SessionContext) => Promise<T>,
  ): Promise<SessionHandle<T>>;
}

/**
 * Top-level context provided to the workflow's `.run()` callback.
 * Does not have session-specific fields (serverUrl, paneId, save, etc.).
 */
export interface WorkflowContext {
  /** The original user prompt from the CLI invocation */
  userPrompt: string;
  /** Which agent is running */
  agent: AgentType;
  /**
   * Spawn a session with its own tmux window and graph node.
   * The runtime manages the full lifecycle: start → run callback → complete/error.
   * The callback's return value is available as `handle.result`.
   */
  session<T = void>(
    options: SessionRunOptions,
    run: (ctx: SessionContext) => Promise<T>,
  ): Promise<SessionHandle<T>>;
  /**
   * Get a completed session's transcript as rendered text.
   * Accepts a SessionHandle (recommended) or session name string.
   */
  transcript(ref: SessionRef): Promise<Transcript>;
  /**
   * Get a completed session's raw native messages.
   * Accepts a SessionHandle (recommended) or session name string.
   */
  getMessages(ref: SessionRef): Promise<SavedMessage[]>;
}

/**
 * Options for defining a workflow.
 */
export interface WorkflowOptions {
  /** Unique workflow name */
  name: string;
  /** Human-readable description */
  description?: string;
}

/**
 * A compiled workflow definition — the sealed output of defineWorkflow().compile().
 */
export interface WorkflowDefinition {
  readonly __brand: "WorkflowDefinition";
  readonly name: string;
  readonly description: string;
  /** The workflow's entry point. Called by the executor with a WorkflowContext. */
  readonly run: (ctx: WorkflowContext) => Promise<void>;
}
