# Stream Debug Logging

Use stream debug logging when you need a full event timeline for a conversation.

When enabled, Atomic writes stream diagnostics into a **timestamped log folder** per run:

- `events` log (structured JSONL event timeline)
- `raw stream` log (UI-oriented conversation components)

## Quick Start

Enable logging for a chat session:

```bash
DEBUG=1 bun run src/cli.ts chat -a opencode
```

You can use `-a claude` or `-a copilot` the same way.

At startup, Atomic prints the folder and both files:

```text
[Atomic] Stream debug logs: /home/<user>/.local/share/atomic/log/events/2026-03-02T184210
[Atomic] Stream events log: /home/<user>/.local/share/atomic/log/events/2026-03-02T184210/events.jsonl
[Atomic] Stream raw log: /home/<user>/.local/share/atomic/log/events/2026-03-02T184210/raw-stream.log
```

## Environment Variables

- `DEBUG`
    - `1`, `true`, `on`: enable stream debug log files and console preview
    - `0`, `false`, `off`: disable stream debug log files
- `LOG_DIR`
    - optional directory override for the **parent debug log directory** (defaults to `~/.local/share/atomic/log/events/`)

## What Gets Logged

Each session folder contains:

- `events.jsonl`: structured bus timeline + diagnostics
- `raw-stream.log`: UI-style line stream for visual debugging

The JSONL `events` log contains two kinds of entries: **event entries** (bus events) and **diagnostic entries** (errors, metadata). In addition, **pipeline diagnostic messages** are emitted to the console at both `debug` and `error` levels.

### Raw Stream Log (UI)

The raw stream log captures conversation components in the order they are rendered/observed by the stream pipeline, for example:

```text
❯ @codebase-online-researcher Research good UI/UX design practices for the TUI
∴ Thinking...
Launching UI/UX research task
◉
task codebase-online-researcher: Research TUI UX practices
Agent: codebase-online-researcher
Task: Research TUI UX practices
Prompt: Research task only (do not write code): Find modern, high-quality UI/UX design practices...
⣯ Composing… (23s)
```

Notes:

- User prompts are written when a stream starts.
- `Task/task/launch_agent` tool calls include expanded `Agent/Task/Prompt` fields when present.
- The raw stream log is optimized for UI debugging and is intentionally less structured than the JSONL event log.

### Event Entries

All bus events — including `stream.*` events and `workflow.*` events — are logged as JSON objects with:

- `seq`: global monotonically increasing log sequence number
- `runSeq`: per `sessionId + runId` sequence number
- `ts`: event timestamp (ISO string)
- `loggedAt`: wall-clock timestamp when the event was written to disk
- `type`: bus event type (for example `stream.text.delta`, `stream.tool.start`, `workflow.step.start`, `workflow.step.complete`)
- `sessionId`: session identifier associated with the event
- `runId`: run identifier for stream turn correlation
- `eventLagMs`: `loggedAt - ts` in milliseconds
- `globalGapMs`: elapsed milliseconds since the previous logged event (any session)
- `sessionRunGapMs`: elapsed milliseconds since the previous event in the same `sessionId + runId`
- `continuityGapMs`: present when `sessionRunGapMs >= 1500` for `stream.*` events (helps spot streaming stalls)
- `eventTimestampRegressionMs`: present when event timestamps move backwards within the same run
- `streamGapMs`: elapsed milliseconds since the previous `stream.*` event in the same run
- `runAgeMs`: milliseconds since the first event in the run was logged
- `runDurationMs`: present on idle/error terminal events; total observed run lifetime in ms
- `streamEventCount` / `textDeltaCount` / `thinkingDeltaCount`: cumulative stream counters for the run at this event
- `toolStartCount` / `toolCompleteCount`: cumulative tool lifecycle counters for the run
- `pendingToolCalls` / `maxPendingToolCalls`: in-flight tool count snapshot and max observed concurrency
- `lifecycleMarkers`: derived hints for diagnostics (for example `session-start`, `first-text-delta`, `stream-gap`, `idle-with-pending-tools`, `timestamp-regression`)
- `payloadBytes`: JSON byte length of `data`
- `agentTreeSnapshot`: present on agent lifecycle events (`stream.agent.start`, `stream.agent.update`, `stream.agent.complete`) and session errors; see [Agent Tree Snapshots](#agent-tree-snapshots)
- `data`: full event payload

Example event entry:

```json
{
    "seq": 27,
    "runSeq": 9,
    "ts": "2026-03-02T18:42:10.235Z",
    "loggedAt": "2026-03-02T18:42:10.241Z",
    "type": "stream.text.delta",
    "sessionId": "ses_123",
    "runId": 3,
    "eventLagMs": 6,
    "globalGapMs": 14,
    "sessionRunGapMs": 14,
    "streamGapMs": 14,
    "runAgeMs": 221,
    "streamEventCount": 9,
    "textDeltaCount": 7,
    "thinkingDeltaCount": 0,
    "toolStartCount": 1,
    "toolCompleteCount": 1,
    "pendingToolCalls": 0,
    "maxPendingToolCalls": 1,
    "lifecycleMarkers": ["first-text-delta"],
    "payloadBytes": 38,
    "data": { "delta": "hello", "messageId": "msg_1" }
}
```

### Diagnostic Entries

Diagnostic entries capture errors and metadata that are not bus events. They share the same `seq` counter for ordering and have a `category` field instead of `type`:

- `seq`: global sequence number (shared with event entries)
- `ts`: wall-clock timestamp (ISO string)
- `category`: one of `"startup"`, `"bus_error"`, `"process_error"`
- `error`: error message (present on error categories)
- `stack`: stack trace (present when available)
- `agentTreeSnapshot`: current agent tree state at the time of the diagnostic
- `data`: category-specific metadata

#### Startup Entry

The first entry in every debug log is a `startup` diagnostic containing environment and process metadata:

```json
{
    "seq": 1,
    "ts": "2026-03-02T18:42:10.100Z",
    "category": "startup",
    "agentTreeSnapshot": {
        "agents": [],
        "totalCount": 0,
        "runningCount": 0,
        "completedCount": 0,
        "errorCount": 0
    },
    "data": {
        "pid": 12345,
        "platform": "linux",
        "arch": "x64",
        "nodeVersion": "v22.0.0",
        "bunVersion": "1.3.10",
        "cwd": "/home/user/project",
        "debugConfig": { "enabled": true, "logDir": "..." },
        "env": { "DEBUG": "1", "NODE_ENV": "development" },
        "argv": ["bun", "run", "src/cli.ts", "chat", "-a", "opencode"],
        "memoryUsage": {
            "rss": 52428800,
            "heapTotal": 8388608,
            "heapUsed": 6291456,
            "external": 1048576
        }
    }
}
```

#### Bus Error Entry

Captures internal EventBus failures — schema validation drops, handler exceptions, and agent lifecycle contract violations — that would otherwise be swallowed by the TUI:

```json
{
    "seq": 42,
    "ts": "2026-03-02T18:42:15.500Z",
    "category": "bus_error",
    "error": "Expected string, received number",
    "stack": "ZodError: ...",
    "agentTreeSnapshot": { "agents": [...], "totalCount": 2, "runningCount": 1, "completedCount": 1, "errorCount": 0 },
    "data": {
        "kind": "schema_validation",
        "eventType": "stream.text.delta",
        "eventData": { "delta": 42 }
    }
}
```

The `kind` field is one of:

- `schema_validation` — event payload failed Zod schema validation and was dropped (never reached subscribers)
- `handler_error` — a typed event handler threw an exception
- `wildcard_handler_error` — a wildcard (`onAll`) handler threw an exception
- `contract_violation` — an agent lifecycle contract was violated (e.g., `stream.agent.complete` received without a prior `stream.agent.start`)

#### Process Error Entry

Captures unhandled exceptions and promise rejections at the process level:

```json
{
    "seq": 99,
    "ts": "2026-03-02T18:43:01.000Z",
    "category": "process_error",
    "error": "Cannot read properties of undefined",
    "stack": "TypeError: Cannot read properties of undefined\n    at ...",
    "agentTreeSnapshot": { "agents": [...], "totalCount": 3, "runningCount": 2, "completedCount": 1, "errorCount": 0 },
    "data": { "kind": "uncaughtException", "name": "TypeError" }
}
```

### Agent Tree Snapshots

Agent lifecycle events and error entries include an `agentTreeSnapshot` field that shows the aggregate state of all tracked sub-agents at that point in time:

```json
{
    "agentTreeSnapshot": {
        "agents": [
            {
                "agentId": "agent-1",
                "agentType": "worker",
                "task": "Implement auth module",
                "status": "running",
                "isBackground": false,
                "startedAt": "2026-03-02T18:42:10.300Z",
                "currentTool": "edit",
                "toolUses": 5
            },
            {
                "agentId": "agent-2",
                "agentType": "explore",
                "task": "Find auth patterns",
                "status": "completed",
                "isBackground": false,
                "startedAt": "2026-03-02T18:42:08.100Z"
            }
        ],
        "totalCount": 2,
        "runningCount": 1,
        "completedCount": 1,
        "errorCount": 0
    }
}
```

Each agent entry tracks:

- `agentId`, `agentType`, `task`: identity and purpose
- `status`: `"running"`, `"completed"`, or `"error"`
- `isBackground`: whether the agent was launched in background mode
- `startedAt`: ISO timestamp of agent start
- `currentTool`: tool currently being executed (cleared on completion)
- `toolUses`: cumulative tool call count
- `error`: error message (present when `status` is `"error"`)

## Pipeline Diagnostic Messages

When `DEBUG=1`, the pipeline logger emits prefixed console messages at key chokepoints. These messages use two log levels:

- **`console.debug`** (via `pipelineLog`) — informational diagnostics (event flow, coalescing, flushing)
- **`console.error`** (via `pipelineError`) — error-level diagnostics (schema drops, handler errors, workflow failures)

All messages are prefixed with `[Pipeline:<stage>]` for easy filtering:

```text
[Pipeline:EventBus] schema_drop {"type":"stream.text.delta"}
[Pipeline:Dispatcher] coalesce {"key":"text","type":"stream.text.delta"}
[Pipeline:Workflow] start {"workflow":"ralph","sessionId":"abc-123"}
[Pipeline:Workflow] execution_failed {"workflow":"ralph","nodeId":"planner","error":"timeout"}
```

### Pipeline Stages

| Stage        | Description                                                                |
| ------------ | -------------------------------------------------------------------------- |
| `EventBus`   | Schema validation, handler dispatch errors                                 |
| `Dispatcher` | Event coalescing, buffer overflow drops, batch flushing                    |
| `Wire`       | Ownership filtering (owned vs unowned events)                              |
| `Consumer`   | Event mapping, unmapped event warnings                                     |
| `Subagent`   | Sub-agent spawn/complete, registry misses                                  |
| `Workflow`   | Workflow lifecycle — start, complete, execution failures, task save errors |

### Error-Level Actions

The following actions are logged at `console.error` level (via `pipelineError`):

- `EventBus`: `schema_drop`, `handler_error`, `wildcard_handler_error`, `agent_lifecycle_contract_violation`, `contract_failure_turn_terminated`
- `Workflow`: `session_init_error`, `task_save_error`, `task_flush_error`, `execution_failed`, `execution_error`

## Notes

- Log sessions are named `<timestamp>` (e.g. `2026-03-02T184210`) and each contains:
    - `events.jsonl`
    - `raw-stream.log`
- Log rotation is automatic; Atomic keeps the most recent 10 session folders.
- This mode is intended for debugging. Keep it off in normal usage for best performance.
- Both event entries and diagnostic entries share the same `seq` counter, so you can sort by `seq` to get a unified timeline of events and errors.
