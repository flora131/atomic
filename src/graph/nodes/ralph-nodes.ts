/**
 * Ralph Node Factory Functions
 *
 * This module provides specialized graph nodes for the Ralph autonomous workflow.
 * Ralph sessions manage iterative feature implementation with checkpointing,
 * context window management, and progress tracking.
 *
 * Node types provided:
 * - initRalphSessionNode: Initialize or resume a Ralph session
 * - implementFeatureNode: Implement a task from the task list
 * - checkCompletionNode: Determine if the workflow should continue or exit
 * - createPRNode: Create a pull request with session metadata
 *
 * Reference: Feature 36 - Create src/graph/nodes/ralph-nodes.ts file
 */

import type {
  BaseState,
  NodeDefinition,
  NodeResult,
  ExecutionContext,
  ContextWindowUsage,
  DebugReport,
} from "../types.ts";
import type {
  RalphSession,
} from "../../workflows/ralph/session.ts";
import {
  generateSessionId,
  getSessionDir,
  createRalphSession,
  isRalphSession,
  createSessionDirectory,
  saveSession,
  loadSession,
  loadSessionIfExists,
  appendLog,
  appendProgress,
} from "../../workflows/ralph/session.ts";
import type { TodoItem } from "../../sdk/tools/todo-write.ts";
import { writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

// ============================================================================
// CHECK COMPLETION NODE
// ============================================================================

/**
 * Configuration options for checkCompletionNode.
 */
export interface CheckCompletionNodeConfig {
  /** Unique identifier for the node */
  id: string;

  /** Human-readable name for the node */
  name?: string;

  /** Description of what the node does */
  description?: string;
}

/**
 * Create a node that checks if the Ralph workflow should continue or exit.
 *
 * This node handles:
 * - Checking if any available (non-blocked) tasks remain
 * - If all tasks are completed, marking session as completed
 * - If remaining tasks are all blocked, exiting workflow
 * - Logging completion status
 *
 * The node should be placed at the end of each loop iteration to determine
 * if the workflow should continue or exit.
 *
 * @param config - Node configuration
 * @returns A NodeDefinition for checking completion
 *
 * @example
 * ```typescript
 * // Create a completion check node
 * const checkNode = checkCompletionNode({
 *   id: "check-completion",
 *   name: "Check Completion",
 * });
 *
 * // Use in a workflow loop
 * graph<RalphWorkflowState>()
 *   .start(initNode)
 *   .loop({
 *     body: [implementNode, agentNode, processResultNode, checkNode],
 *     until: (state) => !state.shouldContinue,
 *   })
 *   .then(createPRNode)
 *   .compile();
 * ```
 */
export function checkCompletionNode<TState extends RalphWorkflowState = RalphWorkflowState>(
  config: CheckCompletionNodeConfig
): NodeDefinition<TState> {
  const {
    id,
    name = "check-completion",
    description = "Check if the Ralph workflow should continue or exit",
  } = config;

  return {
    id,
    type: "tool",
    name,
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const state = ctx.state as RalphWorkflowState;
      const sessionDir = state.ralphSessionDir;
      const now = new Date().toISOString();

      // Deterministic termination: check if any available tasks remain
      const hasAvailableTask = state.tasks.some(
        (t) => t.status === "pending" && (!t.blockedBy || t.blockedBy.length === 0)
      );
      const allCompleted = state.tasks.every((t) => t.status === "completed");
      const shouldContinue = hasAvailableTask;

      // Log completion status
      await appendLog(sessionDir, "agent-calls", {
        action: "check-completion",
        sessionId: state.ralphSessionId,
        iteration: state.iteration,
        totalTasks: state.tasks.length,
        completedTasks: state.tasks.filter((t) => t.status === "completed").length,
        pendingTasks: state.tasks.filter((t) => t.status === "pending").length,
        hasAvailableTask,
        shouldContinue,
      });

      let sessionStatus = state.sessionStatus;
      if (!shouldContinue) {
        sessionStatus = "completed";
        if (allCompleted) {
          console.log("All tasks completed! Workflow complete.");
        } else {
          console.log("No available tasks remaining (all blocked). Workflow exiting.");
          const blocked = state.tasks.filter((t) => t.status === "pending");
          for (const t of blocked) {
            console.log(`  Blocked: ${t.id} — blocked by ${t.blockedBy?.join(", ")}`);
          }
        }
        console.log(`Status: ${formatSessionStatus(sessionStatus)}`);
      }

      const updatedState: Partial<RalphWorkflowState> = {
        shouldContinue,
        sessionStatus,
        lastUpdated: now,
      };

      if (!shouldContinue) {
        const session = workflowStateToSession({
          ...state,
          ...updatedState,
        } as RalphWorkflowState);
        await saveSession(sessionDir, session);
      }

      return {
        stateUpdate: updatedState as Partial<TState>,
      };
    },
  };
}

