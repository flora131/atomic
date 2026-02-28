---
date: 2026-02-28 05:36:00 UTC
researcher: Copilot (Claude Opus 4.6)
git_commit: 21201623897ed3dcc3f2214ca0a54a6df7a4c978
branch: lavaman131/feature/workflow-sdk
repository: workflow-sdk
topic: "Workflow Gaps: Exact Files, Functions, and Architecture Required to Fill All Gaps"
tags: [research, codebase, workflow-gaps, part-registry, custom-tools, mcp-bridge, max-iterations, dead-modules, unrendered-components, unconsumed-events]
status: complete
last_updated: 2026-02-28
last_updated_by: Copilot (Claude Opus 4.6)
---

# Research: Workflow Gaps — Files to Edit and Architecture Required

## Research Question

For each gap in `research/workflow-gaps.md`, identify the exact files, functions, and code locations that need to be edited, and document the architectural changes required — covering: (1) WorkflowStepPartDisplay registration in PART_REGISTRY, (2) registerCustomTools() activation during init, (3) OpenCode MCP bridge placeholder tool handlers, (4) --max-iterations flag removal from chat.ts, (5) the 6 dead modules and their intended import points, (6) the 6 unrendered UI components and their registration/rendering hooks, and (7) the 12 unconsumed event types and their intended consumer wiring.

## Summary

The gaps documented in `research/workflow-gaps.md` span 7 categories across ~40 source files. Each gap has a clear architectural root cause and a specific set of files that need editing. The findings are organized below by gap category with exact file paths, line numbers, and descriptions of the disconnections.

---

## 🔴 Gap 1: WorkflowStepPartDisplay Not Registered in PART_REGISTRY

### Root Cause

Three disconnections in the rendering pipeline prevent workflow step events from reaching the UI:

1. **Consumer gap**: `StreamPipelineConsumer.mapToStreamPart()` does not map `workflow.step.*` bus events to `StreamPartEvent`s
2. **Type system gap**: `WorkflowStepPart` is not defined in `types.ts` and not in the `Part` union
3. **Registry gap**: `"workflow-step"` is not a key in `PART_REGISTRY`

### Event Flow (Current — Broken)

```
executor.ts:346 → publishStepStart()
  → workflow-adapter.ts:69 → bus.publish("workflow.step.start")
    → wire-consumers.ts:70 → dispatcher.enqueue()
      → stream-pipeline-consumer.ts:177 → default: return null  ← DROPPED
```

### Files to Edit

| File | Lines | What Needs to Change |
|------|-------|---------------------|
| `src/events/consumers/stream-pipeline-consumer.ts` | 126-182 | Add `case "workflow.step.start"` and `case "workflow.step.complete"` to `mapToStreamPart()` switch, mapping to `"workflow-step-start"` and `"workflow-step-complete"` `StreamPartEvent`s |
| `src/ui/parts/types.ts` | 124-132 | Define `WorkflowStepPart` interface (with `type: "workflow-step"`, `nodeId`, `nodeName`, `status`, `durationMs?`) and add it to the `Part` union |
| `src/ui/components/parts/registry.tsx` | 22-31 | Add `"workflow-step": WorkflowStepPartDisplay` entry to `PART_REGISTRY` and import the component |
| `src/ui/components/parts/index.ts` | 1-18 | Add `WorkflowStepPartDisplay` to barrel exports |
| `src/ui/components/parts/workflow-step-part-display.tsx` | 11 | Verify/fix the import of `WorkflowStepPart` from `../../parts/types.ts` once the type is defined |

### Existing Code That Already Works (Once Connected)

- `src/ui/parts/stream-pipeline.ts:987-999` — Reducer handles `"workflow-step-start"`, creates `WorkflowStepPart`
- `src/ui/parts/stream-pipeline.ts:1002-1019` — Reducer handles `"workflow-step-complete"`, updates status
- `src/ui/components/parts/workflow-step-part-display.tsx:25-53` — Renderer component exists
- `src/events/adapters/workflow-adapter.ts:56-101` — Adapter publishes events correctly
- `src/workflows/executor.ts:336-414` — Executor calls adapter during graph iteration

