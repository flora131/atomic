import { readFile } from "fs/promises";
import type {
  BaseState,
  ExecutionContext,
  NodeDefinition,
  NodeId,
  NodeResult,
} from "../types.ts";
import type { DeadlockDiagnostic } from "../../ui/components/task-order.ts";
import { detectDeadlock, getReadyTasks } from "../../ui/components/task-order.ts";
import type { TaskItem as OrderTaskItem } from "../../ui/components/task-list-indicator.tsx";
import { normalizeTodoItems } from "../../ui/utils/task-status.ts";
import type { TaskItem } from "./ralph.ts";

function normalizeOrderStatus(status: string): OrderTaskItem["status"] {
  const normalized = status.trim().toLowerCase();
  if (normalized === "in_progress") return "in_progress";
  if (normalized === "completed" || normalized === "complete" || normalized === "done") {
    return "completed";
  }
  if (normalized === "error" || normalized === "failed") return "error";
  return "pending";
}

function toOrderTasks(tasks: TaskItem[]): OrderTaskItem[] {
  return tasks.map((task) => ({
    id: task.id,
    content: task.content,
    status: normalizeOrderStatus(task.status),
    blockedBy: task.blockedBy,
  }));
}

function getReadyLoopTasks(tasks: TaskItem[]): TaskItem[] {
  const ready = getReadyTasks(toOrderTasks(tasks));
  const readyIds = new Set(
    ready
      .map((task) => task.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  return tasks.filter((task) => task.id && readyIds.has(task.id));
}

function mergeStateUpdate<TState extends BaseState>(
  current: TState,
  update?: Partial<TState>,
): TState {
  if (!update) return current;

  const nextOutputs = update.outputs
    ? { ...current.outputs, ...update.outputs }
    : current.outputs;

  return {
    ...current,
    ...update,
    outputs: nextOutputs,
  };
}

async function loadTasksFromPath(path: string): Promise<TaskItem[]> {
  try {
    const content = await readFile(path, "utf-8");
    return normalizeTodoItems(JSON.parse(content));
  } catch {
    return [];
  }
}

export interface TaskLoopState extends BaseState {
  tasks: TaskItem[];
  iteration: number;
  shouldContinue: boolean;
  allTasksComplete?: boolean;
  maxIterationsReached?: boolean;
  currentTask?: TaskItem;
  currentTasks?: TaskItem[];
}

export interface TaskLoopConfig<TState extends TaskLoopState> {
  id?: NodeId;
  tasksPath?: string | ((state: TState) => string);
  taskNodes: NodeDefinition<TState> | NodeDefinition<TState>[];
  preIterationNode?: NodeDefinition<TState>;
  until?: (state: TState, tasks: TaskItem[]) => boolean;
  maxIterations?: number;
  taskSelector?: (tasks: TaskItem[]) => TaskItem[];
  detectDeadlocks?: boolean;
  onDeadlock?: (
    diagnostic: DeadlockDiagnostic,
    state: TState,
  ) => TState | null;
}

export function taskLoopNode<TState extends TaskLoopState>(
  config: TaskLoopConfig<TState>,
): NodeDefinition<TState> {
  const {
    id = "taskLoop",
    tasksPath,
    taskNodes,
    preIterationNode,
    until = (_state, tasks) => tasks.every((task) => normalizeOrderStatus(task.status) === "completed"),
    maxIterations = 100,
    taskSelector = (tasks) => getReadyLoopTasks(tasks),
    detectDeadlocks = true,
    onDeadlock,
  } = config;

  return {
    id,
    type: "tool",
    name: "Task Loop",
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      let workingState = ctx.state;
      let iteration = Math.max(workingState.iteration ?? 0, 0);

      while (iteration < maxIterations) {
        const resolvedPath = typeof tasksPath === "function"
          ? tasksPath(workingState)
          : tasksPath;

        const loadedTasks = resolvedPath
          ? await loadTasksFromPath(resolvedPath)
          : workingState.tasks;

        const tasks = loadedTasks.length > 0 ? loadedTasks : workingState.tasks;

        if (until(workingState, tasks)) {
          return {
            stateUpdate: {
              tasks,
              allTasksComplete: true,
              shouldContinue: false,
              iteration,
            } as Partial<TState>,
          };
        }

        if (detectDeadlocks) {
          const diagnostic = detectDeadlock(toOrderTasks(tasks));
          if (diagnostic.type !== "none") {
            if (onDeadlock) {
              const recovered = onDeadlock(diagnostic, workingState);
              if (recovered === null) {
                return {
                  stateUpdate: {
                    tasks,
                    shouldContinue: false,
                    iteration,
                  } as Partial<TState>,
                };
              }
              workingState = recovered;
              continue;
            }

            return {
              stateUpdate: {
                tasks,
                shouldContinue: false,
                iteration,
              } as Partial<TState>,
            };
          }
        }

        const selectedTasks = taskSelector(tasks);
        if (selectedTasks.length === 0) {
          return {
            stateUpdate: {
              tasks,
              shouldContinue: false,
              iteration,
            } as Partial<TState>,
          };
        }

        let loopState = {
          ...workingState,
          tasks,
          iteration,
          shouldContinue: true,
          currentTask: selectedTasks[0],
          currentTasks: selectedTasks,
        } as TState;

        if (preIterationNode) {
          const preResult = await preIterationNode.execute({
            ...ctx,
            state: loopState,
          });

          loopState = mergeStateUpdate(loopState, preResult.stateUpdate);
          if (preResult.goto || preResult.signals) {
            return {
              stateUpdate: {
                ...preResult.stateUpdate,
                tasks: loopState.tasks,
              } as Partial<TState>,
              goto: preResult.goto,
              signals: preResult.signals,
            };
          }
        }

        const bodyNodes = Array.isArray(taskNodes) ? taskNodes : [taskNodes];
        for (const node of bodyNodes) {
          const bodyResult = await node.execute({
            ...ctx,
            state: loopState,
          });
          loopState = mergeStateUpdate(loopState, bodyResult.stateUpdate);

          if (bodyResult.goto || bodyResult.signals) {
            return {
              stateUpdate: {
                ...bodyResult.stateUpdate,
                tasks: loopState.tasks,
              } as Partial<TState>,
              goto: bodyResult.goto,
              signals: bodyResult.signals,
            };
          }
        }

        iteration += 1;
        workingState = {
          ...loopState,
          iteration,
        };
      }

      return {
        stateUpdate: {
          tasks: workingState.tasks,
          iteration,
          maxIterationsReached: true,
          shouldContinue: false,
        } as Partial<TState>,
      };
    },
  };
}

export interface CriteriaLoopConfig<TState extends BaseState> {
  id?: NodeId;
  taskNodes: NodeDefinition<TState>[];
  completionSignal?: string;
  maxIterations?: number;
}

export function criteriaLoopNode<TState extends BaseState>(
  config: CriteriaLoopConfig<TState>,
): NodeDefinition<TState> {
  const {
    id = "criteriaLoop",
    taskNodes,
    completionSignal = "ALL_TASKS_COMPLETE",
    maxIterations = 100,
  } = config;

  return {
    id,
    type: "tool",
    name: "Criteria Loop",
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      let state = ctx.state;

      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        for (const node of taskNodes) {
          const result = await node.execute({ ...ctx, state });
          state = mergeStateUpdate(state, result.stateUpdate);

          const output = (state as Record<string, unknown>).lastOutput;
          if (typeof output === "string" && output.includes(completionSignal)) {
            return {
              stateUpdate: {
                ...result.stateUpdate,
                shouldContinue: false,
              } as unknown as Partial<TState>,
            };
          }

          if (result.goto || result.signals) {
            return {
              stateUpdate: result.stateUpdate,
              goto: result.goto,
              signals: result.signals,
            };
          }
        }
      }

      return {
        stateUpdate: {
          shouldContinue: false,
          maxIterationsReached: true,
        } as unknown as Partial<TState>,
      };
    },
  };
}