// ============================================================================
// RALPH WORKFLOW STATE
// ============================================================================

/**
 * Extended workflow state for Ralph sessions.
 *
 * Combines the base graph state with Ralph-specific session fields.
 * This state is used by all Ralph nodes and persisted to session.json.
 *
 * @example
 * ```typescript
 * const state: RalphWorkflowState = {
 *   // BaseState fields
 *   executionId: "exec-123",
 *   lastUpdated: "2026-02-02T10:00:00.000Z",
 *   outputs: {},
 *
 *   // Ralph session fields
 *   ralphSessionId: "abc123-def456",
 *   ralphSessionDir: ".ralph/sessions/abc123-def456/",
 *   tasks: [...],
 *   currentFeatureIndex: 2,
 *   completedFeatures: ["#1", "#2"],
 *   iteration: 15,
 *   sessionStatus: "running",
 *
 *   // Control flow flags
 *   shouldContinue: true,
 * };
 * ```
 */
export interface RalphWorkflowState extends BaseState {
  // Ralph Session Identity
  ralphSessionId: string;
  ralphSessionDir: string;

  // Session Configuration
  /** User-provided prompt */
  userPrompt?: string;

  // Task Tracking (uses native TodoItem)
  /** Task list — uses native TodoItem from the Claude Agent SDK */
  tasks: TodoItem[];
  /** Index of the currently active feature */
  currentFeatureIndex: number;
  /** List of feature IDs that have been completed */
  completedFeatures: string[];
  /** The task currently being implemented (null if none) */
  currentTask: TodoItem | null;

  // Execution Tracking
  iteration: number;
  sessionStatus: "running" | "paused" | "completed" | "failed";

  // Control Flow Flags
  shouldContinue: boolean;

  // PR Artifacts
  prUrl?: string;
  prBranch?: string;

  // Context Tracking
  contextWindowUsage?: ContextWindowUsage;

  // Debug Reports
  debugReports: DebugReport[];
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a value is a valid RalphWorkflowState.
 *
 * @param value - The value to check
 * @returns True if the value is a valid RalphWorkflowState
 */
export function isRalphWorkflowState(value: unknown): value is RalphWorkflowState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Check BaseState fields
  if (
    typeof obj.executionId !== "string" ||
    typeof obj.lastUpdated !== "string" ||
    typeof obj.outputs !== "object" ||
    obj.outputs === null
  ) {
    return false;
  }

  // Check Ralph-specific fields
  return (
    typeof obj.ralphSessionId === "string" &&
    typeof obj.ralphSessionDir === "string" &&
    Array.isArray(obj.tasks) &&
    typeof obj.currentFeatureIndex === "number" &&
    Array.isArray(obj.completedFeatures) &&
    typeof obj.iteration === "number" &&
    ["running", "paused", "completed", "failed"].includes(obj.sessionStatus as string) &&
    typeof obj.shouldContinue === "boolean" &&
    Array.isArray(obj.debugReports)
  );
}

// ============================================================================
// STATE FACTORIES
// ============================================================================

/**
 * Options for creating a new RalphWorkflowState.
 */
export interface CreateRalphStateOptions {
  /** Execution ID for the graph execution (auto-generated if not provided) */
  executionId?: string;

  /** Session ID to resume from (auto-generated if not provided) */
  sessionId?: string;

  /** User prompt */
  userPrompt?: string;

  /** Initial tasks to load */
  tasks?: TodoItem[];
}

/**
 * Create a new RalphWorkflowState with default values.
 *
 * @param options - Optional initial values
 * @returns A new RalphWorkflowState instance
 *
 * @example
 * ```typescript
 * // Create default state
 * const state = createRalphWorkflowState();
 *
 * // Create state for resuming a session
 * const resumeState = createRalphWorkflowState({
 *   sessionId: "existing-session-id"
 * });
 *
 * // Create state with tasks
 * const taskState = createRalphWorkflowState({
 *   tasks: myTasks,
 *   userPrompt: "Build a snake game"
 * });
 * ```
 */
export function createRalphWorkflowState(
  options: CreateRalphStateOptions = {}
): RalphWorkflowState {
  const sessionId = options.sessionId ?? generateSessionId();
  const now = new Date().toISOString();

  return {
    // BaseState fields
    executionId: options.executionId ?? crypto.randomUUID(),
    lastUpdated: now,
    outputs: {},

    // Ralph session identity
    ralphSessionId: sessionId,
    ralphSessionDir: getSessionDir(sessionId),

    // Session configuration
    userPrompt: options.userPrompt,

    // Task tracking
    tasks: options.tasks ?? [],
    currentFeatureIndex: 0,
    completedFeatures: [],
    currentTask: null,

    // Execution tracking
    iteration: 1,
    sessionStatus: "running",

    // Control flow flags
    shouldContinue: true,

    // PR artifacts
    prUrl: undefined,
    prBranch: undefined,

    // Context tracking
    contextWindowUsage: undefined,

    // Debug reports (empty array, will accumulate via Reducers.concat)
    debugReports: [],
  };
}

