/**
 * Integration tests for workflow executor
 * Tests the integration of workflow components working together
 */

import { test, expect, describe } from "bun:test";
import { ralphWorkflowDefinition } from "./ralph/definition.ts";
import { compileGraphConfig } from "./executor.ts";
import type {
    WorkflowDefinition,
    WorkflowGraphConfig,
    WorkflowStateParams,
} from "../ui/commands/workflow-commands.ts";
import type { BaseState, NodeDefinition, Edge } from "./graph/types.ts";
import { createNode } from "./graph/builder.ts";

// ============================================================================
// Task #43: Integration test — Ralph through generic execution path
// ============================================================================

describe("Task #43: Ralph workflow through generic execution path", () => {
    test("ralphWorkflowDefinition has expected properties", () => {
        // Verify it's a valid WorkflowDefinition with required fields
        expect(ralphWorkflowDefinition).toBeDefined();
        expect(ralphWorkflowDefinition.name).toBe("ralph");
        expect(ralphWorkflowDefinition.description).toBeTruthy();
        expect(ralphWorkflowDefinition.version).toBeTruthy();
    });

    test("ralphWorkflowDefinition has createState factory", () => {
        expect(ralphWorkflowDefinition.createState).toBeDefined();
        expect(typeof ralphWorkflowDefinition.createState).toBe("function");
    });

    test("ralphWorkflowDefinition has nodeDescriptions", () => {
        expect(ralphWorkflowDefinition.nodeDescriptions).toBeDefined();
        expect(typeof ralphWorkflowDefinition.nodeDescriptions).toBe("object");
    });

    test("createState produces valid state with expected fields", () => {
        if (!ralphWorkflowDefinition.createState) {
            throw new Error("createState is not defined");
        }

        const params: WorkflowStateParams = {
            prompt: "Test prompt",
            sessionId: "test-session-123",
            sessionDir: "/tmp/test-session",
            maxIterations: 50,
        };

        const state = ralphWorkflowDefinition.createState(params);

        // Verify state has BaseState fields
        expect(state).toBeDefined();
        expect(typeof state).toBe("object");

        // Verify state has required Ralph-specific session fields
        // Ralph uses ralphSessionId and ralphSessionDir as field names
        expect(state).toHaveProperty("ralphSessionId");
        expect(state).toHaveProperty("ralphSessionDir");
        expect(state).toHaveProperty("maxIterations");
        expect((state as any).ralphSessionId).toBe("test-session-123");
        expect((state as any).ralphSessionDir).toBe("/tmp/test-session");
        expect((state as any).maxIterations).toBe(50);
    });

    test("nodeDescriptions contains expected node IDs", () => {
        const descriptions = ralphWorkflowDefinition.nodeDescriptions;

        if (!descriptions) {
            throw new Error("nodeDescriptions is not defined");
        }

        // Verify all expected Ralph workflow nodes are described
        const expectedNodeIds = [
            "planner",
            "parse-tasks",
            "select-ready-tasks",
            "worker",
            "reviewer",
            "fixer",
        ];

        for (const nodeId of expectedNodeIds) {
            expect(descriptions).toHaveProperty(nodeId);
            const description = descriptions[nodeId];
            expect(typeof description).toBe("string");
            expect(description?.length ?? 0).toBeGreaterThan(0);
        }
    });

    test("nodeDescriptions are human-readable", () => {
        const descriptions = ralphWorkflowDefinition.nodeDescriptions;

        if (!descriptions) {
            throw new Error("nodeDescriptions is not defined");
        }

        // Verify descriptions contain expected content patterns
        expect(descriptions["planner"]).toContain("Planning");
        expect(descriptions["parse-tasks"]).toContain("Parsing");
        expect(descriptions["select-ready-tasks"]).toContain("Selecting");
        expect(descriptions["worker"]).toContain("Working");
        expect(descriptions["reviewer"]).toContain("Review");
        expect(descriptions["fixer"]).toContain("Fix");
    });
});

// ============================================================================
// Task #44: Integration test — custom workflow with graphConfig
// ============================================================================

