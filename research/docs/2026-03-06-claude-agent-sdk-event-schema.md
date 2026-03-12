# Claude Agent SDK Event Schema Reference

Date: 2026-03-06
Package in this repo: `@anthropic-ai/claude-agent-sdk@^0.2.70`

## Short answer

Yes. Claude Agent SDK exposes a structured TypeScript event/message union for streamed output:

```ts
type SDKMessage = ...
```

This is the type yielded by `query()` and used by `session.stream()` in the V2 preview. The checked-in reference at `docs/claude-agent-sdk.md` documents the main message types, and the installed package declarations in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` expose the concrete exported TypeScript types for the version used by this repo.

## Source of truth

Use these in order:

1. `docs/claude-agent-sdk.md`
   - `SDKMessage`
   - `SDKAssistantMessage`
   - `SDKUserMessage`
   - `SDKResultMessage`
   - `SDKSystemMessage`
   - `SDKPartialAssistantMessage`
   - later sections for task, hook, tool-progress, rate-limit, and prompt-suggestion messages
2. `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
   - Canonical for the exact installed package version in this repo
   - Includes a few variants/fields that are ahead of the checked-in markdown doc

## Event union

`docs/claude-agent-sdk.md` documents this union:

```ts
type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKPartialAssistantMessage
  | SDKCompactBoundaryMessage
  | SDKStatusMessage
  | SDKHookStartedMessage
  | SDKHookProgressMessage
  | SDKHookResponseMessage
  | SDKToolProgressMessage
  | SDKAuthStatusMessage
  | SDKTaskNotificationMessage
  | SDKTaskStartedMessage
  | SDKTaskProgressMessage
  | SDKFilesPersistedEvent
  | SDKToolUseSummaryMessage
  | SDKRateLimitEvent
  | SDKPromptSuggestionMessage;
```

For the installed `0.2.70` package, `sdk.d.ts` adds two more exported variants:

```ts
type SDKMessage =
  | ...documented members...
  | SDKLocalCommandOutputMessage
  | SDKElicitationCompleteMessage;
```

## Discriminators

The stream is a discriminated union. In practice, narrow by `type`, and for many `system` messages also narrow by `subtype`.

| `type` | `subtype` | Meaning |
| --- | --- | --- |
| `assistant` | none | Final assistant turn payload |
| `user` | none | User message echoed into the transcript |
| `result` | `success` or error subtype | Final turn result / terminal state |
| `system` | `init` | Session initialization |
| `system` | `compact_boundary` | Context compaction boundary |
| `system` | `status` | Session status update |
| `system` | `hook_started` | Hook execution started |
| `system` | `hook_progress` | Hook stdout/stderr update |
| `system` | `hook_response` | Hook completed |
| `system` | `task_started` | Background task started |
| `system` | `task_progress` | Background task progress |
| `system` | `task_notification` | Background task finished/failed/stopped |
| `system` | `files_persisted` | File checkpoint persistence event |
| `system` | `local_command_output` | Local slash-command output (`sdk.d.ts`) |
| `system` | `elicitation_complete` | MCP elicitation completed (`sdk.d.ts`) |
| `stream_event` | none | Partial streaming token/block event |
| `tool_progress` | none | Tool still running |
| `auth_status` | none | Authentication flow update |
| `tool_use_summary` | none | Collapsed tool summary |
| `rate_limit_event` | none | Rate-limit state change |
| `prompt_suggestion` | none | Suggested next prompt |

## Core message shapes

These are the message shapes most useful for app-level handling.

### `SDKAssistantMessage`

```ts
type SDKAssistantMessage = {
  type: "assistant";
  uuid: UUID;
  session_id: string;
  message: BetaMessage;
  parent_tool_use_id: string | null;
  error?: SDKAssistantMessageError;
};
```

Notes:
- `message` is Anthropic's `BetaMessage`, so the actual content blocks live under `message.content`.
- In installed `0.2.70`, `SDKAssistantMessageError` includes:
  - `"authentication_failed" | "billing_error" | "rate_limit" | "invalid_request" | "server_error" | "unknown" | "max_output_tokens"`