/**
 * Convert a RalphSession to RalphWorkflowState.
 *
 * Used when resuming a session from disk.
 *
 * @param session - The session loaded from disk
 * @param executionId - New execution ID for this run
 * @returns A RalphWorkflowState populated from the session
 */
export function sessionToWorkflowState(
  session: RalphSession,
  executionId?: string
): RalphWorkflowState {
  const now = new Date().toISOString();

  return {
    // BaseState fields
    executionId: executionId ?? crypto.randomUUID(),
    lastUpdated: now,
    outputs: {},

    // Ralph session identity
    ralphSessionId: session.sessionId,
    ralphSessionDir: session.sessionDir,

    // Session configuration
    userPrompt: undefined,

    // Task tracking
    tasks: session.tasks,
    currentFeatureIndex: session.currentFeatureIndex,
    completedFeatures: session.completedFeatures,
    currentTask: session.tasks[session.currentFeatureIndex] ?? null,

    // Execution tracking
    iteration: session.iteration,
    sessionStatus: session.status,

    // Control flow flags
    shouldContinue: session.tasks.some(
      (t) => t.status === "pending" && (!t.blockedBy || t.blockedBy.length === 0)
    ),

    // PR artifacts
    prUrl: session.prUrl,
    prBranch: session.prBranch,

    // Context tracking
    contextWindowUsage: undefined,

    // Debug reports (load from session or start fresh)
    debugReports: session.debugReports ?? [],
  };
}

/**
 * Convert a RalphWorkflowState to a RalphSession for persistence.
 *
 * @param state - The workflow state
 * @returns A RalphSession for saving to disk
 */
export function workflowStateToSession(state: RalphWorkflowState): RalphSession {
  return {
    sessionId: state.ralphSessionId,
    sessionDir: state.ralphSessionDir,
    createdAt: state.lastUpdated, // Will be overwritten on load
    lastUpdated: new Date().toISOString(),
    tasks: state.tasks,
    currentFeatureIndex: state.currentFeatureIndex,
    completedFeatures: state.completedFeatures,
    iteration: state.iteration,
    status: state.sessionStatus,
    prUrl: state.prUrl,
    prBranch: state.prBranch,
    debugReports: state.debugReports,
  };
}

// ============================================================================
// EXPORT RE-EXPORTS FROM ralph-session.ts
// ============================================================================

// Re-export session management types and functions for convenience
export {
  // Types
  type RalphSession,

  // Functions
  generateSessionId,
  getSessionDir,
  createRalphSession,
  isRalphSession,
  createSessionDirectory,
  saveSession,
  loadSession,
  loadSessionIfExists,
  appendLog,
  appendProgress,
};

// ============================================================================
// TASK HELPERS
// ============================================================================

/** Write tasks.json to the session directory */
async function writeTasksJson(sessionDir: string, tasks: TodoItem[]): Promise<void> {
  const tasksPath = join(sessionDir, "tasks.json");
  await writeFile(tasksPath, JSON.stringify(tasks, null, 2), "utf-8");
}

/** Build a progress entry for an iteration */
function buildProgressEntry(
  iteration: number,
  task: TodoItem,
  passed: boolean,
  context?: { description?: string; acceptanceCriteria?: string[]; error?: string }
): string {
  const status = passed ? "completed" : "failing";
  const icon = passed ? "✓" : "✗";
  const timestamp = new Date().toISOString();
  const lines = [`## Iteration ${iteration} — ${task.id}: ${task.content}`];
  if (context?.description) {
    lines.push(`Description: ${context.description}`);
  }
  if (context?.acceptanceCriteria?.length) {
    lines.push(`Acceptance criteria:`);
    context.acceptanceCriteria.forEach(c => lines.push(`- ${c}`));
  }
  lines.push(``, `Progress:`);
  lines.push(`- ${icon} Status: ${status} (${timestamp})`);
  if (context?.error) {
    lines.push(`- Error: ${context.error}`);
  }
  return lines.join("\n");
}

