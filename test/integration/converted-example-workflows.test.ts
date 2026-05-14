import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import { discoverWorkflows } from "../../src/extension/discovery.js";
import {
  runWorkflowSdkEntrypoint,
  type WorkflowSdkEntrypointResult,
} from "../../src/runs/shared/workflow-sdk-entrypoint.js";
import type { StageSessionRuntime } from "../../src/runs/foreground/stage-runner.js";

const convertedExamples = [
  {
    name: "atomic-example-hello-world",
    args: ["who=pi"],
    expectedStages: 1,
  },
  {
    name: "atomic-example-goodbye",
    args: ["tone=casual"],
    expectedStages: 1,
  },
  {
    name: "atomic-example-commander-embed-greet",
    args: ["who=Alex"],
    expectedStages: 1,
  },
  {
    name: "atomic-example-explain-file",
    args: ["path=src/index.ts"],
    expectedStages: 1,
  },
  {
    name: "atomic-example-sequential-describe-summarize",
    args: ["topic=TypeScript"],
    expectedStages: 2,
  },
  {
    name: "atomic-example-parallel-hello-world",
    args: ["topic=project launch", "tone=warm"],
    expectedStages: 4,
  },
  {
    name: "atomic-example-headless-fanout",
    args: ["prompt=TypeScript"],
    expectedStages: 6,
  },
  {
    name: "atomic-example-hil-favorite-color",
    args: [],
    expectedStages: 2,
  },
  {
    name: "atomic-example-hil-favorite-color-headless",
    args: [],
    expectedStages: 1,
  },
  {
    name: "atomic-example-structured-output",
    args: ["prompt=Python"],
    expectedStages: 1,
  },
  {
    name: "atomic-example-review-fix-loop",
    args: ["topic=adopting Bun", "max_iterations=3"],
    expectedStages: 2,
  },
  {
    name: "atomic-example-reviewer-tool-test",
    args: [],
    expectedStages: 1,
  },
  {
    name: "atomic-example-pane-navigation",
    args: [],
    expectedStages: 3,
  },
  {
    name: "atomic-example-background-subagents",
    args: [],
    expectedStages: 2,
  },
  {
    name: "atomic-example-empty-fanout",
    args: ["branches=0"],
    expectedStages: 1,
  },
] as const;

const upstreamExampleCoverage = [
  { source: "examples/claude-background-subagents", workflows: ["atomic-example-background-subagents"] },
  { source: "examples/commander-embed", workflows: ["atomic-example-commander-embed-greet"] },
  { source: "examples/custom-workflow-bunx", workflows: ["atomic-example-explain-file"] },
  { source: "examples/headless-test", workflows: ["atomic-example-headless-fanout"] },
  { source: "examples/hello-world", workflows: ["atomic-example-hello-world"] },
  { source: "examples/hil-favorite-color", workflows: ["atomic-example-hil-favorite-color"] },
  { source: "examples/hil-favorite-color-headless", workflows: ["atomic-example-hil-favorite-color-headless"] },
  { source: "examples/multi-workflow", workflows: ["atomic-example-hello-world", "atomic-example-goodbye"] },
  { source: "examples/pane-navigation", workflows: ["atomic-example-pane-navigation"] },
  { source: "examples/parallel-hello-world", workflows: ["atomic-example-parallel-hello-world"] },
  { source: "examples/review-fix-loop", workflows: ["atomic-example-review-fix-loop"] },
  { source: "examples/reviewer-tool-test", workflows: ["atomic-example-reviewer-tool-test"] },
  { source: "examples/sequential-describe-summarize", workflows: ["atomic-example-sequential-describe-summarize"] },
  { source: "examples/structured-output-demo", workflows: ["atomic-example-structured-output"] },
] as const;

const convertedNames = new Set(convertedExamples.map((workflow) => workflow.name));

function responseForPrompt(prompt: string): string {
  if (prompt.includes("Return JSON facts")) {
    return JSON.stringify({
      language: "Python",
      primaryUse: "application and automation development",
      strengths: ["readability", "ecosystem"],
    });
  }
  if (prompt.includes("Review this draft.")) {
    return "CLEAN";
  }
  if (prompt.includes("Return JSON only with this exact shape:")) {
    return JSON.stringify({
      verdict: "patch is correct",
      explanation: "The patch expands the abbreviated greeting to a clearer full word.",
    });
  }
  if (prompt.includes("Pretend to dispatch three independent background subagents")) {
    return "bg-1 dispatched\nbg-2 dispatched\nbg-3 dispatched";
  }
  if (prompt.includes("No branches ran")) {
    return "empty fanout completed";
  }
  return `sdk:${prompt.split("\n")[0] ?? prompt}`;
}

