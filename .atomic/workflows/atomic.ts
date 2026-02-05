/**
 * Atomic Workflow Definition
 *
 * The full Atomic workflow for AI-assisted software development.
 * Follows the pattern: Research → Spec → Features → Implement → PR
 *
 * This workflow automates the Atomic SDLC approach:
 * 1. Research the codebase to understand existing patterns
 * 2. Create a technical specification for the feature
 * 3. Break the spec into implementable features
 * 4. Implement each feature with Ralph
 * 5. Create a pull request
 *
 * Usage:
 *   /atomic <feature description>
 *   /workflow <feature description>
 *
 * @see https://github.com/flora131/atomic
 */

import type { CompiledGraph, BaseState, NodeDefinition, ExecutionContext, NodeResult, SignalData } from "../../src/graph/types.ts";
import { graph } from "../../src/graph/index.ts";

// ============================================================================
// WORKFLOW METADATA (Exported Constants)
// ============================================================================

/** Workflow name (used as command name) */
export const name = "atomic";

/** Human-readable description */
export const description = "Full Atomic workflow: Research → Spec → Features → Implement → PR";

/** Alternative command names */
export const aliases = ["workflow"];

/** Default configuration for the workflow */
export const defaultConfig = {
  maxIterations: 100,
  autoApproveSpec: false,
  researchDir: "research",
};

// ============================================================================
// WORKFLOW STATE
// ============================================================================

/**
 * State interface for the Atomic workflow.
 * Tracks progress through each phase of the SDLC.
 */