/** Build the spec-to-tasks prompt for decomposing a spec into TodoItem[] */
export function buildSpecToTasksPrompt(specContent: string): string {
  return `You are tasked with decomposing a feature specification into an ordered task list.

Read the following specification and create a comprehensive and structured JSON array of tasks to be implemented in order of highest to lowest priority.

<specification>
${specContent}
</specification>

# Output Format

Produce a JSON array where each element follows this exact schema:

\`\`\`json
[
  {
    "id": "#1",
    "content": "Concise description of the task",
    "status": "pending",
    "activeForm": "Present-participle form (e.g., 'Implementing auth endpoint')",
    "blockedBy": []
  }
]
\`\`\`

# Field Definitions

- \`id\`: Sequential identifier ("#1", "#2", "#3", ...).
- \`content\`: A concise, actionable description of the task.
- \`status\`: Always "pending" for new tasks.
- \`activeForm\`: Present-participle description shown in the UI spinner (e.g., "Implementing X", "Adding Y").
- \`blockedBy\`: Array of task IDs that must complete before this task can start. Use this for technical dependencies (e.g., tests blocked by implementation, UI blocked by API). Leave empty ([]) for tasks with no dependencies.

# Guidelines

- Parse the specification thoroughly. Every distinct deliverable should be a separate task.
- Order tasks by priority: foundational/infrastructure tasks first, then features, then tests, then polish.
- Analyze technical dependencies between tasks and populate \`blockedBy\` arrays.
- Keep \`content\` concise (under 80 characters).
- Output ONLY the JSON array. No surrounding text, no markdown fences, no explanation.`;
}

// ============================================================================
// SESSION STATUS DISPLAY
// ============================================================================

/**
 * Session status type for Ralph workflows.
 */
export type RalphSessionStatus = "running" | "paused" | "completed" | "failed";

/**
 * Format session status for display.
 *
 * Converts the internal status value to a human-readable, capitalized string.
 *
 * @param status - The session status value
 * @returns Human-readable status string (e.g., "Running", "Paused", "Completed", "Failed")
 *
 * @example
 * ```typescript
 * formatSessionStatus("running"); // "Running"
 * formatSessionStatus("paused"); // "Paused"
 * formatSessionStatus("completed"); // "Completed"
 * formatSessionStatus("failed"); // "Failed"
 * ```
 */
export function formatSessionStatus(status: RalphSessionStatus): string {
  const statusMap: Record<RalphSessionStatus, string> = {
    running: "Running",
    paused: "Paused",
    completed: "Completed",
    failed: "Failed",
  };
  return statusMap[status] ?? status;
}


// ============================================================================
// IMPLEMENT FEATURE NODE
// ============================================================================

/**
 * Configuration options for implementFeatureNode.
 */
export interface ImplementFeatureNodeConfig {
  /** Unique identifier for the node */
  id: string;

  /** Human-readable name for the node */
  name?: string;

  /** Description of what the node does */
  description?: string;

  /** Optional: prompt template for implementing tasks */
  promptTemplate?: string;
}

/**
 * Create a node that prepares state for implementing the next pending feature.
 *
 * This node handles:
 * - Finding the next task with status 'pending' and empty blockedBy
 * - If no available tasks, setting shouldContinue: false
 * - Marking the task as 'in_progress' and saving the session
 * - Logging the agent call to agent-calls.jsonl
 * - Preparing state for agent execution (actual agent call is handled by agentNode)
 *
 * The node should be followed by an agentNode that performs the actual implementation,
 * and then a node that processes the results using the outputMapper pattern.
 *
 * @param config - Node configuration
 * @returns A NodeDefinition for implementing features
 *
 * @example
 * ```typescript
 * // Create a node for feature implementation
 * const implementNode = implementFeatureNode({
 *   id: "implement-feature",
 *   name: "Implement Next Feature",
 *   promptTemplate: "Implement the following feature: {{description}}",
 * });
 *
 * // Use in a workflow
 * graph<RalphWorkflowState>()
 *   .start(initNode)
 *   .then(implementNode)
 *   .then(agentNode)  // Actual agent execution
 *   .then(checkResultsNode)  // Process results
 *   .compile();
 * ```
 */
