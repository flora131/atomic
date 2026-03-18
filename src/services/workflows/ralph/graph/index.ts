/**
 * Graph-based Ralph Workflow
 * 
 * Expresses the Ralph autonomous implementation workflow as a compiled graph:
 * Phase 1: Task decomposition via planner sub-agent
 * Phase 2: Worker loop — select ready tasks, dispatch workers in parallel
 * Phase 3: Review & conditional fix
 */

import {
  graph,
  toolNode,
} from "@/services/workflows/graph/index.ts";
import type { NodeDefinition, ExecutionContext, NodeResult } from "@/services/workflows/graph/types.ts";
import {
  normalizeWorkflowRuntimeTaskStatus,
} from "@/services/workflows/runtime-contracts.ts";
import { buildTaskResultEnvelope } from "@/services/workflows/task-result-envelope.ts";
import type { RalphWorkflowState } from "@/services/workflows/ralph/state.ts";
import {
  toRalphWorkflowContext,
  type RalphWorkflowContext,
} from "@/services/workflows/ralph/types.ts";
import {
  buildSpecToTasksPrompt,
  buildReviewPrompt,
  buildFixSpecFromReview,
  buildFixSpecFromRawReview,
  parseReviewResult,
  type TaskItem,
} from "@/services/workflows/ralph/prompts.ts";
import {
  applyRuntimeTask,
  buildReviewFixTasks,
  getReadyTasks,
  hasActionableTasks,
  parseTasks,
  toRuntimeTask,
} from "./task-helpers.ts";
import { createWorkerDispatchAdapter } from "./worker-dispatch.ts";

// ============================================================================
// EXTRACTED NODE IMPLEMENTATIONS
// ============================================================================

/**
 * Worker node implementation.
 *
 * Dispatches ready tasks to sub-agents in parallel, maps results back to task
 * statuses, and advances the iteration counter. Uses RalphWorkflowContext
 * instead of reaching into ExecutionContext.config.runtime directly.
 */
async function executeWorkerNode(
  ralphCtx: RalphWorkflowContext,
): Promise<NodeResult<RalphWorkflowState>> {
  const state = ralphCtx.state;
  const remainingReadyDispatchWaves = Math.max(state.maxIterations - state.iteration, 0);

  const ready = state.currentTasks;
  if (ready.length === 0) {
    return { stateUpdate: { iteration: state.iteration + 1 } as Partial<RalphWorkflowState> };
  }
  if (remainingReadyDispatchWaves === 0) {
    return { stateUpdate: { iteration: state.maxIterations } as Partial<RalphWorkflowState> };
  }

  const { coordinator, reconcileDispatchedTask } = createWorkerDispatchAdapter({
    tasks: state.tasks,
    executionId: state.executionId,
    iteration: state.iteration,
    maxReadyDispatchWaves: remainingReadyDispatchWaves,
    runtime: ralphCtx.runtime,
    abortSignal: ralphCtx.abortSignal,
  });
  const {
    dispatchedTaskIndices,
    readyDispatchWaveCount,
    resultsByTaskIndex,
    taskStatuses,
  } = await coordinator.execute();
  if (readyDispatchWaveCount === 0) {
    throw new Error(
      "Worker dispatch reconciliation invariant failed: ready tasks were present but no eager waves were dispatched",
    );
  }

  const updatedTasks = state.tasks.map((task, taskIndex) => {
    if (!dispatchedTaskIndices.has(taskIndex)) {
      return task;
    }

    return reconcileDispatchedTask(
      task,
      taskIndex,
      taskStatuses.get(taskIndex) ?? task.status,
      resultsByTaskIndex.get(taskIndex),
      state.executionId,
    );
  });

  return {
    stateUpdate: {
      iteration: state.iteration + readyDispatchWaveCount,
      tasks: updatedTasks,
    } as Partial<RalphWorkflowState>,
  };
}

/**
 * Fixer node implementation.
 *
 * Spawns a single sub-agent to apply review fixes. Uses RalphWorkflowContext
 * for typed access to runtime dependencies instead of unsafe casts on
 * ExecutionContext.config.runtime.
 */