---

## 🔴 Gap 2: registerCustomTools() Never Called

### Root Cause

The entire custom tools pipeline is built (discovery → import → schema conversion → registration) but the orchestrator function `registerCustomTools()` is never called from any init/startup code path. The spec's Phase 3 checklist (`specs/custom-tools-directory.md:853`) remains unchecked.

### Files to Edit

| File | Lines | What Needs to Change |
|------|-------|---------------------|
| `src/commands/chat.ts` | 243-251 | Call `registerCustomTools(client)` between client creation (line 243) and `client.start()` (line 251) |
| `src/sdk/tools/index.ts` | 7-8 | Add re-export of `registerCustomTools` and `cleanupTempToolFiles` from `./discovery.ts` |

### Intended Call Site (from spec)

```typescript
// src/commands/chat.ts — between lines 248 and 251
const client = createClientForAgentType(agentType);     // line 243
if (agentType === "copilot") {
    client.registerTool(createTodoWriteTool());          // line 246-248
}
await registerCustomTools(client);                       // ← MISSING
await client.start();                                    // line 251
```

### Supporting Infrastructure (Already Built)

| File | Lines | What It Does |
|------|-------|-------------|
| `src/sdk/tools/discovery.ts` | 262-280 | `registerCustomTools()` — orchestrator function |
| `src/sdk/tools/discovery.ts` | 129-157 | `discoverToolFiles()` — scans `.atomic/tools/` and `~/.atomic/tools/` |
| `src/sdk/tools/discovery.ts` | 221-250 | `loadToolsFromDisk()` — dynamic import + Zod schema conversion |
| `src/sdk/tools/discovery.ts` | 185-206 | `convertToToolDefinition()` — wraps `execute()` in validated handler |
| `src/sdk/tools/discovery.ts` | 80-103 | `prepareToolFileForImport()` — rewrites `@atomic/plugin` imports |
| `src/sdk/tools/plugin.ts` | 40-44 | `tool()` — user-facing authoring helper |
| `src/sdk/tools/registry.ts` | 29-51 | `ToolRegistry` singleton (permanently empty without activation) |
| `src/sdk/tools/truncate.ts` | 12-39 | `truncateToolOutput()` — caps output at 2000 lines / 50KB |

---

## 🔴 Gap 3: OpenCode MCP Bridge Returns Placeholder Strings

### Root Cause

`generateMcpServerScript()` serializes only `{name, description, inputSchema}` via `JSON.stringify` (the `handler` function is inherently non-serializable). The generated MCP stdio server script returns `"Tool ${toolName} executed via MCP bridge"` for every `tools/call` request instead of dispatching to the actual handler.

### The Placeholder Code

```typescript
// src/sdk/tools/opencode-mcp-bridge.ts:77-88
} else if (method === "tools/call") {
    const toolName = (params as Record<string, unknown>)?.name as string;
    const tool = TOOLS.find((t: { name: string }) => t.name === toolName);
    if (!tool) {
        respondError(id, -32601, `Tool not found: ${toolName}`);
    } else {
        // For MCP bridge, we return a placeholder — actual execution happens
        // in the Atomic process via the registered handler
        respond(id, {
            content: [{ type: "text", text: `Tool ${toolName} executed via MCP bridge` }],
        });
    }
}
```

### Files to Edit

| File | Lines | What Needs to Change |
|------|-------|---------------------|
| `src/sdk/tools/opencode-mcp-bridge.ts` | 25-110 | Redesign the bridge to support actual handler execution. Two approaches exist in the codebase: (a) Claude's in-process MCP pattern using `createSdkMcpServer()`, or (b) IPC between the spawned script and the main process |
| `src/sdk/clients/opencode.ts` | 1201-1221 | `registerToolsMcpServer()` — may need modification depending on the bridge approach |

### How Other Clients Solve This

