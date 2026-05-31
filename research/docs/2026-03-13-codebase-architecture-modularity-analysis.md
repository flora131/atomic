---
date: 2026-03-13 22:56:50 UTC
researcher: Copilot (Claude Opus 4.6)
git_commit: 555751436d1f71a29ee56397166de9cccbcb74ce
branch: lavaman131/feature/code-cleanup
repository: atomic
topic: "Codebase Architecture, Module Boundaries, Dependency Graph, and Coupling Analysis"
tags: [research, codebase, architecture, modularity, coupling, dependency-graph, change-propagation]
status: complete
last_updated: 2026-03-13
last_updated_by: Copilot (Claude Opus 4.6)
---

# Codebase Architecture & Modularity Analysis

## Research Question

Document the current codebase architecture, module boundaries, dependency graph, and coupling patterns to identify how code is organized, where tight coupling exists, how changes propagate across modules, and what the current separation of concerns looks like — in preparation for re-modularization.

## Summary

The Atomic CLI is a 576-file TypeScript TUI application organized into 11 top-level `src/` modules. It uses a React (OpenTUI) + hooks-based architecture with three AI agent backends (Claude, OpenCode, Copilot) normalized through a unified `CodingAgentClient` interface and an event bus streaming pipeline. The codebase exhibits a **hub-and-spoke dependency pattern** centered on `services/agents/types.ts` (109 imports, 54 external) with the `state/` module as the most interconnected (270 cross-module imports). There are **9 bidirectional circular dependency pairs** at the module level. The architecture's key structural concerns center around: tight coupling between `state/chat/` and nearly every other module, the `lib/ui/` module acting as a "gravity well" for business logic that belongs closer to its consumers, `screens/chat-screen.tsx` functioning as both a React component AND a type-export hub, and `state/parts/types.ts` importing from `components/` (upward dependency).

---

## Detailed Findings

### 1. Top-Level Module Map

```
src/
├── cli.ts              # Process entry point (Commander.js)
├── app.tsx             # TUI entry point (React/OpenTUI renderer)
├── version.ts          # Version constant
├── commands/           # CLI + TUI command definitions
│   ├── catalog/        #   File-based agent/skill discovery
│   ├── cli/            #   Commander.js CLI actions (chat, init, update, uninstall, config)
│   ├── core/           #   CommandRegistry class + CommandDefinition types
│   └── tui/            #   Slash commands for the interactive TUI
├── components/         # React/OpenTUI presentational components
│   ├── message-parts/  #   Part-based message renderers (PART_REGISTRY)
│   ├── model-selector/ #   Model picker UI
│   └── tool-registry/  #   Tool-specific result renderers
├── hooks/              # React hooks (message queue, verbose mode) — isolated
├── lib/                # Shared utilities
│   ├── markdown.ts     #   YAML frontmatter parser
│   ├── merge.ts        #   JSON config merging
│   ├── path-root-guard.ts # Path traversal protection
│   └── ui/             #   ~35 files of UI/business logic utilities
├── screens/            # Top-level screen components
│   └── chat-screen.tsx #   The single screen (also re-exports types)
├── services/           # Backend services
│   ├── agents/         #   Unified client abstraction + SDK implementations
│   ├── config/         #   Configuration loading/discovery/settings
│   ├── events/         #   Event bus + adapters + consumers
│   ├── models/         #   Model listing/selection operations
│   ├── system/         #   OS utilities (detect, copy, cleanup, download)
│   ├── telemetry/      #   Usage tracking + upload
│   ├── terminal/       #   Tree-sitter assets for syntax highlighting
│   └── workflows/      #   Graph execution engine + Ralph workflow
├── state/              # State management
│   ├── chat/           #   Main chat state machine (~55 hooks + helpers)
│   ├── parts/          #   Message part store + type system
│   ├── runtime/        #   Imperative runtime (controller, stream adapter)
│   └── streaming/      #   Event-to-part reducer pipeline
├── theme/              # Colors, palettes, icons, spacing, syntax themes
│   └── banner/         #   ASCII art banner
├── types/              # Convenience re-export barrels
│   ├── chat.ts         #   → state/chat/shared/types/
│   └── ui.ts           #   → FooterState, VerboseProps, etc.
└── scripts/            # Build/dev scripts
```

