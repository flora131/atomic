---
date: 2026-04-02 04:54:40 UTC
researcher: Claude Code
git_commit: fbfc5a3f51f5d3aee2ed25f398233aa1549e025c
branch: lavaman131/feature/enhance-debug-logs
repository: atomic
topic: "Unified Logging, Debugging Traces, and AppInsights Telemetry for Atomic TUI — SDK Integration Research"
tags: [research, logging, debugging, telemetry, appinsights, copilot-sdk, claude-agent-sdk, opencode-sdk, keyboard-logging, opentui]
status: complete
last_updated: 2026-04-02
last_updated_by: Claude Code
---

# Research: Unified Logging, Debugging Traces, and AppInsights Telemetry for Atomic TUI

## Research Question

Rethink the logging/debugging traces and AppInsights traces for the Atomic TUI. Research in depth how the built-in loggers in Copilot SDK, Claude Agent SDK, and OpenCode SDK work and how they can be incorporated alongside the built-in TUI logs from Atomic. Additionally, document how Atomic can log key names that were pressed for maximum debugging insights (e.g., ESC, CTRL+C, etc.).

## Summary

The Atomic TUI has a mature, multi-layered observability system centered on the `DEBUG=1` environment variable and an EventBus-driven debug subscriber. However, the three SDK backends (Copilot SDK, Claude Agent SDK, OpenCode SDK) each have their own independent logging/tracing systems that are currently **not fully wired** into Atomic's unified debug output. Additionally, keyboard events flow through a single `useKeyboardOwnership` hook from OpenTUI but **key names are not logged** to any debug channel today.

### Key Findings at a Glance

| SDK | Logging Mechanism | Current Integration in Atomic | Gap |
|---|---|---|---|
| **Copilot SDK** | OTel spans/metrics via `TelemetryConfig` (`filePath`, `exporterType`, `otlpEndpoint`) + `logLevel` option | `logLevel` is accepted in `CopilotClientOptions` but not set by default; OTel telemetry config is not used | Telemetry config not wired |
| **Claude Agent SDK** | `debug`/`debugFile` options + `stderr` callback + debug file at `~/.claude/debug/<sessionId>.txt` | No `debug`, `debugFile`, or `stderr` options passed in `buildClaudeSdkOptions()` | None of the 3 debug options are used |
| **OpenCode SDK** | Custom logger at `~/.local/share/opencode/log/`, `--log-level` CLI flag, `POST /log` REST endpoint | Module-level `debugLog` only active when `DEBUG === "1"` (exact string match); no SDK `logLevel` configured | SDK log level not passed |
| **Atomic TUI** | EventBus debug subscriber → `events.jsonl` + `raw-stream.log` at `~/.local/share/atomic/log/events/` | Fully functional when `DEBUG=1` | Key presses not logged |
| **AppInsights** | `@azure/monitor-opentelemetry` via `telemetry-upload.ts`, hardcoded connection string | Functional but lazy-loaded; uploads via `--upload-telemetry` CLI flag | Not invoked during TUI sessions |

---

## Detailed Findings

### 1. Atomic TUI Built-in Logging Infrastructure

#### 1.1 Debug Subscriber (Primary Debug System)

**Directory:** `src/services/events/debug-subscriber/`

The debug subscriber is the primary structured logging system. It is activated by the `DEBUG` environment variable and writes two log files per session:

- **`events.jsonl`**: Structured JSONL event timeline with rich metadata (`seq`, `runSeq`, `eventLagMs`, `lifecycleMarkers`, `agentTreeSnapshot`, etc.)
- **`raw-stream.log`**: Human-readable UI-oriented stream for visual debugging

**Configuration** (`src/services/events/debug-subscriber/config.ts`):
- `DEFAULT_LOG_DIR`: `~/.local/share/atomic/log/events`
- `MAX_LOG_SESSIONS`: 10 (older sessions auto-deleted)
- `LOG_EVENTS_FILENAME`: `events.jsonl`
- `LOG_RAW_STREAM_FILENAME`: `raw-stream.log`
- `STREAM_CONTINUITY_GAP_THRESHOLD_MS`: 1500ms (gaps flagged with `"continuity-gap"` marker)

**Activation** (`src/services/events/debug-subscriber/config.ts:25`):
`resolveStreamDebugLogConfig(env)` reads `DEBUG` and `LOG_DIR` env vars. Returns enabled=true when `DEBUG` is truthy and not `"0"`, `"false"`, `"off"`.

**Attachment** (`src/state/runtime/chat-ui-runtime-state.ts:54`):
`attachDebugSubscriber(bus)` is called during `createChatUIRuntimeState()`. When enabled, it:
1. Creates timestamped session directory with JSONL and raw log writers
2. Writes a `"startup"` diagnostic entry with `pid`, `platform`, `arch`, `nodeVersion`, `bunVersion`, `cwd`, `memoryUsage`, `argv`
3. Subscribes to all bus events via `bus.onAll()` — every `BusEvent` is written with rich metadata
4. Subscribes to `bus.onInternalError()` for `"bus_error"` diagnostics
5. Registers `process.on("uncaughtException")` and `process.on("unhandledRejection")` for `"process_error"` diagnostics

**Event Log Entry Fields** (`src/services/events/debug-subscriber/log-writer.ts:250`):
Each logged event includes: `seq`, `runSeq`, `ts`, `loggedAt`, `type`, `sessionId`, `runId`, `eventLagMs`, `globalGapMs`, `sessionRunGapMs`, `streamGapMs`, `runAgeMs`, `runDurationMs`, `lifecycleMarkers[]`, `payloadBytes`, optional `agentTreeSnapshot`, `data`.

**Lifecycle Markers** (automatically detected):
`"run-first-seen"`, `"session-start"`, `"first-stream-event"`, `"first-text-delta"`, `"session-idle"`, `"idle-with-pending-tools"`, `"session-error"`, `"stream-gap"`, `"continuity-gap"`, `"timestamp-regression"`, `"tool-complete-without-start"`.

