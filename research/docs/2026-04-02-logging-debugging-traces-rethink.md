---
date: 2026-04-02 04:45:21 UTC
researcher: Claude Code
git_commit: fbfc5a3f51f5d3aee2ed25f398233aa1549e025c
branch: lavaman131/feature/enhance-debug-logs
repository: atomic
topic: "Rethinking Logging/Debugging Traces and AppInsights for Atomic TUI — SDK Logger Integration and Key Press Logging"
tags: [research, logging, debugging, telemetry, appinsights, copilot-sdk, claude-agent-sdk, opencode-sdk, opentui, keyboard, traces]
status: complete
last_updated: 2026-04-02
last_updated_by: Claude Code
---

# Research: Logging/Debugging Traces and AppInsights Rethink for Atomic TUI

## Research Question

Rethink the logging/debugging traces and the AppInsights traces for the Atomic TUI. Research in depth how the built-in loggers in Copilot SDK, Claude Agent SDK, and OpenCode SDK work and how to incorporate those in addition to the built-in TUI logs from Atomic. Atomic should also log key names that were pressed for maximum debugging insights (e.g., ESC, CTRL+C, etc.).

## Summary

The Atomic TUI currently has a **rich internal debug logging system** gated behind `DEBUG=1` (structured JSONL event logs, raw stream logs, tool-debug JSONL, conductor-debug JSONL, pipeline console diagnostics) and a **separate telemetry system** that buffers events to JSONL and uploads to Azure Application Insights via OpenTelemetry. However, the three SDK-level loggers (Copilot SDK telemetry traces, Claude Agent SDK debug logs, and OpenCode built-in file logs) are **not systematically captured or surfaced** alongside Atomic's own logs. Additionally, **keyboard input events are not logged at all** — despite full key metadata (`name`, `ctrl`, `shift`, `meta`, `raw`, `source`) being available in the `useKeyboardOwnership` hook.

This document catalogs all existing logging infrastructure, documents each SDK's logging capabilities, and describes how key press logging currently flows through the system.

---

## Detailed Findings

### 1. Atomic TUI Built-in Logging Infrastructure

#### 1.1 Debug Subscriber (Primary Debug System)

**Location**: `src/services/events/debug-subscriber/`

The debug subscriber is the core debug infrastructure. It is activated by `DEBUG=1` and attached during `createChatUIRuntimeState()` at `src/state/runtime/chat-ui-runtime-state.ts:54`.

**Output files** (per session, in `~/.local/share/atomic/log/events/<timestamp>/`):
- `events.jsonl` — Structured bus timeline with rich metadata: `seq`, `runSeq`, `ts`, `loggedAt`, `eventLagMs`, `globalGapMs`, `sessionRunGapMs`, `streamGapMs`, `runAgeMs`, `runDurationMs`, `lifecycleMarkers[]`, `payloadBytes`, `agentTreeSnapshot`, `data`
- `raw-stream.log` — Human-readable conversation view with symbols: `∴ Thinking...`, `◉ toolName`, `● agentType: task`, `⣯ Composing… (duration)`

**Diagnostic entries** (written to `events.jsonl`):
- `startup` — pid, platform, arch, nodeVersion, bunVersion, cwd, env snapshot, argv, memoryUsage
- `bus_error` — Schema validation drops, handler exceptions, agent lifecycle violations
- `process_error` — `uncaughtException` and `unhandledRejection` handlers

**Configuration** (`src/services/events/debug-subscriber/config.ts`):
- `DEFAULT_LOG_DIR`: `~/.local/share/atomic/log/events`
- `MAX_LOG_SESSIONS`: 10 sessions retained
- `STREAM_CONTINUITY_GAP_THRESHOLD_MS`: 1500ms

**Reference**: Full documentation at `docs/stream-debug-logging.md`

#### 1.2 Pipeline Logger

**File**: `src/services/events/pipeline-logger.ts`

- `isPipelineDebug()` (line 37): Reads `process.env.DEBUG`, caches result. Truthy for `"1"`, `"true"`, `"on"` (case-insensitive).
- `pipelineLog(stage, action, data?)` (line 62): `console.debug("[Pipeline:<stage>] <action> <JSON>")` when debug enabled.
- `pipelineError(stage, action, data?)` (line 82): `console.error("[Pipeline:<stage>] <action> <JSON>")`.
- Valid stages: `"EventBus"`, `"Dispatcher"`, `"Wire"`, `"Consumer"`, `"Subagent"`, `"Workflow"`.

#### 1.3 Tool Attribution Debug Logger

**File**: `src/services/events/adapters/providers/claude/tool-debug-log.ts`

- `toolDebug(action, data)` (line 44): Appends JSONL to `~/.local/share/atomic/log/tool-debug.jsonl` via `Bun.file().writer()`.
- Gated on `DEBUG` env var (not `"0"`, `"false"`, `"off"`).

#### 1.4 Conductor Executor Debug Logger

