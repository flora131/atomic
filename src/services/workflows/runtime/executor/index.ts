/**
 * Generic workflow executor that replaces both createRalphCommand() and WorkflowSDK.
 * Handles graph compilation, session initialization, state construction,
 * bridge/registry setup, graph streaming with progress, and error handling.
 */

import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types.ts";
import { type WorkflowDefinition } from "@/commands/tui/workflow-commands.ts";
import type { CommandContext, CommandResult } from "@/commands/tui/registry.ts";
import { streamGraph } from "@/services/workflows/graph/compiled.ts";
import type { NormalizedTodoItem } from "@/lib/ui/task-status.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import {
    resolveWorkflowRuntimeFeatureFlags,
    toWorkflowRuntimeTask,
    toWorkflowRuntimeTasks,
    workflowRuntimeStrictTaskSchema,
    type WorkflowRuntimeFeatureFlagOverrides,
    type WorkflowRuntimeTask,
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
        eventBus?: EventBus;
        featureFlags?: WorkflowRuntimeFeatureFlagOverrides;
        abortSignal?: AbortSignal;
    },
): Promise<CommandResult> {
    const {
        eventAdapter,
        sessionDir,
        sessionId,
        workflowRunId,
    } = initializeWorkflowExecutionSession({
        context,
        definition,
        eventBus: options?.eventBus,
        prompt,
    });

    let unsubscribeStatusChange: (() => void) | undefined;
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
        } else if (definition.graphConfig) {
            compiled = compileGraphConfig(definition.graphConfig);
        } else {
            context.setStreaming(false);
            return {
                success: false,
                message: `Workflow "${definition.name}" has no graphConfig or pre-compiled graph.`,
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
                // Publish agent start event if adapter is available
                if (eventAdapter) {
                    eventAdapter.publishAgentStart(
                        agent.agentId,
                        agent.agentName,
                        agent.task,
                        true, // Single workflow spawns also run as background agents
                    );
                }

                const [result] = await spawnFn(
                    [{ ...agent, abortSignal: effectiveAbortSignal }],
                    effectiveAbortSignal,
                );
                if (!result) throw new Error("Subagent spawn returned no results");

                // Publish agent complete event if adapter is available
                if (eventAdapter) {
                    eventAdapter.publishAgentComplete(
                        agent.agentId,
                        result.success,
                        result.output,
                        result.error,
                    );
                }

                return result;
            },
            spawnSubagentParallel: async (agents, abortSignal) => {
                const effectiveAbortSignal = abortSignal ?? workflowAbortSignal;
                // Publish agent start events for all agents if adapter is available
                if (eventAdapter) {
                    for (const agent of agents) {
                        eventAdapter.publishAgentStart(
                            agent.agentId,
                            agent.agentName,
                            agent.task,
                            true, // isBackground = true for parallel agent spawn
                        );
                    }
                }

                const results = await spawnFn(
                    agents.map((agent) => ({
                        ...agent,
                        abortSignal: agent.abortSignal ?? effectiveAbortSignal,
                    })),
                    effectiveAbortSignal,
                );

                // Publish agent complete events for all agents if adapter is available
                if (eventAdapter) {
                    for (const result of results) {
                        eventAdapter.publishAgentComplete(
                            result.agentId,
                            result.success,
                            result.output,
                            result.error,
                        );
                    }
                }

                return results;
            },
            taskIdentity,
            subagentRegistry: registry,
            notifyTaskStatusChange: options?.eventBus && runtimeFeatureFlags.emitTaskStatusEvents
                ? (
                    taskIds: string[],
                    newStatus: string,
                    tasks: WorkflowRuntimeTask[],
                ) => {
                    options.eventBus!.publish({
                        type: "workflow.task.statusChange",
                        sessionId,
                        runId: workflowRunId,
                        timestamp: Date.now(),
                        data: {
                            workflowId: sessionId,
                            taskIds,
                            newStatus,
                            tasks: tasks.map(toRuntimeTask),
                        },
                    });
                }
                : undefined,
        };

        // Phase 5: Stream graph execution with progress
        let sessionTracked = false;
        let lastNodeId: string | null = null;
        let lastNodeCompletionStatus: "success" | "error" | "skipped" = "success";
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
            eventBus: options?.eventBus,
            saveTasksToSession: options?.saveTasksToSession,
            toRuntimeTasks,
            persistTaskStatusEvents: runtimeFeatureFlags.persistTaskStatusEvents,
        });
        unsubscribeStatusChange = taskPersistence.subscribeStatusChange();

        for await (const step of streamGraph(compiled, { initialState, abortSignal: workflowAbortSignal })) {
            const currentCompletionStatus = mapStepStatusToCompletionStatus(step.status);

            // Track step status for failure detection
            lastStepStatus = step.status;
            lastStepError = step.error?.error instanceof Error ? step.error.error.message : step.error?.error;

            // Show progress for node transitions
            if (step.nodeId !== lastNodeId) {
                const description = nodeDescriptions?.[step.nodeId];
                
                // Publish step complete event for previous node (if any)
                if (lastNodeId !== null && eventAdapter) {
                    eventAdapter.publishStepComplete(
                        sessionId,
                        nodeDescriptions?.[lastNodeId] ?? lastNodeId,
                        lastNodeId,
                        lastNodeCompletionStatus,
                    );
                }
                
                // Publish step start event for new node
                if (eventAdapter) {
                    eventAdapter.publishStepStart(
                        sessionId,
                        description ?? step.nodeId,
                        step.nodeId,
                    );
                }
                
                lastNodeId = step.nodeId;
            }

            lastNodeCompletionStatus = currentCompletionStatus;

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

                // Publish task update event
                if (eventAdapter) {
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
                    eventAdapter.publishTaskUpdate(sessionId, formattedTasks);
                }

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
        
        // Unsubscribe from statusChange events before cleanup
        unsubscribeStatusChange?.();

        // Flush any pending debounced save
        await taskPersistence.flush();
        
        // Publish final step complete event
        if (lastNodeId !== null && eventAdapter) {
            eventAdapter.publishStepComplete(
                sessionId,
                nodeDescriptions?.[lastNodeId] ?? lastNodeId,
                lastNodeId,
                lastNodeCompletionStatus,
            );
        }

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
        unsubscribeStatusChange?.();
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
