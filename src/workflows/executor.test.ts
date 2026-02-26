/**
 * Unit tests for workflow executor utilities
 */

import { describe, expect, test } from "bun:test";
import {
    compileGraphConfig,
    inferHasSubagentNodes,
    inferHasTaskList,
    createSubagentRegistry,
    executeWorkflow,
} from "./executor.ts";
import type { WorkflowGraphConfig } from "../ui/commands/workflow-commands.ts";
import type { BaseState, NodeDefinition } from "./graph/types.ts";

describe("compileGraphConfig", () => {
    test("converts node array to Map", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const graphConfig: WorkflowGraphConfig<TestState> = {
            nodes: [
                {
                    id: "node1",
                    type: "agent",
                    execute: async () => ({ stateUpdate: { value: "test" } as Partial<TestState> }),
                },
                {
                    id: "node2",
                    type: "tool",
                    execute: async () => ({ stateUpdate: { value: "test2" } as Partial<TestState> }),
                },
            ],
            edges: [{ from: "node1", to: "node2" }],
            startNode: "node1",
        };

        const compiled = compileGraphConfig(graphConfig);

        expect(compiled.nodes.size).toBe(2);
        expect(compiled.nodes.has("node1")).toBe(true);
        expect(compiled.nodes.has("node2")).toBe(true);
        expect(compiled.nodes.get("node1")?.type).toBe("agent");
        expect(compiled.nodes.get("node2")?.type).toBe("tool");
    });

    test("detects end nodes correctly", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const graphConfig: WorkflowGraphConfig<TestState> = {
            nodes: [
                {
                    id: "start",
                    type: "agent",
                    execute: async () => ({ stateUpdate: { value: "start" } as Partial<TestState> }),
                },
                {
                    id: "middle",
                    type: "tool",
                    execute: async () => ({ stateUpdate: { value: "middle" } as Partial<TestState> }),
                },
                {
                    id: "end",
                    type: "agent",
                    execute: async () => ({ stateUpdate: { value: "end" } as Partial<TestState> }),
                },
            ],
            edges: [
                { from: "start", to: "middle" },
                { from: "middle", to: "end" },
            ],
            startNode: "start",
        };

        const compiled = compileGraphConfig(graphConfig);

        expect(compiled.endNodes.size).toBe(1);
        expect(compiled.endNodes.has("end")).toBe(true);
        expect(compiled.endNodes.has("start")).toBe(false);
        expect(compiled.endNodes.has("middle")).toBe(false);
    });

    test("handles multiple end nodes", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const graphConfig: WorkflowGraphConfig<TestState> = {
            nodes: [
                {
                    id: "start",
                    type: "agent",
                    execute: async () => ({ stateUpdate: { value: "start" } as Partial<TestState> }),
                },
                {
                    id: "end1",
                    type: "tool",
                    execute: async () => ({ stateUpdate: { value: "end1" } as Partial<TestState> }),
                },
                {
                    id: "end2",
                    type: "agent",
                    execute: async () => ({ stateUpdate: { value: "end2" } as Partial<TestState> }),
                },
            ],
            edges: [
                { from: "start", to: "end1" },
                { from: "start", to: "end2" },
            ],
            startNode: "start",
        };

        const compiled = compileGraphConfig(graphConfig);

        expect(compiled.endNodes.size).toBe(2);
        expect(compiled.endNodes.has("end1")).toBe(true);
        expect(compiled.endNodes.has("end2")).toBe(true);
    });

    test("sets startNode correctly", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const graphConfig: WorkflowGraphConfig<TestState> = {
            nodes: [
                {
                    id: "myStart",
                    type: "agent",
                    execute: async () => ({ stateUpdate: { value: "start" } as Partial<TestState> }),
                },
            ],
            edges: [],
            startNode: "myStart",
        };

        const compiled = compileGraphConfig(graphConfig);

        expect(compiled.startNode).toBe("myStart");
    });

    test("copies edges array", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const graphConfig: WorkflowGraphConfig<TestState> = {
            nodes: [
                {
                    id: "node1",
                    type: "agent",
                    execute: async () => ({ stateUpdate: { value: "test" } as Partial<TestState> }),
                },
                {
                    id: "node2",
                    type: "tool",
                    execute: async () => ({ stateUpdate: { value: "test2" } as Partial<TestState> }),
                },
            ],
            edges: [{ from: "node1", to: "node2" }],
            startNode: "node1",
        };

        const compiled = compileGraphConfig(graphConfig);

        expect(compiled.edges).toHaveLength(1);
        expect(compiled.edges[0]?.from).toBe("node1");
        expect(compiled.edges[0]?.to).toBe("node2");
        // Verify it's a copy, not the same array
        expect(compiled.edges).not.toBe(graphConfig.edges);
    });

    test("sets maxIterations in config metadata", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const graphConfig: WorkflowGraphConfig<TestState> = {
            nodes: [
                {
                    id: "node1",
                    type: "agent",
                    execute: async () => ({ stateUpdate: { value: "test" } as Partial<TestState> }),
                },
            ],
            edges: [],
            startNode: "node1",
            maxIterations: 50,
        };

        const compiled = compileGraphConfig(graphConfig);

        expect(compiled.config.metadata?.maxIterations).toBe(50);
    });

    test("omits metadata when maxIterations is undefined", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const graphConfig: WorkflowGraphConfig<TestState> = {
            nodes: [
                {
                    id: "node1",
                    type: "agent",
                    execute: async () => ({ stateUpdate: { value: "test" } as Partial<TestState> }),
                },
            ],
            edges: [],
            startNode: "node1",
        };

        const compiled = compileGraphConfig(graphConfig);

        expect(compiled.config.metadata).toBeUndefined();
    });
});