**File**: `src/services/workflows/runtime/executor/conductor-debug-log.ts`

- `conductorDebug(action, data)` (line 52): Appends JSONL to `~/.local/share/atomic/log/conductor-debug.jsonl`.
- Same `DEBUG` gating as tool-debug-log.

#### 1.5 Conductor Workflow Text Log

**File**: `src/services/workflows/conductor/conductor.ts`

- `conductorLog(action, data?)` (lines 72-81): `appendFileSync` plain-text to `<LOG_DIR>/conductor-debug.log`.
- `LOG_DIR` from `process.env.LOG_DIR` or default.

#### 1.6 OpenCode Client Inline Debug

**File**: `src/services/agents/clients/opencode.ts`

- Module-level `debugLog` (lines 31-33): No-op when `DEBUG !== "1"` (exact string match), otherwise `console.debug(label, data)`.
- Labels: `"sse-watchdog-timeout"`, `"sse-abort"`, `"sse-event-filter"`, `"compaction.proactive_trigger"`, `"compaction.overflow_trigger"`, `"subagent.start"`, `"tool.start"`, etc.

#### 1.7 Runtime Parity Observability

**File**: `src/services/workflows/runtime-parity-observability.ts`

- `runtimeParityDebug(phase, data)` (line 96): `console.debug("[workflow.runtime.parity] ...")`.
- Gated on `DEBUG` or `ATOMIC_WORKFLOW_DEBUG=1`.

#### 1.8 Thinking Source Trace

**File**: `src/state/chat/shared/helpers/thinking.ts`

- `traceThinkingSourceLifecycle(action, sourceKey, detail?)` (line 14): `console.debug("[thinking-source] ...")`.
- Gated on `ATOMIC_THINKING_DIAGNOSTICS_DEBUG=1`.

#### 1.9 Discovery Event Logger

**File**: `src/services/config/discovery-events.ts`

- `emitDiscoveryEvent(event, options)` (line 269): Builds payload with `schema: "atomic.discovery.event.v1"`, routes to `console.debug`/`console.warn`/`console.error`. Path values redacted to `<project>/...`, `~/...`, `<external-path>`.
- Gated on `DEBUG` via `isDiscoveryDebugLoggingEnabled()`.

#### 1.10 Summary of Environment Variables

| Variable | Files | Behavior |
|---|---|---|
| `DEBUG` | Multiple | Master debug switch. `"1"`, `"true"`, `"on"` enable; `"0"`, `"false"`, `"off"` disable |
| `LOG_DIR` | `config.ts`, `conductor.ts` | Override log directory |
| `ATOMIC_WORKFLOW_DEBUG=1` | `runtime-parity-observability.ts` | Workflow debug output |
| `ATOMIC_THINKING_DIAGNOSTICS_DEBUG=1` | `thinking.ts` | Thinking source trace |
| `ATOMIC_TELEMETRY_DEBUG=1` | `telemetry-errors.ts` | Print telemetry errors |
| `ATOMIC_VALIDATE_BUS_EVENTS=1` | `chat-ui-runtime-state.ts` | Zod validation on all bus events |
| `ATOMIC_DISABLE_TELEMETRY=1` | `telemetry.ts` | Disable all telemetry |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | `telemetry-upload.ts` | Override App Insights connection |

---

### 2. Copilot SDK Telemetry and Logging

#### 2.1 Telemetry Configuration

**Source**: `node_modules/@github/copilot-sdk/dist/types.d.ts`

The `CopilotClient` accepts a `telemetry` option with the following `TelemetryConfig` interface:

```typescript
interface TelemetryConfig {
  otlpEndpoint?: string;   // Sets OTEL_EXPORTER_OTLP_ENDPOINT
  filePath?: string;        // Sets COPILOT_OTEL_FILE_EXPORTER_PATH
  exporterType?: string;    // Sets COPILOT_OTEL_EXPORTER_TYPE ("otlp-http" or "file")
  sourceName?: string;      // Sets COPILOT_OTEL_SOURCE_NAME
  captureContent?: boolean; // Sets OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT
}
```

Usage:
```typescript
const client = new CopilotClient({
  telemetry: {
    filePath: "./traces.jsonl",
    exporterType: "file",
  },
});
```

The SDK maps each field to an environment variable passed to the spawned CLI subprocess. OTel is off by default with zero overhead.

#### 2.2 OTel Span Hierarchy

The Copilot CLI creates a three-level span hierarchy following OTel GenAI Semantic Conventions:

**`invoke_agent` span** (kind: `CLIENT`) — root span per agent turn:
- Attributes: `gen_ai.operation.name`, `gen_ai.agent.id`, `gen_ai.conversation.id`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.*`, `github.copilot.turn_count`, `github.copilot.cost`, `github.copilot.aiu`, `error.type`

**`chat` span** (kind: `CLIENT`) — one per LLM API call:
- Attributes: `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.id`, `gen_ai.response.finish_reasons`, `gen_ai.usage.*`, `github.copilot.cost`, `github.copilot.server_duration`, `github.copilot.turn_id`, `github.copilot.interaction_id`

**`execute_tool` span** (kind: `INTERNAL`) — one per tool call:
- Attributes: `gen_ai.tool.name`, `gen_ai.tool.type`, `gen_ai.tool.call.id`, `gen_ai.tool.description`
- When `captureContent: true`: also `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`

#### 2.3 OTel Metrics

| Metric | Type | Description |
|---|---|---|
| `gen_ai.client.operation.duration` | Histogram | LLM API call and agent invocation duration |
| `gen_ai.client.token.usage` | Histogram | Token counts by type |
| `gen_ai.client.operation.time_to_first_chunk` | Histogram | Time to first streaming chunk |
| `gen_ai.client.operation.time_per_output_chunk` | Histogram | Inter-chunk latency |
| `github.copilot.tool.call.count` | Counter | Tool invocations by name and success |
| `github.copilot.tool.call.duration` | Histogram | Tool execution latency |
| `github.copilot.agent.turn.count` | Histogram | LLM round-trips per invocation |

#### 2.4 OTel Span Events

Lifecycle events recorded as OTel span events:
- `github.copilot.hook.start` / `hook.end` / `hook.error`
- `github.copilot.session.truncation`, `session.compaction_start`, `session.compaction_complete`
- `github.copilot.skill.invoked`
- `github.copilot.session.shutdown` (with usage stats)
- `github.copilot.session.abort`
- `exception`

#### 2.5 SDK `logLevel` Option

```typescript
const client = new CopilotClient({
  logLevel: "debug" // "none" | "error" | "warning" | "info" | "debug" | "all"
});
```

This sets the `--log-level` CLI flag. Log output goes to CLI process stderr (internally `client.stderrBuffer`).

#### 2.6 Copilot CLI OTel Environment Variables

| Variable | Default | Description |
|---|---|---|
| `COPILOT_OTEL_ENABLED` | `false` | Explicitly enable OTel |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP HTTP endpoint; enables OTel automatically |
| `COPILOT_OTEL_EXPORTER_TYPE` | `otlp-http` | `"otlp-http"` or `"file"` |
| `OTEL_SERVICE_NAME` | `github-copilot` | Resource service name |
| `OTEL_RESOURCE_ATTRIBUTES` | — | Extra resource attributes |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `false` | Capture full prompts/responses |
| `OTEL_LOG_LEVEL` | — | OTel SDK internal diagnostic level |
| `COPILOT_OTEL_FILE_EXPORTER_PATH` | — | JSONL trace file path |
| `COPILOT_OTEL_SOURCE_NAME` | `github.copilot` | Instrumentation scope name |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | Auth headers for OTLP endpoint |

#### 2.7 Programmatic Session Events

The SDK provides 50+ strongly-typed session events via `session.on()`:
- Session lifecycle: `session.start`, `session.resume`, `session.error`, `session.idle`, `session.shutdown`
- Turn lifecycle: `assistant.turn_start`, `assistant.reasoning`, `assistant.streaming_delta`, `assistant.message`, `assistant.turn_end`, `assistant.usage`
- Tool lifecycle: `tool.execution_start`, `tool.execution_progress`, `tool.execution_complete`
- Subagents: `subagent.started`, `subagent.completed`, `subagent.failed`
- Hooks: `hook.start`, `hook.end`

#### 2.8 Current Atomic Integration State

**File**: `src/services/agents/clients/copilot.ts`

- `CopilotClientOptions` includes `logLevel?: "none" | "error" | "warning" | "info" | "debug" | "all"` (lines 95-104)
- `buildCopilotSdkOptions()` passes `logLevel` to the SDK (line 48 of `sdk-options.ts`)
- **No telemetry config** is currently passed. The `telemetry` field on `CopilotClientOptions` is not being set.
- `createCopilotClient(options?)` creates `new CopilotClient(options)` with default `{}` (line 586), so `logLevel` is undefined by default.

---

### 3. Claude Agent SDK Debug Logging

#### 3.1 SDK Options for Debug

**Source**: `docs/claude-code/agent-sdk.md`, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`

```typescript
const q = query({
  prompt: "...",
  options: {
    debug: true,              // Enable debug mode, writes to ~/.claude/debug/<sessionId>.txt
    debugFile: "/path/to.log", // Write debug logs to specific path (implicitly enables debug)
    stderr: (data: string) => void, // Callback for subprocess stderr output
  }
});
```

#### 3.2 What Debug Mode Outputs

The Claude Code subprocess has 1,682+ distinct log calls covering:
- **API calls**: `[API REQUEST] /v1/messages x-client-request-id=<id> source=<source>`
- **MCP servers**: Connection status, tool loading, registry fetches
- **Tool execution**: Permission decisions, deferred tool use, search selection
- **Process lifecycle**: Bash path detection, session ID rotation, shell task management
- **Settings/config**: MDM settings, config corruption recovery, file watchers
- **Hooks**: Registration, ConfigChange hooks, keybinding reloads
- **Permissions**: Mode changes, permission persistence
- **Sandbox**: Blocked network requests, planted file scrubbing
- **Authentication**: Trusted device, CA certs, mTLS loading
- **Session**: Title, tag, git branch tracking

