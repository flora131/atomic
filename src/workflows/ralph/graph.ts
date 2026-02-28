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
  subagentNode,
  toolNode,
} from "../graph/index.ts";
import type { NodeDefinition, ExecutionContext, NodeResult } from "../graph/types.ts";
import type { SubagentSpawnOptions } from "../graph/types.ts";
import type { RalphWorkflowState } from "./state.ts";
import {
  buildSpecToTasksPrompt,
  buildWorkerAssignment,
  buildReviewPrompt,
  buildFixSpecFromReview,
  parseReviewResult,
  type TaskItem,
} from "./prompts.ts";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse LLM output containing a JSON task array into TaskItem[].
 * Tries direct parse first, then regex extraction.
 */
function parseTasks(content: string): TaskItem[] {
  const trimmed = content.trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        /* ignore */
      }
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return [];
  return parsed as TaskItem[];
}

/**
 * Get tasks that are ready to execute (pending with all dependencies met).
 */
function getReadyTasks(tasks: TaskItem[]): TaskItem[] {
  const completedIds = new Set(
    tasks
      .filter((t) => t.status === "completed" || t.status === "complete" || t.status === "done")
      .map((t) => t.id)
      .filter((id): id is string => Boolean(id))
      .map((id) => id.trim().toLowerCase().replace(/^#/, ""))
  );

  return tasks.filter((task) => {
    if (task.status !== "pending") return false;
    const deps = (task.blockedBy ?? [])
      .map((d) => d.trim().toLowerCase().replace(/^#/, ""))
      .filter((d) => d.length > 0);
    return deps.every((d) => completedIds.has(d));
  });
}

/**
 * Check if there are any actionable tasks remaining.
 */
function hasActionableTasks(tasks: TaskItem[]): boolean {
  return tasks.some((task) => {
    if (task.status === "in_progress") return true;
    if (task.status !== "pending") return false;
    return getReadyTasks([...tasks]).some((t) => t.id === task.id);
  });
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
            const spawnParallel = ctx.config.runtime?.spawnSubagentParallel;
            const spawnSingle = ctx.config.runtime?.spawnSubagent;
            if (!spawnParallel && !spawnSingle) {
              throw new Error("spawnSubagent not initialized. Execute this graph through WorkflowSDK.init().");
            }
            const ready = ctx.state.currentTasks;
            if (ready.length === 0) {
              return { stateUpdate: { iteration: ctx.state.iteration + 1 } as Partial<RalphWorkflowState> };
            }

            // Set tasks to in_progress before dispatching
            const inProgressTasks = ctx.state.tasks.map((t) => {
              if (ready.some((r) => r.id === t.id)) {
                return { ...t, status: "in_progress" };
              }
              return t;
            });

            // Build spawn options for all ready tasks
            const spawnOptionsList: SubagentSpawnOptions[] = ready.map((task) => ({
              agentId: `worker-${task.id ?? ctx.state.executionId}`,
              agentName: "worker",
              task: buildWorkerAssignment(task, ctx.state.tasks),
            }));

            // Dispatch all ready tasks in parallel if available, else fall back to single
            let results: Array<{ agentId: string; success: boolean }>;
            if (spawnParallel && spawnOptionsList.length > 1) {
              const parallelResults = await spawnParallel(spawnOptionsList, ctx.abortSignal);
              results = parallelResults.map((r, i) => ({
                agentId: spawnOptionsList[i]!.agentId,
                success: r.success,
              }));
            } else {
              // Single task or no parallel support — dispatch first task
              const opts = spawnOptionsList[0]!;
              const result = await spawnSingle!(opts, ctx.abortSignal);
              results = [{ agentId: opts.agentId, success: result.success }];
            }

            // Map results back to task statuses
            const resultByTaskId = new Map(
              results.map((r, i) => [ready[i]!.id, r.success])
            );

            return {
              stateUpdate: {
                iteration: ctx.state.iteration + 1,
                tasks: inProgressTasks.map((t) => {
                  const success = resultByTaskId.get(t.id);
                  if (success !== undefined) {
                    return { ...t, status: success ? "completed" : "error" };
                  }
                  return t;
                }),
              } as Partial<RalphWorkflowState>,
            };
          },
        } satisfies NodeDefinition<RalphWorkflowState>,
      ],
      {
        until: (state) =>
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
      outputMapper: (result, _state) => ({
        reviewResult: parseReviewResult(result.output ?? "") ?? {
          findings: [],
          overall_correctness: "patch is correct",
          overall_explanation: "No review output available",
        },
      }),
      name: "Reviewer",
      description: "Reviews completed work",
    })
    // oxlint-disable-next-line unicorn/no-thenable -- `then` is part of the IfConfig API
    .if({
      condition: (state) =>
        state.reviewResult !== null &&
        state.reviewResult.findings.length > 0 &&
        state.reviewResult.overall_correctness !== "patch is correct",
      then: [
        subagentNode<RalphWorkflowState>({
          id: "fixer",
          agentName: "debugger",
          task: (state) => {
            const fixSpec = buildFixSpecFromReview(
              state.reviewResult!,
              state.tasks,
              state.yoloPrompt ?? ""
            );
            return fixSpec || "No fixes needed";
          },
          outputMapper: (_result, _state) => ({
            fixesApplied: true,
          }),
          name: "Fixer",
          description: "Applies review fixes",
        }),
      ],
    })
    .compile();
}
