---
date: 2026-03-15 18:32:54 UTC
researcher: Claude Opus 4.6
git_commit: d3f22e2b5bf791dcc57580e001ac279c85390fce
branch: lavaman131/feature/code-cleanup
repository: code-cleanup
topic: "Spec 03: State Management - Chat state, parts, runtime, streaming"
tags: [spec, state-management, zustand, chat-state, parts, streaming, v2]
status: complete
last_updated: 2026-03-15
last_updated_by: Claude Opus 4.6
parent: 2026-03-15-atomic-v2-rebuild-spec-index.md
---

# Spec 03: State Management

## Current State

### Overview (18,475 lines)

The state layer is the second largest layer (23% of codebase), organized into 4 top-level modules with the chat module further decomposed into 8 sub-modules:

```
state/                          18,475 lines
├── chat/                       14,572 lines (79% of state)
│   ├── stream/                  4,381 lines (30%)
│   ├── shared/                  3,127 lines (21%)
│   ├── controller/              2,178 lines (15%)
│   ├── keyboard/                1,740 lines (12%)
│   ├── composer/                1,169 lines (8%)
│   ├── command/                   805 lines (6%)
│   ├── agent/                     656 lines (5%)
│   ├── shell/                     510 lines (3%)
│   ├── session/                     6 lines (0%)
│   └── exports.ts                (barrel)
├── streaming/                   1,853 lines
│   ├── pipeline-agents/         (agent streaming pipeline)
│   └── pipeline-tools/          (tool streaming pipeline)
├── runtime/                     1,040 lines
└── parts/                         893 lines
    └── helpers/
```

### Chat State Sub-Modules

**`stream/` (4,381 lines)** - The largest sub-module. Manages stream lifecycle:
- Starting/stopping streams
- Run tracking (monotonically increasing runId)
- Stale run detection
- Stream finalization
- Error handling during streams

**`shared/` (3,127 lines)** - Types and helpers shared across chat sub-modules:
- `types/` - Shared type definitions
- `helpers/` - Shared helper functions

**`controller/` (2,178 lines)** - UI controller bridge:
- `use-ui-controller-stack/` - Controller stack management
- Bridges between UI events and state mutations

**`keyboard/` (1,740 lines)** - Keyboard shortcut handling:
- Input processing
- Keybinding registration
- Shortcut execution

**`composer/` (1,169 lines)** - Input composition:
- Message submission
- @mention handling
- File attachment

**`command/` (805 lines)** - Slash command execution context:
- Command parsing
- Context assembly
- Result handling

**`agent/` (656 lines)** - Agent state:
- Background agent tracking
- Parallel agent tree state

**`shell/` (510 lines)** - Shell UI state:
- Scroll position
- Layout dimensions
- Footer state
- `ChatShell.tsx` - React shell component
- `use-render-model.tsx` - Render model hook

**`session/` (6 lines)** - Session lifecycle:
- Nearly empty module (only re-exports)
- Session creation/resume logic lives elsewhere

### Sub-Module Boundary Rules

Enforced by `scripts/check-submodule-boundaries.ts`:
1. No sub-module may import from another sub-module's internal files
2. Sibling imports must go through the sub-module's barrel (`index.ts`)
3. Imports from `shared/` are always allowed
4. External consumers must import from `state/chat/exports.ts`

### Parts State (`state/parts/`, 893 lines)

Manages the `Part` abstraction - a discrete renderable unit in the message stream:
- Text parts (accumulated from text.delta events)
- Tool parts (from tool.start/complete events)
- Agent parts (from agent.start/complete events)
- Reasoning/thinking parts
- Task list parts
- Compaction parts

Parts are the bridge between streaming events and rendered UI.

### Runtime State (`state/runtime/`, 1,040 lines)

Stream run runtime:
- `stream-run-runtime.ts` - StreamRunHandle, StreamRunKind, StreamRunResult, StreamRunVisibility
- Tracks active stream runs, their visibility, and lifecycle

