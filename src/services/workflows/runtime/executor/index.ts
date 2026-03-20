/**
 * Generic workflow executor that replaces both createRalphCommand() and WorkflowSDK.
 * Handles graph compilation, session initialization, state construction,
 * bridge/registry setup, graph streaming with progress, and error handling.
 */

import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types.ts";
import { type WorkflowDefinition } from "@/services/workflows/workflow-types.ts";
import type { CommandContext, CommandResult } from "@/types/command.ts";
import { streamGraph } from "@/services/workflows/graph/compiled.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import {
    resolveWorkflowRuntimeFeatureFlags,
    toWorkflowRuntimeTask,
    toWorkflowRuntimeTasks,
    workflowRuntimeStrictTaskSchema,
    type WorkflowRuntimeFeatureFlagOverrides,
    type WorkflowRuntimeTask,
    type WorkflowRuntimeTaskStatus,
} from "@/services/workflows/runtime-contracts.ts";
import { TaskIdentityService } from "@/services/workflows/task-identity-service.ts";
import {
    incrementRuntimeParityCounter,
    runtimeParityDebug,
} from "@/services/workflows/runtime-parity-observability.ts";
import { pipelineLog, pipelineError } from "@/services/events/pipeline-logger.ts";
import {
    compileGraphConfig,
    createSubagentRegistry,
} from "./graph-helpers.ts";

/** Workflow sub-agents get a longer stale timeout (20 min) than the global default (5 min). */
const WORKFLOW_STALE_TIMEOUT_MS = 20 * 60 * 1000;
import { initializeWorkflowExecutionSession } from "./session-runtime.ts";
import { createWorkflowTaskPersistence } from "./task-persistence.ts";

/**
 * Result of a workflow execution.
 */
export interface WorkflowExecutionResult {
    success: boolean;
    message?: string;
    error?: Error;
}

export {
    compileGraphConfig,
    createSubagentRegistry,
    inferHasSubagentNodes,
    inferHasTaskList,
} from "./graph-helpers.ts";

/** Default max iterations for workflows */
const DEFAULT_MAX_ITERATIONS = 100;

/**
 * Generic workflow executor that encapsulates the full execution lifecycle.
 * Replaces the ~200-line createRalphCommand() with a reusable function.
 *
 * Handles: session init, state creation, graph compilation, bridge/registry
 * setup, streaming with progress updates, task list sync, and error handling.
 *
 * @param definition - The workflow definition with metadata + execution config
 * @param prompt - User's prompt text
 * @param context - TUI CommandContext for UI updates
 * @param options - Optional pre-compiled graph (for builder-pattern workflows like Ralph)
 */
