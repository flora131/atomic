# Workflow UI Collapsible Phase Toggles & SDK Node Announcements

| Document Metadata      | Details             |
| ---------------------- | ------------------- |
| Author(s)              | lavaman131, Copilot |
| Status                 | In Review (RFC)     |
| Team / Owner           | Atomic CLI          |
| Created / Last Updated | 2026-02-22          |

## 1. Executive Summary

This spec proposes two interconnected changes to the workflow SDK and UI: (1) extending the workflow SDK so each graph node can declare a phase announcement message, and (2) adding collapsible toggle sections to the TUI that show per-phase event streams. Currently, phase messages are hardcoded in the UI layer (`getPhaseSummary()`) and streaming events during node execution are hidden and discarded. The proposed solution moves announcement responsibility to the SDK layer and introduces a new `WorkflowPhaseSection` component that renders each phase as a collapsible header — collapsed by default — with the full event stream expandable on click or keyboard toggle. This uses the frontend-design skill for implementation.

**Related research:** `research/docs/2026-02-22-workflow-ui-collapsible-phases-research.md`

## 2. Context and Motivation

### 2.1 Current State

The Ralph workflow executes graph nodes via `GraphExecutor.stream()` (`src/graph/compiled.ts:266-501`), yielding `StepResult` objects after each node completes. Phase announcements are generated **after node completion** by `getPhaseSummary()` (`src/ui/commands/workflow-commands.ts:558-580`), which maps hardcoded `nodeId` strings to static messages:

```typescript
if (nodeId === "review") return "[Code Review] Review completed.";
if (nodeId === "complete") return "[Workflow] Ralph workflow completed.";
```

These messages are injected as regular assistant `TextPart` messages via `context.addMessage()`. During node execution, streaming content (tool calls, agent output) is hidden via `hideStreamContentRef` and either discarded or collapsed into a single-line summary by `buildHiddenPhaseSummary()` (`src/ui/utils/hidden-phase-summary.ts`).

**Research reference:** `research/docs/2026-02-22-workflow-ui-collapsible-phases-research.md` §1-§2

### 2.2 The Problem

- **No SDK-level announcements:** `NodeResult` (`src/graph/types.ts:228-245`) has no `message` field. Phase messages are a UI-layer concern hardcoded per workflow, making the SDK non-extensible for custom workflows.
- **Lost streaming events:** Events during node execution (tool calls, agent output, progress) are hidden and discarded. Users cannot inspect what happened during a phase.
- **No collapsible sections:** Phase announcements render as flat messages in the chat stream with no structure. There is no mechanism to group events by phase or toggle visibility.
- **Static messages:** Phase summaries are hardcoded strings with no dynamic content (e.g., task counts, duration, agent names).

## 3. Goals and Non-Goals

### 3.1 Functional Goals

- [ ] Each workflow graph node can declare a phase announcement message via `NodeDefinition.phaseName` and/or return a `message` field in `NodeResult`
- [ ] Each workflow phase renders as a collapsible section in the TUI, collapsed by default
- [ ] Clicking or pressing a keyboard shortcut on a phase header expands it to show the full stream of events
- [ ] Events include: tool calls, agent output, streaming text, sub-agent spawns, errors
- [ ] Phase headers show dynamic summary text (e.g., `[Task Decomposition] Decomposed into 6 tasks.`)
- [ ] The `getPhaseSummary()` function is replaced by SDK-driven announcements
- [ ] Use the frontend-design skill for component implementation

### 3.2 Non-Goals (Out of Scope)

- [ ] We will NOT change the graph execution engine (`GraphExecutor.stream()`) control flow
- [ ] We will NOT add persistence for expanded/collapsed state across sessions
- [ ] We will NOT change the existing `TranscriptView` (Ctrl+O) behavior
- [ ] We will NOT implement filtering or searching within expanded phase events
- [ ] We will NOT modify existing non-workflow message rendering

## 4. Proposed Solution (High-Level Design)

### 4.1 System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Graph Execution                       │
│                                                         │
│  NodeDefinition                NodeResult               │
│  ┌──────────────┐             ┌──────────────┐          │
│  │ phaseName?   │             │ message?     │          │
│  │ phaseIcon?   │             │ stateUpdate  │          │
│  └──────────────┘             │ goto         │          │
│                               └──────────────┘          │
│         │                           │                    │
│         ▼                           ▼                    │
│  ┌────────────────────────────────────────┐              │
│  │         GraphExecutor.stream()         │              │
│  │  yields StepResult with phaseMessage   │              │
│  └────────────────────────────────────────┘              │
└─────────────────────┬───────────────────────────────────┘
                      │ StepResult { nodeId, phaseMessage, ... }
                      ▼