### Streaming State (`state/streaming/`, 1,853 lines)

Pipeline processing:
- `pipeline-agents/` - Agent event processing pipeline
- `pipeline-tools/` - Tool event processing pipeline

These pipelines consume BusEvents and produce state updates.

### Issues Documented

1. **Stream module bloat**: At 4,381 lines, `state/chat/stream/` is disproportionately large. It handles stream lifecycle, stale run detection, error boundaries, retry logic, and finalization - responsibilities that could be split.

2. **Shared module size**: `state/chat/shared/` at 3,127 lines suggests the sub-module boundaries may be too fine-grained, pushing significant logic into shared code that bypasses the boundary rules.

3. **Session module emptiness**: `state/chat/session/` is 6 lines. Session lifecycle is distributed across stream, controller, and command modules instead of being centralized.

4. **Controller complexity**: The controller (2,178 lines) bridges UI and state through a "controller stack" pattern that adds indirection.

5. **Dual streaming state**: Both `state/chat/stream/` (4,381 lines) and `state/streaming/` (1,853 lines) manage streaming-related state with overlapping concerns.

6. **Event-driven state mutations**: State changes are triggered by bus event handlers subscribing imperatively, making the mutation flow hard to trace. There's no single place where you can see "this event → these state changes."

---

## V2 Spec: State Management

### Design Principle: Derived State Over Stored State

Store the minimum raw state. Derive everything else. A stream event is processed once by a reducer, and the UI subscribes to computed selectors.

### 1. Single State Store

Replace the 8 chat sub-modules with a single store that has clearly delineated slices:

```typescript
// state/store.ts
import { create } from "zustand";

interface AppState {
  // Session slice
  session: SessionState;

  // Messages slice
  messages: MessagesState;

  // Stream slice
  stream: StreamState;

  // Agents slice
  agents: AgentsState;

  // UI slice
  ui: UIState;

  // Actions (mutations)
  actions: AppActions;
}

interface SessionState {
  sessionId: string | null;
  isActive: boolean;
  contextUsage: ContextUsage | null;
  title: string | null;
  isCompacting: boolean;
}

interface MessagesState {
  /** Ordered list of message IDs */
  messageIds: string[];
  /** Map of messageId → message data */
  messages: Map<string, ChatMessage>;
  /** Map of messageId → parts */
  parts: Map<string, Part[]>;
}

interface StreamState {
  /** Current run state */
  currentRun: ActiveRun | null;
  /** Queue of pending messages */
  queue: string[];
  /** Whether stream is actively producing events */
  isStreaming: boolean;
}

interface ActiveRun {
  runId: number;
  messageId: string;
  startedAt: number;
  lastEventAt: number;
}

interface AgentsState {
  /** Active foreground agents */
  foreground: Map<string, AgentEntry>;
  /** Active background agents */
  background: Map<string, AgentEntry>;
}

interface AgentEntry {
  id: string;
  task: string;
  status: AgentStatus;
  toolUses: number;
  currentTool: string | null;
  startedAt: number;
  durationMs: number | null;
}

interface UIState {
  verboseMode: boolean;
  scrollLocked: boolean;
  modelDisplay: string;
  footerState: FooterState;
  pendingPermission: PermissionRequest | null;
  pendingHumanInput: InputRequest | null;
}
```

### 2. Event Reducer

A single pure reducer function maps `StreamEvent` → state mutations:

```typescript
// state/reducer.ts

type StateUpdate = Partial<AppState> | ((prev: AppState) => Partial<AppState>);

function reduceStreamEvent(state: AppState, event: StreamEvent): StateUpdate {
  switch (event.type) {
    case "text.delta":
      return appendTextDelta(state, event.data);

    case "text.complete":
      return finalizeText(state, event.data);

    case "thinking.delta":
      return appendThinkingDelta(state, event.data);

    case "tool.start":
      return addToolPart(state, event.data);

    case "tool.complete":
      return completeToolPart(state, event.data);

    case "agent.start":
      return addAgent(state, event.data);

    case "agent.update":
      return updateAgent(state, event.data);

    case "agent.complete":
      return completeAgent(state, event.data);

    case "session.idle":
      return finalizeStream(state);

    case "session.error":
      return handleStreamError(state, event.data);

    case "session.retry":
      return handleRetry(state, event.data);

    case "turn.start":
      return startTurn(state, event.data);

    case "turn.end":
      return endTurn(state, event.data);

    case "permission.requested":
      return showPermission(state, event.data);

    case "usage":
      return updateUsage(state, event.data);

    case "session.title_changed":
      return updateTitle(state, event.data);

    case "session.compaction":
      return updateCompaction(state, event.data);

    default:
      return {};
  }
}
```

**Key improvements**:
- Every event → state mapping is visible in one function
- Each handler is a pure function: `(state, eventData) → stateUpdate`
- No imperative subscriptions scattered across modules
- Trivially testable: `expect(reducer(initialState, event)).toEqual(expectedState)`

### 3. Parts Accumulation

Parts are accumulated directly in the reducer, not in a separate state module:

```typescript
// state/parts.ts

function appendTextDelta(state: AppState, data: { delta: string; messageId: string }): StateUpdate {
  return (prev) => {
    const parts = prev.messages.parts.get(data.messageId) ?? [];
    const lastPart = parts[parts.length - 1];

    // Append to existing text part or create new one
    if (lastPart?.type === "text") {
      const updated = [...parts];
      updated[updated.length - 1] = { ...lastPart, content: lastPart.content + data.delta };
      return {
        messages: {
          ...prev.messages,
          parts: new Map(prev.messages.parts).set(data.messageId, updated),
        },
      };
    }

    return {
      messages: {
        ...prev.messages,
        parts: new Map(prev.messages.parts).set(data.messageId, [
          ...parts,
          { type: "text", content: data.delta, messageId: data.messageId },
        ]),
      },
    };
  };
}
```

### 4. Derived State / Selectors

Common computed values are selectors, not stored state:

```typescript
// state/selectors.ts

const selectIsStreaming = (state: AppState) => state.stream.currentRun !== null;

const selectMessageCount = (state: AppState) => state.messages.messageIds.length;

const selectActiveAgents = (state: AppState) =>
  [...state.agents.foreground.values(), ...state.agents.background.values()]
    .filter(a => a.status === "running");

const selectFooterState = (state: AppState): FooterState => ({
  isStreaming: selectIsStreaming(state),
  verboseMode: state.ui.verboseMode,
  queuedCount: state.stream.queue.length,
  modelId: state.ui.modelDisplay,
  agentType: state.session.sessionId ? "active" : undefined,
});

const selectMessageParts = (state: AppState, messageId: string) =>
  state.messages.parts.get(messageId) ?? [];
```

### 5. Store Wiring

The store subscribes to the event bus and applies the reducer:

```typescript
// state/store-wiring.ts

function wireStoreToBus(store: StoreApi<AppState>, bus: EventBus): Unsubscribe {
  return bus.onAll((event) => {
    const update = reduceStreamEvent(store.getState(), event);
    if (typeof update === "function") {
      store.setState(update(store.getState()));
    } else if (Object.keys(update).length > 0) {
      store.setState(update);
    }
  });
}
```

### 6. Module Structure

```
state/
├── store.ts                  # Zustand store definition
├── reducer.ts                # StreamEvent → state mutation reducer
├── selectors.ts              # Derived state selectors
├── parts.ts                  # Part accumulation logic (used by reducer)
├── agents.ts                 # Agent state logic (used by reducer)
├── wiring.ts                 # Store ↔ EventBus connection
└── types.ts                  # State type definitions
```

