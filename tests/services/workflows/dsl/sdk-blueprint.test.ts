/**
 * Integration test: SDK blueprint → binary loader → compiled WorkflowDefinition
 *
 * Verifies the full round-trip contract between the `@bastani/atomic` SDK
 * package and the binary's workflow loader. An SDK-produced blueprint must
 * be compilable by the binary into a valid WorkflowDefinition with
 * conductorStages and createConductorGraph.
 */

import { test, expect, describe } from "bun:test";

// SDK imports (simulates what a user workflow file does)
import {
  defineWorkflow as sdkDefineWorkflow,
} from "@/../../packages/workflow-sdk/src/define-workflow.ts";

// Binary loader
import { extractWorkflowDefinition } from "@/commands/tui/workflow-commands/workflow-files.ts";

describe("SDK blueprint → binary loader round-trip", () => {
  test("single stage workflow compiles to valid WorkflowDefinition", () => {
    // Simulate a user's .atomic/workflows/my-workflow.ts
    const compiled = sdkDefineWorkflow({
      name: "test-sdk-workflow",
      description: "A test workflow from SDK",
    })
      .version("1.0.0")
      .stage({
        name: "planner",
        agent: "planner",
        description: "Plans the work",
        prompt: (ctx) => `Plan: ${ctx.userPrompt}`,
        outputMapper: (response) => ({ plan: response }),
      })
      .compile();

    // Simulate the binary's dynamic import: module has a default export
    const mod = { default: compiled };
    const definition = extractWorkflowDefinition(mod);

    expect(definition).not.toBeNull();
    expect(definition!.name).toBe("test-sdk-workflow");
    expect(definition!.description).toBe("A test workflow from SDK");
    expect(definition!.version).toBe("1.0.0");
    expect(definition!.conductorStages).toBeDefined();
    expect(definition!.conductorStages).toHaveLength(1);
    expect(definition!.conductorStages![0]!.id).toBe("planner");
    expect(definition!.createConductorGraph).toBeInstanceOf(Function);
  });

  test("multi-stage workflow with conditionals compiles correctly", () => {
    const compiled = sdkDefineWorkflow({
      name: "conditional-wf",
      description: "Workflow with conditionals",
    })
      .stage({
        name: "analyzer",
        description: "Analyzes",
        prompt: (ctx) => ctx.userPrompt,
        outputMapper: () => ({}),
      })
      .if((ctx) => ctx.stageOutputs.has("analyzer"))
        .stage({
          name: "executor",
          description: "Executes",
          prompt: () => "execute",
          outputMapper: () => ({}),
        })
      .else()
        .stage({
          name: "fallback",
          description: "Fallback",
          prompt: () => "fallback",
          outputMapper: () => ({}),
        })
      .endIf()
      .compile();

    const definition = extractWorkflowDefinition({ default: compiled });

    expect(definition).not.toBeNull();
    expect(definition!.conductorStages).toHaveLength(3);
    const stageIds = definition!.conductorStages!.map((s) => s.id);
    expect(stageIds).toEqual(["analyzer", "executor", "fallback"]);

    // executor should have a shouldRun condition
    expect(definition!.conductorStages![1]!.shouldRun).toBeInstanceOf(Function);
  });

  test("workflow with loop compiles to graph with back-edges", () => {
    const compiled = sdkDefineWorkflow({
      name: "loop-wf",
      description: "Looping workflow",
    })
      .loop({ maxCycles: 3 })
        .stage({
          name: "worker",
          description: "Works",
          prompt: () => "work",
          outputMapper: () => ({}),
        })
        .break(() => (state) => Boolean(state.outputs["worker"]))
      .endLoop()
      .compile();

    const definition = extractWorkflowDefinition({ default: compiled });

    expect(definition).not.toBeNull();
    expect(definition!.createConductorGraph).toBeInstanceOf(Function);

    const graph = definition!.createConductorGraph!();
    expect(graph.nodes.size).toBeGreaterThan(1);
    expect(graph.edges.length).toBeGreaterThan(1);

    // Should have a back-edge labeled loop_continue
    const backEdge = graph.edges.find((e) => e.label === "loop_continue");
    expect(backEdge).toBeDefined();
  });

  test("workflow with globalState produces createState factory", () => {
    const compiled = sdkDefineWorkflow({
      name: "stateful-wf",
      description: "Stateful workflow",
      globalState: {
        count: { default: 0, reducer: "sum" as const },
        items: { default: () => [], reducer: "concat" as const },
      },
    })
      .stage({
        name: "worker",
        description: "Works",
        prompt: () => "work",
        outputMapper: () => ({}),
      })
      .compile();

    const definition = extractWorkflowDefinition({ default: compiled });

    expect(definition).not.toBeNull();
    expect(definition!.createState).toBeInstanceOf(Function);

    const state = definition!.createState!({
      prompt: "test",
      sessionId: "s1",
      sessionDir: "/tmp",
    });
    expect(state.executionId).toBeDefined();
    expect((state as unknown as Record<string, unknown>).count).toBe(0);
    expect(Array.isArray((state as unknown as Record<string, unknown>).items)).toBe(true);
  });

  test("named export is detected (not just default)", () => {
    const compiled = sdkDefineWorkflow({
      name: "named-wf",
      description: "Named export",
    })
      .stage({
        name: "s1",
        description: "d",
        prompt: () => "",
        outputMapper: () => ({}),
      })
      .compile();

    // Simulate: export const myWorkflow = defineWorkflow(...).compile()
    const mod = { myWorkflow: compiled };
    const definition = extractWorkflowDefinition(mod);

    expect(definition).not.toBeNull();
    expect(definition!.name).toBe("named-wf");
  });

  test("non-branded module returns null", () => {
    const mod = { default: { notAWorkflow: true } };
    expect(extractWorkflowDefinition(mod)).toBeNull();
  });

  test("prompt functions receive correct context shape at runtime", () => {
    let capturedPrompt = "";
    const compiled = sdkDefineWorkflow({ name: "wf", description: "d" })
      .stage({
        name: "s1",
        description: "d",
        prompt: (ctx) => {
          capturedPrompt = ctx.userPrompt;
          return `Do: ${ctx.userPrompt}`;
        },
        outputMapper: () => ({}),
      })
      .compile();

    const definition = extractWorkflowDefinition({ default: compiled });
    const stage = definition!.conductorStages![0]!;

    // Simulate conductor calling buildPrompt
    const result = stage.buildPrompt({
      userPrompt: "hello world",
      stageOutputs: new Map(),
      tasks: [],
      abortSignal: new AbortController().signal,
    });

    expect(result).toBe("Do: hello world");
    expect(capturedPrompt).toBe("hello world");
  });
});