┌─────────────────────────────────────────────────────────┐
│                 Workflow Command Layer                    │
│           (workflow-commands.ts)                          │
│                                                         │
│  ┌────────────────────────────────────────┐              │
│  │    PhaseEventAccumulator               │              │
│  │    - Captures events per phase         │              │
│  │    - Tool calls, text, agent spawns    │              │
│  │    - Builds phase summary              │              │
│  └────────────────────────────────────────┘              │
│         │                                                │
│         ▼                                                │
│  context.addPhaseMessage(phaseData)                      │
└─────────────────────┬───────────────────────────────────┘
                      │ PhaseMessage { header, events[], ... }
                      ▼
┌─────────────────────────────────────────────────────────┐
│                      UI Layer                            │
│                                                         │
│  ┌────────────────────────────────────────┐              │
│  │    WorkflowPhaseSection (new)          │              │
│  │    ┌──────────────────────────────┐    │              │
│  │    │ ▸ [Code Review] Completed.   │◄───│── Click/key  │
│  │    └──────────────────────────────┘    │   to toggle  │
│  │    ┌──────────────────────────────┐    │              │
│  │    │ (expanded event stream)      │    │              │
│  │    │  ├─ Tool: grep "pattern"     │    │              │
│  │    │  ├─ Agent: analyzing code... │    │              │
│  │    │  └─ Result: 3 findings       │    │              │
│  │    └──────────────────────────────┘    │              │
│  └────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Architectural Pattern

We adopt a **producer-consumer event accumulation** pattern:

- **Producer (SDK):** Nodes declare `phaseName` in their definition and optionally return a `message` in `NodeResult`
- **Accumulator (Command):** `PhaseEventAccumulator` captures streaming events during node execution and associates them with the active phase
- **Consumer (UI):** `WorkflowPhaseSection` renders accumulated events in a collapsible section

This follows the existing pattern of `TaskListIndicator` (parent-controlled expand/collapse via props) as documented in `research/docs/2026-02-22-opentui-collapsible-components-analysis.md`.

### 4.3 Key Components

| Component                  | Responsibility                               | Location                                       | Justification                            |
| -------------------------- | -------------------------------------------- | ---------------------------------------------- | ---------------------------------------- |
| `NodeDefinition.phaseName` | Node-declared phase metadata                 | `src/graph/types.ts`                           | Moves announcements to SDK layer         |
| `NodeResult.message`       | Dynamic per-execution phase message          | `src/graph/types.ts`                           | Enables dynamic content like task counts |
| `StepResult.phaseMessage`  | Propagates phase message to consumers        | `src/graph/compiled.ts`                        | Clean data flow through execution        |
| `PhaseEventAccumulator`    | Captures events per phase during execution   | `src/ui/commands/workflow-commands.ts`         | Associates streaming events with phases  |
| `WorkflowPhaseSection`     | Collapsible phase UI component               | `src/ui/components/workflow-phase-section.tsx` | New component for phase rendering        |
| `PhaseEventList`           | Renders event stream within expanded section | `src/ui/components/phase-event-list.tsx`       | Sub-component for event display          |

## 5. Detailed Design

### 5.1 SDK Type Extensions

#### NodeDefinition Changes (`src/graph/types.ts`)

Add optional phase metadata to `NodeDefinition`:

```typescript
export interface NodeDefinition<TState extends BaseState = BaseState> {
    id: NodeId;
    type: NodeType;
    execute: NodeExecuteFn<TState>;
    // ... existing fields ...

    /** Human-readable phase name for UI display (e.g., "Code Review", "Task Decomposition") */
    phaseName?: string;
    /** Icon for the phase (e.g., "🔍", "📋"). Defaults to STATUS.active "●" */
    phaseIcon?: string;
}
```

#### NodeResult Changes (`src/graph/types.ts`)

Add optional message field to `NodeResult`:

```typescript
export interface NodeResult<TState extends BaseState = BaseState> {
    stateUpdate?: Partial<TState>;
    goto?: NodeId | NodeId[];
    signals?: SignalData[];

    /** Phase completion message for UI display. Supports dynamic content.
     *  If not provided and node has phaseName, defaults to "[{phaseName}] Completed." */
    message?: string;
}
```