| Client | Pattern | Handler Invoked? |
|--------|---------|-----------------|
| **Claude** (`claude.ts:1694-1748`) | In-process MCP server via `createSdkMcpServer()` — handler closure stays in-process | ✓ Yes — `tool.handler()` at line 1711 |
| **Copilot** (`copilot.ts:871-888`) | Direct SDK injection — handler-bearing `SdkTool` objects passed to session config | ✓ Yes — `tool.handler()` at line 885 |
| **OpenCode** (`opencode-mcp-bridge.ts:77-88`) | Separate Bun process via stdio — handler lost at JSON.stringify serialization boundary | ✗ No — placeholder string returned |

### Cleanup Gap

`cleanupMcpBridgeScripts()` at `src/sdk/tools/opencode-mcp-bridge.ts:139-155` is exported but has **zero callers** in the codebase.

---

## 🔴 Gap 4: --max-iterations CLI Flag Parsed Then Dropped

### Root Cause

The CLI flag is defined, parsed to an integer, and passed to `chatCommand()`, but the destructuring at `chat.ts:197-203` explicitly omits `maxIterations`. The workflow engine has a separate internal `maxIterations` pathway that reads from `definition.graphConfig?.maxIterations`, which is always `undefined` for Ralph (so it falls back to hardcoded `100`).

### Files to Edit

| File | Lines | What Needs to Change |
|------|-------|---------------------|
| `src/cli.ts` | 108 | Remove `--max-iterations <n>` flag definition |
| `src/cli.ts` | 118 | Remove `--max-iterations` help text example |
| `src/cli.ts` | 168 | Remove `maxIterations: parseInt(...)` from options object |
| `src/commands/chat.ts` | 67 | Remove `maxIterations?: number` from `ChatCommandOptions` interface |
| `README.md` | 310 | Remove `--max-iterations` from CLI flag reference table |

### Complete Data Flow (Current — Broken)

```
CLI: --max-iterations <n>
  → src/cli.ts:108 (flag defined, default "100")
  → src/cli.ts:168 (parseInt → number)
  → src/commands/chat.ts:67 (accepted by ChatCommandOptions interface)
  → src/commands/chat.ts:197-203 (OMITTED from destructuring) ← DROPS HERE
  ╳ Dead end

Internal Workflow Path (completely separate, hardcoded to 100):
  → src/workflows/executor.ts:109 (DEFAULT_MAX_ITERATIONS = 100)
  → src/workflows/executor.ts:197 (definition.graphConfig?.maxIterations ?? 100)
  → src/workflows/ralph/state.ts:148 (options?.maxIterations ?? 100)
  → src/workflows/ralph/graph.ts:210 (state.iteration >= state.maxIterations)
```

### All References to maxIterations

| File | Line | Usage |
|------|------|-------|
| `src/cli.ts` | 108 | Flag definition |
| `src/cli.ts` | 118 | Help text example |
| `src/cli.ts` | 168 | `parseInt(localOpts.maxIterations, 10)` |
| `src/commands/chat.ts` | 67 | `ChatCommandOptions.maxIterations?: number` |
| `src/commands/chat.ts` | 197-203 | Destructuring **omits** `maxIterations` |
| `src/ui/commands/workflow-commands.ts` | 131 | `WorkflowGraphConfig.maxIterations?: number` |
| `src/ui/commands/workflow-commands.ts` | 145 | `WorkflowStateParams.maxIterations: number` |
| `src/ui/commands/registry.ts` | 203 | `WorkflowState.maxIterations?: number` |
| `src/workflows/executor.ts` | 52-53 | `compileGraphConfig()` metadata |
| `src/workflows/executor.ts` | 108-109 | `DEFAULT_MAX_ITERATIONS = 100` |
| `src/workflows/executor.ts` | 197 | Reads from `definition.graphConfig?.maxIterations` |
| `src/workflows/ralph/definition.ts` | 38 | Forwards `params.maxIterations` |
| `src/workflows/ralph/state.ts` | 74, 79, 114, 118, 148, 205 | State interface, annotations, factory |
| `src/workflows/ralph/graph.ts` | 210, 212 | Loop exit condition, builder config |
| `src/workflows/graph/builder.ts` | 51, 669, 737, 748 | `LoopConfig`, builder defaults |
| `src/workflows/graph/templates.ts` | 26, 38, 186, 206 | Template config interfaces |

---

## 🟡 Gap 5: Six Dead Modules

