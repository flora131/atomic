import { describe, expect, test } from "bun:test";
import {
    buildOrchestratorPrompt,
    type TaskItem,
} from "./ralph.test-support.ts";

/**
 * Extract the serialized task array from a buildOrchestratorPrompt result.
 * Parses the JSON code-fenced block embedded in the prompt.
 */
function extractTasksFromPrompt(prompt: string): Array<{
    id?: string;
    description: string;
    status: string;
    summary: string;
    blockedBy: string[];
}> {
    const match = prompt.match(/```json\n([\s\S]*?)\n```/);
    if (!match) throw new Error("No JSON code fence found in prompt");
    return JSON.parse(match[1]!);
}

// ---------------------------------------------------------------------------
// Helpers to build task fixtures for each DAG shape
// ---------------------------------------------------------------------------

function task(
    id: string,
    description: string,
    status: string,
    blockedBy: string[] = [],
): TaskItem {
    return { id, description, status, summary: `Doing ${id}`, blockedBy };
}

describe("buildOrchestratorPrompt – DAG shapes", () => {
    // ========================================================================
    // Single node (trivial graph)
    // ========================================================================
    describe("single node", () => {
        const tasks: TaskItem[] = [task("A", "Only task", "pending")];

        test("serializes a single task with no dependencies", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));

            expect(parsed).toHaveLength(1);
            expect(parsed[0]!.id).toBe("A");
            expect(parsed[0]!.blockedBy).toEqual([]);
        });
    });

    // ========================================================================
    // Linear chain: A → B → C → D
    // Each task blocks exactly the next one
    // ========================================================================
    describe("linear chain (A → B → C → D)", () => {
        const tasks: TaskItem[] = [
            task("A", "Step 1", "completed"),
            task("B", "Step 2", "pending", ["A"]),
            task("C", "Step 3", "pending", ["B"]),
            task("D", "Step 4", "pending", ["C"]),
        ];

        test("each task depends on exactly its predecessor", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));

            expect(parsed).toHaveLength(4);
            expect(parsed[0]!.blockedBy).toEqual([]);
            expect(parsed[1]!.blockedBy).toEqual(["A"]);
            expect(parsed[2]!.blockedBy).toEqual(["B"]);
            expect(parsed[3]!.blockedBy).toEqual(["C"]);
        });

        test("only root task has empty blockedBy", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const roots = parsed.filter((t) => t.blockedBy.length === 0);

            expect(roots).toHaveLength(1);
            expect(roots[0]!.id).toBe("A");
        });
    });

    // ========================================================================
    // Wide parallel: A, B, C, D all independent — no edges
    // ========================================================================
    describe("wide parallel (A | B | C | D)", () => {
        const tasks: TaskItem[] = [
            task("A", "Independent 1", "pending"),
            task("B", "Independent 2", "pending"),
            task("C", "Independent 3", "pending"),
            task("D", "Independent 4", "pending"),
        ];

        test("all tasks have empty blockedBy", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));

            expect(parsed).toHaveLength(4);
            for (const t of parsed) {
                expect(t.blockedBy).toEqual([]);
            }
        });

        test("preserves insertion order of independent tasks", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const ids = parsed.map((t) => t.id);

            expect(ids).toEqual(["A", "B", "C", "D"]);
        });
    });

    // ========================================================================
    // Fan-out: A → {B, C, D}
    // One root task unblocks multiple children
    // ========================================================================
    describe("fan-out (A → B, A → C, A → D)", () => {
        const tasks: TaskItem[] = [
            task("A", "Root task", "completed"),
            task("B", "Child 1", "pending", ["A"]),
            task("C", "Child 2", "pending", ["A"]),
            task("D", "Child 3", "pending", ["A"]),
        ];

        test("all children depend on the single root", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));

            expect(parsed[0]!.blockedBy).toEqual([]);
            expect(parsed[1]!.blockedBy).toEqual(["A"]);
            expect(parsed[2]!.blockedBy).toEqual(["A"]);
            expect(parsed[3]!.blockedBy).toEqual(["A"]);
        });

        test("root is the only task with no dependencies", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const roots = parsed.filter((t) => t.blockedBy.length === 0);

            expect(roots).toHaveLength(1);
            expect(roots[0]!.id).toBe("A");
        });
    });

    // ========================================================================
    // Fan-in: {A, B, C} → D
    // Multiple independent tasks converge into one
    // ========================================================================
    describe("fan-in (A, B, C → D)", () => {
        const tasks: TaskItem[] = [
            task("A", "Prereq 1", "completed"),
            task("B", "Prereq 2", "completed"),
            task("C", "Prereq 3", "pending"),
            task("D", "Merge step", "pending", ["A", "B", "C"]),
        ];

        test("merge task depends on all prerequisite tasks", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const mergeTask = parsed.find((t) => t.id === "D")!;

            expect(mergeTask.blockedBy).toEqual(["A", "B", "C"]);
            expect(mergeTask.blockedBy).toHaveLength(3);
        });

        test("prerequisite tasks have no dependencies", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const prereqs = parsed.filter((t) => ["A", "B", "C"].includes(t.id!));

            for (const p of prereqs) {
                expect(p.blockedBy).toEqual([]);
            }
        });
    });

    // ========================================================================
    // Diamond: A → {B, C} → D
    // Fan-out then fan-in
    // ========================================================================
    describe("diamond (A → B,C → D)", () => {
        const tasks: TaskItem[] = [
            task("A", "Setup", "completed"),
            task("B", "Path left", "pending", ["A"]),
            task("C", "Path right", "pending", ["A"]),
            task("D", "Merge", "pending", ["B", "C"]),
        ];

        test("mid-layer tasks depend on root; leaf depends on both mid tasks", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));

            expect(parsed[0]!.blockedBy).toEqual([]); // A
            expect(parsed[1]!.blockedBy).toEqual(["A"]); // B
            expect(parsed[2]!.blockedBy).toEqual(["A"]); // C
            expect(parsed[3]!.blockedBy).toEqual(["B", "C"]); // D
        });

        test("exactly one root and one leaf node", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const roots = parsed.filter((t) => t.blockedBy.length === 0);
            const referenced = new Set(parsed.flatMap((t) => t.blockedBy));
            const leaves = parsed.filter((t) => !referenced.has(t.id!));

            expect(roots).toHaveLength(1);
            expect(leaves).toHaveLength(1);
            expect(leaves[0]!.id).toBe("D");
        });
    });

    // ========================================================================
    // Multi-root disconnected: {A → B}, {C → D}
    // Two independent subgraphs
    // ========================================================================
    describe("multi-root disconnected ({A→B}, {C→D})", () => {
        const tasks: TaskItem[] = [
            task("A", "Subgraph 1 root", "completed"),
            task("B", "Subgraph 1 leaf", "pending", ["A"]),
            task("C", "Subgraph 2 root", "pending"),
            task("D", "Subgraph 2 leaf", "pending", ["C"]),
        ];

        test("subgraphs have independent dependency chains", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const byId = Object.fromEntries(parsed.map((t) => [t.id, t]));

            // Subgraph 1
            expect(byId["A"].blockedBy).toEqual([]);
            expect(byId["B"].blockedBy).toEqual(["A"]);

            // Subgraph 2
            expect(byId["C"].blockedBy).toEqual([]);
            expect(byId["D"].blockedBy).toEqual(["C"]);
        });

        test("two root nodes exist", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const roots = parsed.filter((t) => t.blockedBy.length === 0);

            expect(roots).toHaveLength(2);
            expect(roots.map((r) => r.id).sort()).toEqual(["A", "C"]);
        });
    });

    // ========================================================================
    // Deep chain: A → B → C → D → E → F → G → H
    // Stress-tests long sequential dependency chains
    // ========================================================================
    describe("deep chain (8 sequential tasks)", () => {
        const ids = ["A", "B", "C", "D", "E", "F", "G", "H"];
        const tasks: TaskItem[] = ids.map((id, i) =>
            task(
                id,
                `Stage ${i + 1}`,
                i < 2 ? "completed" : "pending",
                i > 0 ? [ids[i - 1]!] : [],
            ),
        );

        test("each task depends exactly on the previous one", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));

            expect(parsed[0]!.blockedBy).toEqual([]);
            for (let i = 1; i < parsed.length; i++) {
                expect(parsed[i]!.blockedBy).toEqual([ids[i - 1]!]);
            }
        });

        test("all 8 tasks appear in the output", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));

            expect(parsed).toHaveLength(8);
            expect(parsed.map((t) => t.id)).toEqual(ids);
        });
    });

    // ========================================================================
    // Inverted tree (wide fan-in with multiple layers)
    //   A   B   C   D    (layer 0 — 4 roots)
    //    \ /     \ /
    //     E       F      (layer 1 — 2 merge nodes)
    //      \     /
    //        G           (layer 2 — final merge)
    // ========================================================================
    describe("inverted tree (multi-layer fan-in)", () => {
        const tasks: TaskItem[] = [
            task("A", "Leaf 1", "completed"),
            task("B", "Leaf 2", "completed"),
            task("C", "Leaf 3", "completed"),
            task("D", "Leaf 4", "pending"),
            task("E", "Mid-merge 1", "pending", ["A", "B"]),
            task("F", "Mid-merge 2", "pending", ["C", "D"]),
            task("G", "Final merge", "pending", ["E", "F"]),
        ];

        test("layer 0 tasks have no dependencies", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const layer0 = parsed.filter((t) => ["A", "B", "C", "D"].includes(t.id!));

            for (const t of layer0) {
                expect(t.blockedBy).toEqual([]);
            }
        });

        test("layer 1 merge nodes depend on their respective pairs", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const byId = Object.fromEntries(parsed.map((t) => [t.id, t]));

            expect(byId["E"].blockedBy).toEqual(["A", "B"]);
            expect(byId["F"].blockedBy).toEqual(["C", "D"]);
        });

        test("final merge depends on all layer 1 nodes", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const byId = Object.fromEntries(parsed.map((t) => [t.id, t]));

            expect(byId["G"].blockedBy).toEqual(["E", "F"]);
        });
    });

    // ========================================================================
    // Complex mixed DAG
    //
    //     A ──→ B ──→ D ──→ F
    //     │           ↑     ↑
    //     └──→ C ─────┘     │
    //                       │
    //     E ────────────────┘   (independent root)
    //
    //  Roots: A, E  |  Diamond: A→{B,C}→D  |  Multi-parent: F←{D,E}
    // ========================================================================
    describe("complex mixed DAG", () => {
        const tasks: TaskItem[] = [
            task("A", "Init", "completed"),
            task("B", "Build lib", "pending", ["A"]),
            task("C", "Build tests", "pending", ["A"]),
            task("D", "Integration", "pending", ["B", "C"]),
            task("E", "Fetch data", "completed"),
            task("F", "Deploy", "pending", ["D", "E"]),
        ];

        test("preserves multi-parent dependencies", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const byId = Object.fromEntries(parsed.map((t) => [t.id, t]));

            expect(byId["D"].blockedBy).toEqual(["B", "C"]);
            expect(byId["F"].blockedBy).toEqual(["D", "E"]);
        });

        test("has two independent root nodes", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const roots = parsed.filter((t) => t.blockedBy.length === 0);

            expect(roots).toHaveLength(2);
            expect(roots.map((r) => r.id).sort()).toEqual(["A", "E"]);
        });

        test("has single leaf node (Deploy)", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const referenced = new Set(parsed.flatMap((t) => t.blockedBy));
            const leaves = parsed.filter((t) => !referenced.has(t.id!));

            expect(leaves).toHaveLength(1);
            expect(leaves[0]!.id).toBe("F");
        });

        test("all 6 tasks are serialized with correct descriptions", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));

            expect(parsed).toHaveLength(6);
            expect(parsed.map((t) => t.description)).toEqual([
                "Init",
                "Build lib",
                "Build tests",
                "Integration",
                "Fetch data",
                "Deploy",
            ]);
        });
    });

    // ========================================================================
    // W-shaped DAG (two diamonds sharing a middle node)
    //
    //   A       C
    //    \     / \
    //      B      D
    //    /     \ /
    //   E       F
    //
    //  B depends on A,E (fan-in); D depends on C (linear); F depends on B,D (fan-in)
    // ========================================================================
    describe("W-shaped DAG (overlapping diamonds)", () => {
        const tasks: TaskItem[] = [
            task("A", "Source 1", "completed"),
            task("C", "Source 2", "completed"),
            task("E", "Source 3", "pending"),
            task("B", "Middle left", "pending", ["A", "E"]),
            task("D", "Middle right", "pending", ["C"]),
            task("F", "Sink", "pending", ["B", "D"]),
        ];

        test("shared-path dependencies are correctly serialized", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const byId = Object.fromEntries(parsed.map((t) => [t.id, t]));

            expect(byId["B"].blockedBy).toEqual(["A", "E"]);
            expect(byId["D"].blockedBy).toEqual(["C"]);
            expect(byId["F"].blockedBy).toEqual(["B", "D"]);
        });

        test("three root nodes and one leaf", () => {
            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const roots = parsed.filter((t) => t.blockedBy.length === 0);
            const referenced = new Set(parsed.flatMap((t) => t.blockedBy));
            const leaves = parsed.filter((t) => !referenced.has(t.id!));

            expect(roots).toHaveLength(3);
            expect(leaves).toHaveLength(1);
            expect(leaves[0]!.id).toBe("F");
        });
    });

    // ========================================================================
    // Self-contained status snapshots
    // Verifies that different DAG shapes serialize with mixed statuses
    // (simulating mid-execution states)
    // ========================================================================
    describe("mid-execution status snapshots", () => {
        test("diamond with partial completion preserves statuses", () => {
            const tasks: TaskItem[] = [
                task("A", "Setup", "completed"),
                task("B", "Left path", "in_progress", ["A"]),
                task("C", "Right path", "completed", ["A"]),
                task("D", "Merge", "pending", ["B", "C"]),
            ];

            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const byId = Object.fromEntries(parsed.map((t) => [t.id, t]));

            expect(byId["A"].status).toBe("completed");
            expect(byId["B"].status).toBe("in_progress");
            expect(byId["C"].status).toBe("completed");
            expect(byId["D"].status).toBe("pending");
            // Dependencies still correct
            expect(byId["D"].blockedBy).toEqual(["B", "C"]);
        });

        test("fan-out with errors preserves error statuses and dependencies", () => {
            const tasks: TaskItem[] = [
                task("A", "Root", "completed"),
                task("B", "Child OK", "completed", ["A"]),
                task("C", "Child fail", "error", ["A"]),
                task("D", "Child pending", "pending", ["A"]),
            ];

            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));
            const statuses = Object.fromEntries(parsed.map((t) => [t.id, t.status]));

            expect(statuses).toEqual({
                A: "completed",
                B: "completed",
                C: "error",
                D: "pending",
            });
        });

        test("deep chain with mixed completion states", () => {
            const tasks: TaskItem[] = [
                task("1", "Step 1", "completed"),
                task("2", "Step 2", "completed", ["1"]),
                task("3", "Step 3", "in_progress", ["2"]),
                task("4", "Step 4", "pending", ["3"]),
                task("5", "Step 5", "pending", ["4"]),
            ];

            const parsed = extractTasksFromPrompt(buildOrchestratorPrompt(tasks));

            expect(parsed.map((t) => t.status)).toEqual([
                "completed",
                "completed",
                "in_progress",
                "pending",
                "pending",
            ]);
            expect(parsed[4]!.blockedBy).toEqual(["4"]);
        });
    });

    // ========================================================================
    // Concurrency interaction with DAG shapes
    // Verifies the prompt adapts concurrency limits for different shapes
    // ========================================================================
    describe("concurrency interaction with DAG shapes", () => {
        test("wide parallel DAG with concurrency lower than task count", () => {
            const tasks: TaskItem[] = Array.from({ length: 6 }, (_, i) =>
                task(`T${i + 1}`, `Parallel task ${i + 1}`, "pending"),
            );

            const prompt = buildOrchestratorPrompt(tasks, { maxConcurrency: 3 });

            expect(prompt).toContain("Spawn at most 3 sub-agents in parallel");
            const parsed = extractTasksFromPrompt(prompt);
            expect(parsed).toHaveLength(6);
            for (const t of parsed) {
                expect(t.blockedBy).toEqual([]);
            }
        });

        test("linear chain with high concurrency still serializes chain deps", () => {
            const tasks: TaskItem[] = [
                task("A", "First", "completed"),
                task("B", "Second", "pending", ["A"]),
                task("C", "Third", "pending", ["B"]),
            ];

            const prompt = buildOrchestratorPrompt(tasks, { maxConcurrency: 10 });

            expect(prompt).toContain("Spawn at most 10 sub-agents in parallel");
            const parsed = extractTasksFromPrompt(prompt);
            expect(parsed[1]!.blockedBy).toEqual(["A"]);
            expect(parsed[2]!.blockedBy).toEqual(["B"]);
        });
    });

    // ========================================================================
    // Structural sections present regardless of DAG shape
    // ========================================================================
    describe("structural sections present for all DAG shapes", () => {
        const dagShapes: Record<string, TaskItem[]> = {
            "single node": [task("A", "Only", "pending")],
            "linear chain": [
                task("A", "First", "completed"),
                task("B", "Second", "pending", ["A"]),
            ],
            "wide parallel": [
                task("A", "P1", "pending"),
                task("B", "P2", "pending"),
            ],
            diamond: [
                task("A", "Root", "completed"),
                task("B", "Left", "pending", ["A"]),
                task("C", "Right", "pending", ["A"]),
                task("D", "Merge", "pending", ["B", "C"]),
            ],
        };

        const requiredSections = [
            "## Task List",
            "## Dependency Graph Integrity Check",
            "## Dependency Rules",
            "## Instructions",
            "## Concurrency Guidelines",
            "## Error Handling",
            "## Task Status Protocol",
        ];

        for (const [shapeName, tasks] of Object.entries(dagShapes)) {
            test(`${shapeName} DAG includes all required sections`, () => {
                const prompt = buildOrchestratorPrompt(tasks);

                for (const section of requiredSections) {
                    expect(prompt).toContain(section);
                }
            });
        }
    });
});