#### StepResult Changes (`src/graph/compiled.ts`)

Add phase message to `StepResult`:

```typescript
export interface StepResult<TState extends BaseState = BaseState> {
    nodeId: NodeId;
    state: TState;
    result: NodeResult<TState>;
    status: ExecutionStatus;
    error?: ExecutionError;

    /** Resolved phase message for UI display */
    phaseMessage?: string;
    /** Phase name from node definition */
    phaseName?: string;
    /** Phase icon from node definition */
    phaseIcon?: string;
}
```

#### Phase Message Resolution in GraphExecutor (`src/graph/compiled.ts`)

In the `stream()` method, resolve the phase message before yielding:

```typescript
// After line ~468 in compiled.ts
const phaseMessage = result.message
  ?? (node.phaseName ? `[${node.phaseName}] Completed.` : undefined);

yield {
  nodeId: currentNodeId,
  state,
  result,
  status: isEndNode ? "completed" : "running",
  phaseMessage,
  phaseName: node.phaseName,
  phaseIcon: node.phaseIcon,
};
```

### 5.2 Node Factory Updates

#### agentNode (`src/graph/nodes.ts`)

Add `phaseName` and `phaseIcon` to `AgentNodeConfig`:

```typescript
export interface AgentNodeConfig<TState extends BaseState> {
    // ... existing fields ...
    /** Phase name for UI display */
    phaseName?: string;
    /** Phase icon for UI display */
    phaseIcon?: string;
}
```

Pass through to `NodeDefinition`:

```typescript
return {
    id,
    type: "agent" as NodeType,
    phaseName: config.phaseName,
    phaseIcon: config.phaseIcon,
    execute: async (context) => {
        /* ... */
    },
};
```

#### Similar updates for `toolNode`, `taskLoopNode`, etc.

### 5.3 Ralph Workflow Node Updates (`src/graph/workflows/ralph.ts`)

Update node definitions with phase metadata and dynamic messages:

```typescript
// Task Decomposition node
agentNode<RalphWorkflowState>({
    id: "taskDecomposition",
    phaseName: "Task Decomposition",
    phaseIcon: "📋",
    // ... existing config ...
    outputMapper: (messages, state) => {
        const tasks = parseTasks(messages);
        return {
            stateUpdate: { tasks },
            message: `[Task Decomposition] Decomposed into ${tasks.length} tasks.`,
        };
    },
});

// Review node
agentNode<RalphWorkflowState>({
    id: "review",
    phaseName: "Code Review",
    phaseIcon: "🔍",
    // ... existing config ...
    outputMapper: (messages, state) => {
        return {
            stateUpdate: { reviewResult: parseReview(messages) },
            message: "[Code Review] Review completed.",
        };
    },
});

// Complete node
toolNode<RalphWorkflowState>({
    id: "complete",
    phaseName: "Workflow",
    phaseIcon: "✓",
    // ... existing config ...
    execute: async (context) => {
        return {
            stateUpdate: {},
            message: "[Workflow] Ralph workflow completed.",
        };
    },
});
```

### 5.4 Phase Event Accumulation

#### PhaseEvent Type (`src/ui/commands/workflow-commands.ts`)

```typescript
export interface PhaseEvent {
    type:
        | "tool_call"
        | "tool_result"
        | "text"
        | "agent_spawn"
        | "agent_complete"
        | "error"
        | "progress";
    timestamp: string;
    content: string;
    metadata?: Record<string, unknown>;
}

export interface PhaseData {
    nodeId: string;
    phaseName: string;
    phaseIcon: string;
    message: string;
    events: PhaseEvent[];
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    status: "running" | "completed" | "error";
}
```

#### PhaseEventAccumulator Class

```typescript
export class PhaseEventAccumulator {
    private events: PhaseEvent[] = [];
    private startTime: number;

    constructor(public readonly nodeId: string) {
        this.startTime = Date.now();
        this.events = [];
    }

    addEvent(event: PhaseEvent): void {
        this.events.push(event);
    }

    addToolCall(toolName: string, input: string): void {
        this.events.push({
            type: "tool_call",
            timestamp: new Date().toISOString(),
            content: `${toolName}: ${input}`,
        });
    }

    addText(text: string): void {
        this.events.push({
            type: "text",
            timestamp: new Date().toISOString(),
            content: text,
        });
    }

    addAgentSpawn(name: string, task: string): void {
        this.events.push({
            type: "agent_spawn",
            timestamp: new Date().toISOString(),
            content: `Spawned ${name}: ${task}`,
        });
    }

    addAgentComplete(name: string, durationMs: number): void {
        this.events.push({
            type: "agent_complete",
            timestamp: new Date().toISOString(),
            content: `${name} completed`,
            metadata: { durationMs },
        });
    }

    addError(error: string): void {
        this.events.push({
            type: "error",
            timestamp: new Date().toISOString(),
            content: error,
        });
    }

    getEvents(): PhaseEvent[] {
        return [...this.events];
    }

    getDurationMs(): number {
        return Date.now() - this.startTime;
    }
}
```