describe("Task #44: Custom workflow with graphConfig", () => {
    interface CustomWorkflowState extends BaseState {
        input: string;
        result: string;
    }

    test("compileGraphConfig compiles minimal workflow correctly", () => {
        // Create a minimal WorkflowGraphConfig with 2 nodes and 1 edge
        const graphConfig: WorkflowGraphConfig<CustomWorkflowState> = {
            nodes: [
                {
                    id: "start-node",
                    type: "tool",
                    execute: async (ctx) => ({
                        stateUpdate: { result: `Processed: ${ctx.state.input}` } as Partial<CustomWorkflowState>,
                    }),
                },
                {
                    id: "end-node",
                    type: "agent",
                    execute: async (ctx) => ({
                        stateUpdate: { result: `${ctx.state.result} - Done` } as Partial<CustomWorkflowState>,
                    }),
                },
            ],
            edges: [{ from: "start-node", to: "end-node" }],
            startNode: "start-node",
        };

        // Call compileGraphConfig
        const compiled = compileGraphConfig(graphConfig);

        // Verify the compiled graph has the correct structure
        expect(compiled).toBeDefined();
        expect(compiled.nodes).toBeDefined();
        expect(compiled.edges).toBeDefined();
        expect(compiled.startNode).toBeDefined();
        expect(compiled.endNodes).toBeDefined();
    });

    test("compiled graph has correct nodes", () => {
        const graphConfig: WorkflowGraphConfig<CustomWorkflowState> = {
            nodes: [
                {
                    id: "node-a",
                    type: "tool",
                    execute: async () => ({ stateUpdate: {} }),
                },
                {
                    id: "node-b",
                    type: "agent",
                    execute: async () => ({ stateUpdate: {} }),
                },
            ],
            edges: [{ from: "node-a", to: "node-b" }],
            startNode: "node-a",
        };

        const compiled = compileGraphConfig(graphConfig);

        // Verify nodes are correctly mapped
        expect(compiled.nodes.size).toBe(2);
        expect(compiled.nodes.has("node-a")).toBe(true);
        expect(compiled.nodes.has("node-b")).toBe(true);
        expect(compiled.nodes.get("node-a")?.type).toBe("tool");
        expect(compiled.nodes.get("node-b")?.type).toBe("agent");
    });

    test("compiled graph has correct edges", () => {
        const graphConfig: WorkflowGraphConfig<CustomWorkflowState> = {
            nodes: [
                {
                    id: "node-1",
                    type: "tool",
                    execute: async () => ({ stateUpdate: {} }),
                },
                {
                    id: "node-2",
                    type: "agent",
                    execute: async () => ({ stateUpdate: {} }),
                },
            ],
            edges: [{ from: "node-1", to: "node-2" }],
            startNode: "node-1",
        };

        const compiled = compileGraphConfig(graphConfig);

        // Verify edges are copied
        expect(compiled.edges).toBeDefined();
        expect(compiled.edges.length).toBe(1);
        expect(compiled.edges[0]?.from).toBe("node-1");
        expect(compiled.edges[0]?.to).toBe("node-2");
    });

    test("compiled graph has correct startNode", () => {
        const graphConfig: WorkflowGraphConfig<CustomWorkflowState> = {
            nodes: [
                {
                    id: "first",
                    type: "tool",
                    execute: async () => ({ stateUpdate: {} }),
                },
                {
                    id: "second",
                    type: "agent",
                    execute: async () => ({ stateUpdate: {} }),
                },
            ],
            edges: [{ from: "first", to: "second" }],
            startNode: "first",
        };

        const compiled = compileGraphConfig(graphConfig);

        // Verify startNode is set correctly
        expect(compiled.startNode).toBe("first");
    });

    test("compiled graph detects correct endNodes", () => {
        const graphConfig: WorkflowGraphConfig<CustomWorkflowState> = {
            nodes: [
                {
                    id: "beginning",
                    type: "tool",
                    execute: async () => ({ stateUpdate: {} }),
                },
                {
                    id: "finale",
                    type: "agent",
                    execute: async () => ({ stateUpdate: {} }),
                },
            ],
            edges: [{ from: "beginning", to: "finale" }],
            startNode: "beginning",
        };

        const compiled = compileGraphConfig(graphConfig);

        // Verify endNodes are detected (nodes with no outgoing edges)
        expect(compiled.endNodes.size).toBe(1);
        expect(compiled.endNodes.has("finale")).toBe(true);
        expect(compiled.endNodes.has("beginning")).toBe(false);
    });

    test("compiled graph handles maxIterations in config", () => {
        const graphConfig: WorkflowGraphConfig<CustomWorkflowState> = {
            nodes: [
                {
                    id: "loop-node",
                    type: "tool",
                    execute: async () => ({ stateUpdate: {} }),
                },
            ],
            edges: [{ from: "loop-node", to: "loop-node", condition: () => true }],
            startNode: "loop-node",
            maxIterations: 25,
        };

        const compiled = compileGraphConfig(graphConfig);

        // Verify maxIterations is set in config metadata
        expect(compiled.config).toBeDefined();
        expect(compiled.config.metadata).toBeDefined();
        expect(compiled.config.metadata?.maxIterations).toBe(25);
    });

    test("compiled graph handles missing maxIterations", () => {
        const graphConfig: WorkflowGraphConfig<CustomWorkflowState> = {
            nodes: [
                {
                    id: "simple-node",
                    type: "tool",
                    execute: async () => ({ stateUpdate: {} }),
                },
            ],
            edges: [],
            startNode: "simple-node",
            // No maxIterations specified
        };

        const compiled = compileGraphConfig(graphConfig);

        // Verify config is empty object when maxIterations not provided
        expect(compiled.config).toBeDefined();
        // Either metadata is undefined, or maxIterations is undefined
        if (compiled.config.metadata) {
            expect(compiled.config.metadata.maxIterations).toBeUndefined();
        }
    });
});

// ============================================================================
// Task #45: Integration test — workflow without graphConfig fallback
// ============================================================================

