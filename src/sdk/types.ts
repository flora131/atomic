/**
 * Workflow SDK Types
 *
 * Uses native SDK types directly — no re-definitions.
 */

import type { SessionEvent } from "@github/copilot-sdk";
import type { SessionPromptResponse } from "@opencode-ai/sdk/v2";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";

// Provider SDK types for the type maps
import type {
  CopilotClient,
  CopilotClientOptions,
  CopilotSession,
  SessionConfig as CopilotSessionConfig,
} from "@github/copilot-sdk";
import type {
  OpencodeClient,
  Session as OpencodeSession,
} from "@opencode-ai/sdk/v2";
import type {
  ClaudeClientWrapper,
  ClaudeSessionWrapper,
  ClaudeQueryDefaults,
} from "./providers/claude.ts";

/** Supported agent types */
export type AgentType = "copilot" | "opencode" | "claude";

// ─── Provider type maps ─────────────────────────────────────────────────────

/**
 * Maps each agent to the client init options the user passes to `ctx.stage()`.
 * Auto-injected fields (`cliUrl`, `baseUrl`, `paneId`) are omitted.
 */
type ClientOptionsMap = {
  opencode: { directory?: string; experimental_workspaceID?: string };
  copilot: Omit<CopilotClientOptions, "cliUrl">;
  claude: { chatFlags?: string[]; readyTimeoutMs?: number };
};

/**
 * Maps each agent to the session create options the user passes to `ctx.stage()`.
 * - OpenCode: `client.session.create()` body params
 * - Copilot: `client.createSession()` config (onPermissionRequest defaults to approveAll)
 * - Claude: `claudeQuery()` defaults for subsequent queries
 */
type SessionOptionsMap = {
  opencode: {
    parentID?: string;
    title?: string;
    workspaceID?: string;
  };
  copilot: Partial<CopilotSessionConfig>;
  claude: ClaudeQueryDefaults;
};

/** Maps each agent to the `s.client` type provided in the stage callback. */
type ClientMap = {
  opencode: OpencodeClient;
  copilot: CopilotClient;
  claude: ClaudeClientWrapper;
};

/** Maps each agent to the `s.session` type provided in the stage callback. */
type SessionMap = {
  opencode: OpencodeSession;
  copilot: CopilotSession;
  claude: ClaudeSessionWrapper;
};

/** Client init options for `ctx.stage()`, resolved by agent type. */
export type StageClientOptions<A extends AgentType> = ClientOptionsMap[A];

/** Session create options for `ctx.stage()`, resolved by agent type. */
export type StageSessionOptions<A extends AgentType> = SessionOptionsMap[A];

/** The `s.client` type in a stage callback, resolved by agent type. */
export type ProviderClient<A extends AgentType> = ClientMap[A];

/** The `s.session` type in a stage callback, resolved by agent type. */
export type ProviderSession<A extends AgentType> = SessionMap[A];

// Re-export provider types for convenience
export type {
  CopilotClient,
  CopilotClientOptions,
  CopilotSession,
  CopilotSessionConfig,
  OpencodeClient,
  OpencodeSession,
  ClaudeClientWrapper,
  ClaudeSessionWrapper,
  ClaudeQueryDefaults,
};

// ─── Core types ─────────────────────────────────────────────────────────────

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
 * - **Copilot**: `s.save(await s.session.getMessages())`
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
 * Handle returned by `ctx.stage()`. Used for type-safe transcript references
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
 * Options for spawning a session via `ctx.stage()`.
 */
export interface SessionRunOptions {
  /** Unique name for this session (used for transcript references and graph display) */
  name: string;
  /** Human-readable description */
  description?: string;
}

/**
 * Context provided to each session's callback.
 * Created by `ctx.stage(opts, clientOpts, sessionOpts, fn)` — the callback
 * receives this as its argument with pre-initialized `client` and `session`.
 */
export interface SessionContext<A extends AgentType = AgentType> {
  /** Provider-specific SDK client (auto-created by runtime) */
  client: ProviderClient<A>;
  /** Provider-specific session (auto-created by runtime) */
  session: ProviderSession<A>;
  /** The original user prompt from the CLI invocation */
  userPrompt: string;
  /** Which agent is running */
  agent: A;
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
  stage<T = void>(
    options: SessionRunOptions,
    clientOpts: StageClientOptions<A>,
    sessionOpts: StageSessionOptions<A>,
    run: (ctx: SessionContext<A>) => Promise<T>,
  ): Promise<SessionHandle<T>>;
}

/**
 * Top-level context provided to the workflow's `.run()` callback.
 * Does not have session-specific fields (paneId, save, etc.).
 */
export interface WorkflowContext<A extends AgentType = AgentType> {
  /** The original user prompt from the CLI invocation */
  userPrompt: string;
  /** Which agent is running */
  agent: A;
  /**
   * Spawn a session with its own tmux window and graph node.
   * The runtime manages the full lifecycle: create client → create session →
   * run callback → cleanup. The callback's return value is available as
   * `handle.result`.
   */
  stage<T = void>(
    options: SessionRunOptions,
    clientOpts: StageClientOptions<A>,
    sessionOpts: StageSessionOptions<A>,
    run: (ctx: SessionContext<A>) => Promise<T>,
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
export interface WorkflowDefinition<A extends AgentType = AgentType> {
  readonly __brand: "WorkflowDefinition";
  readonly name: string;
  readonly description: string;
  /** The workflow's entry point. Called by the executor with a WorkflowContext. */
  readonly run: (ctx: WorkflowContext<A>) => Promise<void>;
}
