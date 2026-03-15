---
date: 2026-03-15 18:32:54 UTC
researcher: Claude Opus 4.6
git_commit: d3f22e2b5bf791dcc57580e001ac279c85390fce
branch: lavaman131/feature/code-cleanup
repository: code-cleanup
topic: "Atomic V2 Rebuild Spec: Comprehensive architecture redesign fixing streaming instability and SDK unification"
tags: [research, spec, architecture, streaming, sdk-unification, rebuild, v2]
status: complete
last_updated: 2026-03-15
last_updated_by: Claude Opus 4.6
---

# Atomic V2 Rebuild Spec Index

## Research Question

Imagine you are implementing the entire Atomic application from scratch. Create a spec that fixes bad design/instabilities in the current application including unreliable streaming UI and un-unified workflow SDK if I was to scratch everything and write from scratch. Compose into hierarchical specs for best organization.

## Executive Summary

The current Atomic codebase is ~82K lines of TypeScript across a strict layered architecture (Services 46K, State 18K, Components 7K, Commands 5K). It integrates three coding agent SDKs (Claude Agent SDK, OpenCode SDK, Copilot SDK) through a strategy pattern with a dual event system: 25 provider-level `AgentEvent` types are adapted through per-provider adapters into 28 Zod-validated `BusEvent` schemas.

The architecture has grown organically over 3 months (120+ research documents since Jan 2026), resulting in several systemic issues that incremental fixes cannot fully resolve:

### Current Instability Patterns

1. **Streaming Pipeline Fragility**: The dual event system (AgentEvent -> adapter -> BusEvent) creates a translation layer where each of the 3 providers has its own adapter (Claude: 9 files, OpenCode: 9 files, Copilot: 10 files) with different internal abstractions, naming conventions, and race condition handling. Subagent premature completion has been investigated across 5+ research docs.

2. **Un-unified Workflow SDK**: The `CodingAgentClient` interface has 11 methods (5 optional with `?`), `Session` has 11 methods (5 optional with `?`), and `CommandContext` has 34 properties/methods (many optional). Optional methods signal abstraction leaks where provider capabilities don't align. Each SDK uses a fundamentally different streaming pattern: AsyncGenerator (OpenCode), AsyncIterable (Claude), EventEmitter (Copilot).

3. **State Complexity**: The `state/chat/` module has 8 sub-modules with enforced boundary rules, but the stream sub-module alone is 4.4K lines. The `CommandContextState` still carries workflow-specific fields despite refactoring efforts.

4. **Over-Engineering**: The event system has a bus, adapters, registry, consumers, debug subscribers, and coverage policies. The workflow system has a full LangGraph-inspired graph engine with checkpointing, parallel execution, subgraph support, and debug reports for a single built-in workflow (Ralph).

5. **Dual-Channel Race Conditions**: Agent lifecycle events (`stream.agent.start/update/complete`) flow through direct `useBusSubscription` hooks, while tool content events flow through the `StreamPipelineConsumer` pipeline. This creates race conditions where tool events arrive before their `AgentPart` exists, causing silent drops (documented in workflow-gaps-architecture).

6. **Dead Code and Silent Drops**: 6 dead modules (debug-subscriber, tool discovery, file-lock, merge, pipeline-logger, tree-hints), 6 unrendered UI components, and 12 unconsumed event types that adapters emit but `mapToStreamPart()` returns null for.

7. **Circular Dependencies**: 9 bidirectional circular dependency pairs at the module level, including `commands <-> services`, `components <-> state`, and `screens <-> state`. The `services/agents/types.ts` file is imported 109 times (54 external).

8. **WorkflowSDK Bypass**: The `WorkflowSDK` class exists as a complete runtime container but is never used in production. Ralph uses ad-hoc dependency construction through the TUI's `context.spawnSubagentParallel!()` instead.

9. **Agent Config Triplication**: Agent definitions (10 agents), skills (12 skills), and config are mirrored identically across `.claude/`, `.opencode/`, and `.github/` (33 files each, 99 total).

