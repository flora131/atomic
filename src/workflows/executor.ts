/**
 * Generic workflow executor that replaces both createRalphCommand() and WorkflowSDK.
 * Handles graph compilation, session initialization, state construction,
 * bridge/registry setup, graph streaming with progress, and error handling.
 */

import type { BaseState, CompiledGraph, NodeDefinition, GraphConfig } from "./graph/types.ts";
import { SubagentTypeRegistry } from "./graph/subagent-registry.ts";
import { discoverAgentInfos } from "../ui/commands/agent-commands.ts";
import { type WorkflowDefinition, type WorkflowGraphConfig, registerActiveSession } from "../ui/commands/workflow-commands.ts";
import type { CommandContext, CommandResult } from "../ui/commands/registry.ts";
import { streamGraph } from "./graph/compiled.ts";
import {
    initWorkflowSession,
    getWorkflowSessionDir,
} from "./session.ts";
import type { NormalizedTodoItem, TaskStatus } from "../ui/utils/task-status.ts";
import type { EventBus } from "../events/event-bus.ts";
import { WorkflowEventAdapter } from "../events/adapters/workflow-adapter.ts";

/**
 * Result of a workflow execution.
 */
export interface WorkflowExecutionResult {
    success: boolean;
    message?: string;
    error?: Error;
}

/**
 * Compiles a declarative WorkflowGraphConfig into a CompiledGraph.
 * Converts node array to Map, detects end nodes, and builds the config.
 */
export function compileGraphConfig<TState extends BaseState>(
    graphConfig: WorkflowGraphConfig<TState>,
): CompiledGraph<TState> {
    const nodeMap = new Map<string, NodeDefinition<TState>>();
    for (const node of graphConfig.nodes) {
        nodeMap.set(node.id, node);
    }

    // Detect end nodes: nodes with no outgoing edges
    const nodesWithOutgoing = new Set(graphConfig.edges.map((e) => e.from));
    const endNodes = new Set<string>();
    for (const nodeId of nodeMap.keys()) {
        if (!nodesWithOutgoing.has(nodeId)) {
            endNodes.add(nodeId);
        }
    }

    const config: GraphConfig<TState> = {};
    if (graphConfig.maxIterations !== undefined) {
        config.metadata = { maxIterations: graphConfig.maxIterations };
    }

    return {
        nodes: nodeMap,
        edges: [...graphConfig.edges],
        startNode: graphConfig.startNode,
        endNodes,
        config,
    };
}

/**
 * Infers whether the compiled graph uses subagent nodes.
 * Checks node types and IDs for subagent-related patterns.
 */
