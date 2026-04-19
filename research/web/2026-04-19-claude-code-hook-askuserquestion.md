---
source_url: https://github.com/mehmoodosman/claude-code
fetched_at: 2026-04-19
fetch_method: html-parse (GitHub raw API)
topic: Claude Code hook behavior for AskUserQuestion tool - PreToolUse/PostToolUse/PostToolUseFailure events
---

# Claude Code Hook Behavior for AskUserQuestion

## Key Source Files Examined

- `src/services/tools/toolHooks.ts` — runPreToolUseHooks, runPostToolUseHooks, runPostToolUseFailureHooks
- `src/services/tools/toolExecution.ts` — main tool dispatch loop that calls all three hook runners
- `src/utils/hooks.ts` — executePreToolHooks, executePostToolHooks, executePostToolUseFailureHooks, getMatchingHooks, dedup logic
- `src/entrypoints/sdk/coreSchemas.ts` — BaseHookInputSchema, PreToolUseHookInputSchema, PostToolUseHookInputSchema, PostToolUseFailureHookInputSchema
- `src/tools/AskUserQuestionTool/prompt.ts` — ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'

## Q1: Are PreToolUse, PostToolUse, PostToolUseFailure fired for AskUserQuestion?

YES. All three are fired. `toolExecution.ts` calls `runPreToolUseHooks` unconditionally for every tool
before permission check, then calls `runPostToolUseHooks` on success and `runPostToolUseFailureHooks`
on error. `AskUserQuestion` goes through this same dispatch path. The tool has `requiresUserInteraction: true`
which only affects whether `canUseTool` prompt is shown — hooks still fire before and after.

## Q2: Hook input payload fields

### BaseHookInput (all events):
```
session_id: string          // guaranteed present
transcript_path: string
cwd: string
permission_mode?: string
agent_id?: string
agent_type?: string
```

### PreToolUse adds:
```
hook_event_name: 'PreToolUse'
tool_name: string           // e.g. 'AskUserQuestion'
tool_input: unknown         // the questions/options object
tool_use_id: string
```

### PostToolUse adds:
```
hook_event_name: 'PostToolUse'
tool_name: string
tool_input: unknown
tool_response: unknown      // the user's answers
tool_use_id: string
```

### PostToolUseFailure adds:
```
hook_event_name: 'PostToolUseFailure'
tool_name: string
tool_input: unknown
tool_use_id: string
error: string
is_interrupt?: boolean
```

`session_id` is always guaranteed present (it comes from `createBaseHookInput` which calls `getSessionId()`).

## Q3: Hook deduplication

YES, dedup exists. It is in `getMatchingHooks()` in `src/utils/hooks.ts` (lines 1712-1806).

- Scope: **per-event invocation** — dedup runs separately each time a hook event fires.
  There is NO cross-event dedup. If you register the same command in both `PostToolUse` and
  `PostToolUseFailure`, it will run once per event that fires. Since exactly one of those events
  fires per tool use, the command runs exactly once total.

- Key: `hookDedupKey(m, payload)` = `"${pluginRoot ?? skillRoot ?? ''}\0${shell}\0${command}\0${ifCondition}"`

- For settings-file (non-plugin, non-skill) hooks: the prefix is `""`, so the same command string
  registered in user/project/local settings collapses to one execution.

- Cross-plugin hooks with the same template string do NOT collapse (prefix differs by pluginRoot).

- The dedup is per event invocation. Registering command X in PostToolUse AND PostToolUseFailure:
  - If tool succeeds: PostToolUse fires → X runs once; PostToolUseFailure does not fire.
  - If tool fails: PostToolUseFailure fires → X runs once; PostToolUse does not fire.
  - Net: X runs exactly once regardless. The dedup is per-event and moot here since only one
    of the two events fires per tool invocation.

## Q4: Matcher string for AskUserQuestion

The exact matcher string is `"AskUserQuestion"` (no prefix).

Source: `ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'` in `src/tools/AskUserQuestionTool/prompt.ts`.

In `getMatchingHooks()`, the matchQuery for PreToolUse/PostToolUse/PostToolUseFailure is `hookInput.tool_name`.
Matcher is regex-tested via `matchesPattern(matchQuery, matcher.matcher)`, but literal `"AskUserQuestion"`
matches exactly. MCP tools get the `mcp__<server>__<tool>` prefix; built-in tools use their plain name.

## Q5: Exit codes

- Exit 0: success, action proceeds. stdout can be JSON for structured control.
- Exit 2: **blocking** — for PreToolUse, yields `behavior: 'deny'` (blocks the tool call).
  For PostToolUse/PostToolUseFailure, yields a `hook_blocking_error` attachment that feeds
  stderr content back to Claude as feedback. Message surfaced: `"PreToolUse:AskUserQuestion hook error: [cmd]: <stderr>"`.
- Any other non-zero: non-critical error. Stderr is logged to debug (visible with Ctrl+O or --debug)
  but NOT shown to Claude/user as a blocking error. An attachment `hook_non_blocking_error` is created
  but the action proceeds.

From `src/utils/hooks.ts` lines 2647-2696:
```
if (result.status === 2) { yield { blockingError: ..., outcome: 'blocking' }; return }
// Any other non-zero:
yield { message: hook_non_blocking_error attachment, outcome: 'non_blocking_error' }
```

## Q6: PostToolUseFailure is a real separate event

YES. `PostToolUseFailure` is a distinct event from `PostToolUse`. They are separate hook event names
in `HOOK_EVENTS` (coreTypes.ts). `PostToolUse` fires only on tool success; `PostToolUseFailure` fires
only on tool error (catch block in toolExecution.ts). They have different schemas: PostToolUseFailure
has `error: string` and `is_interrupt?: boolean` instead of `tool_response`.

`executePostToolUseFailureHooks` is a completely separate function from `executePostToolHooks` in hooks.ts.