### 2. Dual-Entry Architecture

#### `src/cli.ts` — Process Entry Point
- Creates Commander.js `program` with 6 commands: `init`, `chat` (default), `config set`, `update`, `uninstall`, `upload-telemetry` (hidden)
- All commands use **lazy dynamic imports** (`await import(...)`) to keep startup fast
- The `chat` command action validates agent type against `AGENT_CONFIG`, validates theme, then delegates to `chatCommand()` from `commands/cli/chat.ts`
- `main()` orchestrates: Windows cleanup → `program.parseAsync()` → `spawnTelemetryUpload()`
- **Imports from**: `@commander-js/extra-typings`, `@/version`, `@/theme/colors`, `@/services/config/`

#### `src/app.tsx` — TUI Entry Point
- `startChatUI()` bridges CLI commands to React TUI rendering:
  1. Creates model operations, runtime state, controller
  2. Runs `initializeCommandsAsync()` + client start in parallel
  3. Initializes tree-sitter assets
  4. Creates OpenTUI CLI renderer (mouse tracking, alt screen, Kitty keyboard)
  5. Renders: `ThemeProvider` → `EventBusProvider` → `AppErrorBoundary` → `ChatApp`
- **Heavy re-export surface**: re-exports from `screens/`, `state/`, `theme/`, `components/`, `commands/`
- **Imports from**: `@opentui/core`, `@opentui/react`, `@/screens/`, `@/theme/`, `@/components/`, `@/services/`, `@/state/runtime/`, `@/commands/tui/`

### 3. Agent Service Layer (`services/agents/`)

The agent services provide a **Strategy Pattern** abstraction for three coding agent SDKs:

#### Contracts (`contracts/`)
- `CodingAgentClient` interface — the central abstraction with: `createSession`, `resumeSession`, `on`, `registerTool`, `start`/`stop`, `getModelDisplayInfo`, etc.
- `EventType` union (12 types) + `AgentEvent` envelope
- `Session` interface with `sendMessage()`, `getMessages()`, `interrupt()`
- `ToolDefinition` with Zod-based `inputSchema`
- `ModelDisplayInfo`, `McpConfig`, `SubagentStreamMetadata`

#### Client Implementations (`clients/`)
- `ClaudeAgentClient` (18 internal sub-modules) — uses Claude Agent SDK v1 `query()` patterns
- `OpenCodeClient` (26 internal sub-modules) — uses SDK v2 client/server with SSE
- `CopilotClient` (11 internal sub-modules) — uses streaming deltas with permission/user-input callbacks
- Each implementation conforms to `CodingAgentClient` via `start()`/`createSession()`/event emission

#### Tools (`tools/`)
- `ToolRegistry` — singleton `Map<name, ToolEntry>` with `register`/`get`/`list`
- `tool()` factory + Zod schema DSL (`@atomic/plugin` pattern)
- `discovery.ts` — filesystem scanning + dynamic import for custom tools
- `opencode-mcp-bridge.ts` — HTTP IPC bridge for OpenCode tool dispatch
- Built-in `todo-write.ts` tool

### 4. Event Bus System (`services/events/`)

A pub/sub streaming architecture normalizing SDK events to unified `BusEvent` types:

#### Core Bus
- `EventBus` — type-safe pub/sub with 30 event types across `stream.*` and `workflow.*` namespaces
- `BusEvent<T>` envelope: `type`, `sessionId`, `runId`, `timestamp`, `data`
- `EnrichedBusEvent` adds: `resolvedToolId`, `resolvedAgentId`, `isSubagentTool`, `suppressFromMainChat`, `parentAgentId`
- Runtime Zod validation on `publish()` — drops events on schema failure
- `onAll()` wildcard handler support, `onInternalError()` error channel