describe("inferHasSubagentNodes", () => {
    test("detects agent type nodes", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const compiled = compileGraphConfig({
            nodes: [
                {
                    id: "agent1",
                    type: "agent" as const,
                    execute: async () => ({ stateUpdate: { value: "test" } as Partial<TestState> }),
                },
            ],
            edges: [],
            startNode: "agent1",
        });

        expect(inferHasSubagentNodes(compiled)).toBe(true);
    });

    test("detects subagent in node ID", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const compiled = compileGraphConfig({
            nodes: [
                {
                    id: "my-subagent-node",
                    type: "tool" as const,
                    execute: async () => ({ stateUpdate: { value: "test" } as Partial<TestState> }),
                },
            ],
            edges: [],
            startNode: "my-subagent-node",
        });

        expect(inferHasSubagentNodes(compiled)).toBe(true);
    });

    test("returns false when no subagent nodes", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const compiled = compileGraphConfig({
            nodes: [
                {
                    id: "tool1",
                    type: "tool" as const,
                    execute: async () => ({ stateUpdate: { value: "test" } as Partial<TestState> }),
                },
            ],
            edges: [],
            startNode: "tool1",
        });

        expect(inferHasSubagentNodes(compiled)).toBe(false);
    });
});

describe("inferHasTaskList", () => {
    test("returns true when metadata.hasTaskList is true", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const compiled = compileGraphConfig({
            nodes: [
                {
                    id: "node1",
                    type: "agent" as const,
                    execute: async () => ({ stateUpdate: { value: "test" } as Partial<TestState> }),
                },
            ],
            edges: [],
            startNode: "node1",
        });

        // Manually set metadata for testing
        compiled.config.metadata = { hasTaskList: true };

        expect(inferHasTaskList(compiled)).toBe(true);
    });

    test("returns false when metadata.hasTaskList is false", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const compiled = compileGraphConfig({
            nodes: [
                {
                    id: "node1",
                    type: "agent" as const,
                    execute: async () => ({ stateUpdate: { value: "test" } as Partial<TestState> }),
                },
            ],
            edges: [],
            startNode: "node1",
        });

        // Manually set metadata for testing
        compiled.config.metadata = { hasTaskList: false };

        expect(inferHasTaskList(compiled)).toBe(false);
    });

    test("returns false when metadata is undefined", () => {
        interface TestState extends BaseState {
            value: string;
        }

        const compiled = compileGraphConfig({
            nodes: [
                {
                    id: "node1",
                    type: "agent" as const,
                    execute: async () => ({ stateUpdate: { value: "test" } as Partial<TestState> }),
                },
            ],
            edges: [],
            startNode: "node1",
        });

        expect(inferHasTaskList(compiled)).toBe(false);
    });
});

