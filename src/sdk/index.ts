/**
 * atomic SDK
 *
 * Public API barrel — re-exports the SDK surface.
 * CLI-only concerns (colors, prompts, process management) are not exported here.
 */

// Typed errors
export {
  MissingDependencyError,
  WorkflowNotCompiledError,
  InvalidWorkflowError,
} from "./errors.ts";

// Shared types
export type {
  AgentType,
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
  StageClientOptions,
  StageSessionOptions,
  ProviderClient,
  ProviderSession,
} from "./types.ts";

// Workflow SDK (also available as atomic/workflows subpath)
export { defineWorkflow } from "./define-workflow.ts";

// Workflow discovery and execution
export {
  discoverWorkflows,
  findWorkflow,
} from "./runtime/discovery.ts";

export { WorkflowLoader } from "./runtime/loader.ts";

export { executeWorkflow } from "./runtime/executor.ts";
