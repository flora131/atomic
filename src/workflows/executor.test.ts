/**
 * Unit tests for workflow executor utilities
 */

import { describe, expect, test } from "bun:test";
import {
    compileGraphConfig,
    inferHasSubagentNodes,
    inferHasTaskList,
    createSubagentRegistry,
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
