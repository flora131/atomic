---
title: "Atomic Built-in Workflows and Commands Research"
date: "2026-02-02"
author: "Research Agent"
tags:
  - workflows
  - commands
  - skills
  - ralph
  - hitl
  - mcp
status: complete
---

# Atomic Built-in Workflows and Commands Research

## Executive Summary

This document consolidates research findings for implementing built-in commands, skills, and workflows in the Atomic TUI. The goal is to:

1. Make all slash-commands built-in to Atomic (remove per-agent definitions)
2. Make Ralph a built-in workflow
3. Support configurable workflows from `.atomic/workflows` and `~/.atomic/workflows`
4. Ensure AskUserQuestion and MCP tool rendering work correctly
5. Enable recursive workflow references (subgraph support)

## Key Findings

### 1. AskUserQuestion Tool and HITL Support

**Current Implementation Status**: Fully functional

The HITL (Human-in-the-Loop) system is implemented through:

#### SDK Event Flow
- **Event Type**: `permission.requested` (unified across all SDKs)
- **Event Data Interface**: `PermissionRequestedEventData` at `src/sdk/types.ts:359-377`

```typescript
interface PermissionRequestedEventData {
  requestId: string;
  toolName: string;
  toolInput?: unknown;
  question: string;
  header?: string;
  options: PermissionOption[];
  multiSelect?: boolean;
  respond?: (answer: string | string[]) => void;
}
```

#### UI Components
- **UserQuestionDialog**: Located in `src/ui/chat.tsx`
- **State Management**: `activeQuestion` state at `src/ui/chat.tsx:~180`
- **Handler**: `handlePermissionRequest` callback at `src/ui/chat.tsx:924-950`

#### SDK Mappings
| SDK | Tool Name | Event Mapping |
|-----|-----------|---------------|
| Claude Code | `AskUserQuestion` | `permission.requested` |
| OpenCode | `question` | `permission.requested` |
| Copilot | N/A | Uses approval flow |

#### Tool Filtering
HITL tools are hidden from tool call display at `src/ui/chat.tsx:648-656`:
```typescript
const HITL_TOOL_NAMES = ["AskUserQuestion", "question"];
const visibleToolCalls = toolCalls.filter(
  (tc) => !HITL_TOOL_NAMES.includes(tc.name)
);
```

### 2. MCP Tool Call Rendering

**Current Implementation Status**: Working via registry pattern

#### Tool Renderers Registry
Located at `src/ui/tools/registry.ts:512-525`:

```typescript
export const TOOL_RENDERERS: Record<string, ToolRenderer> = {
  Read: renderReadTool,
  Edit: renderEditTool,
  Bash: renderBashTool,
  Write: renderWriteTool,
  Glob: renderGlobTool,
  Grep: renderGrepTool,
  // MCP tools use default renderer
};
```

#### Renderer Selection
- `getToolRenderer(toolName)` returns specific renderer or default
- Default renderer handles unknown/MCP tools gracefully
- Renderers normalize parameter names across SDKs

#### Cross-SDK Parameter Normalization
The registry handles different parameter naming conventions:
- Claude: `file_path`, `command`
- OpenCode: `filePath`, `cmd`
- Copilot: Varies by tool

### 3. Command/Skill Registration Architecture

**Current Implementation**: Per-agent configuration directories

#### Current Directory Structure
| Agent | Config Dir | Commands File | Skills Dir |
|-------|------------|---------------|------------|
| Claude Code | `.claude/` | `commands.json` | `.claude/commands/` |
| OpenCode | `.opencode/` | Built into TOML | `.opencode/agents/` |
| Copilot | `.github/` | `copilot-instructions.md` | N/A |

#### Built-in Commands
Located at `src/ui/commands/builtin-commands.ts`:
- `helpCommand` - Show available commands
- `statusCommand` - Show workflow progress
- `approveCommand` - Approve spec
- `rejectCommand` - Reject spec with feedback
- `themeCommand` - Toggle theme
- `clearCommand` - Clear messages
- `compactCommand` - Compact context