export function implementFeatureNode<TState extends RalphWorkflowState = RalphWorkflowState>(
  config: ImplementFeatureNodeConfig
): NodeDefinition<TState> {
  const {
    id,
    name = "implement-feature",
    description = "Find and prepare the next pending task for implementation",
    promptTemplate,
  } = config;

  return {
    id,
    type: "tool",
    name,
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const state = ctx.state as RalphWorkflowState;
      const sessionDir = state.ralphSessionDir;

      // Display iteration count and status
      console.log(`Iteration ${state.iteration}`);
      console.log(`Status: ${formatSessionStatus(state.sessionStatus)}`);

      const completedCount = state.tasks.filter((t) => t.status === "completed").length;
      const totalCount = state.tasks.length;
      console.log(`Tasks: ${completedCount}/${totalCount} completed`);

      // Find next available task: pending with empty blockedBy
      const nextTaskIndex = state.tasks.findIndex(
        (t) => t.status === "pending" && (!t.blockedBy || t.blockedBy.length === 0)
      );

      if (nextTaskIndex === -1) {
        // No available tasks
        return {
          stateUpdate: {
            shouldContinue: false,
            currentTask: null,
            lastUpdated: new Date().toISOString(),
          } as Partial<TState>,
        };
      }

      const task = state.tasks[nextTaskIndex]!;
      console.log(`Implementing: ${task.content}`);

      // Mark task as in_progress
      const updatedTasks = [...state.tasks];
      updatedTasks[nextTaskIndex] = { ...task, status: "in_progress" as const };

      // Build prompt for the agent
      let agentPrompt: string;
      if (promptTemplate) {
        agentPrompt = promptTemplate
          .replace(/\{\{id\}\}/g, task.id ?? "")
          .replace(/\{\{content\}\}/g, task.content)
          .replace(/\{\{activeForm\}\}/g, task.activeForm);
      } else {
        agentPrompt = `Implement task: ${task.content}`;
      }

      // Add file recovery instructions
      agentPrompt += `\n\n1. Read \`.ralph/sessions/${state.ralphSessionId}/tasks.json\` to see current task statuses and dependencies.
2. Read \`.ralph/sessions/${state.ralphSessionId}/progress.txt\` to see progress history and context from prior iterations.
3. Read \`git log --oneline -10\` to see recent commits.
4. The next task to implement is: ${task.content} (${task.id})`;

      agentPrompt += "\n\nBegin implementation immediately without asking for confirmation.";

      // Write tasks.json with updated status
      await writeTasksJson(sessionDir, updatedTasks);

      const updatedState: Partial<RalphWorkflowState> = {
        tasks: updatedTasks,
        currentFeatureIndex: nextTaskIndex,
        currentTask: updatedTasks[nextTaskIndex]!,
        shouldContinue: true,
        lastUpdated: new Date().toISOString(),
      };

      // Save session
      const session = workflowStateToSession({
        ...state,
        ...updatedState,
      } as RalphWorkflowState);
      await saveSession(sessionDir, session);

      // Log agent call
      await appendLog(sessionDir, "agent-calls", {
        action: "implement-task-start",
        sessionId: state.ralphSessionId,
        iteration: state.iteration,
        taskId: task.id,
        taskContent: task.content,
        taskIndex: nextTaskIndex,
        prompt: agentPrompt,
      });

      return {
        stateUpdate: {
          ...updatedState,
          outputs: {
            ...state.outputs,
            [`${id}_prompt`]: agentPrompt,
          },
        } as Partial<TState>,
      };
    },
  };
}

/**
 * Configuration for the output mapper after agent execution.
 * This is used by nodes that process the agent's implementation results.
 */
export interface ImplementFeatureOutputConfig {
  /** Function to check if the feature implementation passes (external check) */
  checkFeaturePassing?: (state: RalphWorkflowState) => Promise<boolean>;
}

/**
 * Process the results of a feature implementation agent call.
 *
 * This is a helper function that can be used in an outputMapper or as a
 * standalone processing step after agent execution.
 *
 * @param state - Current workflow state (after agent execution)
 * @param passed - Whether the feature implementation passes
 * @returns Updated state with feature results applied
 */
export async function processFeatureImplementationResult(
  state: RalphWorkflowState,
  passed: boolean,
  errorSummary?: string
): Promise<Partial<RalphWorkflowState>> {
  const sessionDir = state.ralphSessionDir;
  const currentTask = state.currentTask;

  if (!currentTask) {
    return {};
  }

  const now = new Date().toISOString();
  let updatedTasks = [...state.tasks];
  const taskIndex = state.currentFeatureIndex;

  if (passed) {
    // Mark task as completed
    updatedTasks[taskIndex] = { ...currentTask, status: "completed" as const };

    // Resolve blockedBy: remove this task's ID from downstream tasks
    const completedId = currentTask.id;
    if (completedId) {
      updatedTasks = updatedTasks.map((t) => {
        if (t.blockedBy?.includes(completedId)) {
          return {
            ...t,
            blockedBy: t.blockedBy.filter((id) => id !== completedId),
          };
        }
        return t;
      });
    }
  } else {
    // Bug detection: create bug-fix task
    const bugId = `${currentTask.id}-bug-${Date.now()}`;
    const bugTask: TodoItem = {
      id: bugId,
      content: `Fix: ${errorSummary ?? "implementation failed"}`,
      status: "pending",
      activeForm: `Fixing ${errorSummary ?? "implementation issue"}`,
    };

    // Reset failed task to pending, blocked by bug fix
    updatedTasks[taskIndex] = {
      ...currentTask,
      status: "pending" as const,
      blockedBy: [...(currentTask.blockedBy ?? []), bugId],
    };

    // Insert bug task right after the failed task
    updatedTasks.splice(taskIndex + 1, 0, bugTask);
  }

  // Build completed feature IDs list
  const completedFeatures = passed && currentTask.id
    ? [...state.completedFeatures, currentTask.id]
    : state.completedFeatures;

  const nextIteration = state.iteration + 1;

  const updatedState: Partial<RalphWorkflowState> = {
    tasks: updatedTasks,
    completedFeatures,
    iteration: nextIteration,
    currentTask: null,
    shouldContinue: updatedTasks.some(
      (t) => t.status === "pending" && (!t.blockedBy || t.blockedBy.length === 0)
    ),
    lastUpdated: now,
  };

  // Save session
  const session = workflowStateToSession({
    ...state,
    ...updatedState,
  } as RalphWorkflowState);
  await saveSession(sessionDir, session);

  // Write tasks.json
  await writeTasksJson(sessionDir, updatedTasks);

  // Append to progress.txt
  const progressEntry = buildProgressEntry(state.iteration, currentTask, passed, {
    error: errorSummary,
  });
  await appendProgress(sessionDir, progressEntry);

  // Log the result
  await appendLog(sessionDir, "agent-calls", {
    action: "implement-task-result",
    sessionId: state.ralphSessionId,
    iteration: state.iteration,
    taskId: currentTask.id,
    taskContent: currentTask.content,
    passed,
    nextIteration,
  });

  return updatedState;
}