export async function executeWorkflow(
    definition: WorkflowDefinition,
    prompt: string,
    context: CommandContext,
    options?: {
        compiledGraph?: CompiledGraph<BaseState>;
        saveTasksToSession?: (tasks: NormalizedTodoItem[], sessionId: string) => Promise<void>;
        featureFlags?: WorkflowRuntimeFeatureFlagOverrides;
        abortSignal?: AbortSignal;
    },
): Promise<CommandResult> {
    const {
        sessionDir,
        sessionId,
        workflowRunId,
    } = initializeWorkflowExecutionSession({
        context,
        definition,
        prompt,
    });

    pipelineLog("Workflow", "start", { workflow: definition.name, sessionId });
    incrementRuntimeParityCounter("workflow.runtime.parity.execution_total", {
        phase: "start",
        workflow: definition.name,
    });

    try {
        context.addMessage(
            "assistant",
            `Starting **${definition.name}** workflow with prompt: "${prompt}"`,
        );

        // Phase 2: Determine compiled graph
        let compiled: CompiledGraph<BaseState>;
        if (options?.compiledGraph) {
            compiled = options.compiledGraph;
        } else if (definition.createGraph) {
            compiled = definition.createGraph();
        } else if (definition.graphConfig) {
            compiled = compileGraphConfig(definition.graphConfig);
        } else {
            context.setStreaming(false);
            return {
                success: false,
                message: `Workflow "${definition.name}" has no createGraph, graphConfig, or pre-compiled graph.`,
                stateUpdate: {
                    workflowActive: false,
                    workflowType: null,
                    initialPrompt: null,
                },
            };
        }

        // Phase 3: Create initial state
        const maxIterations = definition.graphConfig?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
        const initialState = definition.createState
            ? definition.createState({ prompt, sessionId, sessionDir, maxIterations })
            : ({ executionId: sessionId, lastUpdated: new Date().toISOString(), outputs: {} } as BaseState);

        const runtimeFeatureFlags = resolveWorkflowRuntimeFeatureFlags(
            definition.runtime?.featureFlags,
            options?.featureFlags,
        );
        const taskIdentity = new TaskIdentityService();
        const workflowAbortSignal = options?.abortSignal ?? new AbortController().signal;

        const toRuntimeTask = (task: unknown): WorkflowRuntimeTask => {
            const normalized = toWorkflowRuntimeTask(task, () => crypto.randomUUID());
            const withIdentity = taskIdentity.backfillTask(normalized);
            return workflowRuntimeStrictTaskSchema.parse(withIdentity);
        };

        const toRuntimeTasks = (tasks: unknown): WorkflowRuntimeTask[] => {
            const normalized = toWorkflowRuntimeTasks(tasks, () => crypto.randomUUID());
            const strictTasks = normalized.map((task) => workflowRuntimeStrictTaskSchema.parse(task));
            return taskIdentity.backfillTasks(strictTasks);
        };

        // Phase 4: Registry setup — pass TUI's spawnSubagentParallel directly
        const registry = createSubagentRegistry();
        const spawnFn = context.spawnSubagentParallel;
        if (!spawnFn) {
            throw new Error("spawnSubagentParallel is not available on CommandContext.");
        }

        compiled.config.runtime = {
            ...compiled.config.runtime,
            featureFlags: runtimeFeatureFlags,
            spawnSubagent: async (agent, abortSignal) => {
                const effectiveAbortSignal = agent.abortSignal ?? abortSignal ?? workflowAbortSignal;

                const [result] = await spawnFn(
                    [{ ...agent, staleTimeoutMs: agent.staleTimeoutMs ?? WORKFLOW_STALE_TIMEOUT_MS, abortSignal: effectiveAbortSignal }],
                    effectiveAbortSignal,
                );
                if (!result) throw new Error("Subagent spawn returned no results");

                return result;
            },
            spawnSubagentParallel: async (agents, abortSignal, onAgentComplete) => {
                const effectiveAbortSignal = abortSignal ?? workflowAbortSignal;

                const results = await spawnFn(
                    agents.map((agent) => ({
                        ...agent,
                        staleTimeoutMs: agent.staleTimeoutMs ?? WORKFLOW_STALE_TIMEOUT_MS,
                        abortSignal: agent.abortSignal ?? effectiveAbortSignal,
                    })),
                    effectiveAbortSignal,
                    onAgentComplete,
                );

                return results;
            },
            taskIdentity,
            subagentRegistry: registry,
            notifyTaskStatusChange: runtimeFeatureFlags.emitTaskStatusEvents
                ? (
                    taskIds: string[],
                    newStatus: WorkflowRuntimeTaskStatus,
                    tasks: WorkflowRuntimeTask[],
                ) => {
                    context.onTaskStatusChange?.(taskIds, newStatus, tasks.map(toRuntimeTask));
                }
                : undefined,
        };

        // Phase 5: Stream graph execution with progress
        let sessionTracked = false;
        let lastNodeId: string | null = null;
        let _lastNodeCompletionStatus: "success" | "error" | "skipped" = "success";
        let lastStepStatus: string | null = null;
        let lastStepError: string | undefined;
        const nodeDescriptions = definition.nodeDescriptions;
        const mapStepStatusToCompletionStatus = (
            stepStatus: string,
        ): "success" | "error" | "skipped" => {
            switch (stepStatus) {
                case "failed":
                    return "error";
                case "cancelled":
                case "paused":
                    return "skipped";
                default:
                    return "success";
            }
        };

        const taskPersistence = createWorkflowTaskPersistence({
            sessionId,
            workflowRunId,
            workflowName: definition.name,
            saveTasksToSession: options?.saveTasksToSession,
            toRuntimeTasks,
            persistTaskStatusEvents: runtimeFeatureFlags.persistTaskStatusEvents,
        });

        // Wire onTaskStatusChange on context to the persistence handler
        context.onTaskStatusChange = (taskIds, newStatus, tasks) => {
            taskPersistence.handleTaskStatusChange(taskIds, newStatus, tasks);
        };

        for await (const step of streamGraph(compiled, { initialState, abortSignal: workflowAbortSignal })) {
            const currentCompletionStatus = mapStepStatusToCompletionStatus(step.status);

            // Track step status for failure detection
            lastStepStatus = step.status;
            lastStepError = step.error?.error instanceof Error ? step.error.error.message : step.error?.error;

            // Show progress for node transitions
            if (step.nodeId !== lastNodeId) {
                const _description = nodeDescriptions?.[step.nodeId];
                
                // Publish step complete event for previous node (if any)
                // (Step events are informational only — no bus events needed)
                
                lastNodeId = step.nodeId;
            }

            _lastNodeCompletionStatus = currentCompletionStatus;

            // Sync task list to UI and session
            const state = step.state as BaseState & {
                tasks?: Array<{
                    id?: string;
                    description: string;
                    status: string;
                    summary: string;
                    blockedBy?: string[];
                    identity?: WorkflowRuntimeTask["identity"];
                    taskResult?: WorkflowRuntimeTask["taskResult"];
                }>;
            };
            if (state.tasks && state.tasks.length > 0) {
                if (options?.saveTasksToSession) {
                    taskPersistence.saveTasks(
                        state.tasks as NormalizedTodoItem[],
                    );
                }

                // Directly update task list in the streaming message
                const formattedTasks = toRuntimeTasks(
                    state.tasks.map((task) => ({
                        id: task.id,
                        title: task.description,
                        status: task.status,
                        blockedBy: task.blockedBy,
                        identity: task.identity,
                        taskResult: task.taskResult,
                    })),
                );
                context.updateTaskList?.(formattedTasks);

                if (!sessionTracked) {
                    context.setWorkflowSessionDir(sessionDir);
                    context.setWorkflowSessionId(sessionId);
                    const taskIds = new Set<string>(
                        state.tasks
                            .map((t) => t.id)
                            .filter(
                                (id): id is string =>
                                    id != null && id.length > 0,
                            ),
                    );
                    context.setWorkflowTaskIds(taskIds);
                    sessionTracked = true;
                }
            }
        }
        
        // Flush any pending debounced save
        await taskPersistence.flush();

        // Clear onTaskStatusChange handler
        context.onTaskStatusChange = undefined;

        // Phase 6: Check execution status and report result
        context.setStreaming(false);

        // Silent exit for workflow cancellation (e.g., double Ctrl+C).
        // Cancellation can surface as status "cancelled" (via AbortSignal) or
        // status "failed" with "Workflow cancelled" error (thrown by node).
        if (lastStepStatus === "cancelled" ||
            (lastStepStatus === "failed" && lastStepError === "Workflow cancelled")) {
            return {
                success: true,
                stateUpdate: {
                    workflowActive: false,
                    workflowType: null,
                    initialPrompt: null,
                },
            };
        }

        if (lastStepStatus === "failed") {
            const errorDetail = lastStepError ? `: ${lastStepError}` : "";
            const failureMessage = `Workflow failed at node "${lastNodeId ?? "unknown"}"${errorDetail}`;
            context.addMessage("system", failureMessage);
            pipelineError("Workflow", "execution_failed", { workflow: definition.name, nodeId: lastNodeId ?? "unknown", error: lastStepError });
            incrementRuntimeParityCounter("workflow.runtime.parity.execution_total", {
                phase: "failure",
                workflow: definition.name,
            });
            runtimeParityDebug("workflow_execution_failed", {
                workflow: definition.name,
                sessionId,
                workflowRunId,
                nodeId: lastNodeId,
                error: lastStepError,
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
        context.onTaskStatusChange = undefined;
        context.setStreaming(false);

        // Silent exit for workflow cancellation (double Ctrl+C)
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
        pipelineError("Workflow", "execution_error", { workflow: definition.name, error: error instanceof Error ? error.message : String(error) });
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