## Hierarchical Spec Documents

The rebuild spec is organized into 8 domain-specific documents, ordered by dependency (foundation first, UI last):

| #   | Document                                                                   | Domain                                     | Key Changes                                                                 |
| --- | -------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| 00  | [Foundation Layer](2026-03-15-spec-00-foundation-layer.md)                 | Shared types, contracts, dependency rules  | Single event type, capability-based interfaces, strict layer enforcement    |
| 01  | [Streaming Pipeline](2026-03-15-spec-01-streaming-pipeline.md)             | Event bus, adapters, rendering pipeline    | Single-pass event flow, unified adapter contract, backpressure              |
| 02  | [Provider SDK Unification](2026-03-15-spec-02-provider-sdk-unification.md) | Claude, OpenCode, Copilot integration      | Unified adapter interface, eliminate optional methods, normalized lifecycle |
| 03  | [State Management](2026-03-15-spec-03-state-management.md)                 | Chat state, parts, runtime, streaming      | Simplified state tree, derived state over stored state, single store        |
| 04  | [Workflow Engine](2026-03-15-spec-04-workflow-engine.md)                   | Graph engine, Ralph, custom workflows      | Right-sized graph engine, workflow-as-plugin, minimal runtime               |
| 05  | [UI Rendering](2026-03-15-spec-05-ui-rendering.md)                         | Screens, components, message parts         | Declarative rendering, virtual list, part registry                          |
| 06  | [Services](2026-03-15-spec-06-services.md)                                 | Config, telemetry, agent discovery, models | Unified config model, lightweight telemetry, startup discovery              |
| 07  | [Command System](2026-03-15-spec-07-command-system.md)                     | CLI commands, TUI commands, slash commands | Narrow CommandContext, plugin-based commands, type-safe registry            |

## Current Architecture Quantitative Profile

```
Source Directory                Lines    % of Total
────────────────────────────── ──────── ──────────
services/                       46,573     57%
  services/events/              14,792     18%
  services/agents/              14,524     18%
  services/workflows/            8,725     11%
  services/config/               3,722      5%
  services/telemetry/            2,018      2%
  services/system/               1,269      2%
  services/models/                 821      1%
  services/agent-discovery/        521      1%
  services/terminal/               181      0%
state/                          18,475     23%
  state/chat/stream/             4,381      5%
  state/chat/shared/             3,127      4%
  state/chat/controller/         2,178      3%
  state/streaming/               1,853      2%
  state/chat/keyboard/           1,740      2%
  state/chat/composer/           1,169      1%
  state/runtime/                 1,040      1%
  state/parts/                     893      1%
  state/chat/command/              805      1%
  state/chat/agent/                656      1%
  state/chat/shell/                510      1%
  state/chat/session/                6      0%
components/                      7,218      9%
commands/                        4,925      6%
scripts/                         1,013      1%
lib/                             1,075      1%
theme/                             840      1%
hooks/                             433      1%
types/                             287      0%
screens/                           204      0%
────────────────────────────── ──────── ──────────
TOTAL                           81,751    100%
```

## Key Contracts in Current System

### CodingAgentClient (`services/agents/contracts/client.ts`)
```typescript
interface CodingAgentClient {
  readonly agentType: AgentType;
  createSession(config?: SessionConfig): Promise<Session>;
  resumeSession(sessionId: string): Promise<Session | null>;
  getSessionMessagesWithParts?(sessionId: string): Promise<SessionMessageWithParts[]>;  // optional
  on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void;
  registerTool(tool: ToolDefinition): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  getModelDisplayInfo(modelHint?: string): Promise<ModelDisplayInfo>;
  setActiveSessionModel?(model: string, options?: { reasoningEffort?: string }): Promise<void>;  // optional
  getSystemToolsTokens(): number | null;
  getKnownAgentNames?(): string[];  // optional
}
```