### Summary Table

| # | Module | File | Lines | Exports | Has Tests | Non-Test Imports |
|---|--------|------|-------|---------|-----------|-----------------|
| 1 | debug-subscriber | `src/events/debug-subscriber.ts` | 179 | 6 | ✅ | **0** |
| 2 | tool discovery | `src/sdk/tools/discovery.ts` | 287 | 9 | ❌ | **0** |
| 3 | file-lock | `src/utils/file-lock.ts` | 290 | 7 | ❌ | **0** |
| 4 | merge | `src/utils/merge.ts` | 45 | 1 | ✅ | **0** |
| 5 | pipeline-logger | `src/events/pipeline-logger.ts` | 68 | 3 | ✅ | **0** |
| 6 | tree-hints | `src/ui/utils/background-agent-tree-hints.ts` | 43 | 3 | ✅ | **0** |

### Module 1: debug-subscriber

- **File:** `src/events/debug-subscriber.ts`
- **Primary export:** `attachDebugSubscriber(bus: AtomicEventBus)` at line 153
- **What it does:** File-based JSONL event logging gated on `ATOMIC_DEBUG=1`. Subscribes to `bus.onAll()`, serializes every `BusEvent` to `~/.local/share/atomic/log/events/` with 10-file rotation.
- **Intended import point:** `src/ui/index.ts` after `AtomicEventBus` instantiation at line 240 (`const sharedBus = new AtomicEventBus()`), before `EventBusProvider` at line 740.

### Module 2: tool discovery

- **File:** `src/sdk/tools/discovery.ts`
- **Primary export:** `registerCustomTools(client: CodingAgentClient)` at line 262
- **What it does:** Scans `.atomic/tools/` directories, dynamically imports tool files, converts Zod schemas to JSON Schema, registers with client and ToolRegistry.
- **Intended import point:** `src/commands/chat.ts` between client creation (line 243) and `client.start()` (line 251). See Gap 2 above.
- **Note:** The barrel file `src/sdk/tools/index.ts` does not re-export from `discovery.ts` despite its JSDoc claiming it does.

### Module 3: file-lock

- **File:** `src/utils/file-lock.ts`
- **Primary export:** `withLock(filePath, fn)` at line 213
- **What it does:** File-based locking using `.lock` files with PID-based stale lock detection. `tryAcquireLock()` uses exclusive `wx` flag for atomic lock creation.
- **Intended import point:** `src/telemetry/telemetry-file-io.ts` — though that file's comments (lines 42-48) note that OS-level `O_APPEND` atomicity was considered sufficient. Other candidates: any file performing concurrent writes to shared files.

### Module 4: merge

- **File:** `src/utils/merge.ts`
- **Primary export:** `mergeJsonFile(sourcePath, destPath)` at line 21
- **What it does:** Reads two JSON files, shallow-merges top-level keys with special handling for `mcpServers` sub-object to preserve user MCP entries while updating CLI-managed ones.
- **Intended import point:** `src/commands/init.ts` — the `AgentConfig` type in `src/config.ts` has a `merge_files` field (line 23) populated with values like `[".mcp.json"]` for Claude (line 39) and `[".github/mcp-config.json"]` for Copilot (line 68). `mergeJsonFile()` was designed to replace `copyFile()` for files listed in `merge_files`.

### Module 5: pipeline-logger

- **File:** `src/events/pipeline-logger.ts`
- **Primary export:** `pipelineLog(stage, action, data?)` at line 60
- **What it does:** Conditional `console.debug()` logger gated on `ATOMIC_DEBUG=1`, caches env check. Emits `[Pipeline:<stage>]` prefixed messages for stages: EventBus, Dispatcher, Wire, Consumer, Subagent.
- **Intended import points:** The five pipeline modules matching the `PipelineStage` type:
  - `"EventBus"` → `src/events/event-bus.ts`
  - `"Dispatcher"` → `src/events/batch-dispatcher.ts`
  - `"Wire"` → `src/events/consumers/wire-consumers.ts`
  - `"Consumer"` → `src/events/consumers/stream-pipeline-consumer.ts`
  - `"Subagent"` → `src/events/adapters/subagent-adapter.ts`

