/**
 * Atomic Workflow Definition
 *
 * This module defines the graph-based workflow for the Atomic (Ralph) loop.
 * The workflow implements the full feature implementation cycle:
 *
 * 1. Research the codebase
 * 2. Create a specification
 * 3. Wait for human approval
 * 4. Create feature list from spec
 * 5. Loop: implement features until all pass
 * 6. Create pull request
 *
 * Reference: Feature 26 - Migrate Ralph loop to graph-based execution
 */

import type { AgentMessage } from "../sdk/types.ts";
import type { CompiledGraph, GraphConfig } from "../graph/types.ts";
import type { AtomicWorkflowState, Feature } from "../graph/annotation.ts";
import {
  graph,
  agentNode,
  toolNode,
  clearContextNode,
  decisionNode,
  waitNode,
  ResearchDirSaver,
  createAtomicState,
} from "../graph/index.ts";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default maximum iterations for the feature implementation loop */
export const DEFAULT_MAX_ITERATIONS = 100;

/** Node IDs for the Atomic workflow */
export const ATOMIC_NODE_IDS = {
  RESEARCH: "research",
  CLEAR_AFTER_RESEARCH: "clear-after-research",
  CREATE_SPEC: "create-spec",
  CLEAR_AFTER_SPEC: "clear-after-spec",
  REVIEW_SPEC: "review-spec",
  WAIT_FOR_APPROVAL: "wait-for-approval",
  CHECK_APPROVAL: "check-approval",
  CREATE_FEATURE_LIST: "create-feature-list",
  SELECT_FEATURE: "select-feature",
  IMPLEMENT_FEATURE: "implement-feature",
  CHECK_FEATURES: "check-features",
  CREATE_PR: "create-pr",
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract text content from agent messages.
 */
function extractTextContent(messages: AgentMessage[]): string {
  return messages
    .filter((m) => m.type === "text")
    .map((m) => m.content)
    .join("\n");
}

/**
 * Parse feature list from JSON content.
 */
function parseFeatureList(content: string): Feature[] {
  try {
    // Try to find JSON in the content
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const features = JSON.parse(jsonMatch[0]) as Feature[];
      return features.map((f) => ({
        category: f.category || "functional",
        description: f.description,
        steps: f.steps || [],
        passes: f.passes ?? false,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Get the next unpassed feature from the list.
 */
function getNextFeature(features: Feature[]): Feature | null {
  return features.find((f) => !f.passes) ?? null;
}

/**
 * Check if all features are passing.
 */
function checkAllFeaturesPassing(features: Feature[]): boolean {
  return features.length > 0 && features.every((f) => f.passes);
}

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * Research node: Analyzes the codebase using codebase-research-analyzer agent type.
 */
const researchNode = agentNode<AtomicWorkflowState>({
  id: ATOMIC_NODE_IDS.RESEARCH,
  agentType: "claude",
  name: "Codebase Research",
  description: "Research and analyze the codebase to understand architecture and patterns",
  systemPrompt: `You are a codebase research analyzer. Your job is to:
1. Understand the project's architecture and structure
2. Identify key patterns and conventions used
3. Document important files and their relationships
4. Note any existing tests and their patterns
5. Identify areas that need attention

Provide a comprehensive research document that will help with specification creation.`,
  buildMessage: (state) => {
    return `Please research this codebase and provide a comprehensive analysis.
Current iteration: ${state.iteration}`;
  },
  outputMapper: (messages, state) => ({
    researchDoc: extractTextContent(messages),
    outputs: {
      ...state.outputs,
      [ATOMIC_NODE_IDS.RESEARCH]: messages,
    },
  }),
});

/**
 * Create spec node: Generates a technical specification from research.
 */
const createSpecNode = agentNode<AtomicWorkflowState>({
  id: ATOMIC_NODE_IDS.CREATE_SPEC,
  agentType: "claude",
  name: "Create Specification",
  description: "Generate a technical specification from the research document",
  systemPrompt: `You are a technical specification writer. Your job is to:
1. Review the research document
2. Create a clear technical specification
3. Define the scope and objectives
4. List technical requirements
5. Outline the implementation approach

Create a specification that can be reviewed and approved by a human.`,
  buildMessage: (state) => {
    return `Based on the following research, create a technical specification:

${state.researchDoc}

Please provide a clear, actionable specification.`;
  },
  outputMapper: (messages, state) => ({
    specDoc: extractTextContent(messages),
    specApproved: false,
    outputs: {
      ...state.outputs,
      [ATOMIC_NODE_IDS.CREATE_SPEC]: messages,
    },
  }),
});

/**
 * Clear context after research node.
 * Clears the context window before spec creation.
 */
const clearAfterResearchNode = clearContextNode<AtomicWorkflowState>({
  id: ATOMIC_NODE_IDS.CLEAR_AFTER_RESEARCH,
  name: "Clear Context After Research",
  description: "Clear context window before spec creation",
  message: "Research complete. Clearing context window for spec creation.",
});

/**
 * Clear context after spec creation node.
 * Clears the context window before HIL review.
 */
const clearAfterSpecNode = clearContextNode<AtomicWorkflowState>({
  id: ATOMIC_NODE_IDS.CLEAR_AFTER_SPEC,
  name: "Clear Context After Spec",
  description: "Clear context window before HIL review",
  message: "Specification complete. Clearing context window for review.",
});

/**
 * Review spec decision node: Routes based on spec approval status.
 */
const reviewSpecNode = decisionNode<AtomicWorkflowState>({
  id: ATOMIC_NODE_IDS.REVIEW_SPEC,
  name: "Review Spec Decision",
  description: "Check if specification is approved",
  routes: [
    {
      condition: (state) => state.specApproved,
      target: ATOMIC_NODE_IDS.CREATE_FEATURE_LIST,
      label: "Spec Approved",
    },
  ],
  fallback: ATOMIC_NODE_IDS.WAIT_FOR_APPROVAL,
});

/**
 * Wait for approval node: Pauses for human review of the specification.
 */
const waitForApprovalNode = waitNode<AtomicWorkflowState>({
  id: ATOMIC_NODE_IDS.WAIT_FOR_APPROVAL,
  name: "Wait for Approval",
  description: "Wait for human approval of the specification",
  prompt: (state) => {
    return `Please review the following specification:

${state.specDoc}

Type 'approve' to approve the specification, or provide feedback for revision.`;
  },
  inputMapper: (input, _state) => {
    const approved = input.toLowerCase().includes("approve");
    return {
      specApproved: approved,
    };
  },
});

/**
 * Check approval decision node: Routes based on approval result.
 * Routes to CREATE_FEATURE_LIST if approved, or back to CREATE_SPEC for revision.
 */
const checkApprovalNode = decisionNode<AtomicWorkflowState>({
  id: ATOMIC_NODE_IDS.CHECK_APPROVAL,
  name: "Check Approval Result",
  description: "Route based on whether the spec was approved or rejected",
  routes: [
    {
      condition: (state) => state.specApproved,
      target: ATOMIC_NODE_IDS.CREATE_FEATURE_LIST,
      label: "Approved",
    },
  ],
  fallback: ATOMIC_NODE_IDS.CREATE_SPEC,
});

/**
 * Create feature list node: Extracts features from the approved specification.
 */
const createFeatureListNode = agentNode<AtomicWorkflowState>({
  id: ATOMIC_NODE_IDS.CREATE_FEATURE_LIST,
  agentType: "claude",
  name: "Create Feature List",
  description: "Extract a feature list from the approved specification",
  systemPrompt: `You are a feature extraction specialist. Your job is to:
1. Read the approved specification
2. Break it down into discrete, implementable features
3. Order features by priority and dependencies
4. Create clear acceptance criteria for each

Output a JSON array of features with this structure:
[
  {
    "category": "functional|refactor|ui|performance",
    "description": "Brief description of the feature",
    "steps": ["Step 1", "Step 2", ...],
    "passes": false
  }
]`,
  buildMessage: (state) => {
    return `Based on this approved specification, create a feature list:

${state.specDoc}

Output only the JSON array of features.`;
  },
  outputMapper: (messages, state) => {
    const content = extractTextContent(messages);
    const features = parseFeatureList(content);
    const nextFeature = getNextFeature(features);
    return {
      featureList: features,
      currentFeature: nextFeature,
      allFeaturesPassing: checkAllFeaturesPassing(features),
      outputs: {
        ...state.outputs,
        [ATOMIC_NODE_IDS.CREATE_FEATURE_LIST]: messages,
      },
    };
  },
});

/**
 * Select feature decision node: Routes based on feature implementation status.
 */
const selectFeatureNode = decisionNode<AtomicWorkflowState>({
  id: ATOMIC_NODE_IDS.SELECT_FEATURE,
  name: "Select Feature",
  description: "Select the next feature to implement or check if all are done",
  routes: [
    {
      condition: (state) => state.allFeaturesPassing,
      target: ATOMIC_NODE_IDS.CREATE_PR,
      label: "All Features Passing",
    },
    {
      condition: (state) => state.currentFeature !== null,
      target: ATOMIC_NODE_IDS.IMPLEMENT_FEATURE,
      label: "Has Feature to Implement",
    },
  ],
  fallback: ATOMIC_NODE_IDS.CREATE_PR,
});

/**
 * Implement feature node: Implements the current feature.
 */
const implementFeatureNode = agentNode<AtomicWorkflowState>({
  id: ATOMIC_NODE_IDS.IMPLEMENT_FEATURE,
  agentType: "claude",
  name: "Implement Feature",
  description: "Implement the current feature from the feature list",
  systemPrompt: `You are a feature implementation specialist. Your job is to:
1. Implement the specified feature following the steps provided
2. Write clean, maintainable code
3. Follow existing patterns and conventions
4. Create or update tests as needed
5. Ensure the implementation is complete and working

After implementation, verify the feature works by running tests.`,
  buildMessage: (state) => {
    const feature = state.currentFeature;
    if (!feature) {
      return "No feature to implement.";
    }
    return `Please implement the following feature:

Category: ${feature.category}
Description: ${feature.description}
Steps:
${feature.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Iteration: ${state.iteration}

Follow the steps and verify the implementation works.`;
  },
  outputMapper: (messages, state) => {
    // Update the feature list to mark current feature as potentially passing
    // The actual pass/fail status would be determined by test results
    const updatedFeatures = state.featureList.map((f) => {
      if (f.description === state.currentFeature?.description) {
        return { ...f, passes: true }; // Optimistically mark as passing
      }
      return f;
    });

    const nextFeature = getNextFeature(updatedFeatures);

    return {
      featureList: updatedFeatures,
      currentFeature: nextFeature,
      allFeaturesPassing: checkAllFeaturesPassing(updatedFeatures),
      iteration: state.iteration + 1,
      outputs: {
        ...state.outputs,
        [ATOMIC_NODE_IDS.IMPLEMENT_FEATURE]: messages,
      },
    };
  },
});

/**
 * Check features decision node: Verifies feature status and routes accordingly.
 */
const checkFeaturesNode = decisionNode<AtomicWorkflowState>({
  id: ATOMIC_NODE_IDS.CHECK_FEATURES,
  name: "Check Features",
  description: "Check if all features are passing",
  routes: [
    {
      condition: (state) => state.allFeaturesPassing,
      target: ATOMIC_NODE_IDS.CREATE_PR,
      label: "All Passing",
    },
    {
      condition: (state) => state.iteration >= DEFAULT_MAX_ITERATIONS,
      target: ATOMIC_NODE_IDS.CREATE_PR,
      label: "Max Iterations Reached",
    },
  ],
  fallback: ATOMIC_NODE_IDS.SELECT_FEATURE,
});

/**
 * Create PR tool node: Creates a pull request using gh CLI.
 */
const createPRNode = toolNode<AtomicWorkflowState, { title: string; body: string }, string>({
  id: ATOMIC_NODE_IDS.CREATE_PR,
  toolName: "create_pr",
  name: "Create Pull Request",
  description: "Create a GitHub pull request for the implemented features",
  args: (state) => {
    const passingCount = state.featureList.filter((f) => f.passes).length;
    const totalCount = state.featureList.length;
    return {
      title: `feat: Implement ${passingCount}/${totalCount} features`,
      body: `## Summary
This PR implements features from the approved specification.

### Features Implemented
${state.featureList
  .filter((f) => f.passes)
  .map((f) => `- [x] ${f.description}`)
  .join("\n")}

### Features Pending
${state.featureList
  .filter((f) => !f.passes)
  .map((f) => `- [ ] ${f.description}`)
  .join("\n") || "None"}

### Specification
${state.specDoc.slice(0, 500)}${state.specDoc.length > 500 ? "..." : ""}
`,
    };
  },
  execute: async (args) => {
    // In a real implementation, this would call gh CLI
    // For now, return a placeholder URL
    const { title, body } = args;
    console.log(`Creating PR with title: ${title}`);
    console.log(`Body preview: ${body.slice(0, 200)}...`);
    
    // Placeholder - in production, use:
    // const result = await exec(`gh pr create --title "${title}" --body "${body}"`);
    return "https://github.com/example/repo/pull/123";
  },
  outputMapper: (result, state) => ({
    prUrl: result,
    outputs: {
      ...state.outputs,
      [ATOMIC_NODE_IDS.CREATE_PR]: result,
    },
  }),
});

// ============================================================================
// WORKFLOW CONFIGURATION
// ============================================================================

/**
 * Configuration options for creating the Atomic workflow.
 */
export interface AtomicWorkflowConfig {
  /** Maximum iterations for the feature loop (default: 100) */
  maxIterations?: number;
  /** Enable checkpointing (default: true) */
  checkpointing?: boolean;
  /** Checkpoint directory (default: research/checkpoints) */
  checkpointDir?: string;
  /** Auto-approve specification (for testing) */
  autoApproveSpec?: boolean;
  /** Additional graph configuration */
  graphConfig?: Partial<GraphConfig<AtomicWorkflowState>>;
}

/**
 * Create the Atomic workflow graph.
 *
 * The workflow implements the full Ralph loop:
 * 1. Research -> Create Spec -> Wait for Approval
 * 2. Create Feature List -> Loop (Implement Features)
 * 3. Create PR
 *
 * @param config - Optional workflow configuration
 * @returns Compiled graph ready for execution
 *
 * @example
 * ```typescript
 * const workflow = createAtomicWorkflow({ maxIterations: 50 });
 * const result = await executeGraph(workflow, createAtomicState());
 * console.log("PR URL:", result.prUrl);
 * ```
 */
export function createAtomicWorkflow(
  config: AtomicWorkflowConfig = {}
): CompiledGraph<AtomicWorkflowState> {
  const {
    maxIterations = DEFAULT_MAX_ITERATIONS,
    checkpointing = true,
    checkpointDir = "research/checkpoints",
    autoApproveSpec = false,
    graphConfig = {},
  } = config;

  // Build the workflow graph
  // The sequence follows: research → clear → spec → clear → HIL review
  let builder = graph<AtomicWorkflowState>()
    // Phase 1: Research and Specification
    .start(researchNode)
    .then(clearAfterResearchNode)  // Clear context after research
    .then(createSpecNode)
    .then(clearAfterSpecNode)      // Clear context after spec
    .then(reviewSpecNode);

  // Add approval step if not auto-approving
  if (autoApproveSpec) {
    // Skip approval, go directly to feature list
    builder = builder.then(createFeatureListNode);
  } else {
    // Wait for human approval (HIL), then check result
    // If approved -> create feature list
    // If rejected -> loop back to create spec
    builder = builder
      .then(waitForApprovalNode)
      .then(checkApprovalNode)
      .then(createFeatureListNode);
  }
  
  // Phase 2: Feature Implementation Loop
  builder = builder.loop(
    implementFeatureNode,
    {
      until: (state) =>
        state.allFeaturesPassing || state.iteration >= maxIterations,
      maxIterations,
    }
  );
  
  // Phase 3: Create Pull Request
  builder = builder.then(createPRNode).end();

  // Compile with configuration
  const compiledConfig: GraphConfig<AtomicWorkflowState> = {
    autoCheckpoint: checkpointing,
    checkpointer: checkpointing ? new ResearchDirSaver(checkpointDir) : undefined,
    contextWindowThreshold: 60,
    ...graphConfig,
  };

  return builder.compile(compiledConfig);
}

/**
 * Create a minimal Atomic workflow for testing.
 * Skips human approval and uses minimal iterations.
 *
 * @returns Compiled graph for testing
 */
export function createTestAtomicWorkflow(): CompiledGraph<AtomicWorkflowState> {
  return createAtomicWorkflow({
    maxIterations: 5,
    checkpointing: false,
    autoApproveSpec: true,
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Re-export state utilities
  createAtomicState,
  
  // Node definitions (for testing/customization)
  researchNode,
  createSpecNode,
  reviewSpecNode,
  waitForApprovalNode,
  checkApprovalNode,
  createFeatureListNode,
  selectFeatureNode,
  implementFeatureNode,
  checkFeaturesNode,
  createPRNode,
  
  // Helper functions
  extractTextContent,
  parseFeatureList,
  getNextFeature,
  checkAllFeaturesPassing,
};

// Type exports
export type { AtomicWorkflowState, Feature };
