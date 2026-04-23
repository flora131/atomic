/**
 * atomic/workflows
 *
 * Workflow SDK for defining dynamic agent workflows.
 * Workflows use defineWorkflow().run().compile() with ctx.stage()
 * for spawning agent sessions using native TypeScript control flow.
 */

export { defineWorkflow, WorkflowBuilder } from "../define-workflow.ts";

export type {
  AgentType,
  ValidationWarning,
  Transcript,
  SavedMessage,
  SaveTranscript,
  SessionContext,
  SessionRef,
  SessionHandle,
  SessionRunOptions,
  WorkflowContext,
  WorkflowOptions,
  WorkflowDefinition,
  WorkflowInput,
  WorkflowInputType,
  StageClientOptions,
  StageSessionOptions,
  ProviderClient,
  ProviderSession,
  CopilotClient,
  CopilotClientOptions,
  CopilotSession,
  CopilotSessionConfig,
  OpencodeClient,
  OpencodeSession,
  ClaudeClientWrapper,
  ClaudeSessionWrapper,
} from "../types.ts";

// Re-export native SDK types for convenience
export type { SessionEvent as CopilotSessionEvent } from "@github/copilot-sdk";
export type { SessionPromptResponse as OpenCodePromptResponse } from "@opencode-ai/sdk/v2";
export type { SessionMessage as ClaudeSessionMessage } from "@anthropic-ai/claude-agent-sdk";

// Providers
export { createClaudeSession, claudeQuery, clearClaudeSession, extractAssistantText, validateClaudeWorkflow } from "../providers/claude.ts";
export type { ClaudeSessionOptions, ClaudeQueryOptions } from "../providers/claude.ts";

export { validateCopilotWorkflow } from "../providers/copilot.ts";

export { validateOpenCodeWorkflow } from "../providers/opencode.ts";

// Runtime — tmux utilities
export type { TmuxResult, TmuxSession, SessionType } from "../runtime/tmux.ts";
export {
  SOCKET_NAME,
  isTmuxInstalled,
  getMuxBinary,
  resetMuxBinaryCache,
  isInsideTmux,
  isInsideAtomicSocket,
  createSession,
  createWindow,
  createPane,
  sendLiteralText,
  sendSpecialKey,
  capturePane,
  capturePaneVisible,
  capturePaneScrollback,
  killSession,
  killSessionOnPaneExit,
  killWindow,
  sessionExists,
  listSessions,
  attachSession,
  spawnMuxAttach,
  switchClient,
  getCurrentSession,
  attachOrSwitch,
  detachAndAttachAtomic,
  selectWindow,
  setSessionEnv,
  getSessionEnv,
  parseSessionName,
  tmuxRun,
  normalizeTmuxCapture,
  normalizeTmuxLines,
} from "../runtime/tmux.ts";

// Runtime — workflow discovery
export {
  AGENTS,
  discoverWorkflows,
  findWorkflow,
  loadWorkflowsMetadata,
  WORKFLOWS_GITIGNORE,
} from "../runtime/discovery.ts";
export type {
  DiscoveredWorkflow,
  WorkflowWithMetadata,
  WorkflowMetadataStatus,
} from "../runtime/discovery.ts";

// Runtime — workflow loader pipeline
export { WorkflowLoader } from "../runtime/loader.ts";

// Runtime — workflow executor
export { executeWorkflow } from "../runtime/executor.ts";
export type { WorkflowRunOptions } from "../runtime/executor.ts";