### Module 6: tree-hints

- **File:** `src/ui/utils/background-agent-tree-hints.ts`
- **Primary export:** `buildParallelAgentsHeaderHint(agents, showExpandHint)` at line 24
- **What it does:** Builds status string for parallel-agents tree header with keyboard shortcut hints (`ctrl+f` / `ctrl+o`) based on background agent state.
- **Intended import point:** `src/ui/components/parallel-agents-tree.tsx` or `src/ui/chat.tsx` — to generate the header text above the agent list in the sub-agent tree widget.

---

## 🟡 Gap 6: Six Unrendered UI Components

### Summary Table

| Component | Defined At | `parts/index.ts` | `components/index.ts` | `ui/index.ts` | PART_REGISTRY | JSX Rendered |
|---|---|---|---|---|---|---|
| `WorkflowStepPartDisplay` | `parts/workflow-step-part-display.tsx:25` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `UserQuestionInline` | `parts/user-question-inline.tsx:42` | ✅ line 16 | ❌ | ❌ | N/A | ❌ |
| `FooterStatus` | `components/footer-status.tsx:99` | N/A | ✅ lines 130-132 | ❌ | N/A | ❌ |
| `TimestampDisplay` | `components/timestamp-display.tsx:109` | N/A | ✅ lines 74-79 | ❌ | N/A | ❌ |
| `StreamingBullet` | `chat.tsx:1152` | N/A | N/A | ✅ line 905 | N/A | ❌ |
| `CodeBlock` | `code-block.tsx:187` | N/A | N/A | ✅ lines 925-932 | N/A | ❌ |

### Component Details

#### 1. WorkflowStepPartDisplay (`src/ui/components/parts/workflow-step-part-display.tsx:25`)
- Renders `── Step: <name> <status> (<duration>) ──` inside a themed `<box>`
- **Not in barrel exports**, **not in PART_REGISTRY**, type `WorkflowStepPart` not defined in `types.ts`
- See Gap 1 for the full pipeline disconnection

#### 2. UserQuestionInline (`src/ui/components/parts/user-question-inline.tsx:42`)
- Full inline HITL question dialog with keyboard navigation (up/down/enter/escape/1-9), custom text input mode
- Duplicates `UserQuestionDialog` (`src/ui/components/user-question-dialog.tsx:76`) which IS rendered at `chat.tsx:6008`
- The `ToolPart` type in `src/ui/parts/types.ts:82-89` has a `pendingQuestion` field matching this component's `PendingQuestion` interface
- **Intended context:** Inline alternative to the overlay `UserQuestionDialog`

#### 3. FooterStatus (`src/ui/components/footer-status.tsx:99`)
- Renders model ID, streaming indicator, verbose mode, queued count, permission mode, agent type joined by ` · `
- **What's used instead:** `chat.tsx:6120-6166` hand-builds footer elements inline; `BackgroundAgentFooter` (`background-agent-footer.tsx:13`) uses `formatBackgroundAgentFooterStatus()`

#### 4. TimestampDisplay (`src/ui/components/timestamp-display.tsx:109`)
- Right-aligned display with timestamp, duration, and model ID joined by ` • `
- **Intended context:** Inside `MessageBubble` in verbose mode

#### 5. StreamingBullet (`src/ui/chat.tsx:1152`)
- Animated `●`/`·` blinker at 500ms interval using `useState`/`setInterval`
- **Intended context:** Prefix for streaming text parts in `TextPartDisplay`
- Only real reference outside definition: test mock at `src/ui/index.protocol-ordering.test.ts:104`

#### 6. CodeBlock (`src/ui/code-block.tsx:187`)
- Renders bordered code with optional syntax highlighting via OpenTUI's `<code>` renderable
- Exports helpers: `normalizeLanguage()`, `extractCodeBlocks()`, `hasCodeBlocks()`, `extractInlineCode()`
- **Intended context:** Standalone code rendering alternative to OpenTUI's `<markdown>` internal code handling

---

## 🟡 Gap 7: Twelve Unconsumed Event Types

### The Drop Point