export function inferHasSubagentNodes<TState extends BaseState>(
    compiled: CompiledGraph<TState>,
): boolean {
    for (const node of compiled.nodes.values()) {
        if (
            (node as NodeDefinition<TState>).type === "agent" ||
            node.id.includes("subagent")
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Infers whether the compiled graph's state schema includes a tasks field.
 * Used to determine if the workflow supports task list UI updates.
 */
export function inferHasTaskList<TState extends BaseState>(
    compiled: CompiledGraph<TState>,
): boolean {
    return compiled.config.metadata?.hasTaskList === true;
}

/**
 * Creates and populates a SubagentTypeRegistry with discovered agent infos.
 */
export function createSubagentRegistry(): SubagentTypeRegistry {
    const registry = new SubagentTypeRegistry();
    for (const agent of discoverAgentInfos()) {
        registry.register({
            name: agent.name,
            info: agent,
            source: agent.source,
        });
    }
    return registry;
}

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
    },
): Promise<CommandResult> {
    // Phase 1: Session initialization
    const sessionId = crypto.randomUUID();
    const sessionDir = getWorkflowSessionDir(sessionId);
    const workflowRunId = crypto.getRandomValues(new Uint32Array(1))[0]!;

    // Construct WorkflowEventAdapter if event bus is available
    const eventAdapter = options?.eventBus
        ? new WorkflowEventAdapter(options.eventBus, sessionId, workflowRunId)
        : undefined;

    // Publish synthetic stream.session.start to register this session with the
    // correlation pipeline so sub-agent events are recognized as owned.
    if (options?.eventBus) {
        options.eventBus.publish({
            type: "stream.session.start",
            sessionId,
            runId: workflowRunId,
            timestamp: Date.now(),
            data: { config: { workflowName: definition.name } },
        });
    }

    void initWorkflowSession(definition.name, sessionId).then((session) => {
        registerActiveSession(session);
    }).catch((err) => {
        console.error("[workflow] Failed to initialize session:", err);
    });

    context.updateWorkflowState({
        workflowActive: true,
        workflowType: definition.name,
        workflowConfig: { sessionId, userPrompt: prompt, workflowName: definition.name },
    });

    context.setStreaming(true);

    let unsubscribeStatusChange: (() => void) | undefined;

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

        // Phase 4: Registry setup — pass TUI's spawnSubagentParallel directly
        const registry = createSubagentRegistry();
        const spawnFn = context.spawnSubagentParallel;
        if (!spawnFn) {
            throw new Error("spawnSubagentParallel is not available on CommandContext.");
        }

        compiled.config.runtime = {
            ...compiled.config.runtime,
            spawnSubagent: async (agent, abortSignal) => {
                // Publish agent start event if adapter is available
                if (eventAdapter) {
                    eventAdapter.publishAgentStart(
                        agent.agentId,
                        agent.agentName,
                        agent.task,
                        true, // Single workflow spawns also run as background agents
                    );
                }

                const [result] = await spawnFn([{ ...agent, abortSignal }], abortSignal);
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

                const results = await spawnFn(agents, abortSignal);

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
            subagentRegistry: registry,
            notifyTaskStatusChange: options?.eventBus
                ? (
                    taskIds: string[],
                    newStatus: string,
                    tasks: Array<{ id: string; title: string; status: string; blockedBy?: string[] }>,
                ) => {
                    options.eventBus!.publish({
                        type: "workflow.task.statusChange",
                        sessionId,
                        runId: workflowRunId,
                        timestamp: Date.now(),
                        data: { taskIds, newStatus, tasks },
                    });
                }
                : undefined,
        };

        // Phase 5: Stream graph execution with progress
        let sessionTracked = false;
        let lastNodeId: string | null = null;
        let lastStepStatus: string | null = null;
        let lastStepError: string | undefined;
        const nodeDescriptions = definition.nodeDescriptions;

        // Debounced saveTasksToSession to avoid I/O contention during rapid updates
        let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingSaveTasks: NormalizedTodoItem[] | null = null;
        const normalizeTaskKey = (taskId?: string): string | null => {
            if (typeof taskId !== "string") return null;
            const normalized = taskId.trim().toLowerCase().replace(/^#/, "");
            return normalized.length > 0 ? normalized : null;
        };
        let latestWorkflowTasks: NormalizedTodoItem[] = [];
        const debouncedSaveTasksToSession = options?.saveTasksToSession
            ? (tasks: NormalizedTodoItem[], sid: string) => {
                latestWorkflowTasks = tasks;
                pendingSaveTasks = tasks;
                if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
                saveDebounceTimer = setTimeout(async () => {
                    if (pendingSaveTasks) {
                        try {
                            await options.saveTasksToSession!(pendingSaveTasks, sid);
                        } catch (err) {
                            console.error('[workflow] Failed to save tasks:', err);
                        }
                        pendingSaveTasks = null;
                    }
                    saveDebounceTimer = null;
                }, 100);
            }
            : undefined;

        // Subscribe to workflow.task.statusChange events for persistence.
        // When a worker node publishes a status change (e.g., pending → in_progress)
        // before spawning sub-agents, this subscriber persists the update immediately
        // via the debounced save, so the file watcher can trigger UI updates.
        if (options?.eventBus && debouncedSaveTasksToSession) {
            unsubscribeStatusChange = options.eventBus.on("workflow.task.statusChange", (event) => {
                if (event.sessionId !== sessionId) return;
                const { tasks } = event.data;

                const previousById = new Map<string, NormalizedTodoItem>();
                for (const task of latestWorkflowTasks) {
                    const key = normalizeTaskKey(task.id);
                    if (!key || previousById.has(key)) continue;
                    previousById.set(key, task);
                }

                const normalized: NormalizedTodoItem[] = tasks.map((t) => {
                    const taskKey = normalizeTaskKey(t.id);
                    return {
                        id: t.id,
                        content: t.title,
                        status: t.status as TaskStatus,
                        activeForm: t.title,
                        blockedBy: t.blockedBy
                            ?? (taskKey ? previousById.get(taskKey)?.blockedBy : undefined),
                    };
                });
                debouncedSaveTasksToSession(normalized, sessionId);
            });
        }

        for await (const step of streamGraph(compiled, { initialState })) {
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

            // Sync task list to UI and session
            const state = step.state as BaseState & { tasks?: Array<{ id?: string; content: string; status: string; activeForm: string; blockedBy?: string[] }> };
            if (state.tasks && state.tasks.length > 0) {
                if (debouncedSaveTasksToSession) {
                    debouncedSaveTasksToSession(
                        state.tasks as NormalizedTodoItem[],
                        sessionId,
                    );
                }
                
                // Publish task update event
                if (eventAdapter) {
                    const formattedTasks = state.tasks.map(task => ({
                        id: task.id ?? crypto.randomUUID(),
                        title: task.content,
                        status: task.status,
                        blockedBy: task.blockedBy,
                    }));
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
        if (saveDebounceTimer) {
            clearTimeout(saveDebounceTimer);
            if (pendingSaveTasks && options?.saveTasksToSession) {
                try {
                    await options.saveTasksToSession(pendingSaveTasks, sessionId);
                } catch (err) {
                    console.error('[workflow] Failed to flush pending task save:', err);
                }
            }
        }
        
        // Publish final step complete event
        if (lastNodeId !== null && eventAdapter) {
            eventAdapter.publishStepComplete(
                sessionId,
                nodeDescriptions?.[lastNodeId] ?? lastNodeId,
                lastNodeId,
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
