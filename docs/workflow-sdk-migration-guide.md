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
| `getSubagentBridge()` (from `src/graph/index.ts`) | Use `sdk.getSubagentBridge()` |
| `setSubagentRegistry()` | Pass agents to `WorkflowSDK.init({ agents: ... })` |
| `setWorkflowResolver()` | Pass workflows to `WorkflowSDK.init({ workflows: ... })` and/or call `sdk.registerWorkflow(name, workflow)` |
| `getWorkflowResolver()` | Removed; resolver is managed internally by `WorkflowSDK` |
| `AgentNodeAgentType` union (from `src/graph/index.ts`) | Use plain string provider names (example: `"claude"`, `"copilot"`, custom provider IDs) |
| `RalphWorkflowState` (from `src/graph/index.ts`) | Import from `src/workflows/ralph/state.ts` |
| `RalphStateAnnotation` (from `src/graph/index.ts`) | Import from `src/workflows/ralph/state.ts` |
| `RalphWorkflowState` (from `src/graph/annotation.ts`) | Import from `src/workflows/ralph/state.ts` |
| `RalphStateAnnotation` (from `src/graph/annotation.ts`) | Import from `src/workflows/ralph/state.ts` |
| `createRalphState()` (from `src/graph/annotation.ts`) | Import from `src/workflows/ralph/state.ts` |
| `updateRalphState()` (from `src/graph/annotation.ts`) | Import from `src/workflows/ralph/state.ts` |
| `isRalphWorkflowState()` (from `src/graph/annotation.ts`) | Import from `src/workflows/ralph/state.ts` |

## 3) Import path migration examples

```ts
// Before
import { RalphWorkflowState, RalphStateAnnotation } from "./src/graph/index.ts";
import { createRalphState, updateRalphState, isRalphWorkflowState } from "./src/graph/annotation.ts";

// After
import {
  RalphWorkflowState,
  RalphStateAnnotation,
  createRalphState,
  updateRalphState,
  isRalphWorkflowState,
} from "./src/workflows/ralph/state.ts";
```

> There are no compatibility shims for removed APIs; migration is required for compilation.
