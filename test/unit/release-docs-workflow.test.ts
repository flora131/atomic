import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { mergeStaleDocTasksByOwnerDocs, type StaleDocTask } from "../../.atomic/workflow-utils/release-docs.js";

const task = (id: string, ownerDocs: string[]): StaleDocTask => ({
    id,
    title: `Task ${id}`,
    owner_docs: ownerDocs,
    reason: `Reason ${id}`,
    source_refs: [`src/${id}.ts`],
    update_instructions: `Update ${id}`,
    acceptance_criteria: [`Criteria ${id}`],
});

describe("release-docs stale-doc task merging", () => {
    test("merges tasks that share owner docs before fan-out", () => {
        const merged = mergeStaleDocTasksByOwnerDocs([
            task("cli-flags", ["packages/coding-agent/docs/cli.mdx"]),
            task("workflows", ["packages/coding-agent/docs/workflows.mdx"]),
            task("cli-examples", ["./packages/coding-agent/docs/cli.mdx"]),
        ]);

        assert.equal(merged.length, 2);
        assert.deepEqual(merged[0]?.owner_docs, ["packages/coding-agent/docs/cli.mdx"]);
        assert.match(merged[0]?.update_instructions ?? "", /cli-flags/);
        assert.match(merged[0]?.update_instructions ?? "", /cli-examples/);
        assert.deepEqual(merged[1]?.owner_docs, ["packages/coding-agent/docs/workflows.mdx"]);
    });

    test("merges transitive owner-doc overlaps into one component", () => {
        const merged = mergeStaleDocTasksByOwnerDocs([
            task("a", ["packages/coding-agent/docs/a.mdx"]),
            task("b", ["packages/coding-agent/docs/a.mdx", "packages/coding-agent/docs/b.mdx"]),
            task("c", ["packages/coding-agent/docs/b.mdx"]),
            task("d", ["packages/coding-agent/docs/d.mdx"]),
        ]);

        assert.equal(merged.length, 2);
        assert.deepEqual(merged[0]?.owner_docs, [
            "packages/coding-agent/docs/a.mdx",
            "packages/coding-agent/docs/b.mdx",
        ]);
        assert.match(merged[0]?.id ?? "", /^merged-/);
        assert.deepEqual(merged[1]?.owner_docs, ["packages/coding-agent/docs/d.mdx"]);
    });

    test("deduplicates owner docs on standalone tasks", () => {
        const [deduped] = mergeStaleDocTasksByOwnerDocs([
            task("a", ["packages/coding-agent/docs/a.mdx", "./packages/coding-agent/docs/a.mdx"]),
        ]);

        assert.deepEqual(deduped?.owner_docs, ["packages/coding-agent/docs/a.mdx"]);
    });
});