**`src/events/consumers/stream-pipeline-consumer.ts:126-181`** — The `mapToStreamPart()` switch handles exactly 5 event types. All other events hit `default: return null` at line 177 and are silently discarded.

### Events WITH Active Consumers (16 of 28)

| Bus Event Type | Consumer Mechanism |
|---|---|
| `stream.text.delta` | `mapToStreamPart()` → `text-delta` |
| `stream.text.complete` | `mapToStreamPart()` → `text-complete` |
| `stream.thinking.delta` | `mapToStreamPart()` → `thinking-meta` |
| `stream.thinking.complete` | `chat.tsx:2808` `useBusSubscription` |
| `stream.tool.start` | `mapToStreamPart()` → `tool-start` |
| `stream.tool.complete` | `mapToStreamPart()` → `tool-complete` |
| `stream.agent.start` | `chat.tsx:2832` `useBusSubscription` |
| `stream.agent.update` | `chat.tsx:2889` `useBusSubscription` |
| `stream.agent.complete` | `chat.tsx:2904` `useBusSubscription` |
| `stream.session.start` | `wire-consumers.ts:78` (`correlation.startRun()`) |
| `stream.session.idle` | `chat.tsx:2761` `useBusSubscription` |
| `stream.session.error` | `chat.tsx:2770` `useBusSubscription` |
| `stream.permission.requested` | `chat.tsx:3187` `useBusSubscription` |
| `stream.human_input_required` | `chat.tsx:3200` `useBusSubscription` |
| `stream.usage` | `chat.tsx:2774` `useBusSubscription` |
| `workflow.task.statusChange` | `executor.ts:313` `bus.on()` |

### Events WITHOUT Active Consumers (12 of 28)

#### Category: Session Events (5)

| # | Event Type | Payload | Emitted By | Intended Consumer |
|---|---|---|---|---|
| 1 | `stream.session.info` | `{infoType, message}` | OpenCode (`opencode-adapter.ts:1044`), Copilot (`copilot-adapter.ts:985`) | `chat.tsx` — parallels existing `stream.session.error` subscriber at line 2770 |
| 2 | `stream.session.warning` | `{warningType, message}` | OpenCode (`opencode-adapter.ts:1066`), Copilot (`copilot-adapter.ts:1002`) | `chat.tsx` — parallels existing `stream.session.error` subscriber at line 2770 |
| 3 | `stream.session.title_changed` | `{title}` | OpenCode (`opencode-adapter.ts:1088`), Copilot (`copilot-adapter.ts:1019`) | `chat.tsx` — update conversation title state |
| 4 | `stream.session.truncation` | `{tokenLimit, tokensRemoved, messagesRemoved}` | OpenCode (`opencode-adapter.ts:957`), Copilot (`copilot-adapter.ts:1035`) | `chat.tsx` — context window usage display |
| 5 | `stream.session.compaction` | `{phase, success?, error?}` | OpenCode (`opencode-adapter.ts:934`), Copilot (`copilot-adapter.ts:1053`) | `chat.tsx` — compaction lifecycle display |

#### Category: Turn Lifecycle (2)

| # | Event Type | Payload | Emitted By | Intended Consumer |
|---|---|---|---|---|
| 6 | `stream.turn.start` | `{turnId}` | OpenCode (`opencode-adapter.ts:980`), Copilot (`copilot-adapter.ts:936`) | `chat.tsx` — turn boundary tracking |
| 7 | `stream.turn.end` | `{turnId}` | OpenCode (`opencode-adapter.ts:1001`), Copilot (`copilot-adapter.ts:952`) | `chat.tsx` — turn completion signal |

#### Category: Tool Partial Results (1)

| # | Event Type | Payload | Emitted By | Intended Consumer |
|---|---|---|---|---|
| 8 | `stream.tool.partial_result` | `{toolCallId, partialOutput}` | OpenCode (`opencode-adapter.ts:1022`), Copilot (`copilot-adapter.ts:968`) | `stream-pipeline-consumer.ts` → new `StreamPartEvent` type for streaming tool output |

#### Category: Workflow Events (3)