async function executeFixerNode(
  ralphCtx: RalphWorkflowContext,
): Promise<NodeResult<RalphWorkflowState>> {
  const { spawnSubagent, taskIdentity, notifyTaskStatusChange } = ralphCtx.runtime;
  const state = ralphCtx.state;

  const review = state.reviewResult;
  const rawReviewResult = state.rawReviewResult?.trim() ?? "";
  if (!review && rawReviewResult.length === 0) {
    return {
      stateUpdate: {
        fixesApplied: false,
      } as Partial<RalphWorkflowState>,
    };
  }

  const fixSpec = review
    ? buildFixSpecFromReview(
      review,
      state.tasks,
      state.yoloPrompt ?? "",
    )
    : buildFixSpecFromRawReview(
      rawReviewResult,
      state.yoloPrompt ?? "",
    );
  if (!fixSpec.trim()) {
    return {
      stateUpdate: {
        fixesApplied: false,
      } as Partial<RalphWorkflowState>,
    };
  }

  const tasksInProgress = state.tasks.map((task) =>
    task.status === "pending" ? { ...task, status: "in_progress" } : task,
  );

  const activeFixTaskIds = tasksInProgress
    .filter((task) => task.status === "in_progress")
    .map((task) => task.id)
    .filter((id): id is string => Boolean(id));

  notifyTaskStatusChange?.(
    activeFixTaskIds,
    "in_progress",
    tasksInProgress.map((task, index) => {
      const runtimeTask = toRuntimeTask(task, `${state.executionId}-fix-${index}`);
      return {
        id: task.id ?? "",
        title: task.description,
        status: normalizeWorkflowRuntimeTaskStatus(task.status),
        blockedBy: task.blockedBy,
        identity: runtimeTask.identity,
      };
    }),
  );

  const fixerAgentId = `fixer-${state.executionId}`;
  const identityBoundTasks = taskIdentity
    ? tasksInProgress.map((task, index) => {
      if (task.status !== "in_progress") {
        return task;
      }

      const runtimeTask = toRuntimeTask(task, `${state.executionId}-fix-${index}`);
      const boundTask = taskIdentity.bindProviderId(runtimeTask, "subagent_id", fixerAgentId);
      return applyRuntimeTask(task, boundTask);
    })
    : tasksInProgress;

  const result = await spawnSubagent({
    agentId: fixerAgentId,
    agentName: "debugger",
    task: fixSpec,
    abortSignal: ralphCtx.abortSignal,
  }, ralphCtx.abortSignal);

  const terminalStatus = result.success ? "completed" : "error";
  const finalizedTasks = identityBoundTasks.map((task, index) => {
    if (task.status !== "in_progress") {
      return task;
    }

    const runtimeTask = toRuntimeTask(task, `${state.executionId}-fix-${index}`);
    const taskResult = buildTaskResultEnvelope({
      task: runtimeTask,
      result,
      sessionId: state.executionId,
    });

    return applyRuntimeTask(task, {
      ...runtimeTask,
      status: terminalStatus,
      taskResult,
    });
  });

  return {
    stateUpdate: {
      tasks: finalizedTasks,
      currentTasks: finalizedTasks,
      fixesApplied: result.success,
    } as Partial<RalphWorkflowState>,
  };
}

// ============================================================================
// RALPH GRAPH WORKFLOW
// ============================================================================

/**
 * Create the Ralph workflow as a compiled graph.
 *
 * Three-phase flow:
 * 1. Task Decomposition: Planner sub-agent decomposes spec into task list
 * 2. Worker Loop: Iteratively select ready tasks and dispatch workers
 * 3. Review & Fix: Reviewer evaluates, optional fixer applies corrections
 */
