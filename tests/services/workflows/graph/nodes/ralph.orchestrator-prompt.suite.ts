import { describe, expect, test } from "bun:test";
import {
    buildOrchestratorPrompt,
    type TaskItem,
} from "./ralph.test-support.ts";

describe("buildOrchestratorPrompt", () => {
    // ========================================================================
    // Core structure
    // ========================================================================

    test("includes all spec-required section headings (§5.3)", () => {
        const prompt = buildOrchestratorPrompt([]);

        // Every section from the spec must be present as a markdown heading
        expect(prompt).toContain("## Dependency Graph Integrity Check");
        expect(prompt).toContain("## Task List");
        expect(prompt).toContain("## Dependency Rules");
        expect(prompt).toContain("## Instructions");
        expect(prompt).toContain("## IMPORTANT");
        expect(prompt).toContain("## Concurrency Guidelines");
        expect(prompt).toContain("## Error Handling");
        expect(prompt).toContain("## Task Status Protocol");
    });

    test("includes task list as JSON with all required fields", () => {
        const tasks: TaskItem[] = [
            {
                id: "1",
                description: "Setup project",
                status: "pending",
                summary: "Setting up project",
                blockedBy: [],
            },
            {
                id: "2",
                description: "Implement feature",
                status: "pending",
                summary: "Implementing feature",
                blockedBy: ["1"],
            },
        ];

        const prompt = buildOrchestratorPrompt(tasks);

        // Verify JSON block contains task data
        expect(prompt).toContain('"id": "1"');
        expect(prompt).toContain('"description": "Setup project"');
        expect(prompt).toContain('"status": "pending"');
        expect(prompt).toContain('"summary": "Setting up project"');
        expect(prompt).toContain('"blockedBy": []');
        expect(prompt).toContain('"blockedBy": [\n      "1"\n    ]');
    });

    test("wraps task list JSON in a code fence", () => {
        const tasks: TaskItem[] = [
            { id: "1", description: "Task", status: "pending", summary: "Doing task" },
        ];

        const prompt = buildOrchestratorPrompt(tasks);

        expect(prompt).toContain("```json");
        expect(prompt).toContain("```\n");
    });

    test("includes orchestrator role preamble", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("You are an orchestrator managing a set of implementation tasks");
    });

    // ========================================================================
    // Dependency / blockedBy enforcement
    // ========================================================================

    test("includes dependency enforcement rules", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("Dependency Rules");
        expect(prompt).toContain('status is "pending"');
        expect(prompt).toContain('"blockedBy" array have status "completed"');
        expect(prompt).toContain("Do NOT spawn a sub-agent for a task whose dependencies are not yet completed");
    });

    test("includes blockedBy arrays from tasks in JSON output", () => {
        const tasks: TaskItem[] = [
            { id: "1", description: "First", status: "completed", summary: "First" },
            { id: "2", description: "Second", status: "completed", summary: "Second" },
            {
                id: "3",
                description: "Third",
                status: "pending",
                summary: "Third",
                blockedBy: ["1", "2"],
            },
        ];

        const prompt = buildOrchestratorPrompt(tasks);

        // The JSON should include the blockedBy references
        expect(prompt).toContain('"1"');
        expect(prompt).toContain('"2"');
    });

    test("defaults blockedBy to empty array when undefined", () => {
        const tasks: TaskItem[] = [
            { id: "1", description: "No deps", status: "pending", summary: "No deps" },
        ];

        const prompt = buildOrchestratorPrompt(tasks);

        expect(prompt).toContain('"blockedBy": []');
    });

    // ========================================================================
    // Concurrency guidelines
    // ========================================================================

    test("includes concurrency guidelines with default limit of 4", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("Concurrency Guidelines");
        expect(prompt).toContain("Spawn at most 4 sub-agents in parallel");
    });

    test("uses custom maxConcurrency when provided", () => {
        const prompt = buildOrchestratorPrompt([], { maxConcurrency: 8 });

        expect(prompt).toContain("Spawn at most 8 sub-agents in parallel");
        expect(prompt).not.toContain("Spawn at most 4 sub-agents");
    });

    test("includes concurrency replacement instruction", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("When a sub-agent completes, check for newly-unblocked tasks");
        expect(prompt).toContain("concurrency limit");
    });

    // ========================================================================
    // Error handling
    // ========================================================================

    test("includes error handling with retry-and-fix instructions", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("## Error Handling");
        expect(prompt).toContain("Diagnose");
        expect(prompt).toContain("Retry with fix");
        expect(prompt).toContain("Retry limit");
        expect(prompt).toContain("Continue regardless");
    });

    test("instructs retry up to 2 times before marking as error", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("Retry each failed task up to 2 times");
        expect(prompt).toContain('"error"');
    });

    test("explicitly forbids blocked-by-failure stop pattern", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("NEVER mark tasks as \"blocked-by-failure\" and stop");
        expect(prompt).toContain("complete as much work as possible");
    });

    test("includes dependency graph integrity check section", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("## Dependency Graph Integrity Check");
        expect(prompt).toContain("dangling dependency");
        expect(prompt).toContain("Remove dangling dependencies");
    });

    // ========================================================================
    // Task status protocol
    // ========================================================================

    test("includes task status protocol section", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("Task Status Protocol");
    });

    test("instructs immediate in_progress before spawning", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("IMMEDIATELY BEFORE spawning");
        expect(prompt).toContain('"in_progress"');
    });

    test("instructs immediate completed or error after sub-agent returns", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("IMMEDIATELY AFTER a sub-agent returns");
        expect(prompt).toContain('"completed"');
        expect(prompt).toContain('"error"');
    });

    test("requires separate update_task_status per completion", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("SEPARATE");
        expect(prompt).toContain("update_task_status call for each completion");
        expect(prompt).toContain("do not batch them");
    });

    test("references task_list tool and incremental API", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("task_list");
        expect(prompt).toContain("Incremental API");
        expect(prompt).toContain("updates a SINGLE task by ID");
        expect(prompt).not.toContain("TodoWrite");
        expect(prompt).not.toContain("snapshot-based API");
        expect(prompt).not.toContain("Snapshot API");
    });

    test("includes list_tasks action for checking task state", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("Checking task state");
        expect(prompt).toContain('"action": "list_tasks"');
    });

    // ========================================================================
    // Instructions for parallel dispatch
    // ========================================================================

    test("instructs to spawn all ready tasks in parallel", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("Spawn ALL ready tasks in parallel");
        expect(prompt).toContain("do not wait for one to finish");
    });

    test("has IMPORTANT as its own section heading", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("## IMPORTANT");
        expect(prompt).toContain("Do NOT serialize task execution");
    });

    test("instructs to use Task tool for sub-agent spawning", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("spawn a sub-agent using");
        expect(prompt).toContain("Task tool");
    });

    test("instructs to monitor completions and spawn newly-unblocked tasks", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("Monitor completions");
        expect(prompt).toContain("newly-unblocked tasks");
    });

    test("instructs to report summary when finished", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("Report a summary");
        expect(prompt).toContain("final status");
    });

    // ========================================================================
    // Task list variations
    // ========================================================================

    test("handles empty task list", () => {
        const prompt = buildOrchestratorPrompt([]);

        expect(prompt).toContain("[]");
        // All structural sections should still be present
        expect(prompt).toContain("Dependency Rules");
        expect(prompt).toContain("Concurrency Guidelines");
        expect(prompt).toContain("Error Handling");
        expect(prompt).toContain("Task Status Protocol");
    });

    test("handles tasks with mixed statuses", () => {
        const tasks: TaskItem[] = [
            { id: "1", description: "Done task", status: "completed", summary: "Done" },
            { id: "2", description: "Active task", status: "in_progress", summary: "Active" },
            { id: "3", description: "Waiting task", status: "pending", summary: "Waiting", blockedBy: ["1"] },
            { id: "4", description: "Failed task", status: "error", summary: "Failed" },
        ];

        const prompt = buildOrchestratorPrompt(tasks);

        expect(prompt).toContain('"status": "completed"');
        expect(prompt).toContain('"status": "in_progress"');
        expect(prompt).toContain('"status": "pending"');
        expect(prompt).toContain('"status": "error"');
    });

    test("handles tasks without IDs", () => {
        const tasks: TaskItem[] = [
            { description: "Anonymous task", status: "pending", summary: "Anonymous" },
        ];

        const prompt = buildOrchestratorPrompt(tasks);

        // id should appear but be undefined in JSON (or omitted)
        expect(prompt).toContain('"description": "Anonymous task"');
    });

    test("handles large task list", () => {
        const tasks: TaskItem[] = Array.from({ length: 20 }, (_, i) => ({
            id: `${i + 1}`,
            description: `Task number ${i + 1}`,
            status: i < 5 ? "completed" : "pending",
            summary: `Doing task ${i + 1}`,
            blockedBy: i > 0 ? [`${i}`] : [],
        }));

        const prompt = buildOrchestratorPrompt(tasks);

        // Verify all tasks are included
        expect(prompt).toContain('"id": "1"');
        expect(prompt).toContain('"id": "20"');
        expect(prompt).toContain('"description": "Task number 20"');
    });

    test("handles tasks with special characters in descriptions", () => {
        const tasks: TaskItem[] = [
            {
                id: "1",
                description: 'Handle "quotes" & <angle brackets> in `code`',
                status: "pending",
                summary: "Handling special chars",
            },
        ];

        const prompt = buildOrchestratorPrompt(tasks);

        // JSON.stringify handles escaping
        expect(prompt).toContain("Handle \\\"quotes\\\" & <angle brackets> in `code`");
    });

    // ========================================================================
    // Determinism and idempotence
    // ========================================================================

    test("produces deterministic output for same inputs", () => {
        const tasks: TaskItem[] = [
            { id: "1", description: "Task A", status: "pending", summary: "A", blockedBy: [] },
            { id: "2", description: "Task B", status: "pending", summary: "B", blockedBy: ["1"] },
        ];

        const prompt1 = buildOrchestratorPrompt(tasks);
        const prompt2 = buildOrchestratorPrompt(tasks);

        expect(prompt1).toBe(prompt2);
    });

    test("produces deterministic output with custom concurrency", () => {
        const tasks: TaskItem[] = [
            { id: "1", description: "Task", status: "pending", summary: "Task" },
        ];

        const prompt1 = buildOrchestratorPrompt(tasks, { maxConcurrency: 6 });
        const prompt2 = buildOrchestratorPrompt(tasks, { maxConcurrency: 6 });

        expect(prompt1).toBe(prompt2);
    });

    // ========================================================================
    // Only serializes relevant fields (no runtime-only fields)
    // ========================================================================

    test("does not leak runtime-only fields into task list JSON", () => {
        const tasks: TaskItem[] = [
            {
                id: "1",
                description: "Task",
                status: "pending",
                summary: "Doing task",
                identity: {
                    canonicalId: "canon-1",
                    providerBindings: {},
                },
                taskResult: {
                    task_id: "1",
                    tool_name: "test",
                    title: "Test",
                    status: "completed",
                    output_text: "done",
                },
            },
        ];

        const prompt = buildOrchestratorPrompt(tasks);

        expect(prompt).not.toContain("canonicalId");
        expect(prompt).not.toContain("providerBindings");
        expect(prompt).not.toContain("task_id");
        expect(prompt).not.toContain("tool_name");
        expect(prompt).not.toContain("output_text");
    });
});