### 5.5 Workflow Command Integration (`src/ui/commands/workflow-commands.ts`)

Replace `getPhaseSummary()` and integrate event accumulation:

```typescript
// Replace the existing getPhaseSummary() function and step loop

let currentAccumulator: PhaseEventAccumulator | null = null;
const phases: PhaseData[] = [];

// Wire up event capture callbacks in streamAndWait/spawnSubagent
const originalStreamAndWait = context.streamAndWait;
context.streamAndWait = async (message, options) => {
    // Capture streaming events
    const onChunk = options?.onChunk;
    return originalStreamAndWait(message, {
        ...options,
        onChunk: (chunk) => {
            if (currentAccumulator) {
                currentAccumulator.addText(chunk);
            }
            onChunk?.(chunk);
        },
    });
};

const originalSpawnSubagent = context.spawnSubagent;
context.spawnSubagent = async (opts) => {
    if (currentAccumulator) {
        currentAccumulator.addAgentSpawn(opts.name, opts.message);
    }
    const startTime = Date.now();
    const result = await originalSpawnSubagent(opts);
    if (currentAccumulator) {
        currentAccumulator.addAgentComplete(opts.name, Date.now() - startTime);
    }
    return result;
};

for await (const step of executor.stream({
    initialState,
    abortSignal: abortController.signal,
    workflowName: "ralph",
})) {
    const tasks = step.state.tasks ?? [];
    if (tasks.length > 0) {
        context.setTodoItems(tasks as TodoItem[]);
    }

    // Complete current phase
    if (currentAccumulator) {
        const phaseData: PhaseData = {
            nodeId: currentAccumulator.nodeId,
            phaseName: step.phaseName ?? step.nodeId,
            phaseIcon: step.phaseIcon ?? STATUS.active,
            message:
                step.phaseMessage ??
                `[${step.phaseName ?? step.nodeId}] Completed.`,
            events: currentAccumulator.getEvents(),
            startedAt: new Date(
                Date.now() - currentAccumulator.getDurationMs(),
            ).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: currentAccumulator.getDurationMs(),
            status: step.error ? "error" : "completed",
        };
        phases.push(phaseData);
        context.addPhaseMessage(phaseData);
    }

    // Start accumulator for next phase (if not completed)
    if (step.status === "running") {
        currentAccumulator = new PhaseEventAccumulator(step.nodeId);
    }

    // ... existing status handling (completed, paused, failed, cancelled) ...
}
```

### 5.6 UI Components

#### WorkflowPhaseSection (`src/ui/components/workflow-phase-section.tsx`)

New component following the `TaskListIndicator` pattern (parent-controlled expand/collapse):

```typescript
import React, { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { STATUS, TASK, MISC } from "../constants/icons.ts";
import { useThemeColors, useTheme } from "../theme.tsx";
import { formatDuration } from "../utils/format.ts";
import { SPACING } from "../constants/spacing.ts";
import type { PhaseData, PhaseEvent } from "../commands/workflow-commands.ts";

export interface WorkflowPhaseSectionProps {
  phase: PhaseData;
  expanded?: boolean;
  onToggle?: () => void;
}

export function WorkflowPhaseSection({
  phase,
  expanded = false,
  onToggle,
}: WorkflowPhaseSectionProps): React.ReactNode {
  const themeColors = useThemeColors();
  const { theme } = useTheme();

  const statusIcon = phase.status === "completed" ? STATUS.active
    : phase.status === "error" ? STATUS.error
    : STATUS.pending;

  const statusColor = phase.status === "completed" ? themeColors.success
    : phase.status === "error" ? themeColors.error
    : themeColors.accent;

  const toggleIcon = expanded ? MISC.collapsed : TASK.active;

  return (
    <box flexDirection="column" marginTop={SPACING.ELEMENT}>
      {/* Header — clickable toggle */}
      <box
        flexDirection="row"
        gap={SPACING.ELEMENT}
        onMouseDown={onToggle}
      >
        <text style={{ fg: themeColors.muted }}>{toggleIcon}</text>
        <text style={{ fg: statusColor }}>{statusIcon}</text>
        <text style={{ fg: themeColors.foreground }}>{phase.message}</text>
        {phase.durationMs && (
          <text style={{ fg: themeColors.muted }}>
            {" "}({formatDuration(phase.durationMs)})
          </text>
        )}
        {phase.events.length > 0 && !expanded && (
          <text style={{ fg: themeColors.muted }}>
            {" "}{phase.events.length} events
          </text>
        )}
      </box>

      {/* Expanded event stream */}
      {expanded && phase.events.length > 0 && (
        <PhaseEventList
          events={phase.events}
          themeColors={themeColors}
        />
      )}
    </box>
  );
}
```