export function createRalphWorkflow() {
  return graph<RalphWorkflowState>()
    // Phase 1: Task Decomposition
    .subagent({
      id: "planner",
      agent: "planner",
      task: (state) => buildSpecToTasksPrompt(state.yoloPrompt ?? ""),
      outputMapper: (result, _state) => ({
        specDoc: result.output ?? "",
      }),
      name: "Planner",
      description: "Decomposes user prompt into a task list",
    })
    .tool({
      id: "parse-tasks",
      toolName: "parse-tasks",
      execute: async (args: { specDoc: string }) => parseTasks(args.specDoc),
      args: (state: RalphWorkflowState) => ({ specDoc: state.specDoc }),
      outputMapper: (tasks: TaskItem[], _state: RalphWorkflowState) => ({
        tasks,
        currentTasks: tasks,
        iteration: 0,
      }),
      name: "Task Parser",
      description: "Parse spec document into structured task list",
    })

    // Phase 2: Worker Loop
    .loop(
      [
        toolNode<RalphWorkflowState, { tasks: TaskItem[] }, TaskItem[]>({
          id: "select-ready-tasks",
          toolName: "select-ready-tasks",
          execute: async (args) => getReadyTasks(args.tasks),
          args: (state) => ({ tasks: state.tasks }),
          outputMapper: (readyTasks, _state) => ({
            currentTasks: readyTasks,
          }),
          name: "Task Selector",
          description: "Select tasks ready for execution",
        }),
        // Custom worker node: handles failures gracefully by setting task
        // status to "error" instead of throwing (matches procedural handler).
        {
          id: "worker",
          type: "agent",
          name: "Worker",
          description: "Implements assigned tasks",
          retry: { maxAttempts: 1, backoffMs: 0, backoffMultiplier: 1 },
          async execute(ctx: ExecutionContext<RalphWorkflowState>): Promise<NodeResult<RalphWorkflowState>> {
            return executeWorkerNode(toRalphWorkflowContext(ctx));
          },
        } satisfies NodeDefinition<RalphWorkflowState>,
      ],
      {
        until: (state) =>
          state.tasks.length === 0 ||
          state.tasks.every((t) => t.status === "completed" || t.status === "error") ||
          state.iteration >= state.maxIterations ||
          !hasActionableTasks(state.tasks),
        maxIterations: 100,
      }
    )

    // Phase 3: Review & Fix
    .subagent({
      id: "reviewer",
      agent: "reviewer",
      task: (state) =>
        buildReviewPrompt(
          state.tasks,
          state.yoloPrompt ?? "",
          `${state.ralphSessionDir}/progress.txt`
        ),
      outputMapper: (result, _state) => {
        const rawReviewResult = result.output ?? "";
        return {
          rawReviewResult,
          reviewResult: parseReviewResult(rawReviewResult),
        };
      },
      name: "Reviewer",
      description: "Reviews completed work",
    })
    // oxlint-disable-next-line unicorn/no-thenable -- `then` is part of the IfConfig API
    .if({
      condition: (state) =>
        (state.reviewResult !== null && state.reviewResult.findings.length > 0) ||
        (state.reviewResult === null &&
          typeof state.rawReviewResult === "string" &&
          state.rawReviewResult.trim().length > 0),
      then: [
        toolNode<RalphWorkflowState, { findings: NonNullable<RalphWorkflowState["reviewResult"]>["findings"] }, TaskItem[]>({
          id: "prepare-fix-tasks",
          toolName: "prepare-fix-tasks",
          execute: async (args) => buildReviewFixTasks(args.findings),
          args: (state) => ({ findings: state.reviewResult?.findings ?? [] }),
          outputMapper: (fixTasks) => ({
            tasks: fixTasks,
            currentTasks: fixTasks,
          }),
          name: "Fix Task Planner",
          description: "Converts review findings into actionable fix tasks",
        }),
        {
          id: "fixer",
          type: "agent",
          name: "Fixer",
          description: "Applies review fixes",
          retry: { maxAttempts: 1, backoffMs: 0, backoffMultiplier: 1 },
          async execute(ctx: ExecutionContext<RalphWorkflowState>): Promise<NodeResult<RalphWorkflowState>> {
            return executeFixerNode(toRalphWorkflowContext(ctx));
          },
        } satisfies NodeDefinition<RalphWorkflowState>,
      ],
    })
    .compile();
}