#### Registration Pattern
```typescript
// src/ui/commands/builtin-commands.ts:402-409
export function registerBuiltinCommands(): void {
  for (const command of builtinCommands) {
    if (!globalRegistry.has(command.name)) {
      globalRegistry.register(command);
    }
  }
}
```

#### Proposed Change
Move all commands/skills to be built-in with Atomic, eliminating per-agent definitions:
- Create `src/ui/commands/skill-commands.ts` for skill slash commands
- Register all skills in `registerBuiltinCommands()`
- Remove dependency on `.claude/`, `.opencode/`, `.github/` for commands

### 4. Ralph Workflow Implementation

**Current Implementation**: Dual execution modes (hook-based and graph-based)

#### Hook-Based Mode (Legacy)
- Uses `src/config/ralph.ts` for session management
- Relies on file-based state in agent config directories
- Stop hooks for interruption (problematic for parallel sessions)

#### Graph-Based Mode (Recommended)
Located at `src/workflows/atomic.ts`:

```typescript
// Factory function at src/workflows/atomic.ts:~500
export function createAtomicWorkflow(config: AtomicWorkflowConfig) {
  return graph<AtomicWorkflowState>()
    .start("research")
    .then("createSpec")
    .then("waitForApproval")  // HITL node
    .then("createFeatureList")
    .loop("implementFeature", (state) => !allFeaturesComplete(state))
    .then("createPR")
    .end()
    .compile();
}
```

#### Session Management
- `generateRalphSessionId()` at `src/config/ralph.ts:~150`
- `getRalphSessionPaths(sessionId)` for session-aware file paths
- `AGENT_STATE_DIRS` mapping at `src/config/ralph.ts:~50`

#### Parallel Session Support
Current limitations:
1. File-based state conflicts when multiple sessions run
2. Stop hooks are global, affecting all sessions
3. No session isolation in hook-based mode

**Proposed Solution**: Use graph-based execution with session-scoped state.

### 5. Workflow System Architecture

#### Workflow Search Paths
Defined at `src/ui/commands/workflow-commands.ts:149-154`:

```typescript
const WORKFLOW_SEARCH_PATHS = [
  join(process.cwd(), ".atomic", "workflows"),  // Local (higher priority)
  join(process.env.HOME || "~", ".atomic", "workflows"),  // Global
];
```

#### Workflow File Format (.ts)
Expected structure for workflow files:

```typescript
// .atomic/workflows/my-workflow.ts
import type { WorkflowMetadata } from "@atomic/workflows";

export const metadata: WorkflowMetadata = {
  name: "my-workflow",
  description: "Description of the workflow",
  version: "1.0.0",
};

export function createWorkflow(config: WorkflowConfig) {
  return graph<MyWorkflowState>()
    .start("nodeA")
    .then("nodeB")
    // ... workflow definition
    .compile();
}
```

#### Dynamic Loading
`loadWorkflowsFromDisk()` at `src/ui/commands/workflow-commands.ts:218-268`:
1. Scans search paths for `.ts` files
2. Dynamically imports each workflow module
3. Extracts metadata and `createWorkflow` function
4. Local workflows override global with same name

### 6. Recursive Workflow Support (Subgraph Nodes)

#### Subgraph Node Factory
Located at `src/graph/nodes.ts:846-941`:

```typescript
export function subgraphNode<TState>(
  name: string,
  subgraph: CompiledGraph<TState>,
  options?: SubgraphNodeOptions
): GraphNode<TState> {
  return {
    name,
    type: "subgraph",
    execute: async (state, context) => {
      // Execute nested workflow
      const result = await subgraph.run(state, context);
      return result;
    },
  };
}
```