### `SDKUserMessage` and `SDKUserMessageReplay`

```ts
type SDKUserMessage = {
  type: "user";
  uuid?: UUID;
  session_id: string;
  message: MessageParam;
  parent_tool_use_id: string | null;
  isSynthetic?: boolean;
  tool_use_result?: unknown;
  priority?: "now" | "next" | "later"; // present in sdk.d.ts
};

type SDKUserMessageReplay = SDKUserMessage & {
  uuid: UUID;
  isReplay: true;
};
```

### `SDKResultMessage`

```ts
type SDKResultMessage =
  | {
      type: "result";
      subtype: "success";
      uuid: UUID;
      session_id: string;
      duration_ms: number;
      duration_api_ms: number;
      is_error: boolean;
      num_turns: number;
      result: string;
      stop_reason: string | null;
      total_cost_usd: number;
      usage: NonNullableUsage;
      modelUsage: Record<string, ModelUsage>;
      permission_denials: SDKPermissionDenial[];
      structured_output?: unknown;
      fast_mode_state?: FastModeState; // present in sdk.d.ts
    }
  | {
      type: "result";
      subtype:
        | "error_max_turns"
        | "error_during_execution"
        | "error_max_budget_usd"
        | "error_max_structured_output_retries";
      uuid: UUID;
      session_id: string;
      duration_ms: number;
      duration_api_ms: number;
      is_error: boolean;
      num_turns: number;
      stop_reason: string | null;
      total_cost_usd: number;
      usage: NonNullableUsage;
      modelUsage: Record<string, ModelUsage>;
      permission_denials: SDKPermissionDenial[];
      errors: string[];
      fast_mode_state?: FastModeState; // present in sdk.d.ts
    };
```

This is the terminal event for a turn and the best place to read final usage/cost totals.

### `SDKSystemMessage`

```ts
type SDKSystemMessage = {
  type: "system";
  subtype: "init";
  uuid: UUID;
  session_id: string;
  agents?: string[];
  apiKeySource: ApiKeySource;
  betas?: string[];
  claude_code_version: string;
  cwd: string;
  tools: string[];
  mcp_servers: { name: string; status: string }[];
  model: string;
  permissionMode: PermissionMode;
  slash_commands: string[];
  output_style: string;
  skills: string[];
  plugins: { name: string; path: string }[];
  fast_mode_state?: FastModeState; // present in sdk.d.ts
};
```

### `SDKPartialAssistantMessage`

```ts
type SDKPartialAssistantMessage = {
  type: "stream_event";
  event: BetaRawMessageStreamEvent;
  parent_tool_use_id: string | null;
  uuid: UUID;
  session_id: string;
};
```

This only appears when `includePartialMessages: true`.

## Secondary event/message types

These are still part of `SDKMessage`, but they are usually operational rather than primary conversation content.