#### 3.3 Debug Log Format

**Format**: Plain text, one entry per line:
```
<ISO8601_TIMESTAMP> [<LEVEL>] <message>
```

**Log levels**: `verbose (0)`, `debug (1)`, `info (2)`, `warn (3)`, `error (4)`. Default minimum: `debug`.

**Default debug file path** (when `debug: true`, no `debugFile`):
```
~/.claude/debug/<sessionId>.txt
```

**Log level override**: `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose|debug|info|warn|error`

#### 3.4 Debug Mode Activation Triggers

Any one of these activates debug mode:
- CLI flag `--debug` or `-d`
- CLI flag `--debug-file <path>`
- CLI flag `--debug-to-stderr` or `-d2e`
- Environment variable `DEBUG=1`
- Environment variable `DEBUG_SDK=1`
- Environment variable `CLAUDE_CODE_DEBUG_LOGS_DIR=<path>`

#### 3.5 stderr vs debugFile

These are **separate streams**:
- `debugFile` / `debug: true` → Writes to the debug file (`~/.claude/debug/<sessionId>.txt` or custom path)
- `stderr` callback → Receives raw fd2 output from the subprocess (unhandled exceptions, Node.js warnings)
- When `DEBUG_CLAUDE_AGENT_SDK=1` is set, `--debug-to-stderr` is added to subprocess args, making debug output flow through the `stderr` callback

#### 3.6 SDK-Level Debug Log

**Trigger**: `DEBUG_CLAUDE_AGENT_SDK=1`
**File**: `~/.claude/debug/sdk-<uuid>.txt`
**Content**: Spawn command, stdin writes (first 100 chars), stdout parse errors, process exit errors, DirectConnect events

#### 3.7 Session Transcripts

- **Path**: `~/.claude/projects/<hash_of_cwd>/<sessionId>.jsonl`
- **Subagent transcripts**: `~/.claude/projects/<hash_of_cwd>/<sessionId>/subagents/<agentType>/agent-<agentId>.jsonl`
- Available via `getSessionMessages(sessionId, { dir })` SDK function

#### 3.8 SDKMessage Types Useful for Diagnostics