// ============================================================================
// INIT RALPH SESSION NODE
// ============================================================================

/**
 * Configuration options for initRalphSessionNode.
 */
export interface InitRalphSessionNodeConfig {
  /** Unique identifier for the node */
  id: string;

  /** Human-readable name for the node */
  name?: string;

  /** Description of what the node does */
  description?: string;

  /** Session ID to resume from (auto-generates new ID if not provided) */
  resumeSessionId?: string;

  /** User prompt */
  userPrompt?: string;
}

/**
 * Initialize the session progress.txt file with a header.
 *
 * @param sessionDir - Path to the session directory
 * @param sessionId - Session ID
 * @param taskCount - Number of tasks
 */
async function initializeProgressFile(
  sessionDir: string,
  sessionId: string,
  taskCount: number
): Promise<void> {
  const timestamp = new Date().toISOString();

  const header = `# Ralph Session Progress
# Session ID: ${sessionId}
# Started: ${timestamp}
# Tasks: ${taskCount}
# ====================================

`;

  const progressPath = join(sessionDir, "progress.txt");
  await writeFile(progressPath, header, "utf-8");
}

/**
 * Create a node that initializes or resumes a Ralph session.
 *
 * This node handles:
 * - Creating a new session with a unique ID
 * - Resuming an existing session from disk
 * - Loading features from a feature-list.json file
 * - Creating the session directory structure
 * - Initializing progress tracking files
 *
 * @param config - Node configuration
 * @returns A NodeDefinition for initializing Ralph sessions
 *
 * @example
 * ```typescript
 * // Create a node for starting a new session
 * const initNode = initRalphSessionNode({
 *   id: "init-session",
 * });
 *
 * // Create a node for resuming an existing session
 * const resumeNode = initRalphSessionNode({
 *   id: "resume-session",
 *   resumeSessionId: "abc123-def456",
 * });
 * ```
 */
export function initRalphSessionNode<TState extends RalphWorkflowState = RalphWorkflowState>(
  config: InitRalphSessionNodeConfig
): NodeDefinition<TState> {
  const {
    id,
    name = "init-ralph-session",
    description = "Initialize or resume a Ralph session",
    resumeSessionId,
    userPrompt,
  } = config;

  return {
    id,
    type: "tool",
    name,
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const sessionId = resumeSessionId ?? generateSessionId();
      const sessionDir = getSessionDir(sessionId);

      // Check if we're resuming an existing session
      if (resumeSessionId) {
        const existingSession = await loadSessionIfExists(sessionDir);

        if (existingSession) {
          console.log(`Resuming Ralph session: ${sessionId}`);
          console.log(`Tasks: ${existingSession.tasks.length}`);

          const resumedState = sessionToWorkflowState(existingSession, ctx.state.executionId);

          // If additional prompt provided on resume, log it
          if (userPrompt) {
            await appendProgress(sessionDir, `\n## User instruction\n${userPrompt}\n`);
          }

          await appendLog(sessionDir, "agent-calls", {
            action: "resume",
            sessionId,
            iteration: existingSession.iteration,
          });

          return {
            stateUpdate: {
              ...resumedState,
              userPrompt: userPrompt ?? resumedState.userPrompt,
              lastUpdated: new Date().toISOString(),
            } as Partial<TState>,
          };
        } else {
          console.log(`Session ${sessionId} not found, creating new session`);
        }
      }

      // Create new session
      console.log(`Started Ralph session: ${sessionId}`);

      // Create session directory structure
      await createSessionDirectory(sessionId);

      // Create the session state (tasks will be populated by the agent call)
      const newState = createRalphWorkflowState({
        executionId: ctx.state.executionId,
        sessionId,
        userPrompt,
        tasks: [],
      });

      // Initialize progress.txt with session header
      await initializeProgressFile(sessionDir, sessionId, 0);

      // Write initial empty tasks.json
      await writeTasksJson(sessionDir, []);

      // Save session.json
      const session = workflowStateToSession(newState);
      await saveSession(sessionDir, session);

      // Log the init action
      await appendLog(sessionDir, "agent-calls", {
        action: "init",
        sessionId,
      });

      return {
        stateUpdate: {
          ...newState,
          lastUpdated: new Date().toISOString(),
        } as Partial<TState>,
      };
    },
  };
}

