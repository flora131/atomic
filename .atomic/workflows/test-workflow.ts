/**
 * Test Workflow Definition
 *
 * A basic workflow for testing custom workflow loading from .atomic/workflows.
 * Demonstrates the expected export structure for custom workflows.
 *
 * Usage:
 *   /test-workflow <message>
 *   /test <message>
 *   /tw <message>
 */

import type { CompiledGraph, BaseState, NodeDefinition, ExecutionContext, NodeResult } from "../../src/graph/types.ts";
import { graph } from "../../src/graph/index.ts";

// ============================================================================
// WORKFLOW METADATA (Exported Constants)
// ============================================================================

/** Workflow name (used as command name) */
export const name = "test-workflow";

/** Human-readable description */
export const description = "A basic test workflow for validating custom workflow loading";

/** Alternative command names */
export const aliases = ["test", "tw"];

/** Default configuration for the workflow */
export const defaultConfig = {
  maxIterations: 5,
  greeting: "Hello from test workflow!",
};

// ============================================================================
// WORKFLOW STATE
// ============================================================================

/**
 * State interface for the test workflow.
 * Extends BaseState with workflow-specific fields.
 */
export interface TestWorkflowState extends BaseState {
  /** User's input message */
  userMessage: string;
  /** Greeting from the first node */
  greeting?: string;
  /** Processed result from the workflow */
  result?: string;
  /** Whether workflow completed successfully */
  completed: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create initial state for the test workflow.
 */
export function createTestWorkflowState(userMessage: string): TestWorkflowState {
  return {
    executionId: crypto.randomUUID(),
    lastUpdated: new Date().toISOString(),
    outputs: {},
    userMessage,
    completed: false,
  };
}

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * Configuration for the greet node.
 */
interface GreetNodeConfig {
  id: string;
  greeting?: string;
}

/**
 * Create a node that emits a greeting message.
 */
function createGreetNode(config: GreetNodeConfig): NodeDefinition<TestWorkflowState> {
  const { id, greeting = defaultConfig.greeting } = config;

  return {
    id,
    type: "tool",
    name: "Greet",
    description: "Emit a greeting message to start the workflow",
    execute: async (ctx: ExecutionContext<TestWorkflowState>): Promise<NodeResult<TestWorkflowState>> => {
      const state = ctx.state;

      console.log(`[test-workflow] Greeting: ${greeting}`);
      console.log(`[test-workflow] User message: ${state.userMessage}`);

      return {
        stateUpdate: {
          greeting,
          lastUpdated: new Date().toISOString(),
        },
      };
    },
  };
}

/**
 * Configuration for the process node.
 */
interface ProcessNodeConfig {
  id: string;
}

/**
 * Create a node that processes the user message.
 */
function createProcessNode(config: ProcessNodeConfig): NodeDefinition<TestWorkflowState> {
  const { id } = config;

  return {
    id,
    type: "tool",
    name: "Process",
    description: "Process the user message and generate a result",
    execute: async (ctx: ExecutionContext<TestWorkflowState>): Promise<NodeResult<TestWorkflowState>> => {
      const state = ctx.state;

      // Simulate processing
      const result = `Processed: "${state.userMessage}" with greeting "${state.greeting}"`;
      console.log(`[test-workflow] Result: ${result}`);

      return {
        stateUpdate: {
          result,
          lastUpdated: new Date().toISOString(),
        },
      };
    },
  };
}

/**
 * Configuration for the complete node.
 */
interface CompleteNodeConfig {
  id: string;
}

/**
 * Create a node that marks the workflow as complete.
 */
function createCompleteNode(config: CompleteNodeConfig): NodeDefinition<TestWorkflowState> {
  const { id } = config;

  return {
    id,
    type: "tool",
    name: "Complete",
    description: "Mark the workflow as completed",
    execute: async (ctx: ExecutionContext<TestWorkflowState>): Promise<NodeResult<TestWorkflowState>> => {
      const state = ctx.state;

      console.log(`[test-workflow] Workflow completed!`);
      console.log(`[test-workflow] Final result: ${state.result}`);

      return {
        stateUpdate: {
          completed: true,
          lastUpdated: new Date().toISOString(),
        },
      };
    },
  };
}

// ============================================================================
// WORKFLOW FACTORY (Default Export)
// ============================================================================

/**
 * Create the test workflow graph.
 *
 * This is the required default export for custom workflows.
 * It receives configuration and returns a compiled graph.
 *
 * Workflow sequence:
 * 1. Greet - Emit greeting message
 * 2. Process - Process user message
 * 3. Complete - Mark workflow as done
 *
 * @param config - Optional workflow configuration
 * @returns Compiled workflow graph
 *
 * @example
 * ```typescript
 * const workflow = createTestWorkflow({ greeting: "Custom greeting!" });
 * const initialState = createTestWorkflowState("Hello");
 * const result = await executeGraph(workflow, { initialState });
 * ```
 */
export default function createTestWorkflow(
  config: Record<string, unknown> = {}
): CompiledGraph<TestWorkflowState> {
  // Merge config with defaults
  const greeting = (config.greeting as string) ?? defaultConfig.greeting;

  // Create nodes
  const greetNode = createGreetNode({
    id: "greet",
    greeting,
  });

  const processNode = createProcessNode({
    id: "process",
  });

  const completeNode = createCompleteNode({
    id: "complete",
  });

  // Build the workflow graph
  const builder = graph<TestWorkflowState>()
    .start(greetNode)
    .then(processNode)
    .then(completeNode)
    .end();

  // Compile with configuration
  return builder.compile({
    metadata: {
      workflowName: name,
      workflowDescription: description,
    },
  });
}