| # | Event Type | Payload | Emitted By | Intended Consumer |
|---|---|---|---|---|
| 9 | `workflow.step.start` | `{workflowId, nodeId, nodeName}` | `workflow-adapter.ts:57` via `executor.ts:346` | `stream-pipeline-consumer.ts` → `"workflow-step-start"` (reducer exists at `stream-pipeline.ts:987`) |
| 10 | `workflow.step.complete` | `{workflowId, nodeId, status, result?}` | `workflow-adapter.ts:88` via `executor.ts:337,410` | `stream-pipeline-consumer.ts` → `"workflow-step-complete"` (reducer exists at `stream-pipeline.ts:1002`) |
| 11 | `workflow.task.update` | `{workflowId, tasks[]}` | `workflow-adapter.ts:114` via `executor.ts:373` | `stream-pipeline-consumer.ts` → `"task-list-update"` (reducer exists at `stream-pipeline.ts:1021`) |

#### Category: Skill Events (1)

| # | Event Type | Payload | Emitted By | Intended Consumer |
|---|---|---|---|---|
| 12 | `stream.skill.invoked` | `{skillName, skillPath?}` | OpenCode (`opencode-adapter.ts:910`), Copilot (`copilot-adapter.ts:784`) | `chat.tsx` — skill invocation display |

### Files to Edit for Workflow Event Wiring (Events 9-11)

These three events have **ready receivers** in the reducer but no sender in the consumer:

| File | Lines | What Needs to Change |
|------|-------|---------------------|
| `src/events/consumers/stream-pipeline-consumer.ts` | 126-182 | Add `case "workflow.step.start"`, `case "workflow.step.complete"`, `case "workflow.task.update"` to `mapToStreamPart()` switch |

The reducer at `src/ui/parts/stream-pipeline.ts` already handles the corresponding `StreamPartEvent` types:
- `"workflow-step-start"` at line 987-999
- `"workflow-step-complete"` at line 1002-1019
- `"task-list-update"` at line 1021-1044

### Emission Source Matrix

| Event Type | Claude | OpenCode | Copilot | Workflow Adapter |
|---|---|---|---|---|
| `stream.session.info` | ✗ | ✓ | ✓ | ✗ |
| `stream.session.warning` | ✗ | ✓ | ✓ | ✗ |
| `stream.session.title_changed` | ✗ | ✓ | ✓ | ✗ |
| `stream.session.truncation` | ✗ | ✓ | ✓ | ✗ |
| `stream.session.compaction` | ✗ | ✓ | ✓ | ✗ |
| `stream.turn.start` | ✗ | ✓ | ✓ | ✗ |
| `stream.turn.end` | ✗ | ✓ | ✓ | ✗ |
| `stream.tool.partial_result` | ✗ | ✓ | ✓ | ✗ |
| `workflow.step.start` | ✗ | ✗ | ✗ | ✓ |
| `workflow.step.complete` | ✗ | ✗ | ✗ | ✓ |
| `workflow.task.update` | ✗ | ✗ | ✗ | ✓ |
| `stream.skill.invoked` | ✗ | ✓ | ✓ | ✗ |

**Note:** The Claude adapter does not emit any of the 12 unconsumed event types.

---

## Architecture Documentation

### Event Bus Pipeline Architecture

```
SDK Events → SDK Adapter (Claude/OpenCode/Copilot)
  → bus.publish(BusEvent)
    → AtomicEventBus (src/events/event-bus.ts:57)
      ├── bus.on("type", handler)        [typed subscribers — 10 events]
      ├── bus.onAll(handler)             [wireConsumers — src/events/consumers/wire-consumers.ts:70]
      │     → BatchDispatcher (16ms frame-aligned batching)
      │       → CorrelationService.enrich() (10 event types handled, rest passthrough)
      │         → StreamPipelineConsumer.mapToStreamPart() (5 event types → StreamPartEvent, rest → null)
      │           → applyStreamPartEvent() reducer → Part[] → PART_REGISTRY → React render
      └── bus.onAll(handler)             [debug-subscriber.ts:165 — DEAD MODULE, never attached]
```

### Key Files Index

