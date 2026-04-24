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

// Registry
export type { Registry } from "./registry.ts";
export { createRegistry } from "./registry.ts";

// WorkflowCli — the factory that drives workflow CLIs. Accepts a lone
// workflow, an array of workflows, or a Registry for programmatic
// composition. Ships with the interactive picker out of the box.
export { createWorkflowCli } from "./workflow-cli.ts";
export type { WorkflowCli, CreateWorkflowCliOptions } from "./types.ts";
