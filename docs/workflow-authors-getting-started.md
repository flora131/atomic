# Workflow Authors: Getting Started

This guide is for authors creating custom workflows with the graph SDK and registering workflow metadata for discovery.

## 1) Initialize `WorkflowSDK`

Use `WorkflowSDK.init()` as the single entry point for providers, workflow registration, and runtime defaults.

```ts
import { WorkflowSDK } from "@bastani/atomic/graph";

const sdk = WorkflowSDK.init({
  providers: {
    claude: claudeClient,
    opencode: opencodeClient,
    copilot: copilotClient,
  },
  checkpointer: "session",
  validation: true,
  defaultModel: "claude/claude-sonnet-4.5",
  maxSteps: 100,
});
```

## 2) Build your first workflow graph

Define state as `BaseState` plus your domain fields, then compose nodes with `sdk.graph()` (or templates).

```ts
import { z } from "zod";
import { WorkflowSDK, createNode, sequential, type BaseState } from "@bastani/atomic/graph";

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

const result = await sdk.execute(graph, {
  initialState: { prompt: "Write a release summary" },
});
```

## 3) Stream workflow execution

`sdk.stream()` supports multi-mode output (`values`, `updates`, `events`, `debug`).

```ts
for await (const event of sdk.stream(graph, {
  initialState: { prompt: "Write a release summary" },
  modes: ["updates", "events", "debug"],
})) {
  if (event.mode === "updates") {
    console.log("state update:", event.update);
  }
}
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

Legacy globals were removed from the public graph API.

| Removed API | Use instead |
| --- | --- |
| `setClientProvider()` | `WorkflowSDK.init({ providers: ... })` |
| `setSubagentBridge()` / `getSubagentBridge()` | Managed by `WorkflowSDK.init()` / `sdk.getSubagentBridge()` |
| `setSubagentRegistry()` | `WorkflowSDK.init({ agents: ... })` |
| `setWorkflowResolver()` / `getWorkflowResolver()` | `WorkflowSDK.init({ workflows: ... })` |

Ralph state types were moved out of `@bastani/atomic/graph`; import them from `src/workflows/ralph/state.ts` in this repository.
