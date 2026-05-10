import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadCustomWorkflows, mergeIntoRegistry } from "./custom-workflows.ts";
import { createBuiltinRegistry } from "./builtin-registry.ts";

const FIXTURES = join(import.meta.dir, "../../../atomic-sdk/src/runtime/__fixtures__");

describe("loadCustomWorkflows — daemon direct-import mode", () => {
  test("loads a compiled workflow source directly", async () => {
    const result = await loadCustomWorkflows(
      {
        demo: {
          command: join(FIXTURES, "default-only.ts"),
          agents: ["claude"],
        },
      },
      "local",
      "/repo/.atomic/settings.json",
    );

    expect(result.broken).toHaveLength(0);
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0]!.alias).toBe("demo");
    expect(result.loaded[0]!.workflow.name).toBe("default-only-wf");
    expect(result.loaded[0]!.workflow.agent).toBe("claude");
  });

  test("rejects legacy subprocess command registrations", async () => {
    const result = await loadCustomWorkflows(
      {
        legacy: {
          command: "bunx",
          agents: ["claude"],
        },
      },
      "global",
      "/home/user/.atomic/settings.json",
    );

    expect(result.loaded).toHaveLength(0);
    expect(result.broken).toHaveLength(1);
    expect(result.broken[0]!.reason).toContain("must be an importable workflow source file");
  });

  test("reports missing configured agent as broken", async () => {
    const result = await loadCustomWorkflows(
      {
        wrongAgent: {
          command: join(FIXTURES, "default-only.ts"),
          agents: ["opencode"],
        },
      },
      "local",
      "/repo/.atomic/settings.json",
    );

    expect(result.loaded).toHaveLength(0);
    expect(result.broken).toHaveLength(1);
    expect(result.broken[0]!.agents).toEqual(["opencode"]);
    expect(result.broken[0]!.reason).toContain("did not export a WorkflowDefinition for agent");
  });
});

describe("mergeIntoRegistry — direct workflow definitions", () => {
  test("upserts loaded workflow definitions into the registry", async () => {
    const loaded = await loadCustomWorkflows(
      {
        demo: {
          command: join(FIXTURES, "default-only.ts"),
          agents: ["claude"],
        },
      },
      "local",
      "/repo/.atomic/settings.json",
    );

    const merged = mergeIntoRegistry(createBuiltinRegistry(), { loaded: [], broken: [] }, loaded);
    expect(merged.registry.resolve("default-only-wf", "claude")).toBeDefined();
    expect(merged.summary).toContain("loaded 1 custom workflow");
  });
});