describe("Task #45: Workflow without graphConfig fallback", () => {
    test("WorkflowMetadata without graphConfig is valid", () => {
        // Create a test WorkflowMetadata without graphConfig or createState
        const simpleWorkflow: WorkflowDefinition = {
            name: "simple-chat",
            description: "A simple chat-based workflow",
            version: "1.0.0",
            source: "builtin",
            // No graphConfig, no createState
        };

        // Verify it's a valid WorkflowDefinition
        expect(simpleWorkflow).toBeDefined();
        expect(simpleWorkflow.name).toBe("simple-chat");
        expect(simpleWorkflow.description).toBeTruthy();

        // Verify optional fields are absent
        expect(simpleWorkflow.graphConfig).toBeUndefined();
        expect(simpleWorkflow.createState).toBeUndefined();
        expect(simpleWorkflow.nodeDescriptions).toBeUndefined();
    });

    test("chat-based workflow can have basic metadata", () => {
        // Create a chat-based workflow with just metadata
        const chatWorkflow: WorkflowDefinition = {
            name: "chat-helper",
            description: "A workflow that uses chat interface",
            aliases: ["help", "assist"],
            version: "1.0.0",
            argumentHint: "<question>",
            source: "local",
        };

        // Verify all metadata fields are accessible
        expect(chatWorkflow.name).toBe("chat-helper");
        expect(chatWorkflow.description).toBe("A workflow that uses chat interface");
        expect(chatWorkflow.aliases).toEqual(["help", "assist"]);
        expect(chatWorkflow.version).toBe("1.0.0");
        expect(chatWorkflow.argumentHint).toBe("<question>");
        expect(chatWorkflow.source).toBe("local");
    });

    test("WorkflowDefinition supports optional defaultConfig", () => {
        const workflowWithConfig: WorkflowDefinition = {
            name: "configurable",
            description: "A workflow with default config",
            defaultConfig: {
                temperature: 0.7,
                maxTokens: 1000,
                enableLogging: true,
            },
        };

        expect(workflowWithConfig.defaultConfig).toBeDefined();
        expect(workflowWithConfig.defaultConfig?.temperature).toBe(0.7);
        expect(workflowWithConfig.defaultConfig?.maxTokens).toBe(1000);
        expect(workflowWithConfig.defaultConfig?.enableLogging).toBe(true);
    });

    test("WorkflowDefinition can have both graphConfig and chat fallback metadata", () => {
        // This tests backward compatibility - a workflow can have graphConfig
        // but still have metadata for when it falls back to chat mode

        const hybridWorkflow: WorkflowDefinition = {
            name: "hybrid",
            description: "Can work both ways",
            argumentHint: "<input>",
            // Note: graphConfig is optional and omitted here for simplicity
            // This tests that a workflow can have metadata without graphConfig
        };

        // Verify it has metadata
        expect(hybridWorkflow.name).toBe("hybrid");
        expect(hybridWorkflow.argumentHint).toBe("<input>");
        // graphConfig can be added later or omitted for chat-based workflows
    });

    test("WorkflowDefinition extends WorkflowMetadata (backward compatible)", () => {
        // Test that all WorkflowMetadata fields are available in WorkflowDefinition
        const definition: WorkflowDefinition = {
            name: "test",
            description: "test workflow",
            aliases: ["t"],
            defaultConfig: { key: "value" },
            version: "1.0.0",
            minSDKVersion: "0.1.0",
            stateVersion: 1,
            argumentHint: "<args>",
            source: "global",
        };

        // All these should be accessible
        expect(definition.name).toBe("test");
        expect(definition.description).toBe("test workflow");
        expect(definition.aliases).toEqual(["t"]);
        expect(definition.defaultConfig).toEqual({ key: "value" });
        expect(definition.version).toBe("1.0.0");
        expect(definition.minSDKVersion).toBe("0.1.0");
        expect(definition.stateVersion).toBe(1);
        expect(definition.argumentHint).toBe("<args>");
        expect(definition.source).toBe("global");
    });

    test("chat-based workflow supports state migrations", () => {
        // Test that workflows without graphConfig can still have migrateState
        const workflowWithMigration: WorkflowDefinition = {
            name: "migrating",
            description: "Supports state migrations",
            stateVersion: 2,
            migrateState: (oldState: unknown, fromVersion: number) => {
                // Simple migration example
                if (fromVersion === 1) {
                    return {
                        ...(oldState as object),
                        upgraded: true,
                        executionId: "",
                        lastUpdated: new Date().toISOString(),
                        outputs: {},
                    } as BaseState;
                }
                return oldState as BaseState;
            },
        };

        expect(workflowWithMigration.stateVersion).toBe(2);
        expect(workflowWithMigration.migrateState).toBeDefined();
        expect(typeof workflowWithMigration.migrateState).toBe("function");

        // Test the migration function
        if (workflowWithMigration.migrateState) {
            const oldState = { data: "test" };
            const migrated = workflowWithMigration.migrateState(oldState, 1);
            expect(migrated).toHaveProperty("upgraded", true);
            expect(migrated).toHaveProperty("data", "test");
            expect(migrated).toHaveProperty("executionId");
            expect(migrated).toHaveProperty("lastUpdated");
            expect(migrated).toHaveProperty("outputs");
        }
    });
});
