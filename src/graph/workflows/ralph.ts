import { mkdir, rename, unlink } from "fs/promises";
import { join } from "path";
import {
  SessionDirSaver,
  agentNode,
  clearContextNode,
  graph,
  taskLoopNode,
  type AgentNodeAgentType,
  type CompiledGraph,
  type NodeDefinition,
  type NodeResult,
  type ExecutionContext,
} from "../index.ts";
import type { RalphWorkflowState } from "../annotation.ts";
import { getSubagentBridge } from "../subagent-bridge.ts";
import {
  buildFixSpecFromReview,
  buildReviewPrompt,
  buildSpecToTasksPrompt,
  buildWorkerAssignment,
  parseReviewResult,
  type TaskItem,
} from "../nodes/ralph.ts";
import {
  detectDeadlock,
  getReadyTasks,
  type DeadlockDiagnostic,
} from "../../ui/components/task-order.ts";
import type { TaskItem as DependencyTask } from "../../ui/components/task-list-indicator.tsx";

const MAX_IMPL_ITERATIONS = 100;
const MAX_REVIEW_ITERATIONS = 1;
const MAX_RETRIES = 3;
const MAX_DECOMPOSITION_RETRIES = 2;

function normalizeTaskId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function normalizeDependencyStatus(status: string): DependencyTask["status"] {
  const normalized = status.trim().toLowerCase();
  if (normalized === "in_progress") return "in_progress";
  if (normalized === "completed" || normalized === "complete" || normalized === "done") {
    return "completed";
  }
  if (normalized === "error" || normalized === "failed") return "error";
  return "pending";
}

function toDependencyTasks(tasks: TaskItem[]): DependencyTask[] {
  return tasks.map((task) => ({
    id: task.id,
    content: task.content,
    status: normalizeDependencyStatus(task.status),
    blockedBy: task.blockedBy,
  }));
}