#### Usage Pattern
```typescript
const childWorkflow = createChildWorkflow(config);
const parentWorkflow = graph<ParentState>()
  .start("setup")
  .then(subgraphNode("childWorkflow", childWorkflow))
  .then("cleanup")
  .compile();
```

#### Recursive Loading
Workflows can reference other workflows by name:
1. Load workflow from search paths
2. Resolve references to other workflows
3. Create subgraph nodes for referenced workflows
4. Handle circular dependency detection

### 7. Signal-Based Control Flow

#### Available Signals
Defined in graph execution engine:
- `human_input_required` - Pause for user input (HITL)
- `checkpoint` - Save state for resumption
- `context_window_warning` - Context approaching limit

#### Wait Node for HITL
Located at `src/graph/nodes.ts:675-710`:

```typescript
export function waitNode<TState>(
  name: string,
  options: WaitNodeOptions
): GraphNode<TState> {
  return {
    name,
    type: "wait",
    execute: async (state, context) => {
      context.emit("human_input_required", {
        question: options.question,
        options: options.options,
      });
      // Execution pauses until user responds
      return await context.waitForInput();
    },
  };
}
```

## Implementation Recommendations

### Phase 1: Built-in Commands and Skills

1. **Create unified command registry**
   - Move all commands to `src/ui/commands/`
   - Create `skill-commands.ts` for workflow skills
   - Register all in `registerBuiltinCommands()`

2. **Remove per-agent dependencies**
   - Commands no longer read from `.claude/`, `.opencode/`, `.github/`
   - Skills are built-in, not loaded from agent directories

### Phase 2: Built-in Ralph Workflow

1. **Create `src/workflows/ralph.ts`**
   - Use graph-based execution only
   - Support session isolation via state scoping
   - Remove stop hook dependency

2. **Register as built-in workflow**
   - Add to `builtinWorkflows` array
   - Accessible via `/ralph` command

### Phase 3: Configurable Workflows

1. **Implement workflow loading**
   - Scan `.atomic/workflows` and `~/.atomic/workflows`
   - Support `.ts` files with metadata export
   - Local overrides global

2. **Add recursive workflow support**
   - Resolve workflow references
   - Create subgraph nodes
   - Detect circular dependencies

### Phase 4: AskUserQuestion Integration

1. **Ensure HITL works in workflows**
   - Wait nodes emit `human_input_required`
   - UI responds with `UserQuestionDialog`
   - Response flows back via `respond` callback

2. **Standardize across SDKs**
   - Map all SDK question tools to unified event
   - Normalize options format

## File References

| Component | File | Key Lines |
|-----------|------|-----------|
| SDK Types | `src/sdk/types.ts` | 359-377 (PermissionRequestedEventData) |
| Built-in Commands | `src/ui/commands/builtin-commands.ts` | 379-409 (registration) |
| Tool Renderers | `src/ui/tools/registry.ts` | 512-525 (TOOL_RENDERERS) |
| Chat UI | `src/ui/chat.tsx` | 924-950 (handlePermissionRequest) |
| Workflow Paths | `src/ui/commands/workflow-commands.ts` | 149-154 (WORKFLOW_SEARCH_PATHS) |
| Atomic Workflow | `src/workflows/atomic.ts` | Full file (graph-based workflow) |
| Graph Nodes | `src/graph/nodes.ts` | 846-941 (subgraphNode), 675-710 (waitNode) |
| Ralph Config | `src/config/ralph.ts` | 50 (AGENT_STATE_DIRS), 150 (generateRalphSessionId) |

## Historical Context

Related research documents:
- `2026-01-31-atomic-current-workflow-architecture.md` - Current workflow system
- `2026-01-31-graph-execution-pattern-design.md` - Graph engine design
- `2026-01-31-sdk-migration-and-graph-execution.md` - SDK abstraction layer
- `2026-02-01-chat-tui-parity-implementation.md` - TUI parity features
- `2026-01-31-workflow-config-semantics.md` - Workflow configuration patterns