```ts
type SDKCompactBoundaryMessage = {
  type: "system";
  subtype: "compact_boundary";
  compact_metadata: { trigger: "manual" | "auto"; pre_tokens: number };
  uuid: UUID;
  session_id: string;
};

type SDKStatusMessage = {
  type: "system";
  subtype: "status";
  status: "compacting" | null;
  permissionMode?: PermissionMode;
  uuid: UUID;
  session_id: string;
};

type SDKHookStartedMessage = {
  type: "system";
  subtype: "hook_started";
  hook_id: string;
  hook_name: string;
  hook_event: string;
  uuid: UUID;
  session_id: string;
};

type SDKHookProgressMessage = {
  type: "system";
  subtype: "hook_progress";
  hook_id: string;
  hook_name: string;
  hook_event: string;
  stdout: string;
  stderr: string;
  output: string;
  uuid: UUID;
  session_id: string;
};

type SDKHookResponseMessage = {
  type: "system";
  subtype: "hook_response";
  hook_id: string;
  hook_name: string;
  hook_event: string;
  output: string;
  stdout: string;
  stderr: string;
  exit_code?: number;
  outcome: "success" | "error" | "cancelled";
  uuid: UUID;
  session_id: string;
};

type SDKToolProgressMessage = {
  type: "tool_progress";
  tool_use_id: string;
  tool_name: string;
  parent_tool_use_id: string | null;
  elapsed_time_seconds: number;
  task_id?: string;
  uuid: UUID;
  session_id: string;
};

type SDKAuthStatusMessage = {
  type: "auth_status";
  isAuthenticating: boolean;
  output: string[];
  error?: string;
  uuid: UUID;
  session_id: string;
};

type SDKTaskStartedMessage = {
  type: "system";
  subtype: "task_started";
  task_id: string;
  tool_use_id?: string;
  description: string;
  task_type?: string;
  uuid: UUID;
  session_id: string;
};

type SDKTaskProgressMessage = {
  type: "system";
  subtype: "task_progress";
  task_id: string;
  tool_use_id?: string;
  description: string;
  usage: { total_tokens: number; tool_uses: number; duration_ms: number };
  last_tool_name?: string;
  uuid: UUID;
  session_id: string;
};

type SDKTaskNotificationMessage = {
  type: "system";
  subtype: "task_notification";
  task_id: string;
  tool_use_id?: string;
  status: "completed" | "failed" | "stopped";
  output_file: string;
  summary: string;
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number };
  uuid: UUID;
  session_id: string;
};

type SDKFilesPersistedEvent = {
  type: "system";
  subtype: "files_persisted";
  files: { filename: string; file_id: string }[];
  failed: { filename: string; error: string }[];
  processed_at: string;
  uuid: UUID;
  session_id: string;
};

type SDKToolUseSummaryMessage = {
  type: "tool_use_summary";
  summary: string;
  preceding_tool_use_ids: string[];
  uuid: UUID;
  session_id: string;
};

type SDKRateLimitEvent = {
  type: "rate_limit_event";
  rate_limit_info: {
    status: "allowed" | "allowed_warning" | "rejected";
    resetsAt?: number;
    utilization?: number;
  };
  uuid: UUID;
  session_id: string;
};

type SDKPromptSuggestionMessage = {
  type: "prompt_suggestion";
  suggestion: string;
  uuid: UUID;
  session_id: string;
};
```

Installed `sdk.d.ts` only:

```ts
type SDKLocalCommandOutputMessage = {
  type: "system";
  subtype: "local_command_output";
  content: string;
  uuid: UUID;
  session_id: string;
};

type SDKElicitationCompleteMessage = {
  type: "system";
  subtype: "elicitation_complete";
  mcp_server_name: string;
  elicitation_id: string;
  uuid: UUID;
  session_id: string;
};
```

## Recommended narrowing pattern

```ts
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

function handleSdkMessage(message: SDKMessage) {
  switch (message.type) {
    case "assistant":
      return message.message.content;

    case "result":
      if (message.subtype === "success") {
        return message.result;
      }
      return message.errors;

    case "system":
      switch (message.subtype) {
        case "init":
          return message.model;
        case "task_progress":
          return message.usage.tool_uses;
        case "local_command_output":
          return message.content;
        default:
          return null;
      }

    case "stream_event":
      return message.event;

    case "tool_progress":
      return message.tool_name;

    default:
      return null;
  }
}
```

## Practical guidance for Atomic

- Treat `SDKMessage` as the canonical event envelope for Claude stream processing.
- Narrow on `type` first, then `subtype` for `system` and `result`.
- Use `SDKResultMessage` for final cost/token totals.
- Use `SDKPartialAssistantMessage` only when `includePartialMessages` is enabled.
- Do not assume `docs/claude-agent-sdk.md` is exhaustive for the installed version.
- For exhaustive handling in this repo, prefer the installed `sdk.d.ts` union over the markdown doc when they differ.

## Related note

The SDK also has structured hook input/output types, but those are separate from the streamed `SDKMessage` event union. See the `Hook Types` section in `docs/claude-agent-sdk.md` if you need the schemas for `PreToolUse`, `PostToolUse`, `PermissionRequest`, `SubagentStart`, and related hook callbacks.