#### 1.2 Pipeline Logger

**File:** `src/services/events/pipeline-logger.ts`

`pipelineLog(stage, action, data?)` and `pipelineError(stage, action, data?)` emit `console.debug`/`console.error` with prefix `[Pipeline:<stage>] <action> <JSON>` when `DEBUG` is truthy. Valid stages: `"EventBus"`, `"Dispatcher"`, `"Wire"`, `"Consumer"`, `"Subagent"`, `"Workflow"`.

#### 1.3 Tool Debug Logger

**File:** `src/services/events/adapters/providers/claude/tool-debug-log.ts`

`toolDebug(action, data)` appends JSONL to `~/.local/share/atomic/log/tool-debug.jsonl` when `DEBUG` is truthy. Uses `Bun.file().writer()`.

#### 1.4 Conductor Debug Logger

**File:** `src/services/workflows/runtime/executor/conductor-debug-log.ts`

`conductorDebug(action, data)` appends JSONL to `~/.local/share/atomic/log/conductor-debug.jsonl` when `DEBUG` is truthy. Same pattern as tool debug logger.

#### 1.5 Conductor Text Log

**File:** `src/services/workflows/conductor/conductor.ts:72-81`

`conductorLog(action, data?)` appends plain-text lines to `<LOG_DIR>/conductor-debug.log` using `appendFileSync` when `isPipelineDebug()` is true.

#### 1.6 Specialized Debug Loggers

| Logger | File | Env Var | Pattern |
|---|---|---|---|
| OpenCode client debug | `src/services/agents/clients/opencode.ts:31-33` | `DEBUG === "1"` (exact match) | `console.debug` with labels like `"sse-watchdog-timeout"`, `"compaction.proactive_trigger"` |
| Thinking source trace | `src/state/chat/shared/helpers/thinking.ts:5` | `ATOMIC_THINKING_DIAGNOSTICS_DEBUG === "1"` | `console.debug("[thinking-source] ...")` |
| Chat-UI cleanup | `src/state/runtime/chat-ui-controller.ts:24-28` | `DEBUG` (any truthy) | `console.debug("[chat-ui-controller] ...")` |
| Copilot session abort | `src/services/agents/clients/copilot/session-runtime.ts:195-200` | `DEBUG` (any truthy) | `console.debug("[copilot] failed to abort session ...")` |
| Runtime parity | `src/services/workflows/runtime-parity-observability.ts:19` | `DEBUG` or `ATOMIC_WORKFLOW_DEBUG === "1"` | `console.debug("[workflow.runtime.parity] ...")` |
| Discovery events | `src/services/config/discovery-events.ts:96` | `DEBUG` (truthy) | `console.debug("[discovery.event] ...")` with redacted paths |
| Discovery plan | `src/commands/cli/chat/discovery-debug.ts` | `DEBUG` (truthy) | `logActiveProviderDiscoveryPlan()` |

#### 1.7 Environment Variables Summary (Atomic-Internal)

| Variable | Files | Effect |
|---|---|---|
| `DEBUG` | Multiple | Master debug switch. Values `"1"`, `"true"`, `"on"` enable. `"0"`, `"false"`, `"off"` disable. |
| `LOG_DIR` | `debug-subscriber/config.ts`, `conductor.ts` | Override log directory |
| `ATOMIC_VALIDATE_BUS_EVENTS` | `chat-ui-runtime-state.ts:51` | `"1"` enables Zod schema validation on all EventBus events |
| `ATOMIC_WORKFLOW_DEBUG` | `runtime-parity-observability.ts:24` | `"1"` enables workflow debug output |
| `ATOMIC_THINKING_DIAGNOSTICS_DEBUG` | `thinking.ts:5` | `"1"` enables thinking source trace |
| `ATOMIC_TELEMETRY_DEBUG` | `telemetry-errors.ts:6` | `"1"` prints telemetry errors to console |
| `ATOMIC_DISABLE_TELEMETRY` | `telemetry.ts:186` | `"1"` disables all telemetry |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | `telemetry-upload.ts:61` | Override Azure App Insights connection string |

---

### 2. Copilot SDK Logging & Telemetry

**SDK package:** `@github/copilot-sdk` (types at `node_modules/@github/copilot-sdk/dist/types.d.ts`)

#### 2.1 TelemetryConfig Interface

```typescript
export interface TelemetryConfig {
  /** Sets OTEL_EXPORTER_OTLP_ENDPOINT */
  otlpEndpoint?: string;
  /** Sets COPILOT_OTEL_FILE_EXPORTER_PATH */
  filePath?: string;
  /** Sets COPILOT_OTEL_EXPORTER_TYPE — valid values: "otlp-http" or "file" */
  exporterType?: string;
  /** Sets COPILOT_OTEL_SOURCE_NAME */
  sourceName?: string;
  /** Sets OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT */
  captureContent?: boolean;
}
```

**Source:** `node_modules/@github/copilot-sdk/dist/types.d.ts:29-40`

The SDK maps these to environment variables on the spawned CLI subprocess. The `exporterType` supports `"otlp-http"` and `"file"`. When using `"file"`, traces are written to the `filePath` as JSONL.

**Usage pattern:**
```typescript
const client = new CopilotClient({
  telemetry: {
    filePath: "./traces.jsonl",
    exporterType: "file",
  },
});
```

#### 2.2 Log Level

```typescript
// CopilotClientOptions
logLevel?: "none" | "error" | "warning" | "info" | "debug" | "all";
```

**Source:** `node_modules/@github/copilot-sdk/dist/types.d.ts:84`

This sets the `--log-level` CLI flag on the spawned process. Log output goes to stderr (captured in `client.stderrBuffer`).