export interface AtomicWorkflowState extends BaseState {
  /** Initial user prompt describing the feature */
  userPrompt: string;
  /** Path to the research document */
  researchPath?: string;
  /** Whether research phase is complete */
  researchComplete: boolean;
  /** Path to the spec document */
  specPath?: string;
  /** Whether spec has been approved */
  specApproved: boolean;
  /** Feedback if spec was rejected */
  specFeedback?: string;
  /** Path to the feature list JSON */
  featureListPath?: string;
  /** Current feature being implemented */
  currentFeature?: number;
  /** Total number of features */
  totalFeatures?: number;
  /** Whether all features are complete */
  implementationComplete: boolean;
  /** Whether PR was created */
  prCreated: boolean;
  /** PR URL if created */
  prUrl?: string;
  /** Current phase of the workflow */
  phase: "research" | "spec" | "review" | "features" | "implement" | "pr" | "complete";
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create initial state for the Atomic workflow.
 */
export function createAtomicWorkflowState(userPrompt: string): AtomicWorkflowState {
  return {
    executionId: crypto.randomUUID(),
    lastUpdated: new Date().toISOString(),
    outputs: {},
    userPrompt,
    researchComplete: false,
    specApproved: false,
    implementationComplete: false,
    prCreated: false,
    phase: "research",
  };
}

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * Research Node - Analyzes the codebase to understand patterns and context.
 */
function createResearchNode(): NodeDefinition<AtomicWorkflowState> {
  return {
    id: "research",
    type: "agent",
    name: "Research Codebase",
    description: "Analyze the codebase to understand patterns, architecture, and relevant files",
    execute: async (ctx: ExecutionContext<AtomicWorkflowState>): Promise<NodeResult<AtomicWorkflowState>> => {
      const state = ctx.state;
      const timestamp = new Date().toISOString().split("T")[0];
      const slugifiedPrompt = state.userPrompt
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .substring(0, 50);
      const researchPath = `research/docs/${timestamp}-${slugifiedPrompt}.md`;

      // The agent node will invoke the AI to do the research
      // The actual research is done by sending the prompt to the agent
      console.log(`[atomic] Starting research phase for: ${state.userPrompt}`);

      return {
        stateUpdate: {
          researchPath,
          researchComplete: true,
          phase: "spec",
          lastUpdated: new Date().toISOString(),
        },
      };
    },
  };
}

/**
 * Spec Node - Creates a technical specification from the research.
 */
function createSpecNode(): NodeDefinition<AtomicWorkflowState> {
  return {
    id: "create-spec",
    type: "agent",
    name: "Create Specification",
    description: "Generate a technical specification based on the research findings",
    execute: async (ctx: ExecutionContext<AtomicWorkflowState>): Promise<NodeResult<AtomicWorkflowState>> => {
      const state = ctx.state;
      const slugifiedPrompt = state.userPrompt
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .substring(0, 50);
      const specPath = `specs/${slugifiedPrompt}.md`;

      console.log(`[atomic] Creating specification from research: ${state.researchPath}`);

      return {
        stateUpdate: {
          specPath,
          phase: "review",
          lastUpdated: new Date().toISOString(),
        },
      };
    },
  };
}

/**
 * Review Node - Waits for human approval of the spec.
 */
function createReviewNode(): NodeDefinition<AtomicWorkflowState> {
  return {
    id: "review-spec",
    type: "wait",
    name: "Review Specification",
    description: "Wait for human approval of the technical specification",
    execute: async (ctx: ExecutionContext<AtomicWorkflowState>): Promise<NodeResult<AtomicWorkflowState>> => {
      const state = ctx.state;

      console.log(`[atomic] Waiting for spec approval: ${state.specPath}`);

      // This is a wait node - it will pause execution until human responds
      // Emit a signal to request human input
      const signals: SignalData[] = [{
        type: "human_input_required",
        message: `Please review the specification at: ${state.specPath}\n\nDo you approve this spec?`,
        data: {
          prompt: `Please review the specification at: ${state.specPath}\n\nDo you approve this spec?`,
          options: [
            { label: "Approve", value: "approve" },
            { label: "Request Changes", value: "reject" },
          ],
        },
      }];

      return {
        stateUpdate: {
          lastUpdated: new Date().toISOString(),
        },
        signals,
      };
    },
  };
}

/**
 * Features Node - Breaks the spec into implementable features.
 */
function createFeaturesNode(): NodeDefinition<AtomicWorkflowState> {
  return {
    id: "create-features",
    type: "agent",
    name: "Create Feature List",
    description: "Break the specification into discrete, implementable features",
    execute: async (ctx: ExecutionContext<AtomicWorkflowState>): Promise<NodeResult<AtomicWorkflowState>> => {
      const state = ctx.state;
      const featureListPath = "research/feature-list.json";

      console.log(`[atomic] Creating feature list from spec: ${state.specPath}`);

      return {
        stateUpdate: {
          featureListPath,
          phase: "implement",
          currentFeature: 0,
          lastUpdated: new Date().toISOString(),
        },
      };
    },
  };
}

/**
 * Implement Node - Implements features one by one.
 */
function createImplementNode(): NodeDefinition<AtomicWorkflowState> {
  return {
    id: "implement-feature",
    type: "agent",
    name: "Implement Feature",
    description: "Implement the next feature from the feature list",
    execute: async (ctx: ExecutionContext<AtomicWorkflowState>): Promise<NodeResult<AtomicWorkflowState>> => {
      const state = ctx.state;
      const nextFeature = (state.currentFeature ?? 0) + 1;
      const totalFeatures = state.totalFeatures ?? 1;
      const isComplete = nextFeature >= totalFeatures;

      console.log(`[atomic] Implementing feature ${nextFeature}/${totalFeatures}`);

      return {
        stateUpdate: {
          currentFeature: nextFeature,
          implementationComplete: isComplete,
          phase: isComplete ? "pr" : "implement",
          lastUpdated: new Date().toISOString(),
        },
      };
    },
  };
}

/**
 * PR Node - Creates a pull request with all changes.
 */
function createPRNode(): NodeDefinition<AtomicWorkflowState> {
  return {
    id: "create-pr",
    type: "agent",
    name: "Create Pull Request",
    description: "Create a pull request with all implemented changes",
    execute: async (ctx: ExecutionContext<AtomicWorkflowState>): Promise<NodeResult<AtomicWorkflowState>> => {
      const state = ctx.state;

      console.log(`[atomic] Creating pull request for: ${state.userPrompt}`);

      return {
        stateUpdate: {
          prCreated: true,
          phase: "complete",
          lastUpdated: new Date().toISOString(),
        },
      };
    },
  };
}

// ============================================================================
// NODE IDS (Exported for tests)
// ============================================================================

/** Node IDs for the Atomic workflow */
export const ATOMIC_NODE_IDS = {
  RESEARCH: "research",
  CREATE_SPEC: "create-spec",
  REVIEW_SPEC: "review-spec",
  CREATE_FEATURES: "create-features",
  IMPLEMENT_FEATURE: "implement-feature",
  CREATE_PR: "create-pr",
} as const;

// ============================================================================
// WORKFLOW FACTORY (Default Export)
// ============================================================================

/**
 * Create the Atomic workflow graph.
 *
 * This is the required default export for custom workflows.
 * It receives configuration and returns a compiled graph.
 *
 * Workflow sequence:
 * 1. Research - Analyze codebase
 * 2. Spec - Create technical specification
 * 3. Review - Wait for human approval (HITL)
 * 4. Features - Break into implementable tasks (if approved)
 * 5. Implement - Loop through features
 * 6. PR - Create pull request
 *
 * @param config - Optional workflow configuration
 * @returns Compiled workflow graph
 */
export default function createAtomicWorkflow(
  config: Record<string, unknown> = {}
): CompiledGraph<AtomicWorkflowState> {
  // Merge config with defaults
  const maxIterations = (config.maxIterations as number) ?? defaultConfig.maxIterations;

  // Create nodes
  const researchNode = createResearchNode();
  const specNode = createSpecNode();
  const reviewNode = createReviewNode();
  const featuresNode = createFeaturesNode();
  const implementNode = createImplementNode();
  const prNode = createPRNode();

  // Build the workflow graph
  // Research → Spec → Review → (if approved) Features → Implement (loop) → PR
  const builder = graph<AtomicWorkflowState>()
    .start(researchNode)
    .then(specNode)
    .then(reviewNode)
    // Conditional: if approved, continue; if rejected, workflow ends (user can restart)
    .if((state) => state.specApproved)
      .then(featuresNode)
      // Loop through features until implementation is complete
      .loop(implementNode, {
        until: (state) => state.implementationComplete,
        maxIterations
      })
      .then(prNode)
    .endif()
    .end();

  // Compile with configuration
  return builder.compile({
    metadata: {
      workflowName: name,
      workflowDescription: description,
    },
  });
}

// Re-export createAtomicWorkflow as named export for tests
export { createAtomicWorkflow };
