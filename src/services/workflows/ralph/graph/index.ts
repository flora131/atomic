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
  buildWorkerAssignment,
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

// ============================================================================
// EXTRACTED NODE IMPLEMENTATIONS
// ============================================================================

/**
 * Worker node implementation (graph-executor fallback path).
 *
 * Dispatches ready tasks to sub-agents in parallel via spawnSubagentParallel,
 * maps results back to task statuses, and advances the iteration counter.
 *
 * NOTE: The conductor path (§8.1 Phase 5) replaces this with an orchestrator
 * prompt that manages parallelism natively. This function exists only as the
 * fallback when the graph executor is used instead of the conductor.
 *
 * @deprecated Use WorkflowSessionConductor instead. The conductor handles
 * worker dispatch through session-per-stage execution with an orchestrator
 * prompt rather than explicit sub-agent spawning.
 */
async function executeWorkerNode(
  ralphCtx: RalphWorkflowContext,
): Promise<NodeResult<RalphWorkflowState>> {
  const state = ralphCtx.state;
  const { spawnSubagentParallel, taskIdentity, notifyTaskStatusChange } = ralphCtx.runtime;

  const ready = state.currentTasks;
  if (ready.length === 0) {
    return { stateUpdate: { iteration: state.iteration + 1 } as Partial<RalphWorkflowState> };
  }
  if (state.iteration >= state.maxIterations) {
    return { stateUpdate: { iteration: state.maxIterations } as Partial<RalphWorkflowState> };
  }

  // Build a mapping from ready task → index in state.tasks
  const readyTaskIndices = new Map<TaskItem, number>();
  for (const task of ready) {
    const idx = state.tasks.indexOf(task);
    if (idx !== -1) readyTaskIndices.set(task, idx);
  }

  // Prepare sub-agent spawn options for each ready task
  const spawnOptions = ready.map((task, i) => ({
    agentId: `worker-${state.executionId}-${state.iteration}-${i}`,
    agentName: "worker",
    task: buildWorkerAssignment(task, state.tasks),
    abortSignal: ralphCtx.abortSignal,
  }));

  // Notify tasks moving to in_progress
  const inProgressIds = ready
    .map((t) => t.id)
    .filter((id): id is string => Boolean(id));
  if (notifyTaskStatusChange && inProgressIds.length > 0) {
    notifyTaskStatusChange(
      inProgressIds,
      "in_progress",
      ready.map((task, i) => {
        const opts = spawnOptions[i];
        const runtimeTask = toRuntimeTask(task, opts?.agentId ?? `worker-${state.executionId}-${state.iteration}-${i}`);
        return {
          id: task.id ?? "",
          title: task.description,
          status: normalizeWorkflowRuntimeTaskStatus("in_progress"),
          blockedBy: task.blockedBy,
          identity: runtimeTask.identity,
        };
      }),
    );
  }

  // Dispatch all ready tasks in parallel
  const results = await spawnSubagentParallel(spawnOptions, ralphCtx.abortSignal);

  // Map results back to tasks
  const updatedTasks = [...state.tasks];
  for (let i = 0; i < ready.length; i++) {
    const task = ready[i];
    const opts = spawnOptions[i];
    const result = results[i];
    if (!task || !opts || !result) continue;

    const taskIndex = readyTaskIndices.get(task);
    if (taskIndex === undefined) continue;

    const terminalStatus = result.success ? "completed" : "error";
    const agentId = opts.agentId;

    const runtimeTask = toRuntimeTask(task, agentId);

    // Bind provider identity if available
    const boundTask = taskIdentity
      ? taskIdentity.bindProviderId(runtimeTask, "subagent_id", agentId)
      : runtimeTask;

    const taskResult = buildTaskResultEnvelope({
      task: boundTask,
      result,
      sessionId: state.executionId,
    });

    updatedTasks[taskIndex] = applyRuntimeTask(task, {
      ...boundTask,
      status: terminalStatus,
      taskResult,
    });
  }

  return {
    stateUpdate: {
      iteration: state.iteration + 1,
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
 *
 * @deprecated Use WorkflowSessionConductor instead. The conductor handles
 * fixer dispatch through session-per-stage execution rather than explicit
 * sub-agent spawning.
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