#### 2.3 OTel Span Hierarchy

The CLI uses OpenTelemetry GenAI Semantic Conventions. Three-level span hierarchy per agent invocation:

1. **`invoke_agent` span** (kind: `CLIENT`): Root span wrapping entire turn. Attributes: `gen_ai.operation.name`, `gen_ai.agent.id`, `gen_ai.conversation.id`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `github.copilot.turn_count`, `github.copilot.cost`, `error.type`.

2. **`chat` span** (kind: `CLIENT`): One per LLM API call. Attributes: `gen_ai.provider.name`, `gen_ai.response.id`, `gen_ai.response.finish_reasons`, `github.copilot.server_duration`, `github.copilot.initiator`, `github.copilot.turn_id`.

3. **`execute_tool` span** (kind: `INTERNAL`): One per tool call. Attributes: `gen_ai.tool.name`, `gen_ai.tool.type`, `gen_ai.tool.call.id`, `gen_ai.tool.description`. When `captureContent: true`, also includes `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result`.

**Source:** `docs/copilot-cli/usage.md:617-731`

#### 2.4 OTel Metrics

| Metric | Type | Unit | Description |
|---|---|---|---|
| `gen_ai.client.operation.duration` | Histogram | s | LLM API call and agent invocation duration |
| `gen_ai.client.token.usage` | Histogram | tokens | Token counts by type (input/output) |
| `gen_ai.client.operation.time_to_first_chunk` | Histogram | s | Time to first streaming chunk |
| `gen_ai.client.operation.time_per_output_chunk` | Histogram | s | Inter-chunk latency |
| `github.copilot.tool.call.count` | Counter | calls | Tool invocations by name and success |
| `github.copilot.tool.call.duration` | Histogram | s | Tool execution latency |
| `github.copilot.agent.turn.count` | Histogram | turns | LLM round-trips per invocation |

**Source:** `docs/copilot-cli/usage.md:699-714`

#### 2.5 Span Events

Lifecycle events recorded as OTel span events:
- `github.copilot.hook.start` / `hook.end` / `hook.error`
- `github.copilot.session.truncation`
- `github.copilot.session.compaction_start` / `compaction_complete`
- `github.copilot.skill.invoked`
- `github.copilot.session.shutdown` (with usage stats)
- `github.copilot.session.abort`
- `exception`

**Source:** `docs/copilot-cli/usage.md:718-731`

#### 2.6 OTel Environment Variables

| Variable | Default | Description |
|---|---|---|
| `COPILOT_OTEL_ENABLED` | `false` | Explicitly enable OTel |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP HTTP endpoint; auto-enables OTel |
| `COPILOT_OTEL_EXPORTER_TYPE` | `otlp-http` | `"otlp-http"` or `"file"` |
| `OTEL_SERVICE_NAME` | `github-copilot` | Resource service name |
| `OTEL_RESOURCE_ATTRIBUTES` | — | Extra `key=value` resource attributes |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `false` | Capture full prompts/responses |
| `OTEL_LOG_LEVEL` | — | OTel SDK internal diagnostic level |
| `COPILOT_OTEL_FILE_EXPORTER_PATH` | — | JSONL file path; auto-enables OTel |
| `COPILOT_OTEL_SOURCE_NAME` | `github.copilot` | Instrumentation scope name |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | Auth headers |

**Source:** `docs/copilot-cli/usage.md:600-613`

#### 2.7 Programmatic Session Events

The SDK provides a strongly-typed event stream via `session.on()` with 50+ event types:

**Session lifecycle:** `session.start`, `session.resume`, `session.error`, `session.idle`, `session.shutdown`, `session.compaction_start`, `session.compaction_complete`, `session.usage_info`, etc.

**Turn events:** `assistant.turn_start`, `assistant.reasoning`, `assistant.streaming_delta`, `assistant.message`, `assistant.turn_end`, `assistant.usage`

**Tool execution:** `tool.execution_start`, `tool.execution_partial_result`, `tool.execution_progress`, `tool.execution_complete`

**Subagents:** `subagent.started`, `subagent.completed`, `subagent.failed`

**Source:** `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts`

#### 2.8 Current Integration in Atomic

**File:** `src/services/agents/clients/copilot.ts`

- `CopilotClientOptions` interface (lines 95-104) includes `logLevel` field
- `buildCopilotSdkOptions()` in `sdk-options.ts:48` passes `logLevel: clientOptions.logLevel` to the SDK
- `createCopilotClient(options?)` at line 586 creates `new CopilotClient(options)` with default `{}` — **no `logLevel` or `telemetry` is set by default**
- No `TelemetryConfig` is passed to the client

---

### 3. Claude Agent SDK Logging & Debugging

**SDK package:** `@anthropic-ai/claude-agent-sdk` (v2.1.89)

#### 3.1 SDK Options for Debugging