// ============================================================================
// CREATE PR NODE
// ============================================================================

/**
 * Default prompt template for creating a pull request.
 *
 * Placeholders:
 * - $SESSION_ID: The Ralph session ID
 * - $COMPLETED_FEATURES: JSON array of completed feature names
 * - $TOTAL_FEATURES: Total number of features
 * - $PASSING_FEATURES: Number of passing features
 * - $BASE_BRANCH: The base branch to merge into
 */
export const CREATE_PR_PROMPT = `
Create a pull request for the Ralph session $SESSION_ID.

## Completed Features
$COMPLETED_FEATURES

## Summary
- Total features: $TOTAL_FEATURES
- Passing features: $PASSING_FEATURES

## Instructions
1. Review the changes made during this session
2. Create a descriptive PR title summarizing the work done
3. Write a comprehensive PR description that:
   - Lists the features implemented
   - Describes any notable changes or decisions
   - Mentions any known issues or follow-up work needed
4. Create the PR targeting the $BASE_BRANCH branch
5. Return the PR URL

Use the gh CLI to create the PR:
\`\`\`bash
gh pr create --title "TITLE" --body "BODY" --base $BASE_BRANCH
\`\`\`

After creating the PR, output the PR URL on its own line in this format:
PR_URL: https://github.com/...
`;

/**
 * Configuration options for createPRNode.
 */
export interface CreatePRNodeConfig {
  /** Unique identifier for the node */
  id: string;

  /** Human-readable name for the node */
  name?: string;

  /** Description of what the node does */
  description?: string;

  /** Base branch to merge into (default: "main") */
  baseBranch?: string;

  /** Custom title template (supports $SESSION_ID, $FEATURE_COUNT placeholders) */
  titleTemplate?: string;

  /** Custom PR prompt (overrides CREATE_PR_PROMPT) */
  promptTemplate?: string;
}

/**
 * Extract PR URL from agent output.
 *
 * Looks for patterns like:
 * - PR_URL: https://github.com/...
 * - https://github.com/.../pull/123
 *
 * @param output - The agent's output text
 * @returns The PR URL if found, undefined otherwise
 */
