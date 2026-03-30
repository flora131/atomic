import { describe, expect, test } from "bun:test";
import {
    buildOrchestratorPrompt,
} from "./ralph.test-support.ts";

describe("buildOrchestratorPrompt", () => {
    // ========================================================================
    // Core structure
    // ========================================================================

    test("includes all spec-required section headings (§5.3)", () => {
        const prompt = buildOrchestratorPrompt();

        // Every section from the spec must be present as a markdown heading
        expect(prompt).toContain("## Retrieve Task List");
        expect(prompt).toContain("## Dependency Graph Integrity Check");
        expect(prompt).toContain("## Dependency Rules");
        expect(prompt).toContain("## Instructions");
        expect(prompt).toContain("## IMPORTANT");
        expect(prompt).toContain("## Error Handling");
        expect(prompt).toContain("## Task Status Protocol");
    });

    test("instructs to retrieve tasks via list_tasks action", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("list_tasks");
        expect(prompt).toContain("retrieve the current task list");
        expect(prompt).toContain("task_list tool");
    });

    test("includes orchestrator role preamble", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("You are an orchestrator managing a set of implementation tasks");
    });

    // ========================================================================
    // Dependency / blockedBy enforcement
    // ========================================================================

    test("includes dependency enforcement rules", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("Dependency Rules");
        expect(prompt).toContain('status is "pending"');
        expect(prompt).toContain('"blockedBy" array have status "completed"');
        expect(prompt).toContain("Do NOT spawn a sub-agent for a task whose dependencies are not yet completed");
    });

    // ========================================================================
    // Error handling
    // ========================================================================

    test("includes error handling with retry-and-fix instructions", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("## Error Handling");
        expect(prompt).toContain("Diagnose");
        expect(prompt).toContain("Retry with fix");
        expect(prompt).toContain("Retry limit");
        expect(prompt).toContain("Continue regardless");
    });

    test("instructs retry up to 3 times before marking as error", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("Retry each failed task up to 3 times");
        expect(prompt).toContain('"error"');
    });

    test("explicitly forbids blocked-by-failure stop pattern", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("NEVER mark tasks as \"blocked-by-failure\" and stop");
        expect(prompt).toContain("complete as much work as possible");
    });

    test("includes dependency graph integrity check section", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("## Dependency Graph Integrity Check");
        expect(prompt).toContain("dangling dependency");
        expect(prompt).toContain("Remove dangling dependencies");
    });

    // ========================================================================
    // Task status protocol
    // ========================================================================

    test("includes task status protocol section", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("Task Status Protocol");
    });

    test("instructs immediate in_progress before spawning", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("IMMEDIATELY BEFORE spawning");
        expect(prompt).toContain('"in_progress"');
    });

    test("instructs immediate completed or error after sub-agent returns", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("IMMEDIATELY AFTER a sub-agent returns");
        expect(prompt).toContain('"completed"');
        expect(prompt).toContain('"error"');
    });

    test("requires separate update_task_status per completion", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("SEPARATE");
        expect(prompt).toContain("update_task_status call for each completion");
        expect(prompt).toContain("do not batch them");
    });

    test("references task_list tool and incremental API", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("task_list");
        expect(prompt).toContain("Incremental API");
        expect(prompt).toContain("updates a SINGLE task by ID");
        expect(prompt).not.toContain("TodoWrite");
        expect(prompt).not.toContain("snapshot-based API");
        expect(prompt).not.toContain("Snapshot API");
    });

    test("includes list_tasks action for checking task state", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("Checking task state");
        expect(prompt).toContain('"action": "list_tasks"');
    });

    // ========================================================================
    // Instructions for parallel dispatch
    // ========================================================================

    test("instructs to spawn all ready tasks in parallel", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("Spawn ALL ready tasks in parallel");
        expect(prompt).toContain("do not wait for one to finish");
    });

    test("has IMPORTANT as its own section heading", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("## IMPORTANT");
        expect(prompt).toContain("Do NOT serialize task execution");
    });

    test("instructs to use Task tool for sub-agent spawning", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("spawn a sub-agent using");
        expect(prompt).toContain("Task tool");
    });

    test("instructs to monitor completions and spawn newly-unblocked tasks", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("Monitor completions");
        expect(prompt).toContain("newly-unblocked tasks");
    });

    test("instructs to report summary when finished", () => {
        const prompt = buildOrchestratorPrompt();

        expect(prompt).toContain("Report a summary");
        expect(prompt).toContain("final status");
    });

    // ========================================================================
    // Determinism and idempotence
    // ========================================================================

    test("produces deterministic output for same inputs", () => {
        const prompt1 = buildOrchestratorPrompt();
        const prompt2 = buildOrchestratorPrompt();

        expect(prompt1).toBe(prompt2);
    });

    // ========================================================================
    // No inline task data (tasks come from tool)
    // ========================================================================

    test("does not contain inline task JSON block", () => {
        const prompt = buildOrchestratorPrompt();

        // The prompt should NOT contain a ```json block with task data
        // since the orchestrator retrieves tasks via list_tasks
        expect(prompt).not.toContain("```json");
        expect(prompt).not.toContain("## Task List");
    });
});