### Session (`services/agents/contracts/session.ts`)
```typescript
interface Session {
  readonly id: string;
  send(message: string): Promise<AgentMessage>;
  stream(message: string, options?: { agent?: string; abortSignal?: AbortSignal }): AsyncIterable<AgentMessage>;
  sendAsync?(message: string, options?: { agent?: string; abortSignal?: AbortSignal }): Promise<void>;  // optional
  summarize(): Promise<void>;
  getContextUsage(): Promise<ContextUsage>;
  getSystemToolsTokens(): number;
  getMcpSnapshot?(): Promise<McpRuntimeSnapshot | null>;  // optional
  getCompactionState?(): SessionCompactionState | null;  // optional
  destroy(): Promise<void>;
  command?(commandName: string, args: string, options?): Promise<void>;  // optional
  abort?(): Promise<void>;  // optional
  abortBackgroundAgents?(): Promise<void>;  // optional
}
```

### Dual Event System
- **AgentEvent**: 25 types (`session.*`, `message.*`, `reasoning.*`, `turn.*`, `tool.*`, `skill.*`, `subagent.*`, `permission.*`, `human_input_required`, `usage`)
- **BusEvent**: 28 Zod-validated schemas (`stream.text.*`, `stream.thinking.*`, `stream.tool.*`, `stream.agent.*`, `stream.session.*`, `stream.turn.*`, `stream.permission.*`, `stream.human_input_required`, `stream.skill.*`, `stream.usage`)

### SDKStreamAdapter (`services/events/adapters/types.ts`)
```typescript
interface SDKStreamAdapter {
  startStreaming(session: Session, message: string, options: StreamAdapterOptions): Promise<void>;
  dispose(): void;
}
```

### CommandContext (`types/command.ts`)
- 34 properties/methods, many optional
- Couples workflow, session, UI, messaging, MCP, and model concerns into a single interface

## Historical Context

The project has **120+ research documents** in `research/docs/`, **88 formal specs** in `specs/`, and **11 developer docs** in `docs/` spanning Jan-Mar 2026. Additionally, agent configurations are tripled across `.claude/`, `.opencode/`, and `.github/` (33 files each, mirrored). Key themes:
- Subagent premature completion (5+ investigation docs, Feb 2026)
- SDK UI standardization efforts (Feb 2026)
- Streaming architecture event bus migration (Feb 2026)
- Workflow SDK refactoring attempts (Feb-Mar 2026)
- Event bus callback elimination (Mar 2026)
- Background agent event pipeline (Feb 2026)
- Codebase architecture modularity analysis (Mar 2026)

## Dependency Graph

```
CLI Entry (cli.ts) ──────> Commands (commands/)
TUI Entry (app.tsx) ─────> Screens (screens/)
                              │
                              v
                     UI Layer (components/, hooks/, theme/)
                              │
                              v
                     State Layer (state/chat/, state/parts/,
                                  state/runtime/, state/streaming/)
                              │
                              v
                     Service Layer (services/agents/, services/events/,
                                    services/workflows/, services/config/,
                                    services/models/, services/telemetry/)
                              │
                              v
                     Shared Layer (types/, lib/)
```

## Related Research

- `research/docs/2026-02-26-streaming-architecture-event-bus-migration.md`
- `research/docs/2026-02-28-workflow-gaps-architecture.md`
- `research/docs/2026-02-28-workflow-issues-research.md`
- `research/docs/2026-02-25-workflow-sdk-design.md`
- `research/docs/2026-02-25-unified-workflow-execution-research.md`
- `research/docs/2026-02-12-sdk-ui-standardization-comprehensive.md`
- `research/docs/2026-03-14-event-bus-callback-elimination-sdk-event-types.md`
- `research/docs/2026-03-13-codebase-architecture-modularity-analysis.md`
- `research/docs/2026-02-15-subagent-premature-completion-SUMMARY.md`
- `research/docs/2026-03-06-claude-agent-sdk-event-schema.md`
- `research/docs/2026-03-06-opencode-sdk-event-schema-reference.md`
- `research/docs/2026-03-06-copilot-sdk-session-events-schema-reference.md`
