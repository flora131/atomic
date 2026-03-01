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

function stripPriorityPrefix(title: string): string {
  return title.replace(/^\s*\[(?:P\d|p\d)\]\s*/u, "").trim();
}

function buildReviewFixTasks(findings: ReadonlyArray<{
  title?: string;
  body?: string;
}>): TaskItem[] {
  if (findings.length === 0) {
    return [{
      id: "#review-fix-1",
      content: "Address review feedback",
      status: "pending",
      activeForm: "Addressing review feedback",
      blockedBy: [],
    }];
  }

  return findings.map((finding, index) => {
    const fallback = `Address review finding ${index + 1}`;
    const normalizedTitle = typeof finding.title === "string"
      ? stripPriorityPrefix(finding.title)
      : "";
    const content = normalizedTitle.length > 0 ? normalizedTitle : fallback;

    return {
      id: `#review-fix-${index + 1}`,
      content,
      status: "pending",
      activeForm: `Addressing ${content}`,
      blockedBy: [],
    } satisfies TaskItem;
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
            const spawnSubagentParallel = ctx.config.runtime?.spawnSubagentParallel;
            if (!spawnSubagentParallel) {
              throw new Error("spawnSubagentParallel not available in runtime config");
            }

            const ready = ctx.state.currentTasks;
            if (ready.length === 0) {
              return { stateUpdate: { iteration: ctx.state.iteration + 1 } as Partial<RalphWorkflowState> };
            }

            // Build a stable ready-task index once so status/result mapping stays
            // deterministic even when task IDs are missing or duplicated.
            const readyIndexByTask = new Map<TaskItem, number>();
            for (const [index, task] of ready.entries()) {
              readyIndexByTask.set(task, index);
            }

            // Set all ready tasks to "in_progress" before dispatch
            const tasksWithProgress = ctx.state.tasks.map((task) =>
              readyIndexByTask.has(task)
                ? { ...task, status: "in_progress" }
                : task,
            );

            // Publish workflow.task.statusChange event before spawning.
            // notifyTaskStatusChange is injected at runtime by the executor when an eventBus is available.
            const notifyFn = (ctx.config.runtime as Record<string, unknown> | undefined)
              ?.notifyTaskStatusChange as
              | ((
                taskIds: string[],
                newStatus: string,
                tasks: Array<{ id: string; title: string; status: string; blockedBy?: string[] }>,
              ) => void)
              | undefined;
            notifyFn?.(
              ready.map((r) => r.id).filter((id): id is string => Boolean(id)),
              "in_progress",
              tasksWithProgress.map((t) => ({
                id: t.id ?? "",
                title: t.content,
                status: t.status,
                blockedBy: t.blockedBy,
              })),
            );

            // Build spawn configs for ALL ready tasks.
            // Keep IDs stable for normal flows while guaranteeing uniqueness
            // when tasks have duplicate IDs.
            const agentIdCounts = new Map<string, number>();
            const spawnConfigs: SubagentSpawnOptions[] = ready.map((task, index) => {
              const baseAgentId = `worker-${task.id ?? `${ctx.state.executionId}-${ctx.state.iteration}-${index}`}`;
              const nextCount = (agentIdCounts.get(baseAgentId) ?? 0) + 1;
              agentIdCounts.set(baseAgentId, nextCount);

              return {
                agentId: nextCount === 1 ? baseAgentId : `${baseAgentId}-${nextCount}`,
                agentName: "worker",
                task: buildWorkerAssignment(task, tasksWithProgress),
              };
            });

            // Dispatch all concurrently via spawnSubagentParallel
            const results = await spawnSubagentParallel(spawnConfigs, ctx.abortSignal);

            // Map results back independently — each result corresponds to the
            // matched ready task index from the precomputed map.
            const updatedTasks = tasksWithProgress.map((task, taskIndex) => {
              const sourceTask = ctx.state.tasks[taskIndex];
              if (!sourceTask) return task;
              const readyIndex = readyIndexByTask.get(sourceTask);
              if (readyIndex === undefined) return task;
              const result = results[readyIndex];
              return { ...task, status: result?.success ? "completed" : "error" };
            });

            return {
              stateUpdate: {
                iteration: ctx.state.iteration + 1,
                tasks: updatedTasks,
              } as Partial<RalphWorkflowState>,
            };
          },
        } satisfies NodeDefinition<RalphWorkflowState>,
      ],
      {
        until: (state) =>
          (state.tasks.length > 0 && state.tasks.every((t) => t.status === "completed" || t.status === "error")) ||
          state.iteration >= state.maxIterations ||
          (state.tasks.length > 0 && !hasActionableTasks(state.tasks)),
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
        state.reviewResult.findings.length > 0,
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
            const spawnSubagent = ctx.config.runtime?.spawnSubagent;
            if (!spawnSubagent) {
              throw new Error("spawnSubagent not available in runtime config");
            }

            const review = ctx.state.reviewResult;
            if (!review) {
              return {
                stateUpdate: {
                  fixesApplied: false,
                } as Partial<RalphWorkflowState>,
              };
            }

            const fixSpec = buildFixSpecFromReview(
              review,
              ctx.state.tasks,
              ctx.state.yoloPrompt ?? "",
            );
            if (!fixSpec.trim()) {
              return {
                stateUpdate: {
                  fixesApplied: false,
                } as Partial<RalphWorkflowState>,
              };
            }

            const tasksInProgress = ctx.state.tasks.map((task) =>
              task.status === "pending" ? { ...task, status: "in_progress" } : task,
            );

            const activeFixTaskIds = tasksInProgress
              .filter((task) => task.status === "in_progress")
              .map((task) => task.id)
              .filter((id): id is string => Boolean(id));

            const notifyFn = (ctx.config.runtime as Record<string, unknown> | undefined)
              ?.notifyTaskStatusChange as
              | ((
                taskIds: string[],
                newStatus: string,
                tasks: Array<{ id: string; title: string; status: string; blockedBy?: string[] }>,
              ) => void)
              | undefined;
            notifyFn?.(
              activeFixTaskIds,
              "in_progress",
              tasksInProgress.map((task) => ({
                id: task.id ?? "",
                title: task.content,
                status: task.status,
                blockedBy: task.blockedBy,
              })),
            );

            const result = await spawnSubagent({
              agentId: `fixer-${ctx.state.executionId}`,
              agentName: "debugger",
              task: fixSpec,
              abortSignal: ctx.abortSignal,
            }, ctx.abortSignal);

            const terminalStatus = result.success ? "completed" : "error";
            const finalizedTasks = tasksInProgress.map((task) =>
              task.status === "in_progress" ? { ...task, status: terminalStatus } : task,
            );

            return {
              stateUpdate: {
                tasks: finalizedTasks,
                currentTasks: finalizedTasks,
                fixesApplied: result.success,
              } as Partial<RalphWorkflowState>,
            };
          },
        } satisfies NodeDefinition<RalphWorkflowState>,
      ],
    })
    .compile();
}