#### BatchDispatcher
- Double-buffer swap design with 16ms frame-aligned flushing (~60fps)
- `CoalescingMap` — replaces superseded events (e.g., `stream.text.delta` → `stream.text.complete`)
- Stale delta elimination
- `MAX_BUFFER_SIZE = 10,000` overflow protection (drops oldest non-lifecycle events)
- Lifecycle events (`stream.session.*`) are never dropped

#### Adapters (SDK → BusEvent)
- `OpenCodeStreamAdapter`, `ClaudeStreamAdapter`, `CopilotStreamAdapter`
- `SubagentStreamAdapter` — handles sub-agent event routing
- `WorkflowAdapter` — workflow step/task events
- Each adapter translates SDK-native events to `BusEvent` types

#### Consumers (BusEvent → UI Pipeline)
- `CorrelationService` — enriches events with tool/agent correlation metadata
- `EchoSuppressor` — prevents duplicate/echo events
- `StreamPipelineConsumer` — transforms `BusEvent` → `StreamPartEvent` for the parts reducer
- `wireConsumers()` — sets up the full consumer chain

### 5. Workflow Engine (`services/workflows/`)

A graph-based execution system for multi-agent coding workflows:

#### Graph Engine (`graph/`)
- **LangGraph-inspired** annotation system with state reducers
- `GraphBuilder` fluent API: `.start()`, `.then()`, `.if()`, `.else()`, `.endif()`, `.loop()`, `.parallel()`, `.compile()`
- `GraphExecutor` with BFS traversal, exponential backoff retry, immutable state merging
- 7 node types: `agent`, `tool`, `decision`, `wait`, `ask_user`, `subgraph`, `parallel`
- `Checkpointer` interface with 4 implementations: `MemorySaver`, `FileSaver`, `ResearchDirSaver`, `SessionDirSaver`
- `ProviderRegistry` — immutable registry of `AgentProvider` instances
- `SubagentTypeRegistry` — maps names → `AgentInfo` for sub-agent spawning

#### Ralph Workflow (`ralph/`)
- The primary concrete workflow — autonomous implementation: decompose tasks → dispatch workers → review/fix cycles
- `createRalphWorkflow()` builds graph with planner → worker → reviewer nodes
- `RalphWorkflowState` extends `BaseState` with task-specific fields
- **Key finding**: Ralph bypasses `WorkflowSDK` at runtime — uses ad-hoc dependency construction

#### Runtime Executor (`runtime/`)
- `executeWorkflow()` — top-level entry point called from TUI commands
- `session-runtime.ts` — session + event adapter initialization
- `graph-helpers.ts` — `compileGraphConfig()`, `createSubagentRegistry()`
- `task-persistence.ts` — debounced task save + status event wiring

### 6. State Management (`state/`)

#### Parts Store (`parts/`)
- `Part` discriminated union — 10 concrete types: `TextPart`, `ReasoningPart`, `ToolPart`, `AgentPart`, `TaskListPart`, `SkillLoadPart`, `McpSnapshotPart`, `CompactionPart`, `TaskResultPart`, `WorkflowStepPart`
- `PartId` — branded string with `part_<timestamp>_<counter>` format (lexicographic = chronological)
- Binary search insertion/update for sorted `Part[]` arrays
- `ToolState` finite state machine: `pending → running → completed | error | interrupted`

#### Streaming Pipeline (`streaming/`)
- `StreamPartEvent` discriminated union — 14 event types
- `applyStreamPartEvent(message, event)` — pure reducer function
- Sub-pipelines: `pipeline-thinking.ts`, `pipeline-tools/`, `pipeline-agents/`, `pipeline-workflow.ts`
- Agent event buffering when `AgentPart` not yet materialized

#### Chat State (`chat/`) — The Largest Module (~55 hooks)
- `ChatShell.tsx` — main shell component orchestrating all hooks
- **Sub-systems**: agent, stream, composer, command, keyboard, controller, shell, shared
- ~35 `use-chat-*` hooks managing stream lifecycle, ordering, background dispatch, interrupt, run tracking
- `use-chat-app-orchestration.ts` — coordinates session, model, streaming
- `use-chat-stream-lifecycle.ts` — stream start/stop/finalize state machine

