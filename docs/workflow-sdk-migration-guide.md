# Workflow SDK Migration Guide

This guide covers the breaking API removals introduced by the Workflow SDK standardization work.

## 1) Replace global initialization with `WorkflowSDK.init()`

### Before (removed pattern)

```ts
setClientProvider((type) => getClient(type));
setSubagentBridge(new SubagentGraphBridge(clientProvider));
setSubagentRegistry(registry);
setWorkflowResolver((name) => workflows.get(name) ?? null);
```

### After (supported pattern)

```ts
const sdk = WorkflowSDK.init({
  providers: {
    claude: claudeClient,
    opencode: opencodeClient,
    copilot: copilotClient,
  },
  agents: new Map(Object.entries(agentRegistry)),
  workflows: new Map(Object.entries(workflowRegistry)),
});
```

## 2) Removed APIs and replacements

| Removed API | Replacement |
| --- | --- |
| `setClientProvider()` | Pass providers to `WorkflowSDK.init({ providers: ... })` |
| `getClientProvider()` | Use `sdk.providerRegistry.get(name)` (or `has/list`) |
| `setSubagentBridge()` | Removed; bridge is created internally by `WorkflowSDK.init()` |
| `getSubagentBridge()` (from `src/workflows/graph/index.ts`) | Use `sdk.getSubagentBridge()` |
| `setSubagentRegistry()` | Pass agents to `WorkflowSDK.init({ agents: ... })` |
| `setWorkflowResolver()` | Pass workflows to `WorkflowSDK.init({ workflows: ... })` and/or call `sdk.registerWorkflow(name, workflow)` |
| `getWorkflowResolver()` | Removed; resolver is managed internally by `WorkflowSDK` |
| `AgentNodeAgentType` union (from `src/workflows/graph/index.ts`) | Use plain string provider names (example: `"claude"`, `"copilot"`, custom provider IDs) |
| `RalphWorkflowState` (from `src/workflows/graph/index.ts`) | Import from `src/workflows/ralph/state.ts` |
| `RalphStateAnnotation` (from `src/workflows/graph/index.ts`) | Import from `src/workflows/ralph/state.ts` |
| `RalphWorkflowState` (from `src/workflows/graph/annotation.ts`) | Import from `src/workflows/ralph/state.ts` |
| `RalphStateAnnotation` (from `src/workflows/graph/annotation.ts`) | Import from `src/workflows/ralph/state.ts` |
| `createRalphState()` (from `src/workflows/graph/annotation.ts`) | Import from `src/workflows/ralph/state.ts` |
| `updateRalphState()` (from `src/workflows/graph/annotation.ts`) | Import from `src/workflows/ralph/state.ts` |
| `isRalphWorkflowState()` (from `src/workflows/graph/annotation.ts`) | Import from `src/workflows/ralph/state.ts` |

## 3) Import path migration examples

```ts
// Before
import { RalphWorkflowState, RalphStateAnnotation } from "./src/workflows/graph/index.ts";
import { createRalphState, updateRalphState, isRalphWorkflowState } from "./src/workflows/graph/annotation.ts";

// After
import {
  RalphWorkflowState,
  RalphStateAnnotation,
  createRalphState,
  updateRalphState,
  isRalphWorkflowState,
} from "./src/workflows/ralph/state.ts";
```

## 4) New builder methods

The graph builder now supports convenient chaining methods for common node types:

- **`.subagent(config)`** — Create an agent node with `SubAgentConfig`
- **`.tool(config)`** — Create a tool node with `ToolBuilderConfig`
- **`.if(config)`** — Create conditional branching with `IfConfig` (supports `condition`, `then`, `else_if`, and `else`)

These methods automatically detect the entry point when chained as the first node, eliminating the need for explicit `.setEntryPoint()` calls.

> There are no compatibility shims for removed APIs; migration is required for compilation.