export function extractPRUrl(output: string): string | undefined {
  // First, try to find explicit PR_URL marker
  const prUrlMatch = output.match(/PR_URL:\s*(https:\/\/[^\s]+)/i);
  if (prUrlMatch) {
    return prUrlMatch[1];
  }

  // Fall back to finding any GitHub PR URL
  const githubPrMatch = output.match(/(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/);
  if (githubPrMatch) {
    return githubPrMatch[1];
  }

  return undefined;
}

/**
 * Extract branch name from agent output or git.
 *
 * @param output - The agent's output text
 * @returns The branch name if found, undefined otherwise
 */
export function extractBranchName(output: string): string | undefined {
  // Look for branch name patterns in output
  const branchMatch = output.match(/branch[:\s]+['"]?([a-zA-Z0-9/_-]+)['"]?/i);
  if (branchMatch) {
    return branchMatch[1];
  }

  return undefined;
}

/**
 * Create a node that creates a pull request with session metadata.
 *
 * This node handles:
 * - Building a PR prompt with completed features summary
 * - Preparing state for agent to create the PR
 * - Extracting PR URL from agent output (via processCreatePRResult)
 * - Updating session with PR metadata
 * - Marking the session as completed
 *
 * Note: The actual PR creation is performed by an agent node that follows
 * this node. Use processCreatePRResult() to handle the agent's output.
 *
 * @param config - Node configuration
 * @returns A NodeDefinition for creating pull requests
 *
 * @example
 * ```typescript
 * // Create a PR node
 * const prNode = createPRNode({
 *   id: "create-pr",
 *   baseBranch: "main",
 *   titleTemplate: "feat: Ralph session $SESSION_ID",
 * });
 *
 * // Use in a workflow after all features are implemented
 * graph<RalphWorkflowState>()
 *   .start(initNode)
 *   .loop({ ... })
 *   .then(prNode)
 *   .then(agentNode)  // Agent creates the actual PR
 *   .then(processResultNode)  // Process PR result
 *   .compile();
 * ```
 */
export function createPRNode<TState extends RalphWorkflowState = RalphWorkflowState>(
  config: CreatePRNodeConfig
): NodeDefinition<TState> {
  const {
    id,
    name = "create-pr",
    description = "Create a pull request with session metadata",
    baseBranch = "main",
    titleTemplate,
    promptTemplate = CREATE_PR_PROMPT,
  } = config;

  return {
    id,
    type: "tool",
    name,
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const state = ctx.state as RalphWorkflowState;
      const sessionDir = state.ralphSessionDir;
      const now = new Date().toISOString();

      // Build completed features list
      const completedFeatures = state.tasks
        .filter((t) => t.status === "completed")
        .map((t) => t.content);

      const totalFeatures = state.tasks.length;
      const passingFeatures = completedFeatures.length;

      // Build the PR prompt with placeholders replaced
      let prPrompt = promptTemplate
        .replace(/\$SESSION_ID/g, state.ralphSessionId)
        .replace(/\$COMPLETED_FEATURES/g, JSON.stringify(completedFeatures, null, 2))
        .replace(/\$TOTAL_FEATURES/g, String(totalFeatures))
        .replace(/\$PASSING_FEATURES/g, String(passingFeatures))
        .replace(/\$BASE_BRANCH/g, baseBranch);

      // Build title if template provided
      let prTitle: string | undefined;
      if (titleTemplate) {
        prTitle = titleTemplate
          .replace(/\$SESSION_ID/g, state.ralphSessionId)
          .replace(/\$FEATURE_COUNT/g, String(passingFeatures));
      }

      // Log the PR creation action
      await appendLog(sessionDir, "agent-calls", {
        action: "create-pr-start",
        sessionId: state.ralphSessionId,
        iteration: state.iteration,
        baseBranch,
        completedFeatures: completedFeatures.length,
        totalFeatures,
        titleTemplate: prTitle,
      });

      // Return state with PR prompt in outputs
      // The actual PR creation is handled by a separate agentNode
      return {
        stateUpdate: {
          lastUpdated: now,
          outputs: {
            ...state.outputs,
            [`${id}_prompt`]: prPrompt,
            [`${id}_baseBranch`]: baseBranch,
            ...(prTitle ? { [`${id}_title`]: prTitle } : {}),
          },
        } as Partial<TState>,
      };
    },
  };
}

/**
 * Process the results of a PR creation agent call.
 *
 * This is a helper function that extracts the PR URL from agent output,
 * updates session state, and marks the session as completed.
 *
 * @param state - Current workflow state (after agent execution)
 * @param agentOutput - The agent's output text
 * @returns Updated state with PR metadata
 */
export async function processCreatePRResult(
  state: RalphWorkflowState,
  agentOutput: string
): Promise<Partial<RalphWorkflowState>> {
  const sessionDir = state.ralphSessionDir;
  const now = new Date().toISOString();

  // Extract PR URL from agent output
  const prUrl = extractPRUrl(agentOutput);
  const prBranch = extractBranchName(agentOutput);

  // Build updated state
  const updatedState: Partial<RalphWorkflowState> = {
    prUrl,
    prBranch,
    sessionStatus: "completed",
    shouldContinue: false,
    lastUpdated: now,
  };

  // Save session with updated state
  const session = workflowStateToSession({
    ...state,
    ...updatedState,
  } as RalphWorkflowState);
  await saveSession(sessionDir, session);

  // Append final completion to progress.txt
  const completedCount = state.tasks.filter((t) => t.status === "completed").length;
  const totalCount = state.tasks.length;

  const prEntry = `## Session Complete\n- Tasks: ${completedCount}/${totalCount}\n- ${prUrl ? `PR: ${prUrl}` : "No PR URL"}\n- Status: ${prUrl ? "completed" : "failed"}\n`;
  await appendProgress(sessionDir, prEntry);

  // Log the PR result
  await appendLog(sessionDir, "agent-calls", {
    action: "create-pr-result",
    sessionId: state.ralphSessionId,
    iteration: state.iteration,
    prUrl,
    prBranch,
    success: !!prUrl,
    completedFeatures: completedCount,
    totalFeatures: totalCount,
  });

  // Log completion message
  if (prUrl) {
    console.log(`Pull request created: ${prUrl}`);
  } else {
    console.log("Session completed (no PR URL extracted from output)");
  }
  console.log(`Status: ${formatSessionStatus("completed")}`);

  return updatedState;
}