#### Runtime (`runtime/`)
- `ChatUIState` — imperative state container (renderer, root, session, EventBus, BatchDispatcher)
- `createChatUIController()` — returns functions: `handleSendMessage`, `handleStreamMessage`, `handleExit`, `handleInterrupt`, etc.
- `createStreamAdapter()` — factory selecting correct SDK adapter
- `StreamRunRuntime` — tracks individual stream runs with Promise-based resolution

### 7. UI Layer (`components/`, `screens/`, `theme/`)

#### Components (`components/`)
- **Part registry**: `PART_REGISTRY` maps `Part` discriminants to renderer components (10 entries)
- `MessageBubbleParts` renders a message's parts array via registry dispatch
- Top-level components: `ChatHeader`, `ChatMessageBubble`, `TranscriptView`, `FooterStatus`, `ParallelAgentsTree`, `TaskListIndicator`, `TaskListPanel`, etc.
- Tool registry: `getToolRenderer(toolName)` returns specialized tool renderers (read, edit, bash, search, etc.)
- `ModelSelectorDialog`, `UserQuestionDialog`, `HitlResponseWidget` — modal overlays

#### Screens
- `chat-screen.tsx` — the single screen component, also **re-exports** types from `state/chat/exports.ts`

#### Theme (`theme/`)
- `ThemeProvider` + `useTheme()` React context
- 3 theme presets: `darkTheme`, `lightTheme`, `synthwaveTheme`
- Palettes, icons, spacing, spinner verbs, syntax highlight themes
- Self-contained with minimal dependencies (`services/system/detect.ts` only)

### 8. Configuration System (`services/config/`)

- `AGENT_CONFIG` — static registry mapping agent keys to SDK-specific config loaders
- Provider-specific loaders: `claude-config.ts`, `copilot-config.ts`, `opencode-config.ts`
- `ProviderDiscoveryPlan` — async discovery pipeline for agent capabilities
- `settings.ts` / `settings-schema.ts` — Zod-validated user settings with `settings.json`
- `atomic-config.ts` — `.atomic/` directory management
- `atomic-global-config.ts` — `~/.config/atomic/` global config
- `agent-definition-loader.ts` — loads agent YAML/MD definitions from disk
- `mcp-config.ts` — MCP server configuration discovery/merging
- `discovery-events.ts` — events emitted during provider discovery

---

## Dependency Graph

### Module-to-Module Import Matrix

```
FROM ↓ / TO →    commands  components  hooks  lib   screens  services  state  theme  types
commands           41         0         0     8      0        87        1      1      0
components          2       115         1    23      2         3       20     67      0
hooks               0         0         2     0      0         0        0      0      0
lib                 1         7         0    19      1         3        5      1      0
screens             0         0         1     0      0         1       10      0      0
services            9         0         0    11      0       774        2      0      0
state              18        44         9   114     10        66      329      9      0
theme               0         0         0     0      0         2        0     23      0
types               0         0         0     0      0         1        1      0      0
```

### Heaviest Dependency Arrows

1. **`state/` → `lib/`** (114 imports) — state hooks depend heavily on UI utilities
2. **`commands/` → `services/`** (87 imports) — commands depend on service layer
3. **`theme/` used by `components/`** (67 imports) — components depend on theme
4. **`state/` → `services/`** (66 imports) — state depends on agent types, event bus, models
5. **`state/` → `components/`** (44 imports) — state depends on component types (inverted dependency)

### Circular Dependencies (9 Bidirectional Pairs)

