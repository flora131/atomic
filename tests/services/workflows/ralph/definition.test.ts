/**
 * Tests for Ralph Workflow Definition
 */

import { describe, test, expect } from "bun:test";
import { ralphWorkflowDefinition, ralphNodeDescriptions } from "@/services/workflows/ralph/definition.ts";
import { VERSION } from "@/version.ts";
import type { RalphWorkflowState } from "@/services/workflows/ralph/state.ts";
import { RALPH_STAGES } from "@/services/workflows/ralph/stages.ts";
import { isStageDefinition } from "@/services/workflows/conductor/guards.ts";

describe("Ralph Workflow Definition", () => {
    test("exports ralphNodeDescriptions with all expected nodes", () => {
        const expectedNodes = [
            "planner",
            "parse-tasks",
            "select-ready-tasks",
            "worker",
            "reviewer",
            "prepare-fix-tasks",
            "fixer",
        ];

        expect(Object.keys(ralphNodeDescriptions)).toEqual(expectedNodes);

        // Verify all descriptions are non-empty strings
        for (const nodeId of expectedNodes) {
            const description = ralphNodeDescriptions[nodeId];
            expect(typeof description).toBe("string");
            expect(description && description.length).toBeGreaterThan(0);
        }
    });

    test("ralphWorkflowDefinition has correct metadata", () => {
        expect(ralphWorkflowDefinition.name).toBe("ralph");
        expect(ralphWorkflowDefinition.description).toBe("Start autonomous implementation workflow");
        expect(ralphWorkflowDefinition.aliases).toEqual(["loop"]);
        expect(ralphWorkflowDefinition.version).toBe("1.0.0");
        expect(ralphWorkflowDefinition.minSDKVersion).toBe(VERSION);
        expect(ralphWorkflowDefinition.stateVersion).toBe(1);
        expect(ralphWorkflowDefinition.argumentHint).toBe('"<prompt-or-spec-path>"');
        expect(ralphWorkflowDefinition.source).toBe("builtin");
    });

    test("ralphWorkflowDefinition includes createState factory", () => {
        expect(typeof ralphWorkflowDefinition.createState).toBe("function");
    });

    test("ralphWorkflowDefinition includes nodeDescriptions", () => {
        expect(ralphWorkflowDefinition.nodeDescriptions).toBe(ralphNodeDescriptions);
    });

    test("ralphWorkflowDefinition does not include graphConfig", () => {
        // Ralph uses createRalphWorkflow() builder pattern, not declarative graphConfig
        expect(ralphWorkflowDefinition.graphConfig).toBeUndefined();
    });

    test("createState factory produces valid RalphWorkflowState", () => {
        const params = {
            prompt: "Test prompt",
            sessionId: "test-session-id",
            sessionDir: "/test/session/dir",
            maxIterations: 50,
        };

        const state = ralphWorkflowDefinition.createState!(params) as RalphWorkflowState;

        expect(state.executionId).toBe(params.sessionId);
        expect(state.yoloPrompt).toBe(params.prompt);
        expect(state.ralphSessionId).toBe(params.sessionId);
        expect(state.ralphSessionDir).toBe(params.sessionDir);
        expect(state.maxIterations).toBe(params.maxIterations);

        // Verify other expected fields are initialized
        expect(state.tasks).toEqual([]);
        expect(state.currentTasks).toEqual([]);
        expect(state.iteration).toBe(1);
        expect(typeof state.lastUpdated).toBe("string");
        expect(state.yolo).toBe(false);
    });

    test("node descriptions match expected format", () => {
        // All descriptions should have an emoji and descriptive text
        for (const [nodeId, description] of Object.entries(ralphNodeDescriptions)) {
            expect(description).toMatch(/^[⌕☰◎⚙◉⚒]/); // Starts with emoji
            expect(description.length).toBeGreaterThan(10); // Has descriptive text
        }
    });

    // -------------------------------------------------------------------------
    // Conductor integration
    // -------------------------------------------------------------------------

    test("conductorStages is set to RALPH_STAGES", () => {
        expect(ralphWorkflowDefinition.conductorStages).toBe(RALPH_STAGES);
    });

    test("conductorStages contains 4 valid stage definitions", () => {
        const stages = ralphWorkflowDefinition.conductorStages!;
        expect(stages).toHaveLength(4);
        for (const stage of stages) {
            expect(isStageDefinition(stage)).toBe(true);
        }
    });

    test("conductorStages IDs match expected sequence", () => {
        const ids = ralphWorkflowDefinition.conductorStages!.map((s) => s.id);
        expect(ids).toEqual(["planner", "orchestrator", "reviewer", "debugger"]);
    });

    test("createConductorGraph is a function", () => {
        expect(typeof ralphWorkflowDefinition.createConductorGraph).toBe("function");
    });

    test("createConductorGraph produces a valid compiled graph", () => {
        const graph = ralphWorkflowDefinition.createConductorGraph!();
        expect(graph.nodes.size).toBe(4);
        expect(graph.startNode).toBe("planner");
        expect(graph.endNodes.has("debugger")).toBe(true);
        expect(graph.edges).toHaveLength(3);
    });

    test("conductor graph node IDs match conductor stage IDs", () => {
        const graph = ralphWorkflowDefinition.createConductorGraph!();
        const stageIds = ralphWorkflowDefinition.conductorStages!.map((s) => s.id);
        for (const stageId of stageIds) {
            expect(graph.nodes.has(stageId)).toBe(true);
        }
    });
});