| Category | File | Role |
|----------|------|------|
| **Event Types** | `src/events/bus-events.ts` | All 28 `BusEventType` definitions and payloads |
| **Event Bus** | `src/events/event-bus.ts` | `AtomicEventBus` pub/sub implementation |
| **Batch Dispatcher** | `src/events/batch-dispatcher.ts` | 16ms frame-aligned event batching |
| **Wire Consumers** | `src/events/consumers/wire-consumers.ts` | Connects bus → dispatcher → pipeline |
| **Correlation** | `src/events/consumers/correlation-service.ts` | Enriches events with agent/tool IDs |
| **Pipeline Consumer** | `src/events/consumers/stream-pipeline-consumer.ts` | Maps BusEvent → StreamPartEvent |
| **Stream Pipeline** | `src/ui/parts/stream-pipeline.ts` | `applyStreamPartEvent()` reducer |
| **Part Types** | `src/ui/parts/types.ts` | `Part` union type (8 members, missing `WorkflowStepPart`) |
| **Part Registry** | `src/ui/components/parts/registry.tsx` | `PART_REGISTRY` (8 entries, missing `workflow-step`) |
| **Adapters** | `src/events/adapters/claude-adapter.ts` | Claude SDK → BusEvent |
| **Adapters** | `src/events/adapters/opencode-adapter.ts` | OpenCode SDK → BusEvent |
| **Adapters** | `src/events/adapters/copilot-adapter.ts` | Copilot SDK → BusEvent |
| **Adapters** | `src/events/adapters/workflow-adapter.ts` | Workflow executor → BusEvent |
| **Chat Command** | `src/commands/chat.ts` | Init sequence (client creation → start) |
| **CLI Entry** | `src/cli.ts` | Flag definitions, command routing |
| **Custom Tools** | `src/sdk/tools/discovery.ts` | Tool discovery + registration pipeline |
| **MCP Bridge** | `src/sdk/tools/opencode-mcp-bridge.ts` | OpenCode tool bridge (placeholder) |
| **Executor** | `src/workflows/executor.ts` | Graph workflow execution |
| **Chat TUI** | `src/ui/chat.tsx` | Main UI with `useBusSubscription` hooks |

---

## Historical Context (from research/)

- `research/docs/2026-02-27-workflow-tui-rendering-unification.md` — Documents the fundamental difference between main TUI chat rendering (event-driven pipeline) and workflow executor rendering (static `addMessage()` calls). Identifies that workflow sub-agents bypass the streaming pipeline entirely.
- `research/docs/2026-02-28-workflow-issues-research.md` — Detailed research on sub-agent tree streaming, code-review timing, parallel task execution, and streaming delay issues in the Ralph workflow.
- `research/docs/2026-02-25-workflow-sdk-design.md` — Workflow SDK design patterns and architecture.
- `research/docs/2026-02-25-graph-execution-engine.md` — Graph execution engine technical documentation.
- `research/docs/2026-02-09-165-custom-tools-directory.md` — Custom tools directory research.
- `specs/custom-tools-directory.md:853` — Phase 3 checklist: "Wire `registerCustomTools()` into `src/commands/chat.ts`" (unchecked).

## Related Research

- `research/docs/2026-02-26-streaming-architecture-event-bus-migration.md`
- `research/docs/2026-02-26-streaming-event-bus-spec-audit.md`
- `research/docs/2026-02-25-workflow-registration-flow.md`
- `research/docs/2026-02-16-opentui-rendering-architecture.md`
- `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md`

## Open Questions

1. For the OpenCode MCP bridge (Gap 3), which approach is preferred: (a) adopting Claude's in-process MCP pattern using `createSdkMcpServer()`, (b) implementing IPC between the MCP script and main process, or (c) a different approach specific to OpenCode's architecture?
2. For the 12 unconsumed events (Gap 7), should all events get consumers at once, or should priority be given to the 3 workflow events (9-11) that already have reducer handlers?
3. For the 6 unrendered components (Gap 6), should components like `FooterStatus` replace the hand-built footer in `chat.tsx:6120-6166`, or should the existing inline approach remain and the component be removed?
4. For the dead modules (Gap 5), should all 6 be activated simultaneously, or should they be prioritized based on impact?
