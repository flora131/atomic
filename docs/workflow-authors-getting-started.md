# Workflow Authors: Getting Started

This guide is for authors creating custom workflows with the graph SDK and registering workflow metadata for discovery.

## 1) Define a `WorkflowDefinition`

Use `WorkflowDefinition` to declare your workflow's metadata, graph factory, and state factory. The `executeWorkflow()` function is the single entry point for running all workflows.

```ts
import type { WorkflowDefinition } from "@/commands/tui/workflow-commands.ts";
import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types.ts";

export const myWorkflowDefinition: WorkflowDefinition = {
  name: "my-workflow",
  description: "My custom workflow",
  version: "1.0.0",
  minSDKVersion: "0.4.19",
  stateVersion: 1,
  source: "builtin",

  // Option A: Provide a graph factory (builder pattern)
  createGraph: () => buildMyGraph() as unknown as CompiledGraph<BaseState>,

  // Option B: Provide declarative graphConfig instead
  // graphConfig: { nodes: [...], edges: [...] },

  createState: (params) => ({
    executionId: params.executionId,
    lastUpdated: new Date().toISOString(),
    outputs: {},
    prompt: params.prompt,
  }),
};
```

## 2) Build your first workflow graph

Define state as `BaseState` plus your domain fields, then compose nodes with the builder pattern or templates.

```ts
import { z } from "zod";
import { createNode, sequential, type BaseState } from "@bastani/atomic/graph";

interface DraftWorkflowState extends BaseState {
  prompt?: string;
  plan?: string;
  draft?: string;
}

const planNode = createNode<DraftWorkflowState>(
  "plan",
  "tool",
  async (ctx) => ({
    stateUpdate: {
      plan: `Plan for: ${ctx.state.prompt ?? "unknown task"}`,
    },
  }),
  {
    outputSchema: z.object({
      executionId: z.string(),
      lastUpdated: z.string(),
      outputs: z.record(z.string(), z.unknown()),
      prompt: z.string().optional(),
      plan: z.string().optional(),
      draft: z.string().optional(),
    }),
  },
);

const draftNode = createNode<DraftWorkflowState>("draft", "tool", async (ctx) => ({
  stateUpdate: {
    draft: `Drafted from plan: ${ctx.state.plan ?? "missing plan"}`,
  },
}));

const graph = sequential<DraftWorkflowState>([planNode, draftNode]).compile({
  outputSchema: z.object({
    executionId: z.string(),
    lastUpdated: z.string(),
    outputs: z.record(z.string(), z.unknown()),
    prompt: z.string().optional(),
    plan: z.string().optional(),
    draft: z.string().optional(),
  }),
});

// The graph is compiled and ready. Provide it via createGraph in your WorkflowDefinition.
// executeWorkflow() will call definition.createGraph() to obtain the compiled graph.
```

## 3) Stream workflow execution

`executeWorkflow()` handles streaming internally. The executor emits events through the configured event bus.

```ts
// Events are emitted through the executor's event bus.
// Use ctx.emit(type, data) inside node execution to produce custom events.
```

Use `ctx.emit(type, data)` inside node execution to produce custom `events` mode payloads.

## 4) Use templates to reduce boilerplate

The graph API exports four workflow templates:

- `sequential(nodes, config?)`
- `mapReduce({ splitter, worker, merger, config? })`
- `reviewCycle({ executor, reviewer, fixer, until, maxIterations?, config? })`
- `taskLoop({ decomposer, worker, reviewer?, until?, maxIterations?, config? })`

Templates return `GraphBuilder`, so you can keep chaining before `.compile()`.

## 5) Add workflow metadata for discovery

Custom workflow metadata files are discovered from:

- `.atomic/workflows` (local, highest priority)
- `~/.atomic/workflows` (global)

Export metadata from your workflow module:

```ts
export const name = "my-workflow";
export const description = "My custom workflow";
export const aliases = ["mw"];
export const version = "1.0.0";
export const minSDKVersion = "0.4.19";
export const stateVersion = 1;

export function migrateState(oldState: unknown, fromVersion: number) {
  // Return a BaseState-compatible shape for the new version.
  return {
    executionId: `migrated-${fromVersion}`,
    lastUpdated: new Date().toISOString(),
    outputs: {},
    previous: oldState,
  };
}
```

If `minSDKVersion` is invalid semver or newer than the current SDK, the loader logs a warning.

## 6) Migration quick reference

Legacy globals and `WorkflowSDK` were removed from the public graph API.

| Removed API | Use instead |
| --- | --- |
| `WorkflowSDK.init()` | `executeWorkflow()` via `WorkflowDefinition` |
| `WorkflowSDK.init({ providers: ... })` | Providers configured through `executeWorkflow()` options |
| `sdk.execute(graph, ...)` | `executeWorkflow(definition, prompt, context, options)` |
| `setClientProvider()` | Providers configured through `executeWorkflow()` options |
| `setSubagentBridge()` / `getSubagentBridge()` | Managed internally by `executeWorkflow()` |
| `setSubagentRegistry()` | Managed internally by `executeWorkflow()` |
| `setWorkflowResolver()` / `getWorkflowResolver()` | Managed internally by `executeWorkflow()` |

Ralph state types were moved out of `@bastani/atomic/graph`; import them from `src/services/workflows/ralph/state.ts` in this repository.
