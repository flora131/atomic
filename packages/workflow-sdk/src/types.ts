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
 * - **Copilot**: `ctx.save(await session.getMessages())`
 * - **OpenCode**: `ctx.save(result.data)` — the full `{ info, parts }` response
 * - **Claude**: `ctx.save(sessionId)` — auto-reads via `getSessionMessages()`
 */
export interface SaveTranscript {
  /** Save Copilot SessionEvent[] from session.getMessages() */
  (messages: SessionEvent[]): Promise<void>;
  /** Save OpenCode prompt response `{ info, parts }` from session.prompt().data */
  (response: SessionPromptResponse): Promise<void>;
  /** Save Claude messages — pass the session ID to auto-read transcript */
  (claudeSessionId: string): Promise<void>;
}

/**
 * Session context provided to each session's run() callback at execution time.
 */
export interface SessionContext {
  /** The agent's server URL (Copilot --ui-server / OpenCode built-in server) */
  serverUrl: string;
  /** The original user prompt from the CLI invocation */
  userPrompt: string;
  /** Which agent is running */
  agent: AgentType;
  /**
   * Get a previous session's transcript as rendered text.
   * Returns `{ path, content }` — path for file triggers, content for embedding.
   */
  transcript(sessionName: string): Promise<Transcript>;
  /**
   * Get a previous session's raw native messages.
   * Returns SavedMessage[] exactly as stored by ctx.save().
   */
  getMessages(sessionName: string): Promise<SavedMessage[]>;
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
}

/**
 * Options for defining a session in a workflow.
 */
export interface SessionOptions {
  /** Unique name for this session (used for transcript references) */
  name: string;
  /** Human-readable description */
  description?: string;
  /** The session callback. User writes raw provider-specific SDK code here. */
  run: (ctx: SessionContext) => Promise<void>;
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
  /** Ordered execution steps. Each step is an array of sessions — length 1 is sequential, length > 1 is parallel. */
  readonly steps: ReadonlyArray<ReadonlyArray<SessionOptions>>;
}