From `docs/claude-code/agent-sdk.md` and `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:

| Option | Type | Default | Description |
|---|---|---|---|
| `debug` | `boolean` | `false` | Enable debug mode for the Claude Code subprocess |
| `debugFile` | `string` | `undefined` | Write debug logs to a specific file path. Implicitly enables debug mode |
| `stderr` | `(data: string) => void` | `undefined` | Callback for stderr output from the subprocess |

#### 3.2 Debug Mode Activation (Subprocess Side)

The Claude Code subprocess (`cli.js`) activates debug mode from any of these triggers:
- SDK option `debug: true` → subprocess gets `--debug` flag
- SDK option `debugFile: "/path"` → subprocess gets `--debug-file /path`
- Environment variable `DEBUG=1` (or any truthy value)
- Environment variable `DEBUG_SDK=1`
- Environment variable `CLAUDE_CODE_DEBUG_LOGS_DIR=<path>`
- CLI flag `--debug` or `-d`
- CLI flag `--debug-to-stderr` or `-d2e`

**Source:** `node_modules/@anthropic-ai/claude-agent-sdk/cli.js` (minified, 1,682+ log calls)

#### 3.3 Debug Log Format

**Format:** Plain text, one entry per line:
```
<ISO8601_TIMESTAMP> [<LEVEL>] <message>
```

**Log levels:** `verbose (0)`, `debug (1)`, `info (2)`, `warn (3)`, `error (4)`. Default minimum: `"debug"`.

**Default debug file path** (when `debug: true` but no `debugFile`):
```
~/.claude/debug/<sessionId>.txt
```

**Level override:** `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose|debug|info|warn|error`

#### 3.4 What Debug Mode Outputs

Categories of debug output from the subprocess (1,682+ distinct log calls):
- **API calls:** `[API REQUEST] /v1/messages x-client-request-id=<id> source=<source>`
- **MCP servers:** Connection status, tool loading, registry fetches
- **Tool execution:** `ToolSearchTool` selection, permission decisions, deferred tool use
- **Process lifecycle:** Bash path detection, session ID rotation, shell tasks
- **Settings/config:** MDM settings, config file corruption recovery
- **Hooks:** Hook registration, `[ConfigChange hook]`, `[keybindings]` reload
- **Permissions:** `Applying permission update: Setting mode to '<mode>'`
- **Sandbox:** `[Sandbox] scrubbed planted bare-repo file`, `[sandbox] Blocked network request`
- **Authentication:** `[trusted-device]`, CA certs loading
- **TUI/rendering:** `Resizing to <w>x<h>`, `[stderr] <data>`
- **Session:** Title, tag, git branch tracking

#### 3.5 stderr Callback vs Debug File

The `stderr` callback and debug file are **separate streams**:
- `stderr` receives raw stderr fd2 output from the subprocess (unhandled exceptions, Node.js warnings, explicit `process.stderr.write()`)
- Debug logs go to the debug file via `--debug-file <path>` or `--debug`
- When `DEBUG_CLAUDE_AGENT_SDK=1`, `--debug-to-stderr` is added, making debug output flow through the `stderr` callback
- SDK-level debug goes to `~/.claude/debug/sdk-<uuid>.txt` when `DEBUG_CLAUDE_AGENT_SDK=1`

#### 3.6 SDKMessage Types for Diagnostics

Most valuable for debugging/tracing:

| Message Type | Diagnostic Value |
|---|---|
| `SDKSystemMessage` (init) | Session init — tools, MCP servers, model, permissionMode |
| `SDKToolProgressMessage` | Real-time tool timer — `tool_name`, `elapsed_time_seconds` |
| `SDKStatusMessage` | Compaction state, permissionMode changes |
| `SDKHookStartedMessage` / `SDKHookProgressMessage` / `SDKHookResponseMessage` | Full hook lifecycle |
| `SDKTaskStartedMessage` / `SDKTaskProgressMessage` / `SDKTaskNotificationMessage` | Background task lifecycle |
| `SDKResultMessage` | Turn end — `duration_ms`, `total_cost_usd`, full `usage`, `modelUsage` per model |
| `SDKRateLimitEvent` | Rate limit status, `resetsAt`, `utilization` |
| `SDKAssistantMessage` | Full model response with token usage |

**Source:** `docs/claude-code/agent-sdk.md` (SDKMessage types section)

#### 3.7 Session Transcript Storage

- **Projects base dir:** `~/.claude/projects/`
- **Session transcript:** `~/.claude/projects/<hash_of_cwd>/<sessionId>.jsonl`
- **Subagent transcript:** `~/.claude/projects/<hash_of_cwd>/<sessionId>/subagents/<agentType>/agent-<agentId>.jsonl`
- Hook input `BaseHookInput.transcript_path` provides live path

#### 3.8 Current Integration in Atomic

**File:** `src/services/agents/clients/claude.ts`

- `createClaudeAgentClient()` at line 480 creates `new ClaudeAgentClient()` with **no debug or logging options**
- `buildClaudeSdkOptions()` at line 127 builds the SDK `Options` object — **no `debug`, `debugFile`, or `stderr` fields are set**
- No environment variables like `DEBUG_CLAUDE_AGENT_SDK` are forwarded

---

### 4. OpenCode SDK Logging

**SDK package:** `@opencode-ai/sdk` (server at `@opencode-ai/sdk/server`)

#### 4.1 Log System Architecture

OpenCode uses a custom-built, zero-dependency TypeScript logger (`packages/opencode/src/util/log.ts`, ~130 lines). Not slog, zap, pino, or winston.

**Log levels:** `DEBUG`, `INFO`, `WARN`, `ERROR`. Default: `INFO` (or `DEBUG` when `Installation.isLocal()`).

**Log format:** Plain text, structured with key=value pairs:
```
<LEVEL> <ISO_TIMESTAMP> +<delta_ms> key1=value1 key2=value2 <message>
```
Example:
```
INFO  2025-01-09T12:34:56 +42ms service=llm providerID=anthropic modelID=claude-3-5-sonnet stream
```

#### 4.2 Log File Locations

- **macOS/Linux:** `~/.local/share/opencode/log/`
- **Windows:** `%USERPROFILE%\.local\share\opencode\log`
- File pattern: `YYYY-MM-DDTHHMMSS.log` (e.g., `2025-01-09T123456.log`)
- In local dev mode: `dev.log`
- Retention: most recent 10 log files kept

#### 4.3 SDK Configuration

When using `createOpencodeServer()`, pass `logLevel` in the config:
```typescript
const server = await createOpencodeServer({
  config: { logLevel: "DEBUG" }
})
```
This causes the server to be spawned with `--log-level=DEBUG` on the `opencode serve` command.

#### 4.4 Plugin Logging API

Plugins do NOT receive a `log` function in `PluginInput`. The official method is the REST API:
```typescript
await ctx.client.app.log({
  body: {
    service: "my-plugin",
    level: "info",
    message: "plugin initialized",
    extra: { version: "1.0.0" }
  }
})
```
Endpoint: `POST /log` (`operationId: "app.log"`).

#### 4.5 Bus Events (Subscribable)

| Event Category | Events |
|---|---|
| Session | `session.created`, `session.updated`, `session.deleted`, `session.diff`, `session.error` |
| Message | `message.updated`, `message.removed`, `message.part.updated`, `message.part.delta`, `message.part.removed` |
| Command | `command.executed` |
| Instance | `server.instance.disposed` |

#### 4.6 CLI Flags

- `--log-level <DEBUG|INFO|WARN|ERROR>`: Set log verbosity
- `--print-logs`: Redirect log output to stderr instead of file

#### 4.7 Environment Variables

No dedicated `OPENCODE_LOG_LEVEL` env var exists. Log level is controlled via:
1. `--log-level` CLI flag
2. `logLevel` field in `opencode.json` config
3. `Installation.isLocal()` detection (auto-sets DEBUG in development)

The `AI_SDK_LOG_WARNINGS` global is suppressed in the server entry point.

#### 4.8 Current Integration in Atomic

**File:** `src/services/agents/clients/opencode.ts`

- Line 31-33: Module-level `debugLog` is a no-op when `DEBUG !== "1"`, or `(label, data) => console.debug(...)` when `DEBUG === "1"` (**exact string match**, not normalized like other Atomic debug checks)
- The `debugLog` closure is passed to event stream processing at lines 198, 241, 438, 487. Labels include: `"sse-watchdog-timeout"`, `"sse-abort"`, `"compaction.proactive_trigger"`, `"subagent.start"`, `"tool.start"`, etc.
- `OpenCodeClient` constructor at line 77 sets `baseUrl`, `maxRetries`, `retryDelay` — **no `logLevel` or debug flag passed**
- The SDK's `createSdkClient` is used for HTTP client creation — no logging config

---

### 5. AppInsights / Azure Monitor Telemetry

#### 5.1 Current Implementation

**File:** `src/services/telemetry/telemetry-upload.ts`

- Imports `useAzureMonitor`, `shutdownAzureMonitor` from `@azure/monitor-opentelemetry`
- Imports `logs`, `SeverityNumber` from `@opentelemetry/api-logs`
- `DEFAULT_CONNECTION_STRING` at line 54: Hardcoded Azure Application Insights connection string (West US 2 region)
- `getConnectionString()` at line 60: Checks `process.env.APPLICATIONINSIGHTS_CONNECTION_STRING` first, falls back to default

**Upload flow** (`handleTelemetryUpload()` at line 332):
1. Find all `telemetry-events-*.jsonl` files
2. Claim each via atomic rename to `<path>.uploading.<uuid-prefix>`
3. Read events, filter stale (>30 days)
4. Initialize OTel via `useAzureMonitor()`
5. Emit events in batches of 100 via `logger.emit()` with `microsoft.custom_event.name` attribute
6. Flush via `shutdownAzureMonitor()`
7. On error, rename claimed files back

**Lazy loading:** The module is NOT re-exported from `index.ts` to avoid the 244ms startup penalty of importing `@azure/monitor-opentelemetry`.

#### 5.2 TUI Telemetry Tracker

**File:** `src/services/telemetry/telemetry-tui.ts`

`TuiTelemetrySessionTracker` class (line 72): Instantiated at startup. Tracks:
- `tui_session_start`, `tui_session_end`
- `tui_message_submit`, `tui_command_execution`
- `tui_tool_lifecycle` (start/complete)
- `tui_interrupt`, `tui_background_termination`

Session end event includes: `durationMs`, `messageCount`, `commandCount`, `toolCallCount`, `interruptCount`.

#### 5.3 Package Dependencies

From `package.json`:
- `@azure/monitor-opentelemetry: ^1.16.0`
- `@opentelemetry/api: ^1.9.1`
- `@opentelemetry/api-logs: ^0.214.0`

---

### 6. Keyboard Input Handling and Key Name Logging

#### 6.1 OpenTUI KeyEvent Shape

**Source:** `node_modules/@opentui/core/lib/KeyHandler.d.ts:4-28`

The `KeyEvent` class provides:

| Field | Type | Purpose |
|---|---|---|
| `name` | `string` | Human-readable key name (`"escape"`, `"return"`, `"c"`, `"up"`) |
| `ctrl` | `boolean` | Ctrl modifier |
| `meta` | `boolean` | Meta/Alt modifier |
| `shift` | `boolean` | Shift modifier |
| `option` | `boolean` | Option modifier (macOS) |
| `raw` | `string` | Raw escape sequence bytes |
| `source` | `"raw" \| "kitty"` | Input protocol |
| `eventType` | `"press" \| "repeat" \| "release"` | Key event type |
| `repeated` | `boolean \| undefined` | Key-repeat indicator |
| `sequence` | `string` | Parsed terminal sequence |
| `code` | `string \| undefined` | Key code (Kitty protocol) |
| `baseCode` | `number \| undefined` | Unicode codepoint |

#### 6.2 Renderer Configuration

**File:** `src/app.tsx:167-175`

The OpenTUI CLI renderer is configured with:
- `exitOnCtrlC: false` — Ctrl+C is passed as a KeyEvent, not an OS signal
- `useKittyKeyboard: { disambiguate: true }` — enables Kitty keyboard protocol

A manual `modifyOtherKeys` mode-2 escape sequence is written at line 179: `\x1b[>4;2m`. Reversed on cleanup at `src/state/runtime/chat-ui-controller.ts:116`.

#### 6.3 Central Keyboard Dispatch

**File:** `src/state/chat/keyboard/use-keyboard-ownership.ts:59-319`

A single `useKeyboard` listener is registered. Events flow through 4 sequential phases:

**Phase 1 — All modes always:**
1. Kitty keyboard protocol detection (`event.raw`)
2. `handleClipboardKey(event)` — Ctrl+Shift+C, Meta+C, Ctrl+V, Meta+V
3. `isCtrlCInterrupt(event)` — `event.ctrl && !event.shift && event.name.toLowerCase() === "c"`

**Phase 2 — Mode guard:** If `mode === "dialog"` or `"model-selector"`, return early.

**Phase 3 — Chat mode:**
1. `handleShortcutKey()` — Ctrl+O (transcript toggle), Ctrl+E (verbose toggle), Ctrl+T (todo panel toggle)
2. `event.name === "escape"` → `handleEscapeKey()` or exit queue editing
3. `handleNavigationKey()` — pageup/down, arrow keys, history navigation
4. `handleComposeShortcutKey()` — newline fallback
5. `handleAutocompleteSelectionKey()` — Tab, Return for autocomplete

**Phase 4:** `postDispatchReconciliation()` via `setTimeout(0)`.

**Invoked at:** `src/state/chat/controller/use-ui-controller-stack/controller.ts:37`

#### 6.4 Key Names Handled

| Key Name | Handler | Action |
|---|---|---|
| `"c"` (with ctrl) | `isCtrlCInterrupt()` at `chat-input-handler.ts:83-85` | Interrupt/exit (double-press) |
| `"escape"` | `use-keyboard-ownership.ts:215` | Dismiss autocomplete, interrupt stream, cancel workflow |
| `"return"` / `"linefeed"` | `use-input-state.ts:48-55` | Submit/newline (with modifier checks) |
| `"o"` (with ctrl) | `chat-input-handler.ts:107-131` | Toggle transcript mode |
| `"e"` (with ctrl) | `chat-input-handler.ts:107-131` | Toggle verbose output |
| `"t"` (with ctrl) | `chat-input-handler.ts:107-131` | Toggle todo panel |
| `"v"` (with ctrl/meta) | `chat-input-handler.ts:34-73` | Paste |
| `"c"` (with ctrl+shift / meta) | `chat-input-handler.ts:34-73` | Copy |
| `"pageup"` / `"pagedown"` | `navigation.ts:40-223` | Scroll |
| `"up"` / `"down"` | `navigation.ts:40-223` | History/autocomplete/queue navigation |
| `"tab"` | `navigation.ts:40-223` | Autocomplete selection |
| `"1"`-`"9"` | `dialog-handler.ts:75-296` | Numeric quick-select in dialogs |
| `"space"` | `dialog-handler.ts:75-296` | Toggle multi-select in dialogs |
| `"k"` / `"j"` | `dialog-handler.ts:75-296` | Vi-style navigation in dialogs |

#### 6.5 Ctrl+C Double-Press Confirmation

**File:** `src/state/chat/keyboard/use-interrupt-confirmation.ts:10-49`

Tracks consecutive Ctrl+C presses. First press sets `ctrlCPressed = true` and starts a 1000ms timeout; second press within 1s triggers exit or workflow cancellation. State tracked via `interruptCount`, `ctrlCPressed`, `interruptTimeoutRef`.

#### 6.6 SIGINT/SIGTERM Handlers

**File:** `src/state/runtime/chat-ui-controller.ts:474-495`

OS-level process signals bypass the keyboard flow:
```typescript
process.on("SIGINT", sigintHandler);   // line 483
process.on("SIGTERM", sigtermHandler); // line 484
```

#### 6.7 Current Key Logging Status

**Key names are NOT logged to any debug channel.** No code writes key names, modifiers, or raw sequences to events.jsonl, raw-stream.log, console.debug, or any other output. The `useKeyboardOwnership` hook processes keys silently.

#### 6.8 Input Event Flow Diagram

```
Terminal stdin
  └─> OpenTUI renderer (createCliRenderer, app.tsx:169)
        └─> KeyHandler (@opentui/core)
              └─> useKeyboard hook (@opentui/react)
                    └─> useKeyboardOwnership (use-keyboard-ownership.ts:162)
                          ├─> Phase 1: Kitty detection (event.raw)
                          ├─> Phase 1: handleClipboardKey (Ctrl+Shift+C, Meta+C, Ctrl+V, Meta+V)
                          ├─> Phase 1: isCtrlCInterrupt → handleCtrlCKey
                          ├─> Phase 2: Mode guard ("dialog"/"model-selector"/"chat")
                          │     └─> Dialog/ModelSelector own useKeyboard handlers
                          ├─> Phase 3: handleShortcutKey (Ctrl+O/E/T)
                          ├─> Phase 3: escape → handleEscapeKey
                          ├─> Phase 3: handleNavigationKey (pageup/down/up/down/tab/return)
                          ├─> Phase 3: handleComposeShortcutKey (newline fallback)
                          ├─> Phase 3: handleAutocompleteSelectionKey (tab/return)
                          └─> Phase 4: postDispatchReconciliation (setTimeout 0)

OS-level signals bypass this flow:
  process.on("SIGINT")  → chat-ui-controller.ts:483
  process.on("SIGTERM") → chat-ui-controller.ts:484
```

---

### 7. Telemetry Infrastructure (Atomic Internal)

#### 7.1 Core State

**File:** `src/services/telemetry/telemetry.ts`

- Telemetry state file: `~/.local/share/atomic/telemetry.json`
- Priority chain: CI detection (via `ci-info`) > `ATOMIC_DISABLE_TELEMETRY=1` > config file (`enabled && consentGiven`)
- Monthly anonymous ID rotation

#### 7.2 Event Buffering

**File:** `src/services/telemetry/telemetry-file-io.ts`

- Events written to `~/.local/share/atomic/telemetry-events-<agent>.jsonl`
- Uses file-level locking via `withLock()`
- All errors swallowed silently

#### 7.3 Event Types

| Type | Source | Tracker |
|---|---|---|
| `atomic_command` | CLI commands | `telemetry-cli.ts` |
| `tui_session_start/end` | TUI sessions | `telemetry-tui.ts` |
| `tui_message_submit` | User messages | `telemetry-tui.ts` |
| `tui_command_execution` | Slash commands | `telemetry-tui.ts` |
| `tui_tool_lifecycle` | Tool start/complete | `telemetry-tui.ts` |
| `tui_interrupt` | User interrupts | `telemetry-tui.ts` |
| `tui_background_termination` | Background agent exits | `telemetry-tui.ts` |
| Workflow events | Graph execution | `graph-integration.ts` |

#### 7.4 Error Handling

**File:** `src/services/telemetry/telemetry-errors.ts`

`handleTelemetryError(error, context)`: Silent by default. Emits `console.error("[Telemetry Debug: <context>]", error)` only when `ATOMIC_TELEMETRY_DEBUG=1`.

---

## Code References

### Atomic Debug Subscriber
- `src/services/events/debug-subscriber/config.ts` — Log directory config, session naming
- `src/services/events/debug-subscriber/subscriber.ts` — Bus attachment, process error handlers
- `src/services/events/debug-subscriber/log-writer.ts` — JSONL event writer, raw stream writer, diagnostic writer
- `src/services/events/debug-subscriber/log-readers.ts` — Log file readers
- `src/services/events/debug-subscriber/raw-formatters.ts` — Raw stream line formatters
- `src/state/runtime/chat-ui-runtime-state.ts:54` — `attachDebugSubscriber(bus)` call site

### Pipeline Logger
- `src/services/events/pipeline-logger.ts:37,62,82` — `isPipelineDebug()`, `pipelineLog()`, `pipelineError()`

### Tool/Conductor Debug
- `src/services/events/adapters/providers/claude/tool-debug-log.ts:18,44,60` — Tool debug JSONL
- `src/services/workflows/runtime/executor/conductor-debug-log.ts:33,52` — Conductor debug JSONL
- `src/services/workflows/conductor/conductor.ts:67-81` — Conductor text log

### SDK Client Files
- `src/services/agents/clients/copilot.ts:95-104,586` — CopilotClient options and creation
- `src/services/agents/clients/copilot/sdk-options.ts:48` — `buildCopilotSdkOptions()`
- `src/services/agents/clients/claude.ts:127,435,480` — Claude SDK options builder and client creation
- `src/services/agents/clients/opencode.ts:23,31-33,77` — OpenCode client debug log and creation

### Keyboard Handling
- `src/app.tsx:167-175,179` — Renderer config, exitOnCtrlC, Kitty keyboard, modifyOtherKeys
- `src/state/chat/keyboard/use-keyboard-ownership.ts:59-319` — Central keyboard dispatch
- `src/state/chat/keyboard/handlers/chat-input-handler.ts:34-131` — Key handlers (clipboard, shortcuts, Ctrl+C)
- `src/state/chat/keyboard/navigation.ts:40-223` — Navigation keys
- `src/state/chat/keyboard/handlers/dialog-handler.ts:75-296` — Dialog keyboard handlers
- `src/state/chat/keyboard/use-interrupt-confirmation.ts:10-49` — Ctrl+C double-press
- `src/state/chat/keyboard/use-interrupt-controls.ts:134,413-603` — Interrupt/escape handling
- `src/state/chat/keyboard/kitty-keyboard-detection.ts:1-43` — Kitty protocol detection
- `src/state/chat/shared/helpers/newline-strategies.ts:1-77` — Newline key detection
- `src/state/chat/composer/use-input-state.ts:48-55` — Textarea key bindings
- `src/state/runtime/chat-ui-controller.ts:474-495` — SIGINT/SIGTERM handlers

### Telemetry
- `src/services/telemetry/telemetry.ts` — Core state, ID generation, opt-out chain
- `src/services/telemetry/telemetry-upload.ts:54,60,207,234,332` — Azure Monitor upload
- `src/services/telemetry/telemetry-tui.ts:72` — TUI session tracker
- `src/services/telemetry/telemetry-cli.ts:75` — CLI command tracker
- `src/services/telemetry/telemetry-file-io.ts:19,33` — JSONL event file I/O
- `src/services/telemetry/telemetry-errors.ts:6,22` — Error handler
- `src/services/telemetry/graph-integration.ts:56` — Workflow tracker

### Documentation
- `docs/stream-debug-logging.md` — Stream debug logging guide
- `docs/copilot-cli/usage.md:600-731` — Copilot OTel configuration reference
- `docs/claude-code/agent-sdk.md` — Claude Agent SDK full API reference

---

## Architecture Documentation

### Log File Topology (When `DEBUG=1`)

```
~/.local/share/atomic/
├── log/
│   ├── events/
│   │   ├── 2026-04-02T045440/           # Per-session folder (max 10 retained)
│   │   │   ├── events.jsonl              # Structured bus event timeline
│   │   │   └── raw-stream.log            # UI-oriented conversation stream
│   │   └── ...
│   ├── tool-debug.jsonl                  # Claude tool attribution debug
│   └── conductor-debug.jsonl             # Conductor workflow debug
├── telemetry.json                        # Telemetry state (anonymous ID, consent)
├── telemetry-events-claude.jsonl         # Buffered telemetry events (Claude)
├── telemetry-events-copilot.jsonl        # Buffered telemetry events (Copilot)
├── telemetry-events-opencode.jsonl       # Buffered telemetry events (OpenCode)
└── telemetry-events-atomic.jsonl         # Buffered telemetry events (Atomic CLI)

~/.claude/
├── debug/
│   ├── <sessionId>.txt                   # Claude Code subprocess debug log (when debug: true)
│   └── sdk-<uuid>.txt                    # Claude Agent SDK debug log (when DEBUG_CLAUDE_AGENT_SDK=1)
└── projects/
    └── <hash>/
        ├── <sessionId>.jsonl             # Claude session transcript
        └── <sessionId>/subagents/        # Subagent transcripts

~/.local/share/opencode/
└── log/
    └── 2025-01-09T123456.log             # OpenCode log file (max 10 retained)

(Copilot traces — only when TelemetryConfig is set)
./traces.jsonl                            # Copilot OTel trace file (configurable path)
```

### Debug Activation Chain

```
DEBUG=1
  ├─> debug-subscriber/subscriber.ts:attachDebugSubscriber()
  │     ├─> events.jsonl writer
  │     ├─> raw-stream.log writer
  │     ├─> bus.onAll() subscription
  │     ├─> bus.onInternalError() subscription
  │     └─> process uncaughtException/unhandledRejection handlers
  ├─> pipeline-logger.ts:isPipelineDebug()
  │     └─> console.debug("[Pipeline:<stage>] ...")
  ├─> tool-debug-log.ts:toolDebug()
  │     └─> ~/.local/share/atomic/log/tool-debug.jsonl
  ├─> conductor-debug-log.ts:conductorDebug()
  │     └─> ~/.local/share/atomic/log/conductor-debug.jsonl
  ├─> conductor.ts:conductorLog()
  │     └─> <LOG_DIR>/conductor-debug.log
  ├─> opencode.ts:debugLog (exact match "1" only)
  │     └─> console.debug with labels
  ├─> chat-ui-controller.ts:logCleanupError()
  │     └─> console.debug("[chat-ui-controller] ...")
  ├─> copilot/session-runtime.ts
  │     └─> console.debug("[copilot] ...")
  └─> discovery-events.ts:isDiscoveryDebugLoggingEnabled()
        └─> console.debug("[discovery.event] ...")
```

### SDK Logging Not Wired

```
Copilot SDK:
  CopilotClient({
    telemetry: { filePath, exporterType, otlpEndpoint } ← NOT SET
    logLevel ← NOT SET (default undefined → no --log-level flag)
  })

Claude Agent SDK:
  query({ options: {
    debug ← NOT SET (default false)
    debugFile ← NOT SET (default undefined)
    stderr ← NOT SET (default undefined → stderr piped to /dev/null)
  }})

OpenCode SDK:
  createSdkClient({}) ← no logLevel config
  debugLog ← only works when DEBUG === "1" (exact string match)
```

---

## Historical Context (from research/)

- `research/docs/2026-01-22-azure-app-insights-backend-integration.md` — Documents Phase 6 backend integration plan with Azure App Insights via OpenTelemetry. Shows the `handleTelemetryUpload()` architecture and recommended retry/batch policies.

- `research/docs/2026-01-21-anonymous-telemetry-implementation.md` — Documents the triple collection strategy (Atomic CLI commands, slash command CLI tracking, session hooks) and the JSONL buffer file architecture.

- `research/docs/2026-01-23-telemetry-hook-investigation.md` — Documents root cause of SessionEnd hooks not firing (hooks in wrong file location, wrong hook names/casing). Fixed by moving hook config from `.claude/hooks/hooks.json` to `.claude/settings.json`.

- `research/docs/2026-01-24-opencode-telemetry-investigation.md` — Documents why OpenCode telemetry only detects `/commit` but not `/implement-feature` — slash command names are never stored in OpenCode message text (they're expanded to markdown content).

---

## Related Research

- `research/docs/2026-01-31-claude-agent-sdk-research.md` — Claude Agent SDK research
- `research/docs/2026-01-31-opencode-sdk-research.md` — OpenCode SDK research
- `research/docs/2026-01-31-github-copilot-sdk-research.md` — GitHub Copilot SDK research
- `research/docs/2026-02-12-sdk-ui-standardization-research.md` — SDK UI standardization
- `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md` — Sub-agent SDK integration

---

## Open Questions

1. **Copilot SDK telemetry.filePath integration**: Should the Copilot OTel trace file be written alongside Atomic's own debug logs at `~/.local/share/atomic/log/` or in a separate location? The `filePath` is configurable.

2. **Claude debug log format alignment**: Claude's debug logs are plain text while Atomic uses JSONL. Should Claude's debug output be captured via `stderr` callback and re-emitted as JSONL diagnostic entries in Atomic's `events.jsonl`?

3. **OpenCode DEBUG exact-match inconsistency**: The OpenCode client at `opencode.ts:31` uses `DEBUG === "1"` (exact string match) while all other Atomic debug checks normalize truthy values (`"true"`, `"on"`, etc.). Should this be aligned?

4. **Key press logging granularity**: Should ALL key presses be logged (high volume, ~every character typed) or only "significant" keys (ESC, CTRL+C, shortcuts, navigation)? The `useKeyboardOwnership` hook processes ~every key press — logging all of them would produce substantial volume.

5. **Key press log destination**: Should key events go to `events.jsonl` as proper bus events (via EventBus), to `raw-stream.log` as formatted lines, to a separate key-debug log, or to `console.debug`?

6. **SDK debug log lifecycle**: When `DEBUG=1` is set, should Atomic automatically enable debug mode on the SDK clients (`debug: true` for Claude, `logLevel: "debug"` for Copilot, `logLevel: "DEBUG"` for OpenCode)? This would create significantly more output.

7. **AppInsights during TUI sessions**: Currently, `handleTelemetryUpload()` is only invoked via the `--upload-telemetry` CLI flag (typically by hook scripts after session end). Should it also be triggered periodically during long TUI sessions, or on TUI exit?

8. **Copilot `captureContent` flag**: The `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` flag captures full prompts and responses. This is useful for debugging but has privacy implications. Should Atomic expose this as a user-configurable debug option?