#### PhaseEventList (`src/ui/components/phase-event-list.tsx`)

```typescript
import React from "react";
import { TREE, CONNECTOR } from "../constants/icons.ts";
import { SPACING } from "../constants/spacing.ts";
import { truncateText } from "../utils/format.ts";
import type { PhaseEvent } from "../commands/workflow-commands.ts";

const EVENT_ICONS: Record<PhaseEvent["type"], string> = {
  tool_call: "⚡",
  tool_result: "✓",
  text: "📝",
  agent_spawn: "🔀",
  agent_complete: "✓",
  error: "✗",
  progress: "▸",
};

export interface PhaseEventListProps {
  events: PhaseEvent[];
  themeColors: Record<string, string>;
  maxEvents?: number;
}

export function PhaseEventList({
  events,
  themeColors,
  maxEvents = 50,
}: PhaseEventListProps): React.ReactNode {
  const visibleEvents = events.slice(0, maxEvents);
  const hiddenCount = events.length - maxEvents;

  return (
    <box
      flexDirection="column"
      marginLeft={SPACING.INDENT}
      borderStyle="rounded"
      borderColor={themeColors.border}
      paddingLeft={SPACING.CONTAINER_PAD}
      paddingRight={SPACING.CONTAINER_PAD}
    >
      {visibleEvents.map((event, index) => {
        const isLast = index === visibleEvents.length - 1 && hiddenCount <= 0;
        const connector = isLast ? TREE.lastBranch : TREE.branch;
        const icon = EVENT_ICONS[event.type] ?? "·";
        const color = event.type === "error" ? themeColors.error : themeColors.muted;

        return (
          <box key={index} flexDirection="row">
            <text style={{ fg: themeColors.dim }}>{connector} </text>
            <text style={{ fg: color }}>{icon} </text>
            <text style={{ fg: color }}>
              {truncateText(event.content, 80)}
            </text>
          </box>
        );
      })}

      {hiddenCount > 0 && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {TREE.lastBranch} ...and {hiddenCount} more events
          </text>
        </box>
      )}
    </box>
  );
}
```

### 5.7 Phase State Management in Chat

Add phase tracking to `chat.tsx`:

```typescript
// New state for workflow phases
const [workflowPhases, setWorkflowPhases] = useState<PhaseData[]>([]);
const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());

// Toggle function
const togglePhase = useCallback((nodeId: string) => {
    setExpandedPhases((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
            next.delete(nodeId);
        } else {
            next.add(nodeId);
        }
        return next;
    });
}, []);

// Add to CommandContext
const addPhaseMessage = useCallback((phase: PhaseData) => {
    setWorkflowPhases((prev) => [...prev, phase]);
}, []);
```

### 5.8 Rendering Integration

Replace flat phase messages with `WorkflowPhaseSection` components in the message rendering:

```typescript
// In MessageBubble or chat rendering, replace collapsed phase messages
{workflowPhases.map(phase => (
  <WorkflowPhaseSection
    key={phase.nodeId}
    phase={phase}
    expanded={expandedPhases.has(phase.nodeId)}
    onToggle={() => togglePhase(phase.nodeId)}
  />
))}
```

### 5.9 Interaction Model

Phase toggles are **click-only** using OpenTUI's `onMouseDown` event handler on the phase header. No keyboard shortcuts are used for toggling — this is the first mouse-interactive component in the codebase.

## 6. Alternatives Considered

