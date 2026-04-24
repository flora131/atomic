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

// Worker — single-workflow CLI factory
export { createWorker } from "./worker.ts";
export type { Worker, CreateWorkerOptions } from "./types.ts";

// Dispatcher — multi-workflow CLI factory (registry-based dispatch)
export { createDispatcher } from "./dispatcher.ts";
export type { Dispatcher, CreateDispatcherOptions } from "./types.ts";