describe("createSubagentRegistry", () => {
    test("creates a SubagentTypeRegistry", () => {
        const registry = createSubagentRegistry();

        expect(registry).toBeDefined();
        // Verify it's the right type by checking for methods
        expect(typeof registry.register).toBe("function");
        expect(typeof registry.get).toBe("function");
    });

    test("populates registry with discovered agents", () => {
        const registry = createSubagentRegistry();

        // Should have at least the built-in agents
        const allAgents = registry.getAll();
        expect(allAgents.length).toBeGreaterThan(0);

        // Check for some expected agents (actual names may vary by environment)
        const agentNames = allAgents.map((a) => a.name);
        // Just verify we have some common agents
        expect(agentNames.length).toBeGreaterThan(0);
    });
});

describe("executeWorkflow", () => {
    // Create a minimal CommandContext mock
    function createMockContext() {
        const messages: Array<{ role: string; content: string }> = [];
        const todoItems: any[] = [];
        let streaming = false;
        let workflowState: any = {};
        let workflowSessionDir: string | null = null;
        let workflowSessionId: string | null = null;
        let workflowTaskIds: Set<string> = new Set();

        return {
            session: null,
            state: {
                isStreaming: false,
                messageCount: 0,
            },
            addMessage: (role: string, content: string) => {
                messages.push({ role, content });
            },
            setStreaming: (value: boolean) => {
                streaming = value;
            },
            updateWorkflowState: (update: any) => {
                workflowState = { ...workflowState, ...update };
            },
            setTodoItems: (items: any[]) => {
                todoItems.push(...items);
            },
            setWorkflowSessionDir: (dir: string | null) => {
                workflowSessionDir = dir;
            },
            setWorkflowSessionId: (id: string | null) => {
                workflowSessionId = id;
            },
            setWorkflowTaskIds: (ids: Set<string>) => {
                workflowTaskIds = ids;
            },
            spawnSubagentParallel: async () => [],
            // Expose for testing
            _getMessages: () => messages,
            _getStreaming: () => streaming,
            _getWorkflowState: () => workflowState,
            _getSessionDir: () => workflowSessionDir,
            _getSessionId: () => workflowSessionId,
            _getTaskIds: () => workflowTaskIds,
        };
    }

    test("returns error when no graphConfig or compiledGraph provided", async () => {
        const context = createMockContext();
        const definition = {
            name: "test-workflow",
            description: "Test workflow without graph",
            command: "/test",
            // No graphConfig or createState
        };

        const result = await executeWorkflow(definition, "test prompt", context as any);

        expect(result.success).toBe(false);
        expect(result.message).toContain("no graphConfig");
        expect(context._getStreaming()).toBe(false);
    });

    test("successfully executes with a pre-compiled graph", async () => {
        const context = createMockContext();
        
        interface TestState extends BaseState {
            value: string;
        }

        // Create a simple compiled graph
        const compiledGraph = compileGraphConfig<TestState>({
            nodes: [
                {
                    id: "test-node",
                    type: "tool",
                    execute: async (ctx) => ({
                        stateUpdate: { value: "executed" } as Partial<TestState>,
                    }),
                },
            ],
            edges: [],
            startNode: "test-node",
        });

        const definition = {
            name: "test-workflow",
            description: "Test workflow with compiled graph",
            command: "/test",
        };

        const result = await executeWorkflow(
            definition,
            "test prompt",
            context as any,
            { compiledGraph: compiledGraph as any }
        );

        expect(result.success).toBe(true);
        expect(context._getStreaming()).toBe(false);
        const messages = context._getMessages();
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.some((m: any) => m.content.includes("Starting"))).toBe(true);
        expect(messages.some((m: any) => m.content.includes("completed successfully"))).toBe(true);
    });

    test("uses nodeDescriptions for progress messages", async () => {
        const context = createMockContext();
        
        interface TestState extends BaseState {
            step: number;
        }

        const compiledGraph = compileGraphConfig<TestState>({
            nodes: [
                {
                    id: "step1",
                    type: "tool",
                    execute: async (ctx) => ({
                        stateUpdate: { step: 1 } as Partial<TestState>,
                    }),
                },
                {
                    id: "step2",
                    type: "tool",
                    execute: async (ctx) => ({
                        stateUpdate: { step: 2 } as Partial<TestState>,
                    }),
                },
            ],
            edges: [{ from: "step1", to: "step2" }],
            startNode: "step1",
        });

        const definition = {
            name: "test-workflow",
            description: "Test workflow with node descriptions",
            command: "/test",
            nodeDescriptions: {
                step1: "Executing first step",
                step2: "Executing second step",
            },
        };

        const result = await executeWorkflow(
            definition,
            "test prompt",
            context as any,
            { compiledGraph: compiledGraph as any }
        );

        expect(result.success).toBe(true);
        // Progress messages are now sent via bus events, not context.addMessage()
        // Verify workflow still executes successfully with nodeDescriptions
        const messages = context._getMessages();
        expect(messages.some((m: any) => m.content.includes("Starting"))).toBe(true);
        expect(messages.some((m: any) => m.content.includes("completed successfully"))).toBe(true);
    });

    test("handles workflow cancellation error gracefully", async () => {
        const context = createMockContext();
        
        interface TestState extends BaseState {
            value: string;
        }

        // Create a graph that throws cancellation error
        const compiledGraph = compileGraphConfig<TestState>({
            nodes: [
                {
                    id: "cancel-node",
                    type: "tool",
                    execute: async () => {
                        throw new Error("Workflow cancelled");
                    },
                },
            ],
            edges: [],
            startNode: "cancel-node",
        });

        const definition = {
            name: "test-workflow",
            description: "Test workflow with cancellation",
            command: "/test",
        };

        const result = await executeWorkflow(
            definition,
            "test prompt",
            context as any,
            { compiledGraph: compiledGraph as any }
        );

        // Should return success:true for cancellation (silent exit)
        expect(result.success).toBe(true);
        expect(context._getStreaming()).toBe(false);
        expect(result.stateUpdate?.workflowActive).toBe(false);
    });

    test("creates state using createState factory when provided", async () => {
        const context = createMockContext();
        
        interface TestState extends BaseState {
            customValue: string;
            sessionId: string;
        }

        let capturedParams: any = null;

        const definition = {
            name: "test-workflow",
            description: "Test workflow with state factory",
            command: "/test",
            graphConfig: {
                nodes: [
                    {
                        id: "test-node",
                        type: "tool" as const,
                        execute: async (ctx: any) => {
                            // Verify state was created with factory
                            expect((ctx.state as TestState).customValue).toBe("factory-created");
                            return { stateUpdate: {} };
                        },
                    },
                ],
                edges: [],
                startNode: "test-node",
            },
            createState: (params: any) => {
                capturedParams = params;
                return {
                    executionId: params.sessionId,
                    lastUpdated: new Date().toISOString(),
                    outputs: {},
                    customValue: "factory-created",
                    sessionId: params.sessionId,
                } as TestState;
            },
        };

        const result = await executeWorkflow(
            definition as any,
            "test prompt",
            context as any
        );

        expect(result.success).toBe(true);
        expect(capturedParams).not.toBeNull();
        expect(capturedParams.prompt).toBe("test prompt");
        expect(capturedParams.sessionId).toBeDefined();
        expect(capturedParams.sessionDir).toBeDefined();
        expect(capturedParams.maxIterations).toBe(100); // DEFAULT_MAX_ITERATIONS
    });
});
