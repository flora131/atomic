/**
 * Tests for Ralph Workflow Definition
 */

import { describe, test, expect } from "bun:test";
import { ralphWorkflowDefinition, ralphNodeDescriptions } from "./definition.ts";
import { VERSION } from "../../version.ts";
import type { RalphWorkflowState } from "./state.ts";

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
});
