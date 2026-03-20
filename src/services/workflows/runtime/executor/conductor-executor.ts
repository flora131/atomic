/**
 * Conductor-based workflow executor.
 *
 * Replaces the legacy `executeWorkflow()` + `streamGraph()` path for workflows
 * that declare `conductorStages`. Uses `WorkflowSessionConductor` to sequence
 * isolated agent sessions per stage, threading context forward via `StageOutput`
 * records.
 *
 * The conductor executor handles:
 * 1. Session initialization (reuses `initializeWorkflowExecutionSession`)
 * 2. Graph compilation (from `definition.createGraph()`)
 * 3. `ConductorConfig` construction (session lifecycle, UI callbacks)
 * 4. Conductor execution with stage definitions
 * 5. Result mapping to `CommandResult`
 */

import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types.ts";
import type { WorkflowDefinition } from "@/services/workflows/workflow-types.ts";
import type { CommandContext, CommandResult } from "@/types/command.ts";
import type { ConductorConfig } from "@/services/workflows/conductor/types.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { TaskItem } from "@/services/workflows/ralph/prompts.ts";
import { normalizeWorkflowRuntimeTaskStatus } from "@/services/workflows/runtime-contracts.ts";
import { WorkflowSessionConductor } from "@/services/workflows/conductor/conductor.ts";
import { pipelineLog, pipelineError } from "@/services/events/pipeline-logger.ts";
import {
  incrementRuntimeParityCounter,
  runtimeParityDebug,
} from "@/services/workflows/runtime-parity-observability.ts";
import { createDefaultPartsCompactionConfig } from "@/state/parts/compaction.ts";
import { initializeWorkflowExecutionSession } from "./session-runtime.ts";
import { compileGraphConfig } from "./graph-helpers.ts";

/**
 * Execute a workflow using the WorkflowSessionConductor.
 *
 * This function replaces `executeWorkflow()` for definitions that include
 * `conductorStages`. Each "agent" node in the compiled graph runs as an
 * isolated session stage, while "tool" and "decision" nodes execute
 * deterministically via their `execute` functions.
 *
 * @param definition - Workflow definition with `conductorStages` populated
 * @param prompt - User's prompt text
 * @param context - TUI CommandContext for UI updates and session creation
 * @param options - Optional abort signal and task persistence callback
 */