**Target**: ~7 files, ~2,000 lines (down from 18,475 lines across 4 modules and 8 sub-modules).

### 7. Eliminate Sub-Module Boundaries

The current 8 chat sub-modules with enforced boundary rules add architectural overhead:
- A boundary enforcement script
- Pre-commit hooks
- Barrel exports at every level
- `shared/` module that becomes a dumping ground (3,127 lines)

With a single store + reducer pattern, the boundaries are:
- **Types** are in `types/` (shared layer)
- **State** is in the store (one location)
- **Mutations** are in the reducer (one function)
- **Selectors** are pure functions (one file)

No boundary enforcement scripts needed because there's nothing to enforce - the architecture is inherently flat.

### 8. Keyboard / Composer / Command State

Currently these are separate chat sub-modules. In V2:

- **Keyboard**: Move to UI layer (`components/keyboard-handler.ts`). Keyboard shortcuts are a UI concern, not state.
- **Composer**: Simplify to React component state. Input text, mention state, and attachment state are local to the input component.
- **Command**: Move command execution to `services/commands/executor.ts`. Command state is transient (execute and return result), not persistent.

### 9. Controller Elimination

The current "UI controller" pattern (2,178 lines) bridges UI events and state mutations through an abstraction layer. With zustand's `useStore` hooks, components subscribe to state directly:

```typescript
// Components subscribe directly to store slices
function TranscriptView() {
  const messageIds = useAppStore(state => state.messages.messageIds);
  const parts = useAppStore(state => state.messages.parts);
  // render messages from state
}

function FooterStatus() {
  const footer = useAppStore(selectFooterState);
  // render footer
}
```

No controller intermediary needed.

### 10. Testing Strategy

The reducer is a pure function, making it the primary test target:

```typescript
test("text.delta appends to existing text part", () => {
  const state = createTestState({
    messages: {
      parts: new Map([["msg-1", [{ type: "text", content: "hello", messageId: "msg-1" }]]]),
    },
  });
  const event: StreamEvent = {
    type: "text.delta",
    sessionId: "s1",
    runId: 1,
    timestamp: Date.now(),
    data: { delta: " world", messageId: "msg-1" },
  };
  const update = reduceStreamEvent(state, event);
  const newState = applyUpdate(state, update);
  expect(newState.messages.parts.get("msg-1")).toEqual([
    { type: "text", content: "hello world", messageId: "msg-1" },
  ]);
});
```

## Code References (Current)

- `src/state/chat/stream/` - Stream lifecycle (4,381 lines)
- `src/state/chat/shared/` - Shared types/helpers (3,127 lines)
- `src/state/chat/controller/` - Controller bridge (2,178 lines)
- `src/state/chat/keyboard/` - Keyboard handling (1,740 lines)
- `src/state/chat/composer/` - Input composition (1,169 lines)
- `src/state/chat/command/` - Command context (805 lines)
- `src/state/chat/agent/` - Agent state (656 lines)
- `src/state/chat/shell/` - Shell UI state (510 lines)
- `src/state/chat/session/` - Session (6 lines)
- `src/state/chat/exports.ts` - Public API barrel
- `src/state/parts/` - Part state (893 lines)
- `src/state/runtime/` - Run runtime (1,040 lines)
- `src/state/streaming/` - Streaming pipeline (1,853 lines)
- `src/scripts/check-submodule-boundaries.ts` - Boundary enforcement

## Related Research

- `research/docs/2026-02-16-atomic-chat-architecture-current.md`
- `research/docs/2026-02-16-chat-system-design-reference.md`
- `research/docs/2026-02-15-ui-inline-streaming-vs-pinned-elements.md`
- `research/docs/2026-02-16-sub-agent-tree-inline-state-lifecycle-research.md`
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md`
- `research/docs/2026-03-13-codebase-architecture-modularity-analysis.md`
