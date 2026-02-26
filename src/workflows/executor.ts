/**
 * Generic workflow executor that replaces both createRalphCommand() and WorkflowSDK.
 * Handles graph compilation, session initialization, state construction,
 * bridge/registry setup, graph streaming with progress, and error handling.
 */

import type { BaseState, CompiledGraph, NodeDefinition, Edge, GraphConfig } from "./graph/types.ts";
import { SubagentTypeRegistry } from "./graph/subagent-registry.ts";
import { discoverAgentInfos } from "../ui/commands/agent-commands.ts";
import { type WorkflowDefinition, type WorkflowGraphConfig, registerActiveSession } from "../ui/commands/workflow-commands.ts";
import type { CommandContext, CommandResult } from "../ui/commands/registry.ts";
import { streamGraph } from "./graph/compiled.ts";
import {
    initWorkflowSession,
    getWorkflowSessionDir,
} from "./session.ts";
import type { TodoItem } from "../sdk/tools/todo-write.ts";
import type { NormalizedTodoItem } from "../ui/utils/task-status.ts";

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
    },
): Promise<CommandResult> {
    // Phase 1: Session initialization
    const sessionId = crypto.randomUUID();
    const sessionDir = getWorkflowSessionDir(sessionId);
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

    try {
        context.addMessage(
            "assistant",
            `Starting **${definition.name}** workflow with prompt: "${prompt}"\n\nInitializing task decomposition...`,
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
                const [result] = await spawnFn([{ ...agent, abortSignal }], abortSignal);
                if (!result) throw new Error("Subagent spawn returned no results");
                return result;
            },
            spawnSubagentParallel: spawnFn,
            subagentRegistry: registry,
        };

        // Phase 5: Stream graph execution with progress
        let sessionTracked = false;
        let lastNodeId: string | null = null;
        const nodeDescriptions = definition.nodeDescriptions;

        for await (const step of streamGraph(compiled, { initialState })) {
            // Show progress for node transitions
            if (step.nodeId !== lastNodeId) {
                const description = nodeDescriptions?.[step.nodeId];
                if (description) {
                    context.addMessage(
                        "assistant",
                        `**Workflow Progress:** ${description}`,
                    );
                }
                lastNodeId = step.nodeId;
            }

            // Sync task list to UI and session
            const state = step.state as BaseState & { tasks?: Array<{ id?: string; content: string; status: string; activeForm: string; blockedBy?: string[] }> };
            if (state.tasks && state.tasks.length > 0) {
                if (options?.saveTasksToSession) {
                    await options.saveTasksToSession(
                        state.tasks as NormalizedTodoItem[],
                        sessionId,
                    );
                }
                context.setTodoItems(state.tasks as TodoItem[]);

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

        // Phase 6: Success
        context.addMessage(
            "assistant",
            `**${definition.name}** workflow completed successfully.`,
        );
        context.setStreaming(false);

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

        return {
            success: false,
            message: `Workflow failed: ${error instanceof Error ? error.message : String(error)}`,
            stateUpdate: {
                workflowActive: false,
                workflowType: null,
                initialPrompt: null,
            },
        };
    }
}