function getReadyTasksForRalph(tasks: TaskItem[]): TaskItem[] {
  const ready = getReadyTasks(toDependencyTasks(tasks));
  const readyIds = new Set(
    ready
      .map((task) => task.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  return tasks.filter((task) => task.id && readyIds.has(task.id));
}

function detectDeadlockForRalph(tasks: TaskItem[]): DeadlockDiagnostic {
  return detectDeadlock(toDependencyTasks(tasks));
}

function hasActionableTasks(tasks: TaskItem[]): boolean {
  const completed = new Set(
    tasks
      .filter((task) => normalizeDependencyStatus(task.status) === "completed")
      .map((task) => task.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map((id) => normalizeTaskId(id)),
  );

  return tasks.some((task) => {
    const status = normalizeDependencyStatus(task.status);
    if (status === "in_progress") return true;
    if (status !== "pending") return false;

    const blockers = (task.blockedBy ?? [])
      .map((blockedId) => normalizeTaskId(blockedId))
      .filter((blockedId) => blockedId.length > 0);

    if (blockers.length === 0) return true;
    return blockers.every((blockedId) => completed.has(blockedId));
  });
}

function formatTaskCount(count: number): string {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

function buildImplementationMessage(tasks: TaskItem[]): string {
  const total = tasks.length;
  const completed = tasks.filter(
    (task) => normalizeDependencyStatus(task.status) === "completed",
  ).length;
  const errors = tasks.filter(
    (task) => normalizeDependencyStatus(task.status) === "error",
  ).length;

  if (errors > 0) {
    return `[Implementation] Completed ${completed}/${total} tasks with ${errors} error${errors === 1 ? "" : "s"}.`;
  }

  return `[Implementation] Completed ${completed}/${total} tasks.`;
}

function parseTasksFromContent(content: string): TaskItem[] {
  const trimmed = content.trim();
  let parsed: unknown = null;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return [];
  }

  const idPattern = /^#\d+$/;
  const statusValues = new Set(["pending", "in_progress", "completed"]);
  const seenIds = new Set<string>();

  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }

    const task = entry as Record<string, unknown>;
    if (typeof task.id !== "string" || !idPattern.test(task.id)) {
      return [];
    }
    if (seenIds.has(task.id)) {
      return [];
    }
    seenIds.add(task.id);

    if (typeof task.content !== "string" || task.content.trim().length === 0) {
      return [];
    }
    if (typeof task.activeForm !== "string" || task.activeForm.trim().length === 0) {
      return [];
    }
    if (typeof task.status !== "string" || !statusValues.has(task.status)) {
      return [];
    }

    if (task.blockedBy !== undefined) {
      if (!Array.isArray(task.blockedBy)) {
        return [];
      }
      if (
        task.blockedBy.some(
          (blockedId) =>
            typeof blockedId !== "string" || !idPattern.test(blockedId),
        )
      ) {
        return [];
      }
    }
  }

  return parsed as TaskItem[];
}

async function writeTasksJson(tasks: TaskItem[], sessionDir: string): Promise<void> {
  await mkdir(sessionDir, { recursive: true });
  const targetPath = join(sessionDir, "tasks.json");
  const tempPath = join(sessionDir, `.tasks-${crypto.randomUUID()}.tmp`);

  try {
    await Bun.write(tempPath, JSON.stringify(tasks, null, 2));
    await rename(tempPath, targetPath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup failure.
    }
    throw error;
  }
}

function stringifyTasks(tasks: TaskItem[]): string {
  return JSON.stringify(
    tasks.map((task) => ({
      id: task.id,
      content: task.content,
      status: task.status,
      activeForm: task.activeForm,
      blockedBy: task.blockedBy ?? [],
    })),
  );
}

async function dagOrchestratorExecute(
  ctx: ExecutionContext<RalphWorkflowState>,
): Promise<NodeResult<RalphWorkflowState>> {
  const bridge = getSubagentBridge();
  if (!bridge) {
    throw new Error("SubagentGraphBridge not initialized");
  }

  let tasks = [...ctx.state.tasks];
  const retryCount = new Map<string, number>();

  while (true) {
    if (tasks.every((task) => normalizeDependencyStatus(task.status) === "completed")) {
      break;
    }

    const diagnostic = detectDeadlockForRalph(tasks);
    if (diagnostic.type === "cycle") {
      return {
        stateUpdate: {
          tasks,
          shouldContinue: false,
        },
      };
    }

    if (diagnostic.type === "error_dependency") {
      const exhausted = diagnostic.errorDependencies.some((dependencyId) => {
        const retries = retryCount.get(dependencyId) ?? 0;
        return retries >= MAX_RETRIES;
      });

      if (exhausted) {
        return {
          stateUpdate: {
            tasks,
            shouldContinue: false,
          },
        };
      }

      const retryable = new Set(diagnostic.errorDependencies);
      tasks = tasks.map((task) => {
        const id = task.id ? normalizeTaskId(task.id) : "";
        if (retryable.has(id)) {
          return { ...task, status: "pending" };
        }
        return task;
      });

      for (const dependencyId of diagnostic.errorDependencies) {
        retryCount.set(dependencyId, (retryCount.get(dependencyId) ?? 0) + 1);
      }

      continue;
    }

    const readyTasks = getReadyTasksForRalph(tasks);
    if (readyTasks.length === 0) {
      break;
    }

    const readyIds = new Set(
      readyTasks
        .map((task) => task.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );

    tasks = tasks.map((task) => {
      if (task.id && readyIds.has(task.id)) {
        return { ...task, status: "in_progress" };
      }
      return task;
    });

    if (ctx.state.ralphSessionDir) {
      await writeTasksJson(tasks, ctx.state.ralphSessionDir);
    }

    const spawnOptions = readyTasks.map((task, index) => ({
      agentId: `worker-${task.id ?? index}`,
      agentName: "worker",
      task: buildWorkerAssignment(task, tasks),
    }));
    const results = await bridge.spawnParallel(spawnOptions);

    for (let index = 0; index < readyTasks.length; index += 1) {
      const task = readyTasks[index];
      const result = results[index];
      if (!task?.id) continue;

      tasks = tasks.map((candidate) => {
        if (candidate.id !== task.id) return candidate;
        return {
          ...candidate,
          status: result?.success ? "completed" : "error",
        };
      });
    }

    if (ctx.state.ralphSessionDir) {
      await writeTasksJson(tasks, ctx.state.ralphSessionDir);
    }
  }

  return {
    stateUpdate: {
      tasks,
      shouldContinue: hasActionableTasks(tasks),
      iteration: ctx.state.iteration + 1,
    },
  };
}

export interface RalphWorkflowOptions {
  agentType: AgentNodeAgentType;
}

export function createRalphWorkflow(
  options: RalphWorkflowOptions,
): CompiledGraph<RalphWorkflowState> {
  let lastTasksDigest = "";

  const initSessionNode: NodeDefinition<RalphWorkflowState> = {
    id: "initSession",
    type: "tool",
    name: "Initialize Ralph Session",
    phaseName: "Initialization",
    phaseIcon: "🚀",
    execute: async (ctx) => ({
      stateUpdate: {
        iteration: 0,
        reviewIteration: 0,
        decompositionRetryCount: 0,
        shouldContinue: true,
        fixSpec: ctx.state.fixSpec ?? "",
      },
      message: "[Initialization] Ralph workflow initialized.",
    }),
  };

  const dagOrchestratorNode: NodeDefinition<RalphWorkflowState> = {
    id: "dagOrchestrator",
    type: "tool",
    name: "DAG Worker Orchestrator",
    execute: dagOrchestratorExecute,
  };

  const prepareFixCycleNode: NodeDefinition<RalphWorkflowState> = {
    id: "prepareFixCycle",
    type: "tool",
    name: "Prepare Fix Cycle",
    phaseName: "Fix Cycle",
    phaseIcon: "🔁",
    execute: async (ctx) => ({
      stateUpdate: {
        reviewIteration: ctx.state.reviewIteration + 1,
        decompositionRetryCount: 0,
        iteration: 0,
        shouldContinue: false,
      },
      message: `[Fix Cycle] Starting fix cycle ${ctx.state.reviewIteration + 1}.`,
    }),
  };

  const reenterDecompositionNode: NodeDefinition<RalphWorkflowState> = {
    id: "reenterDecomposition",
    type: "tool",
    name: "Re-enter Decomposition",
    phaseName: "Fix Cycle",
    phaseIcon: "🔁",
    execute: async () => ({
      goto: "taskDecomposition",
      message: "[Fix Cycle] Returning to task decomposition.",
    }),
  };

  const completeNode: NodeDefinition<RalphWorkflowState> = {
    id: "complete",
    type: "tool",
    name: "Complete Workflow",
    phaseName: "Workflow",
    phaseIcon: "✓",
    execute: async () => ({
      stateUpdate: {
        shouldContinue: false,
        fixSpec: "",
      },
      message: "[Workflow] Ralph workflow completed.",
    }),
  };

  const reviewNode: NodeDefinition<RalphWorkflowState> = {
    id: "review",
    type: "agent",
    name: "Code Review",
    phaseName: "Code Review",
    phaseIcon: "🔍",
    execute: async (ctx) => {
      const bridge = getSubagentBridge();
      if (!bridge) {
        throw new Error("SubagentGraphBridge not initialized");
      }

      const result = await bridge.spawn({
        agentId: `review-${ctx.state.executionId}`,
        agentName: "reviewer",
        task: buildReviewPrompt(
          ctx.state.tasks,
          ctx.state.userPrompt || ctx.state.yoloPrompt || "",
        ),
      });

      if (!result.success) {
        throw new Error(result.error ?? "Reviewer failed");
      }

      const reviewResult = parseReviewResult(result.output);
      if (!reviewResult) {
        return {
          stateUpdate: {
            reviewResult: null,
            fixSpec: "",
            shouldContinue: false,
          },
          message: "[Code Review] Review completed, but no structured findings were parsed.",
        };
      }

      const fixSpec = buildFixSpecFromReview(
        reviewResult,
        ctx.state.tasks,
        ctx.state.userPrompt || ctx.state.yoloPrompt || "",
      );

      return {
        stateUpdate: {
          reviewResult,
          fixSpec,
          shouldContinue: fixSpec.trim().length > 0,
        },
        message: fixSpec.trim().length > 0
          ? `[Code Review] Found ${reviewResult.findings.length} actionable issue${reviewResult.findings.length === 1 ? "" : "s"}.`
          : "[Code Review] No actionable issues found.",
      };
    },
  };

  const ensureDecompositionTasksNode: NodeDefinition<RalphWorkflowState> = {
    id: "ensureDecompositionTasks",
    type: "tool",
    name: "Ensure Decomposition Tasks",
    phaseName: "Task Decomposition",
    phaseIcon: "📋",
    execute: async (ctx) => {
      const tasks = ctx.state.tasks ?? [];
      if (tasks.length > 0) {
        if (ctx.state.decompositionRetryCount === 0) {
          return {
            stateUpdate: {},
            message: `[Task Decomposition] Decomposed into ${formatTaskCount(tasks.length)}.`,
          };
        }
        return {
          stateUpdate: {
            decompositionRetryCount: 0,
          },
          message: `[Task Decomposition] Recovered with ${formatTaskCount(tasks.length)}.`,
        };
      }

      const retryCount = ctx.state.decompositionRetryCount ?? 0;
      if (retryCount < MAX_DECOMPOSITION_RETRIES) {
        return {
          stateUpdate: {
            decompositionRetryCount: retryCount + 1,
          },
          goto: "taskDecomposition",
          message: `[Task Decomposition] No valid tasks parsed; retrying (${retryCount + 2}/${MAX_DECOMPOSITION_RETRIES + 1}).`,
        };
      }

      throw new Error(
        `Task decomposition produced no valid tasks after ${MAX_DECOMPOSITION_RETRIES + 1} attempts.`,
      );
    },
  };

  const taskDecompositionBase = agentNode<RalphWorkflowState>({
    id: "taskDecomposition",
    name: "Task Decomposition",
    phaseName: "Task Decomposition",
    phaseIcon: "📋",
    agentType: options.agentType,
    buildMessage: (state) => {
      const prompt = state.fixSpec.trim().length > 0
        ? state.fixSpec
        : (state.userPrompt || state.yoloPrompt || "");
      return buildSpecToTasksPrompt(prompt);
    },
    outputMapper: (messages) => {
      const content = messages
        .map((message) =>
          typeof message.content === "string" ? message.content : "",
        )
        .join("");
      const tasks = parseTasksFromContent(content);

      return {
        tasks,
        taskIds: new Set(
          tasks
            .map((task) => task.id)
            .filter(
              (id): id is string => typeof id === "string" && id.length > 0,
            ),
        ),
        iteration: 0,
      };
    },
  });

  const taskDecompositionNode: NodeDefinition<RalphWorkflowState> = {
    ...taskDecompositionBase,
    execute: async (ctx) => {
      const result = await taskDecompositionBase.execute(ctx);
      const tasks = result.stateUpdate?.tasks ?? ctx.state.tasks;
      const count = tasks?.length ?? 0;

      return {
        ...result,
        message: `[Task Decomposition] Decomposed into ${formatTaskCount(count)}.`,
      };
    },
  };

  const implementationLoopBase = taskLoopNode<RalphWorkflowState>({
    id: "implementationLoop",
    phaseName: "Implementation",
    phaseIcon: "⚙",
    taskNodes: dagOrchestratorNode,
    detectDeadlocks: false,
    taskSelector: getReadyTasksForRalph,
    until: (_state, tasks) =>
      (tasks.length > 0 &&
        tasks.every(
          (task) => normalizeDependencyStatus(task.status) === "completed",
        )) ||
      !hasActionableTasks(tasks),
    maxIterations: MAX_IMPL_ITERATIONS,
  });

  const implementationLoopNode: NodeDefinition<RalphWorkflowState> = {
    ...implementationLoopBase,
    execute: async (ctx) => {
      const result = await implementationLoopBase.execute(ctx);
      const tasks = result.stateUpdate?.tasks ?? ctx.state.tasks ?? [];

      return {
        ...result,
        message: buildImplementationMessage(tasks),
      };
    },
  };

  const clearBeforeReviewBase = clearContextNode<RalphWorkflowState>({
    id: "clearBeforeReview",
    name: "Clear Context Before Review",
    phaseName: "Context Management",
    phaseIcon: "🧹",
    message: "Clearing context before review phase",
  });

  const clearBeforeReviewNode: NodeDefinition<RalphWorkflowState> = {
    ...clearBeforeReviewBase,
    execute: async (ctx) => ({
      ...(await clearBeforeReviewBase.execute(ctx)),
      message: "[Context Management] Clearing context before review phase.",
    }),
  };

  return graph<RalphWorkflowState>()
    .start(initSessionNode)
    .then(taskDecompositionNode)
    .then(ensureDecompositionTasksNode)
    .then(implementationLoopNode)
    .then(clearBeforeReviewNode)
    .then(reviewNode)
    .if(
      (state) =>
        state.shouldContinue && state.reviewIteration < MAX_REVIEW_ITERATIONS,
    )
    .then(prepareFixCycleNode)
    .then(reenterDecompositionNode)
    .else()
    .then(completeNode)
    .endif()
    .end()
    .compile({
      checkpointer: new SessionDirSaver<RalphWorkflowState>(
        (state) => state.ralphSessionDir,
      ),
      autoCheckpoint: true,
      onProgress: (event) => {
        if (event.type !== "node_completed") return;

        const tasks = event.state.tasks ?? [];
        if (tasks.length === 0 || !event.state.ralphSessionDir) return;

        const digest = stringifyTasks(tasks);
        if (digest === lastTasksDigest) return;

        lastTasksDigest = digest;
        void writeTasksJson(tasks, event.state.ralphSessionDir).catch((error) => {
          console.error("[ralph-workflow] failed to persist tasks.json:", error);
        });
      },
    });
}
