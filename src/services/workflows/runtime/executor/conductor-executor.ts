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
 * 2. Graph compilation (from `definition.createConductorGraph()`)
 * 3. `ConductorConfig` construction (session lifecycle, UI callbacks)
 * 4. Conductor execution with stage definitions
 * 5. Result mapping to `CommandResult`
 */

import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types.ts";
import type { WorkflowDefinition } from "@/services/workflows/types/index.ts";
import type { CommandContext, CommandResult } from "@/types/command.ts";
import type { ConductorConfig } from "@/services/workflows/conductor/types.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { TaskItem } from "@/services/workflows/builtin/ralph/helpers/prompts.ts";
import type { BusEvent } from "@/services/events/bus-events/types.ts";

import { WorkflowSessionConductor } from "@/services/workflows/conductor/conductor.ts";
import { pipelineLog, pipelineError } from "@/services/events/pipeline-logger.ts";
import {
  incrementRuntimeParityCounter,
  runtimeParityDebug,
} from "@/services/workflows/runtime-parity-observability.ts";
import { createDefaultPartsTruncationConfig } from "@/state/parts/truncation.ts";
import { createTaskUpdatePublisher } from "@/services/workflows/conductor/event-bridge.ts";
import { createTaskListTool, type TaskListTool } from "@/services/agents/tools/task-list.ts";
import { initializeWorkflowExecutionSession } from "./session-runtime.ts";

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
    // Phase 1: Compile graph
    if (!definition.createConductorGraph) {
      context.setStreaming(false);
      return {
        success: false,
        message: `Workflow "${definition.name}" has no createConductorGraph.`,
        stateUpdate: {
          workflowActive: false,
          workflowType: null,
          initialPrompt: null,
        },
      };
    }
    const compiled: CompiledGraph<BaseState> = definition.createConductorGraph();

    // Phase 2: Set up abort signal
    const abortController = new AbortController();
    const workflowAbortSignal = options?.abortSignal ?? abortController.signal;

    // Phase 3: Build ConductorConfig
    const createSession = context.createAgentSession;

    // Create bus publisher for workflow.task.update events (§5.6)
    const publishTaskUpdate = context.eventBus
      ? createTaskUpdatePublisher(context.eventBus, sessionId, workflowRunId)
      : undefined;

    // Create and register the task_list tool for this workflow session (§5.7).
    // The tool is backed by a session-scoped SQLite database and emits
    // workflow.tasks.updated events for real-time UI updates.
    // Wrapped in try/catch so that SQLite initialization failures (e.g., missing
    // session directory in tests) do not prevent the workflow from executing.
    let taskListTool: TaskListTool | undefined;
    try {
      taskListTool = createTaskListTool({
        workflowName: definition.name,
        sessionId,
        sessionDir,
        emitTaskUpdate: (tasks) => {
          if (context.eventBus) {
            const event: BusEvent<"workflow.tasks.updated"> = {
              type: "workflow.tasks.updated",
              sessionId,
              runId: workflowRunId,
              timestamp: Date.now(),
              data: {
                sessionId,
                tasks: tasks.map((t) => ({
                  id: t.id,
                  description: t.description,
                  status: t.status,
                  summary: t.summary,
                  ...(t.blockedBy && t.blockedBy.length > 0 ? { blockedBy: t.blockedBy } : {}),
                })),
              },
            };
            context.eventBus.publish(event);
          }
        },
      });
      context.registerTool?.(taskListTool);
    } catch {
      // task_list tool registration is best-effort. If the session directory
      // does not exist yet (e.g., in test environments with mocked session-runtime),
      // the SQLite database cannot be created and we silently skip registration.
      // The workflow continues without the task_list tool.
    }

    const conductorConfig: ConductorConfig = {
      graph: compiled,
      agentType: context.agentType,

      createSession: async (sessionConfig) => {
        return createSession(sessionConfig);
      },

      streamSession: context.streamWithSession,

      destroySession: async (session) => {
        await session.destroy();
      },

      onStageTransition: (from, to, options) => {
        // On resume, skip the stage banner update — the UI already shows
        // the correct stage indicator from the initial transition.
        if (!options?.isResume) {
          const stage = stages.find((s) => s.id === to);
          const indicator = stage?.indicator ?? to;
          const stageIndex = stages.findIndex((s) => s.id === to);
          const stageIndicator = stageIndex >= 0
            ? `Stage ${stageIndex + 1}/${stages.length}: ${indicator}`
            : indicator;

          context.updateWorkflowState({
            currentStage: to,
            stageIndicator,
            workflowConfig: {
              userPrompt: prompt,
              sessionId,
              workflowName: definition.name,
            },
          });
        }

        // Re-enable streaming for this stage.  The previous stage's
        // stream.session.idle handler calls handleStreamComplete() which sets
        // isStreamingRef=false.  We must restore it before addMessage so the
        // new message is created as a streaming target.
        context.setStreaming(true);

        // Always add a new assistant message — even on resume.  The previous
        // streaming message was already finalized (streaming=false,
        // wasInterrupted=true) by interruptStreaming().  Without a new message,
        // streamingMessageIdRef stays null, causing text deltas to have no
        // target and handleStreamComplete() to return early (breaking the
        // entire stream lifecycle).  The stage banner is already suppressed
        // above via the updateWorkflowState guard.
        context.addMessage("assistant", "");

        pipelineLog("Workflow", "stage_transition", {
          workflow: definition.name,
          from: from ?? "start",
          to,
          indicator: options?.isResume ? "(resume)" : undefined,
        });
      },

      onTaskUpdate: (tasks: TaskItem[]) => {
        // Publish workflow.task.update event to the bus — this is the sole update
        // path so that task-list parts are ordered correctly relative to thinking
        // and text deltas flowing through the same batched pipeline.
        if (publishTaskUpdate && tasks.length > 0) {
          publishTaskUpdate(tasks);
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

      // --- Bus event dispatch (enables workflow.step.start / workflow.step.complete) ---
      dispatchEvent: context.eventBus
        ? (event) => context.eventBus!.publish(event)
        : undefined,
      workflowId: definition.name ?? "ralph",
      sessionId,
      runId: workflowRunId,

      // --- Parts truncation (reclaims memory on stage completion) ---
      partsTruncation: createDefaultPartsTruncationConfig(),

      // --- Interrupt & Queue Integration (enables pause/resume on interrupt) ---
      checkQueuedMessage: context.dequeueMessage ?? undefined,
      waitForResumeInput: async () => {
        try {
          return await context.waitForUserInput();
        } catch {
          // Rejection means workflow cancelled (double Ctrl+C)
          throw new Error("Workflow cancelled");
        }
      },

      // Re-enable streaming before each queued message in the drain loop.
      // The previous stream's session.idle already stopped the TUI's stream
      // state; this restores it so the queued message's events bind correctly.
      onBeforeQueuedStream: () => {
        context.setStreaming(true);
        context.addMessage("assistant", "");
      },

      // State factory — uses definition.createState when available so that
      // user-declared globalState defaults are initialized in the conductor state.
      createState: definition.createState
        ? (params) => definition.createState!({ ...params, prompt, sessionDir })
        : undefined,

      // Context pressure monitoring — opt-in via definition.contextPressure.
      // Sessions created by context.createAgentSession implement getContextUsage(),
      // which the conductor calls via takeContextSnapshot() after each stage stream.
      contextPressure: definition.contextPressure,
    };

    // Phase 4: Execute via conductor
    const conductor = new WorkflowSessionConductor(conductorConfig, stages);

    // Register conductor.interrupt() so the keyboard layer can abort the current stage (§5.5)
    context.registerConductorInterrupt?.(conductor.interrupt.bind(conductor));
    // Register conductor.resume() so the keyboard/queue layer can resume paused stages
    context.registerConductorResume?.(conductor.resume.bind(conductor));
    let result;
    try {
      result = await conductor.execute(prompt);
    } finally {
      // Always deregister the conductor interrupt and resume when execution completes or fails
      context.registerConductorInterrupt?.(null);
      context.registerConductorResume?.(null);
      // Close the task_list tool's SQLite connection to prevent resource leaks
      taskListTool?.close();
    }

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