| Option                                            | Pros                                                                | Cons                                                         | Reason for Rejection                                       |
| ------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| A: Keep UI-layer announcements, add collapse only | Minimal SDK changes                                                 | No extensibility for custom workflows; no event streaming    | Doesn't solve the core problem of SDK-level announcements  |
| B: Event-sourcing with full replay                | Complete audit trail, replay capability                             | Over-engineered for TUI; high memory usage                   | Complexity outweighs benefit for a CLI tool                |
| C: SDK message + UI collapsible (Selected)        | Clean separation of concerns; extensible; follows existing patterns | Requires changes across SDK and UI layers                    | **Selected:** Best balance of extensibility and simplicity |
| D: Transcript mode enhancement only               | Minimal changes, reuses existing Ctrl+O                             | Doesn't provide inline phase visibility; all-or-nothing view | Users want inline phase details, not a separate view       |

## 7. Cross-Cutting Concerns

### 7.1 Performance

- **Event buffer limits:** `maxEvents` prop on `PhaseEventList` (default: 50) prevents unbounded memory growth
- **Conditional rendering:** Collapsed phases render only the header line, not event content
- **Array slicing:** Events are sliced, not filtered — O(1) for collapsed, O(n) for expanded

### 7.2 Backward Compatibility

- `NodeDefinition.phaseName` and `NodeResult.message` are optional — existing nodes work unchanged
- `StepResult.phaseMessage` is optional — existing consumers ignore it
- `getPhaseSummary()` serves as fallback until all nodes declare phase metadata

### 7.3 Testing

- **Unit tests:** `WorkflowPhaseSection` rendering with expanded/collapsed states
- **Unit tests:** `PhaseEventAccumulator` event capture and retrieval
- **Unit tests:** `StepResult.phaseMessage` resolution in `GraphExecutor`
- **Integration tests:** Full workflow execution with phase events flowing to UI

## 8. Migration, Rollout, and Testing

### 8.1 Deployment Strategy

- [ ] **Phase 1: SDK extensions** — Add `phaseName`, `phaseIcon` to `NodeDefinition`; add `message` to `NodeResult`; update `StepResult`; update `GraphExecutor` to resolve phase messages
- [ ] **Phase 2: Event accumulation** — Implement `PhaseEventAccumulator`; integrate with `streamAndWait` and `spawnSubagent` callbacks in workflow-commands.ts
- [ ] **Phase 3: UI components** — Create `WorkflowPhaseSection` and `PhaseEventList` components using the frontend-design skill; add keyboard shortcuts
- [ ] **Phase 4: Ralph workflow migration** — Update Ralph node definitions with `phaseName`/`phaseIcon`; add dynamic `message` returns; remove `getPhaseSummary()` fallback
- [ ] **Phase 5: Chat integration** — Wire phase state into `chat.tsx`; replace collapsed phase messages with `WorkflowPhaseSection` components

### 8.2 Test Plan

- **Unit Tests:**
    - `WorkflowPhaseSection` renders collapsed/expanded correctly
    - `PhaseEventList` renders events with proper tree connectors
    - `PhaseEventAccumulator` captures tool calls, text, agent events
    - `NodeResult.message` resolves through `StepResult.phaseMessage`
    - Toggle state management (expand/collapse/expand-all)
- **Integration Tests:**
    - Full Ralph workflow produces correct phase messages
    - Events captured during `streamAndWait` appear in phase events
    - Sub-agent spawns appear in phase events
    - Keyboard shortcuts (Ctrl+P) toggle phases correctly
- **E2E Tests:**
    - Run `/ralph` command and verify phase sections render
    - Click on phase header to expand event stream
    - Verify event stream contents match actual execution

## 9. Open Questions / Resolved

- [x] **Q1: Keyboard shortcut for expand/collapse** — **Resolved: Click only, no keyboard shortcut.** Individual phases toggle via mouse click only. No Ctrl+P or per-phase keyboard shortcut.
- [x] **Q2: Event granularity** — **Resolved: Show all individual events (tool calls, text chunks).** Full granularity — every tool call, text chunk, agent spawn, and completion is captured and displayed.
- [x] **Q3: Mouse support** — **Resolved: Yes, introduce mouse click support for toggles.** This will be the first mouse-interactive component in the codebase, using OpenTUI's `onMouseDown` event handler.
- [x] **Q4: Phase message format** — **Resolved: Enforce bracket format `[Phase Name] Message`.** The SDK will enforce the `[PhaseName] Message` format for consistency with the existing UI pattern.
- [x] **Q5: Event persistence** — **Resolved: No persistence, events are ephemeral.** Phase events are kept in-memory only and discarded when the session ends. No disk persistence.