| # | Pair | Forward | Reverse | Severity |
|---|------|---------|---------|----------|
| 1 | **commands ↔ services** | 87 | 9 | **High** — `services/workflows/` imports values from `commands/tui/` (`discoverAgentInfos`, `registerActiveSession`) |
| 2 | **commands ↔ lib** | 8 | 1 | Low — `lib/ui/mention-parsing.ts` imports `globalRegistry` from `commands/tui/` |
| 3 | **commands ↔ state** | 1 (type-only) | 18 | Low — reverse is type-only |
| 4 | **components ↔ lib** | 23 | 7 | **Medium** — `lib/` imports values and types from `components/` |
| 5 | **components ↔ state** | 20 (mostly type-only) | 44 | **High** — `state/` imports 44 times from `components/` (values + types) |
| 6 | **lib ↔ services** | 3 | 11 | Medium — mixed value and type imports both directions |
| 7 | **lib ↔ state** | 5 | 114 | **Medium** — `lib/ui/chat-helpers.ts` re-exports from `state/chat/` |
| 8 | **screens ↔ state** | 10 | 10 | **High** — `state/parts/types.ts` imports `MessageSkillLoad` FROM `screens/chat-screen.tsx` |
| 9 | **services ↔ state** | 2 (type-only) | 66 | Low — forward is type-only |

#### Intra-Services Circular Dependencies

| Pair | Forward | Reverse |
|------|---------|---------|
| `events/ ↔ workflows/` | 18 | 9 |
| `agents/ ↔ workflows/` | 3 | 7 |
| `agents/ ↔ config/` | 3 | 3 |
| `config/ ↔ system/` | 2 | 1 |

### Coupling Hotspots (Highest Fan-In Files)

| Rank | File | Total Imports | External Imports |
|------|------|:---:|:---:|
| 1 | `services/agents/types.ts` | 109 | 54 |
| 2 | `services/workflows/graph/types.ts` | 55 | 12 |
| 3 | `state/chat/types.ts` | 38 | 5 |
| 4 | `state/parts/types.ts` | 36 | 17 |
| 5 | `services/events/bus-events.ts` | 35 | 0 |
| 6 | `services/events/event-bus.ts` | 33 | 8 |
| 7 | `components/parallel-agents-tree.tsx` | 32 | 30 |
| 8 | `theme/index.tsx` | 31 | 31 |
| 9 | `theme/icons.ts` | 29 | 28 |
| 10 | `services/workflows/runtime-contracts.ts` | 27 | 23 |
| 11 | `lib/ui/task-status.ts` | 23 | 22 |
| 12 | `state/parts/index.ts` | 22 | 2 |
| 13 | `commands/tui/index.ts` | 15 | 12 |
| 14 | `lib/ui/agent-ordering-contract.ts` | 16 | 16 |
| 15 | `screens/chat-screen.tsx` | 17 | 15 |

### Change Propagation Paths

#### If `services/agents/contracts/` changes:
```
contracts/* → agents/types.ts → 54 external files across 7 modules
                              → all 3 client implementations
                              → all event bus adapters (3)
                              → workflow graph engine
                              → state/runtime/*
```

#### If `state/parts/types.ts` changes:
```
parts/types.ts → 12 message-part renderers in components/message-parts/
               → components/parallel-agents-tree.tsx, tool-result.tsx
               → lib/ui/stream-continuation.ts
               → app.tsx (re-exports ToolExecutionStatus)
               → state/streaming/pipeline*.ts (all pipeline files)
               → state/parts/handlers.ts, guards.ts, store.ts
```

#### If `screens/chat-screen.tsx` exports change:
```
chat-screen.tsx → state/streaming/ (5 files for ChatMessage, MessageToolCall)
                → state/parts/ (3 files for ChatMessage, MessageSkillLoad)
                → state/runtime/chat-ui-controller.ts
                → components/message-parts/message-bubble-parts.tsx
                → components/transcript-view.tsx
                → lib/ui/conversation-history-buffer.ts
                → app.tsx
```

### Barrel File Re-Export Chains

Notable deep re-export chains creating hidden dependency paths:

1. **`types/chat.ts`** → `state/chat/shared/types/index.ts` → 4 leaf files (depth 2)
2. **`state/chat/types.ts`** → `state/chat/shared/types.ts` → `state/chat/shared/types/index.ts` → 4 leaf files (depth 3)
3. **`lib/ui/chat-helpers.ts`** → `state/chat/shared/helpers/index.ts` → 7 leaf files (depth 2, crosses module boundary)
4. **`screens/chat-screen.tsx`** re-exports `state/chat/exports.ts` which aggregates from `lib/ui/`, `state/chat/`, and `components/` (crosses 3 module boundaries)
5. **`services/workflows/index.ts`** → `services/workflows/graph/index.ts` → 13 leaf files (depth 2)

---

## Architecture Documentation

### Current Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLI Layer (Commander.js)              │
│  cli.ts → commands/cli/{chat,init,update,uninstall}     │
└────────────────────────┬────────────────────────────────┘
                         │ startChatUI()
┌────────────────────────▼────────────────────────────────┐
│                    TUI Layer (React/OpenTUI)             │
│  app.tsx → screens/chat-screen.tsx → ChatShell          │
│  components/ → message-parts/ → tool-registry/          │
│  theme/ → hooks/                                        │
└───────┬──────────────────────────┬──────────────────────┘
        │                          │
┌───────▼──────────┐    ┌──────────▼─────────────────────┐
│   State Layer    │    │   Slash Commands Layer          │
│  state/chat/     │    │   commands/tui/ → core/registry │
│  state/parts/    │    │   commands/catalog/{agents,     │
│  state/runtime/  │    │                   skills}       │
│  state/streaming/│    └────────────────────────────────┘
└───────┬──────────┘
        │
