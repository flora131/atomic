/**
 * @bastani/atomic-workflows
 *
 * Workflow SDK for defining multi-session agent workflows.
 * Workflows are defined as a chain of .session() calls and compiled
 * into a WorkflowDefinition consumed by the Atomic CLI runtime.
 */

export { defineWorkflow, WorkflowBuilder } from "./define-workflow.ts";

export type {
  AgentType,
  Transcript,
  SavedMessage,
  SaveTranscript,
  SessionContext,
  SessionOptions,
  WorkflowOptions,
  WorkflowDefinition,
} from "./types.ts";

// Re-export native SDK types for convenience
export type { SessionEvent as CopilotSessionEvent } from "@github/copilot-sdk";
export type { SessionPromptResponse as OpenCodePromptResponse } from "@opencode-ai/sdk/v2";
export type { SessionMessage as ClaudeSessionMessage } from "@anthropic-ai/claude-agent-sdk";

// Providers
export { createClaudeSession, claudeQuery, clearClaudeSession, validateClaudeWorkflow } from "./providers/claude.ts";
export type { ClaudeSessionOptions, ClaudeQueryOptions, ClaudeQueryResult, ClaudeValidationWarning } from "./providers/claude.ts";

export { validateCopilotWorkflow } from "./providers/copilot.ts";
export type { CopilotValidationWarning } from "./providers/copilot.ts";

export { validateOpenCodeWorkflow } from "./providers/opencode.ts";
export type { OpenCodeValidationWarning } from "./providers/opencode.ts";

// Runtime — tmux utilities
export {
  isTmuxInstalled,
  getMuxBinary,
  resetMuxBinaryCache,
  isInsideTmux,
  createSession,
  createWindow,
  createPane,
  sendLiteralText,
  sendSpecialKey,
  sendKeysAndSubmit,
  capturePane,
  capturePaneVisible,
  capturePaneScrollback,
  killSession,
  sessionExists,
  attachSession,
  switchClient,
  getCurrentSession,
  attachOrSwitch,
  selectWindow,
  waitForOutput,
  tmuxRun,
  normalizeTmuxCapture,
  normalizeTmuxLines,
  paneLooksReady,
  paneHasActiveTask,
  paneIsIdle,
  waitForPaneReady,
  attemptSubmitRounds,
} from "./runtime/tmux.ts";

// Runtime — workflow discovery
export {
  discoverWorkflows,
  findWorkflow,
  loadWorkflowDefinition,
} from "./runtime/discovery.ts";
export type { DiscoveredWorkflow } from "./runtime/discovery.ts";

// Runtime — workflow executor
export { executeWorkflow } from "./runtime/executor.ts";
export type { WorkflowRunOptions } from "./runtime/executor.ts";