function makeSessionFactory(prompts: string[]) {
  return async (_options?: CreateAgentSessionOptions): Promise<{ session: StageSessionRuntime }> => {
    let lastAssistantText: string | undefined;
    const session: StageSessionRuntime = {
      async prompt(text: string): Promise<string> {
        prompts.push(text);
        lastAssistantText = responseForPrompt(text);
        return lastAssistantText;
      },
      async steer(_text: string): Promise<void> {},
      async followUp(_text: string): Promise<void> {},
      subscribe(): () => void {
        return () => {};
      },
      sessionFile: undefined,
      sessionId: `converted-example-${crypto.randomUUID()}`,
      async setModel(_model): Promise<void> {},
      setThinkingLevel(_level): void {},
      async cycleModel() {
        return undefined;
      },
      cycleThinkingLevel() {
        return undefined;
      },
      agent: Object.create(null) as StageSessionRuntime["agent"],
      model: undefined,
      thinkingLevel: "off",
      messages: [] as StageSessionRuntime["messages"],
      isStreaming: false as StageSessionRuntime["isStreaming"],
      async navigateTree(): ReturnType<StageSessionRuntime["navigateTree"]> {
        return { cancelled: true };
      },
      async compact(): ReturnType<StageSessionRuntime["compact"]> {
        return { summary: "", firstKeptEntryId: "", tokensBefore: 0 };
      },
      abortCompaction(): void {},
      async abort(): Promise<void> {},
      dispose(): void {},
      getLastAssistantText(): string | undefined {
        return lastAssistantText;
      },
    };
    return { session };
  };
}

function assertCompleted(
  result: WorkflowSdkEntrypointResult,
): asserts result is Extract<WorkflowSdkEntrypointResult, { status: "completed" }> {
  assert.equal(result.handled, true);
  assert.equal(result.status, "completed", "workflow SDK entrypoint should complete");
  assert.equal(result.details.status, "completed");
}

describe("converted project-local example workflows", () => {
  test("discoverWorkflows loads every converted example from .pi/workflows", async () => {
    const discovery = await discoverWorkflows({
      cwd: process.cwd(),
      homeDir: `${process.cwd()}/.pi/tmp/home-for-converted-example-tests`,
      includeBundled: false,
    });

    const names = discovery.registry.names();
    for (const workflow of convertedExamples) {
      assert.ok(names.includes(workflow.name), `missing ${workflow.name}`);
      const source = discovery.sources.find((item) => item.id === workflow.name);
      assert.equal(source?.kind, "project-local");
      assert.ok(source?.filePath?.endsWith(".pi/workflows/converted-examples.ts"));
    }
    assert.equal(discovery.errors.filter((error) => error.level === "error").length, 0);
  });

  test("documents coverage for every upstream atomic examples directory", () => {
    assert.equal(upstreamExampleCoverage.length, 14);
    for (const entry of upstreamExampleCoverage) {
      assert.match(entry.source, /^examples\//);
      for (const workflow of entry.workflows) {
        assert.ok(convertedNames.has(workflow), `${entry.source} maps to missing ${workflow}`);
      }
    }
  });

  for (const workflow of convertedExamples) {
    test(`runs ${workflow.name} through the non-interactive SDK path`, async () => {
      const prompts: string[] = [];
      const result = await runWorkflowSdkEntrypoint({
        argv: ["--workflow", workflow.name, ...workflow.args],
        cwd: process.cwd(),
        homeDir: `${process.cwd()}/.pi/tmp/home-for-converted-example-tests`,
        adapterOptions: { createAgentSession: makeSessionFactory(prompts) },
      });

      assertCompleted(result);
      const { progress } = result.details;
      assert.ok(progress);
      assert.equal(progress.total, workflow.expectedStages);
      assert.equal(progress.completed, workflow.expectedStages);
      assert.equal(prompts.length, workflow.expectedStages);
    });
  }
});
