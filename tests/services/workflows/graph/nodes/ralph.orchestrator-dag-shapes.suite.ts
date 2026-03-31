import { describe, expect, test } from "bun:test";
import {
    buildOrchestratorPrompt,
} from "./ralph.test-support.ts";

/**
 * buildOrchestratorPrompt – tool-first flow
 *
 * Previously this file tested inline task serialization into the prompt
 * (DAG shapes, blockedBy arrays, etc.). Since the orchestrator now
 * retrieves tasks via the task_list tool's list_tasks action, inline
 * task data is no longer embedded in the prompt.
 *
 * These tests verify the prompt instructs the orchestrator to use the
 * tool and that structural sections are present regardless of concurrency.
 */
describe("buildOrchestratorPrompt – tool-first flow", () => {
    test("instructs orchestrator to retrieve tasks via list_tasks", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("list_tasks");
        expect(prompt).toContain("Retrieve Task List");
        expect(prompt).toContain("task_list tool");
    });

    test("does not embed inline task JSON", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).not.toContain("```json");
        expect(prompt).not.toContain("## Task List");
    });

    test("includes all required structural sections", () => {
        const prompt = buildOrchestratorPrompt();

        const requiredSections = [
            "## Retrieve Task List",
            "## Dependency Graph Integrity Check",
            "## Dependency Rules",
            "## Instructions",
            "## Error Handling",
            "## Task Status Protocol",
        ];

        for (const section of requiredSections) {
            expect(prompt).toContain(section);
        }
    });

    test("prompt is deterministic across calls", () => {
        const a = buildOrchestratorPrompt();
        const b = buildOrchestratorPrompt();
        expect(a).toBe(b);
    });
});