┌───────▼──────────────────────────────────────────────────┐
│                   Services Layer                         │
│  agents/{contracts,clients,tools,provider-events}        │
│  events/{bus,adapters,consumers,batch-dispatcher}        │
│  workflows/{graph,ralph,runtime}                         │
│  config/{discovery,settings,provider-configs}            │
│  models/{operations,transform}                           │
│  telemetry/{tracking,upload,consent}                     │
│  system/{detect,copy,cleanup,download}                   │
│  terminal/{tree-sitter}                                  │
└──────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────┐
│                Cross-Cutting Utilities                    │
│  lib/{markdown,merge,path-root-guard,ui/*}               │
│  types/{chat,ui}                                         │
└──────────────────────────────────────────────────────────┘
```

### Data Flow: Message Submission → Rendering

```
User Input
    │
    ▼
composer-submit.ts → handleSendMessage()
    │
    ▼
chat-ui-controller.ts → createStreamAdapter() → SDK-specific adapter
    │
    ▼
SDK Client (Claude/OpenCode/Copilot) session.sendMessage()
    │
    ▼ (SDK stream events)
Stream Adapter (claude-adapter/opencode-adapter/copilot-adapter)
    │
    ▼ (normalized BusEvent)
EventBus.publish()
    │
    ▼ (batched at 16ms)
BatchDispatcher.enqueue() → flush()
    │
    ▼ (enriched events)
CorrelationService → EchoSuppressor → StreamPipelineConsumer
    │
    ▼ (StreamPartEvent)
applyStreamPartEvent(message, event) — pure reducer
    │
    ▼ (updated ChatMessage with Parts[])
React state update → MessageBubbleParts → PART_REGISTRY dispatch
    │
    ▼
Individual Part renderers (TextPartDisplay, ToolPartDisplay, etc.)
```

### Design Patterns in Use

1. **Strategy Pattern** — `CodingAgentClient` interface with 3 concrete implementations
2. **Pub/Sub** — `EventBus` with typed subscriptions and wildcard handlers
3. **Builder Pattern** — `GraphBuilder` fluent API for workflow definition
4. **Registry Pattern** — `ToolRegistry`, `PART_REGISTRY`, `CommandRegistry`, `ProviderRegistry`
5. **Adapter Pattern** — SDK-specific stream adapters normalizing to `BusEvent`
6. **Reducer Pattern** — `applyStreamPartEvent` as a pure state reducer
7. **Double Buffering** — `BatchDispatcher` write/read buffer swap for frame-aligned delivery
8. **Factory Pattern** — `createChatUIController()`, `createStreamAdapter()`, `createCheckpointer()`
9. **Discriminated Union** — `Part`, `StreamPartEvent`, `BusEvent`, `NodeType` all use tagged unions

---

## Key Structural Observations

### 1. `state/` is the gravitational center (270 cross-module imports)

The `state/` module imports from 8 other modules. It is the most interconnected module in the codebase:
- **114** imports from `lib/` (mostly `lib/ui/` utilities)
- **66** imports from `services/` (agent types, event bus, models, workflows)
- **44** imports from `components/` (notably `parallel-agents-tree.tsx` at 25 imports)
- **18** imports from `commands/` (TUI registry/commands)
- **10** imports from `screens/` (chat-screen.tsx for ChatMessage types)
- **9** imports from `hooks/` and `theme/`

### 2. `components/parallel-agents-tree.tsx` is imported by state (inverted dependency)

This single component file is imported 30 times from outside `components/`:
- 25 times from `state/` (agent ordering, stream lifecycle, background dispatch, etc.)
- 4 times from `lib/ui/`

The `ParallelAgent` type and related tree types defined in this file are consumed by state management hooks, making the component a de facto type definition file.

### 3. `screens/chat-screen.tsx` is a type export hub

The screen component re-exports from `state/chat/exports.ts`, and `state/parts/types.ts` imports `MessageSkillLoad` FROM it — creating a circular dependency where the UI screen and the state type system are mutually dependent.

### 4. `lib/ui/` contains 35 files of mixed business logic

`lib/ui/` is consumed by 114 imports from `state/` alone. Its files cover agent lifecycle ledgers, ordering contracts, background agent behavior, stream continuation, task state management, workflow input resolution, and more. Many of these files contain domain-specific business logic rather than generic utilities.

### 5. `services/workflows/` ↔ `commands/tui/` circular dependency

The workflow runtime executor imports `discoverAgentInfos` and `registerActiveSession` from `commands/tui/`, while `commands/tui/` imports workflow types/functions. This creates a cycle between the execution engine and the command presentation layer.

### 6. `WorkflowSDK` exists but is never used at runtime

The `WorkflowSDK` class provides a high-level facade for workflow execution but is bypassed at runtime. Ralph has hardcoded `if (metadata.name === "ralph")` routing, and non-Ralph workflows get a generic handler that only sets UI flags without building/executing any graph.

### 7. Event bus and reducer layers are already shared

The event bus normalization and `applyStreamPartEvent` reducer are provider-agnostic and already handle all three SDKs through a unified pipeline. The divergence is primarily in the rendering layer where workflow sub-agents use bespoke truncated renderers instead of the full `PART_REGISTRY`.

---

## Code References

### Entry Points
- `src/cli.ts:33-37` — Commander.js program creation
- `src/cli.ts:84` — `chat` command (default)
- `src/app.tsx:103` — `startChatUI()` main TUI launcher
- `src/app.tsx:197-246` — React render tree: ThemeProvider → EventBusProvider → AppErrorBoundary → ChatApp

### Agent Contracts
- `src/services/agents/contracts/client.ts:1-29` — `CodingAgentClient` interface
- `src/services/agents/contracts/events.ts` — `EventType` union, `AgentEvent` envelope
- `src/services/agents/contracts/session.ts` — `Session` interface

### Event Bus
- `src/services/events/event-bus.ts:85-332` — `EventBus` class
- `src/services/events/batch-dispatcher.ts:89-313` — `BatchDispatcher` class (16ms frame)
- `src/services/events/bus-events/types.ts:5-35` — 30 event types
- `src/services/events/hooks.ts:214` — `useStreamConsumer()` hook

### State Management
- `src/state/parts/types.ts:1-164` — `Part` discriminated union (10 types)
- `src/state/streaming/pipeline.ts:1-362` — `applyStreamPartEvent()` reducer
- `src/state/runtime/chat-ui-controller.ts:1-510` — `createChatUIController()`
- `src/state/chat/ChatShell.tsx` — main shell component

### Workflow Engine
- `src/services/workflows/graph/authoring/builder.ts` — `GraphBuilder` class
- `src/services/workflows/graph/runtime/compiled.ts` — `GraphExecutor` class
- `src/services/workflows/graph/contracts/core.ts` — `BaseState`, `NodeType`, `Signal`
- `src/services/workflows/ralph/graph/index.ts` — `createRalphWorkflow()`

### High Fan-In Files
- `src/services/agents/types.ts` — 109 imports (54 external)
- `src/components/parallel-agents-tree.tsx` — 32 imports (30 external)
- `src/screens/chat-screen.tsx` — 17 imports (15 external)
- `src/lib/ui/task-status.ts` — 23 imports (22 external)

---

## Historical Context (from research/)

### Architecture Research
- `research/docs/2026-02-16-atomic-chat-architecture-current.md` — Comprehensive reference for chat system architecture, offset-based segment model
- `research/docs/2026-02-16-chat-system-design-reference.md` — Proposed migration to parts-based message model (now implemented)
- `research/docs/2026-01-31-atomic-current-workflow-architecture.md` — Foundational 5-layer architecture document

### Workflow & Coupling Research
- `research/docs/2026-02-25-ui-workflow-coupling.md` — Documents `chat.tsx` (~6100+ lines) as central integration point with 5+ Ralph-specific state variables
- `research/docs/2026-02-25-unified-workflow-execution-research.md` — `WorkflowSDK` never used at runtime; hardcoded Ralph dispatch
- `research/docs/2026-02-25-workflow-sdk-refactor-research.md` — Ralph bypasses graph engine; `graph/` and `workflows/` need consolidation
- `research/docs/2026-02-28-workflow-gaps-architecture.md` — 7-category gap analysis across ~40 files

### Streaming & Event Bus Research
- `research/docs/2026-02-26-streaming-architecture-event-bus-migration.md` — Migration from callbacks to event bus
- `research/docs/2026-02-27-workflow-tui-rendering-unification.md` — Main TUI vs workflow rendering pipeline comparison
- `research/docs/2026-02-28-workflow-tui-rendering-unification-refactor.md` — Event bus already shared; divergence only in rendering

### SDK Integration Research
- `research/docs/2026-02-12-sdk-ui-standardization-comprehensive.md` — Architecture is fundamentally sound; `CodingAgentClient` already abstracts all three SDKs
- `research/docs/2026-02-19-sdk-v2-first-unified-layer-research.md` — Unified provider abstraction documentation

### Related Specs (19 specs in `specs/` directory)
- `specs/2026-03-02-workflow-sdk-standardization.md` — Workflow SDK patterns standardization
- `specs/2026-03-02-workflow-tui-rendering-unification-refactor.md` — PART_REGISTRY dispatch for workflows
- `specs/2026-03-02-streaming-architecture-event-bus-migration.md` — Callbacks-to-event-bus migration
- `specs/2026-03-02-unified-workflow-execution.md` — Unified workflow execution interface

---

## Open Questions

1. **`lib/ui/` scope**: Should the ~35 files in `lib/ui/` be relocated closer to their consumers (e.g., `state/chat/helpers/`, `state/parts/helpers/`), or does the current "shared utility" placement serve a purpose?

2. **`components/parallel-agents-tree.tsx` type extraction**: The 30+ external imports are primarily for type definitions (`ParallelAgent`, tree types). Should these types be extracted to a shared types module to break the `state/ → components/` circular dependency?

3. **`screens/chat-screen.tsx` re-export role**: Is the re-export pattern (where the screen component also serves as a type barrel) intentional, or should type exports be moved to `state/chat/` or `types/`?

4. **`services/workflows/ → commands/tui/` cycle**: The workflow runtime imports `discoverAgentInfos` and `registerActiveSession` from the command layer. Should these be extracted to a shared service to break the cycle?

5. **`WorkflowSDK` dead code**: The `WorkflowSDK` class exists but is never used at runtime. Should it be removed, or is it intended for future use?

6. **`state/chat/` module size**: With ~55 hooks in a single module, is there a principled decomposition that would make the chat state machine more maintainable without introducing new circular dependencies?