| Message Type | Diagnostic Value |
|---|---|
| `SDKSystemMessage` (`subtype: "init"`) | Tools, MCP servers, model, permissionMode, cwd |
| `SDKToolProgressMessage` | `tool_name`, `tool_use_id`, `elapsed_time_seconds` |
| `SDKHookStartedMessage` / `SDKHookProgressMessage` / `SDKHookResponseMessage` | Hook lifecycle with stdout/stderr/exit_code |
| `SDKTaskStartedMessage` / `SDKTaskProgressMessage` / `SDKTaskNotificationMessage` | Background task lifecycle with token/tool usage |
| `SDKResultMessage` | `duration_ms`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials` |
| `SDKRateLimitEvent` | Rate limit status with `resetsAt`, `utilization` |
| `SDKCompactBoundaryMessage` | Context compaction with `pre_tokens` |
| `SDKAuthStatusMessage` | Auth flow events |

#### 3.9 Current Atomic Integration State

**File**: `src/services/agents/clients/claude.ts`

- `createClaudeAgentClient()` (line 480): No debug or logging options passed.
- `buildClaudeSdkOptions()` (line 127): No `debug`, `debugFile`, or `stderr` fields configured.
- Claude SDK debug capabilities are **not being used**.

---

### 4. OpenCode SDK Logging

#### 4.1 Log Levels

**Source**: `packages/opencode/src/util/log.ts`

Four levels: `DEBUG`, `INFO`, `WARN`, `ERROR`.
- Default: `INFO` (production), `DEBUG` (local dev with `Installation.isLocal()`)
- CLI flag: `--log-level DEBUG|INFO|WARN|ERROR`
- Additional: `--print-logs` redirects to stderr instead of file

#### 4.2 Log Format

**Format**: Plain text, structured key=value pairs:
```
INFO  2025-01-09T12:34:56 +42ms service=llm providerID=anthropic modelID=claude-3-5-sonnet stream
DEBUG 2025-01-09T12:34:56 +1ms service=config loading path=/home/user/.config/opencode/config.json
```

**Fields**: LEVEL (5-char padded), ISO timestamp (no ms), +delta ms, key=value tags, message.

**File naming**: `~/.local/share/opencode/log/<YYYY-MM-DDTHHMMSS>.log` (or `dev.log` in local dev). Max 10 files retained.

#### 4.3 SDK Programmatic Configuration

```typescript
import { createOpencodeServer } from "@opencode-ai/sdk/server"
const server = await createOpencodeServer({
  config: { logLevel: "DEBUG" }
})
```

This passes `--log-level=DEBUG` to the spawned `opencode serve` command.

#### 4.4 Plugin Logging

Plugins do **not** receive a `log` function in `PluginInput`. Options:
- **REST API**: `client.app.log({ body: { service: "my-plugin", level: "info", message: "..." } })` — writes to server's log file via `POST /log`
- **Direct import**: `import { Log } from "@opencode-ai/opencode/util/log"` (internal, not public API)

#### 4.5 Bus Events

Available via `Bus.subscribe()` and plugin `hooks.event`:
- `session.created`, `session.updated`, `session.deleted`, `session.diff`, `session.error`
- `message.updated`, `message.removed`, `message.part.updated`, `message.part.delta`, `message.part.removed`
- `command.executed`

#### 4.6 Environment Variables

| Variable | Effect |
|---|---|
| `OPENCODE_PURE=1` | Disable external plugins |
| `OPENCODE_CONFIG_CONTENT` | Override config as JSON (can include `logLevel`) |
| `OPENCODE_DISABLE_AUTOCOMPACT=1` | Disable session auto-compaction |
| `OPENCODE_EXPERIMENTAL=1` | Enable experimental features |

**No `OPENCODE_LOG_LEVEL` env var** — log level is CLI-flag or SDK-config only.

#### 4.7 Current Atomic Integration State

**File**: `src/services/agents/clients/opencode.ts`

- Module-level `debugLog` (lines 31-33): Only active when `process.env.DEBUG === "1"` (exact string match). Outputs `console.debug(label, data)`.
- No SDK-level log configuration passed to `createSdkClient`.
- OpenCode's built-in file logs at `~/.local/share/opencode/log/` are **not captured or surfaced** by Atomic.

---

### 5. Telemetry / AppInsights Infrastructure

#### 5.1 Current Telemetry System

**Directory**: `src/services/telemetry/`

**Core files**:
- `telemetry.ts` — State management, ID generation, monthly rotation, consent/opt-out chain
- `telemetry-cli.ts` — CLI command tracking (`trackAtomicCommand`)
- `telemetry-tui.ts` — `TuiTelemetrySessionTracker` class with events: `tui_session_start`, `tui_session_end`, `tui_message_submit`, `tui_command_execution`, `tui_tool_lifecycle`, `tui_interrupt`, `tui_background_termination`
- `telemetry-session.ts` — Per-session tracking
- `telemetry-file-io.ts` — JSONL file I/O with locking; per-agent files: `telemetry-events-<agent>.jsonl`
- `telemetry-consent.ts` — First-run consent prompt
- `telemetry-errors.ts` — Silent error handler (`ATOMIC_TELEMETRY_DEBUG=1` for verbose)
- `graph-integration.ts` — `WorkflowTracker` interface for graph telemetry

#### 5.2 Azure App Insights Upload

**File**: `src/services/telemetry/telemetry-upload.ts`

- Imports `useAzureMonitor`, `shutdownAzureMonitor` from `@azure/monitor-opentelemetry`
- Imports `logs`, `SeverityNumber` from `@opentelemetry/api-logs`
- `DEFAULT_CONNECTION_STRING` (line 54): Hardcoded App Insights connection string (West US 2)
- `getConnectionString()`: Checks `APPLICATIONINSIGHTS_CONNECTION_STRING` env var, falls back to hardcoded default
- `emitEventsToAppInsights(events)`: Uses OTel Logs API with `microsoft.custom_event.name` attribute for routing to `customEvents` table
- `handleTelemetryUpload()`: Claims files via atomic rename, reads and filters (30-day TTL), batches of 100, flushes via `shutdownAzureMonitor()`
- **Lazy-loaded** to avoid 244ms startup penalty from `@azure/monitor-opentelemetry` import

**Dependencies** (package.json):
- `@azure/monitor-opentelemetry: ^1.16.0`
- `@opentelemetry/api: ^1.9.1`
- `@opentelemetry/api-logs: ^0.214.0`

#### 5.3 Telemetry Event Types

| Event Type | Source | Key Fields |
|---|---|---|
| `atomic_command` | CLI (`telemetry-cli.ts`) | `command`, `agentType`, `success` |
| `cli_command` | CLI (`telemetry-cli.ts`) | `commands[]`, `commandCount` |
| `agent_session` | Session hooks | `sessionId`, `commands[]`, `commandCount` |
| `tui_session_start` | TUI (`telemetry-tui.ts`) | `agentType`, `sessionId` |
| `tui_session_end` | TUI (`telemetry-tui.ts`) | `durationMs`, `messageCount`, `commandCount`, `toolCallCount`, `interruptCount` |
| `tui_message_submit` | TUI | `messageLength`, `hasSlashCommand` |
| `tui_command_execution` | TUI | `commandName` |
| `tui_tool_lifecycle` | TUI | `toolName`, `action` (start/complete) |
| `tui_interrupt` | TUI | `interruptType` |

All events include: `anonymousId`, `eventId`, `timestamp`, `platform`, `atomicVersion`, `source`.

---

### 6. Keyboard Input Handling (for Key Press Logging)

#### 6.1 Entry Point

**File**: `src/state/chat/keyboard/use-keyboard-ownership.ts:59-319`

A single `useKeyboard` listener (from `@opentui/react`) is registered at line 162. This is the **sole keyboard entry point** for the entire chat UI.

#### 6.2 KeyEvent Shape

**Source**: `node_modules/@opentui/core/lib/KeyHandler.d.ts`

```typescript
interface KeyEvent {
  name: string;         // Human-readable: "escape", "return", "c", "up"
  ctrl: boolean;        // Ctrl modifier
  meta: boolean;        // Meta/Alt modifier
  shift: boolean;       // Shift modifier
  option: boolean;      // Option modifier (macOS)
  raw: string;          // Raw escape sequence bytes
  source: "raw" | "kitty";  // Input protocol
  eventType: "press" | "repeat" | "release";
  repeated?: boolean;
  sequence: string;
  code?: string;        // Kitty protocol key code
  baseCode?: number;    // Unicode codepoint
}
```

#### 6.3 Key Dispatch Flow

```
Terminal stdin
  └─> OpenTUI renderer (app.tsx:169, exitOnCtrlC: false, useKittyKeyboard: { disambiguate: true })
        └─> KeyHandler (@opentui/core)
              └─> useKeyboard (@opentui/react)
                    └─> useKeyboardOwnership (use-keyboard-ownership.ts:162)
                          ├─> Phase 1: Kitty detection (event.raw)
                          ├─> Phase 1: handleClipboardKey (Ctrl+Shift+C, Meta+C, Ctrl+V, Meta+V)
                          ├─> Phase 1: isCtrlCInterrupt → handleCtrlCKey
                          ├─> Phase 2: Mode guard ("dialog" / "model-selector" → return early)
                          ├─> Phase 3: handleShortcutKey (Ctrl+O, Ctrl+E, Ctrl+T)
                          ├─> Phase 3: ESC → handleEscapeKey
                          ├─> Phase 3: handleNavigationKey (pageup/down, up/down, tab, return)
                          ├─> Phase 3: handleComposeShortcutKey (newline fallback)
                          ├─> Phase 3: handleAutocompleteSelectionKey (tab, return)
                          └─> Phase 4: postDispatchReconciliation (setTimeout 0)