export async function executeConductorWorkflow(
  definition: WorkflowDefinition,
  prompt: string,
  context: CommandContext,
  options?: {
    saveTasksToSession?: (tasks: NormalizedTodoItem[], sessionId: string) => Promise<void>;
    abortSignal?: AbortSignal;
    maxIterations?: number;
  },
): Promise<CommandResult> {
  const stages = definition.conductorStages;
  if (!stages || stages.length === 0) {
    return {
      success: false,
      message: `Workflow "${definition.name}" has no conductor stages defined.`,
    };
  }

  if (!context.createAgentSession) {
    return {
      success: false,
      message: "Cannot execute conductor workflow: session creation capability is not available.",
    };
  }

  const {
    sessionDir,
    sessionId,
    workflowRunId,
  } = initializeWorkflowExecutionSession({
    context,
    definition,
    prompt,
  });

  pipelineLog("Workflow", "start", { workflow: definition.name, sessionId, executor: "conductor" });
  incrementRuntimeParityCounter("workflow.runtime.parity.execution_total", {
    phase: "start",
    workflow: definition.name,
  });

  try {
    context.addMessage(
      "assistant",
      `Starting **${definition.name}** workflow with prompt: "${prompt}"`,
    );

    // Phase 1: Compile graph — prefer conductor-specific graph
    let compiled: CompiledGraph<BaseState>;
    if (definition.createConductorGraph) {
      compiled = definition.createConductorGraph();
    } else if (definition.createGraph) {
      compiled = definition.createGraph();
    } else if (definition.graphConfig) {
      compiled = compileGraphConfig(definition.graphConfig);
    } else {
      context.setStreaming(false);
      return {
        success: false,
        message: `Workflow "${definition.name}" has no createGraph or graphConfig.`,
        stateUpdate: {
          workflowActive: false,
          workflowType: null,
          initialPrompt: null,
        },
      };
    }

    // Phase 2: Set up abort signal
    const abortController = new AbortController();
    const workflowAbortSignal = options?.abortSignal ?? abortController.signal;

    // Phase 3: Build ConductorConfig
    const createSession = context.createAgentSession;
    const nodeDescriptions = definition.nodeDescriptions;

    const conductorConfig: ConductorConfig = {
      graph: compiled,

      createSession: async (sessionConfig) => {
        return createSession(sessionConfig);
      },

      destroySession: async (session) => {
        await session.destroy();
      },

      onStageTransition: (from, to) => {
        const stage = stages.find((s) => s.id === to);
        const indicator = stage?.indicator ?? to;
        const description = nodeDescriptions?.[to];

        context.updateWorkflowState({
          workflowConfig: {
            userPrompt: prompt,
            sessionId,
            workflowName: definition.name,
          },
        });

        if (description) {
          context.addMessage("assistant", description);
        }

        pipelineLog("Workflow", "stage_transition", {
          workflow: definition.name,
          from: from ?? "start",
          to,
          indicator,
        });
      },

      onTaskUpdate: (tasks: TaskItem[]) => {
        // Update UI task list
        if (context.updateTaskList && tasks.length > 0) {
          const formattedTasks = tasks.map((task) => ({
            id: task.id ?? "",
            title: task.description,
            status: normalizeWorkflowRuntimeTaskStatus(task.status),
            ...(task.blockedBy ? { blockedBy: task.blockedBy } : {}),
          }));
          context.updateTaskList(formattedTasks);
        }

        // Persist tasks to session
        if (options?.saveTasksToSession && tasks.length > 0) {
          const normalized: NormalizedTodoItem[] = tasks.map((task) => ({
            id: task.id ?? "",
            description: task.description,
            status: task.status as NormalizedTodoItem["status"],
            summary: task.summary,
            blockedBy: task.blockedBy,
          }));
          void options.saveTasksToSession(normalized, sessionId);
        }

        // Track session info on first task update
        context.setWorkflowSessionDir(sessionDir);
        context.setWorkflowSessionId(sessionId);
        const taskIds = new Set<string>(
          tasks
            .map((t) => t.id)
            .filter((id): id is string => id != null && id.length > 0),
        );
        context.setWorkflowTaskIds(taskIds);
      },

      abortSignal: workflowAbortSignal,

      maxIterations: options?.maxIterations,

      // --- Bus event dispatch (enables workflow.step.start / workflow.step.complete) ---
      dispatchEvent: context.eventBus
        ? (event) => context.eventBus!.publish(event)
        : undefined,
      workflowId: definition.name ?? "ralph",
      sessionId,
      runId: workflowRunId,

      // --- Parts compaction (reclaims memory on stage completion) ---
      partsCompaction: createDefaultPartsCompactionConfig(),

      // TODO: Wire contextPressure config once session.getContextUsage() is available
      // on sessions created via context.createAgentSession
    };

    // Phase 4: Execute via conductor
    const conductor = new WorkflowSessionConductor(conductorConfig, stages);
    const result = await conductor.execute(prompt);

    // Phase 5: Report result
    context.setStreaming(false);

    if (workflowAbortSignal.aborted) {
      // Silent exit for workflow cancellation
      return {
        success: true,
        stateUpdate: {
          workflowActive: false,
          workflowType: null,
          initialPrompt: null,
        },
      };
    }

    if (!result.success) {
      // Find the failing stage for error reporting
      const failedStage = [...result.stageOutputs.values()].find(
        (output) => output.status === "error",
      );
      const errorDetail = failedStage?.error ? `: ${failedStage.error}` : "";
      const failedStageId = failedStage?.stageId ?? "unknown";
      const failureMessage = `Workflow failed at stage "${failedStageId}"${errorDetail}`;

      context.addMessage("system", failureMessage);
      pipelineError("Workflow", "execution_failed", {
        workflow: definition.name,
        stageId: failedStageId,
        error: failedStage?.error,
      });
      incrementRuntimeParityCounter("workflow.runtime.parity.execution_total", {
        phase: "failure",
        workflow: definition.name,
      });
      runtimeParityDebug("workflow_execution_failed", {
        workflow: definition.name,
        sessionId,
        workflowRunId,
        stageId: failedStageId,
        error: failedStage?.error,
      });

      return {
        success: false,
        stateUpdate: {
          workflowActive: false,
          workflowType: null,
          initialPrompt: null,
        },
      };
    }

    context.addMessage(
      "assistant",
      `**${definition.name}** workflow completed successfully.`,
    );
    pipelineLog("Workflow", "complete", { workflow: definition.name, sessionId });
    incrementRuntimeParityCounter("workflow.runtime.parity.execution_total", {
      phase: "success",
      workflow: definition.name,
    });

    return {
      success: true,
      stateUpdate: {
        workflowActive: false,
        workflowType: null,
        initialPrompt: null,
      },
    };
  } catch (error) {
    context.setStreaming(false);

    // Silent exit for workflow cancellation
    if (error instanceof Error && error.message === "Workflow cancelled") {
      return {
        success: true,
        stateUpdate: {
          workflowActive: false,
          workflowType: null,
          initialPrompt: null,
        },
      };
    }

    const errorMessage = `Workflow failed: ${error instanceof Error ? error.message : String(error)}`;
    context.addMessage("system", errorMessage);
    pipelineError("Workflow", "execution_error", {
      workflow: definition.name,
      error: error instanceof Error ? error.message : String(error),
    });
    incrementRuntimeParityCounter("workflow.runtime.parity.execution_total", {
      phase: "failure",
      workflow: definition.name,
    });
    runtimeParityDebug("workflow_execution_failed", {
      workflow: definition.name,
      sessionId,
      workflowRunId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      stateUpdate: {
        workflowActive: false,
        workflowType: null,
        initialPrompt: null,
      },
    };
  }
}