```

#### 6.4 Key Names Currently Handled

| Key Combination | Handler Location | Action |
|---|---|---|
| Ctrl+C | `chat-input-handler.ts:83-85` | Interrupt / double-press exit |
| Ctrl+Shift+C / Meta+C | `chat-input-handler.ts:34-73` | Copy |
| Ctrl+V / Meta+V | `chat-input-handler.ts:34-73` | Paste |
| Ctrl+O | `chat-input-handler.ts:107-131` | Toggle transcript mode |
| Ctrl+E | `chat-input-handler.ts:107-131` | Toggle verbose output |
| Ctrl+T | `chat-input-handler.ts:107-131` | Toggle todo panel |
| ESC | `use-keyboard-ownership.ts:215-225` | Dismiss autocomplete / interrupt / cancel |
| Page Up/Down | `navigation.ts:40-223` | Scroll |
| Up/Down | `navigation.ts:40-223` | History / autocomplete navigation |
| Tab | `navigation.ts:40-223` | Autocomplete |
| Return/Enter | Multiple | Submit / newline (with Shift/Meta) |
| 1-9 | `dialog-handler.ts:75-296` | Quick-select in dialogs |
| j/k | `dialog-handler.ts:75-296` | Vi-style navigation in dialogs |
| Space | `dialog-handler.ts:75-296` | Toggle multi-select in dialogs |

#### 6.5 Current Key Logging Status

**Key names are NOT logged.** No code anywhere in the codebase logs `event.name`, modifier flags, or raw sequences to any debug channel. The `KeyEvent` object has all the metadata needed (`name`, `ctrl`, `shift`, `meta`, `raw`, `source`, `eventType`), but it is consumed and discarded without any diagnostic trace.

#### 6.6 Signal Handlers (OS-Level)

**File**: `src/state/runtime/chat-ui-controller.ts:474-495`

```typescript
process.on("SIGINT", sigintHandler);   // line 483
process.on("SIGTERM", sigtermHandler); // line 484
```

These bypass the keyboard flow entirely. SIGINT calls `handleInterrupt("signal")`. SIGTERM calls `cleanup()`.

#### 6.7 OpenTUI Renderer Configuration

**File**: `src/app.tsx:167-175`

```typescript
exitOnCtrlC: false,  // Let app handle Ctrl+C
useKittyKeyboard: { disambiguate: true }  // Enable Kitty protocol
```

Manual `modifyOtherKeys` mode-2 escape sequence at line 179: `\x1b[>4;2m`. Cleanup at `chat-ui-controller.ts:116`: `\x1b[>4;0m`.

#### 6.8 Double-Press Ctrl+C Confirmation

**File**: `src/state/chat/keyboard/use-interrupt-confirmation.ts:10-49`

First Ctrl+C sets `ctrlCPressed = true` with 1000ms timeout. Second Ctrl+C within 1s triggers exit or workflow cancellation. State: `interruptCount`, `ctrlCPressed`, `interruptTimeoutRef`.

---

### 7. Error Handling and Crash Reporting

#### 7.1 React Error Boundary

**File**: `src/components/error-exit-screen.tsx:112`

`AppErrorBoundary` — standard React error boundary. Renders `ErrorScreen` with error message and first 12 stack trace lines. Any key press exits.

#### 7.2 Stream Startup Errors

**File**: `src/state/chat/stream/use-errors.ts:34`

`handleStreamStartupError(error)`: `console.error("[stream] Failed to start stream:", error)`, adds `[error]` system message to chat.

#### 7.3 EventBus Error Isolation

**File**: `src/services/events/event-bus.ts:229-275`

Schema validation failures, handler exceptions, and wildcard handler exceptions are all caught, logged via `pipelineError`, `console.error`, and routed through `emitInternalError()`.

#### 7.4 Process-Level Crash Capture

**File**: `src/services/events/debug-subscriber/subscriber.ts:89-105`

When debug mode active: `process.on("uncaughtException")` and `process.on("unhandledRejection")` write `process_error` diagnostic entries with error message, stack, and kind.

---

## Code References

### Atomic Internal Logging
- `src/services/events/debug-subscriber/config.ts` — Log directory config, filenames
- `src/services/events/debug-subscriber/subscriber.ts` — Debug subscriber attachment
- `src/services/events/debug-subscriber/log-writer.ts` — JSONL + raw stream writer
- `src/services/events/debug-subscriber/log-readers.ts` — Log file readers
- `src/services/events/pipeline-logger.ts` — Pipeline console logger
- `src/services/events/adapters/providers/claude/tool-debug-log.ts` — Tool debug JSONL
- `src/services/workflows/runtime/executor/conductor-debug-log.ts` — Conductor debug JSONL
- `src/services/workflows/conductor/conductor.ts:67-81` — Conductor text log
- `src/services/workflows/runtime-parity-observability.ts` — Metrics + debug
- `src/state/chat/shared/helpers/thinking.ts` — Thinking source trace
- `src/services/config/discovery-events.ts` — Discovery event logger
- `src/state/runtime/chat-ui-runtime-state.ts:54` — Debug subscriber init
- `src/state/runtime/chat-ui-controller.ts:24-28` — Cleanup error logger
- `docs/stream-debug-logging.md` — Full documentation

### SDK Clients
- `src/services/agents/clients/claude.ts:127,480` — Claude SDK options (no debug config)
- `src/services/agents/clients/copilot.ts:95-104,586` — Copilot SDK options (logLevel supported, telemetry not wired)
- `src/services/agents/clients/copilot/session-runtime.ts:195-200` — Copilot abort debug
- `src/services/agents/clients/opencode.ts:31-33` — OpenCode inline debug

### Telemetry
- `src/services/telemetry/telemetry.ts` — Core state management
- `src/services/telemetry/telemetry-upload.ts` — Azure App Insights upload
- `src/services/telemetry/telemetry-tui.ts` — TUI session tracker
- `src/services/telemetry/telemetry-cli.ts` — CLI command tracker
- `src/services/telemetry/telemetry-file-io.ts` — JSONL file I/O
- `src/services/telemetry/telemetry-errors.ts` — Error handler
- `src/services/telemetry/graph-integration.ts` — Workflow tracker

### Keyboard Input
- `src/state/chat/keyboard/use-keyboard-ownership.ts:59-319` — Central dispatch
- `src/state/chat/keyboard/handlers/chat-input-handler.ts` — Ctrl+C, clipboard, shortcuts
- `src/state/chat/keyboard/handlers/dialog-handler.ts` — Dialog key handling
- `src/state/chat/keyboard/navigation.ts` — Page/arrow/tab navigation
- `src/state/chat/keyboard/use-interrupt-confirmation.ts` — Double Ctrl+C
- `src/state/chat/keyboard/use-interrupt-controls.ts:413-603` — ESC handler
- `src/state/chat/keyboard/kitty-keyboard-detection.ts` — Kitty protocol detection
- `src/state/chat/shared/helpers/newline-strategies.ts` — Shift+Enter detection
- `src/state/chat/composer/use-input-state.ts:48-55` — Textarea key bindings
- `src/state/runtime/chat-ui-controller.ts:474-495` — SIGINT/SIGTERM handlers
- `src/app.tsx:167-175` — OpenTUI renderer config
- `src/components/error-exit-screen.tsx:32-34` — Error screen any-key handler

---

## Architecture Documentation

### Log File Locations (Runtime)

| Log Category | Path | Format | Rotation |
|---|---|---|---|
| Event timeline | `~/.local/share/atomic/log/events/<timestamp>/events.jsonl` | JSONL | 10 sessions |
| Raw stream | `~/.local/share/atomic/log/events/<timestamp>/raw-stream.log` | Plain text | 10 sessions |
| Tool debug | `~/.local/share/atomic/log/tool-debug.jsonl` | JSONL | None |
| Conductor debug | `~/.local/share/atomic/log/conductor-debug.jsonl` | JSONL | None |
| Conductor text | `<LOG_DIR>/conductor-debug.log` | Plain text | None |
| Telemetry events | `~/.local/share/atomic/telemetry-events-<agent>.jsonl` | JSONL | Deleted after upload |
| Claude debug | `~/.claude/debug/<sessionId>.txt` | Plain text | None |
| Claude SDK debug | `~/.claude/debug/sdk-<uuid>.txt` | Plain text | None |
| Claude transcripts | `~/.claude/projects/<hash>/<sessionId>.jsonl` | JSONL | None |
| OpenCode logs | `~/.local/share/opencode/log/<timestamp>.log` | Key=value text | 10 files |
| Copilot traces | User-specified (e.g., `./traces.jsonl`) | OTel JSONL | None |

### SDK Logger Capabilities Matrix

| Capability | Copilot SDK | Claude Agent SDK | OpenCode SDK |
|---|---|---|---|
| File-based traces | `telemetry.filePath` | `debugFile` | Built-in at `~/.local/share/opencode/log/` |
| OTLP export | `telemetry.otlpEndpoint` | No | No |
| Log level control | `logLevel` option | `CLAUDE_CODE_DEBUG_LOG_LEVEL` env | `--log-level` CLI / SDK config |
| stderr callback | No (internal buffer) | `stderr` callback | No |
| Content capture | `captureContent: true` | Via debug logs | No |
| OTel spans | Yes (3-level hierarchy) | No | No |
| OTel metrics | Yes (7 metrics) | No | No |
| Session events API | `session.on()` (50+ types) | `SDKMessage` stream (20+ types) | Bus events via plugin hooks |
| Debug env var | `OTEL_LOG_LEVEL` | `DEBUG`, `DEBUG_SDK`, `DEBUG_CLAUDE_AGENT_SDK` | None (CLI flag only) |

---

## Historical Context (from research/)

- `research/docs/2026-01-21-anonymous-telemetry-implementation.md` — Triple collection strategy (CLI commands, slash commands, session hooks), privacy-preserving JSONL buffering
- `research/docs/2026-01-22-azure-app-insights-backend-integration.md` — Phase 6 backend integration plan, Azure Monitor OpenTelemetry setup, batch upload design
- `research/docs/2026-01-23-telemetry-hook-investigation.md` — SessionEnd hooks not firing investigation, hooks.json vs settings.json issue
- `research/docs/2026-01-24-opencode-telemetry-investigation.md` — OpenCode slash command detection limitation (command names lost during expansion)

---

## Open Questions

1. **SDK log unification**: How should the three SDK log streams (Copilot OTel traces, Claude debug file, OpenCode log files) be surfaced alongside Atomic's own `events.jsonl`? Options include: (a) merging into a single timeline, (b) writing to separate files in the same session directory, (c) reading SDK logs on demand.

2. **Key press log volume**: Logging every key press at `DEBUG` level in the event JSONL would add significant volume (especially during typing). Should key logging be gated on a separate flag (e.g., `ATOMIC_KEYPRESS_DEBUG=1`) or be part of the standard `DEBUG=1` output?

3. **Key press event format**: Should key events be logged as bus events (flowing through the EventBus and appearing in `events.jsonl` alongside stream events) or as diagnostic entries? Bus events would allow filtering by type, but diagnostic entries would be simpler.

4. **Copilot telemetry activation**: Should Atomic automatically configure `telemetry: { filePath: "<session-log-dir>/copilot-traces.jsonl", exporterType: "file" }` when `DEBUG=1` is set? This would produce Copilot OTel traces alongside Atomic's debug logs.

5. **Claude debug activation**: Should Atomic pass `debug: true` and `debugFile: "<session-log-dir>/claude-debug.txt"` to the Claude Agent SDK when `DEBUG=1`? This would capture Claude Code's internal debug output.

6. **OpenCode log forwarding**: Should Atomic read `~/.local/share/opencode/log/*.log` and surface recent entries, or pass a custom log path to OpenCode via `--log-level DEBUG` and write to the Atomic session directory?

7. **AppInsights trace enrichment**: Should SDK-level events (Copilot spans, Claude tool progress, OpenCode session events) be included in the AppInsights telemetry upload, or kept as local-only debug data?

8. **Key press privacy**: Key names like "escape" and "return" are safe to log, but should printable character key names (e.g., `name: "a"`) be redacted or omitted to avoid leaking typed content into debug logs?
