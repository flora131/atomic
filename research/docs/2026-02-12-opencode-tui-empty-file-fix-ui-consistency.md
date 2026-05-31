---
date: 2026-02-12 05:49:20 UTC
researcher: opencode
git_commit: acb591bfa8a868d4f2b58eda630402991aabeefe
branch: lavaman131/hotfix/opentui-distribution
repository: atomic
topic: "Fix OpenCode TUI (empty file) display and UI consistency across agent SDKs"
tags: [research, codebase, tui, tool-rendering, ui-parity, opencode, claude, copilot]
status: complete
last_updated: 2026-02-12
last_updated_by: opencode
---

# Research: OpenCode TUI (empty file) Fix and Agent UI Consistency

## Research Question

Fix OpenCode version of the Atomic TUI from showing "(empty file)" in the output of read_file. In general, ensure the UI of all agent variants (opencode, claude, copilot) for the TUI are similar and consistent.

## Summary

The "(empty file)" issue occurs in `src/ui/tools/registry.ts:121` when the `readToolRenderer.render()` method fails to extract file content from the tool output. The root cause is that the output extraction logic doesn't handle all possible format variations from the different SDKs. Each SDK (OpenCode, Claude, Copilot) returns tool results in slightly different formats, and the current normalization logic has gaps that cause content to be lost or unrecognized.

## Detailed Findings

### 1. Root Cause Analysis

The "(empty file)" text appears at `src/ui/tools/registry.ts:121`:

```typescript
return {
  title: filePath,
  content: content ? content.split("\n") : ["(empty file)"],  // <-- HERE
  language,
  expandable: true,
};
```

This happens when the `content` variable is falsy after the extraction logic (lines 80-113) fails to extract file content from `props.output`.

### 2. SDK Output Format Differences

#### OpenCode SDK (`src/sdk/opencode-client.ts:482-491`)

```typescript
// Tool complete event emission
this.emitEvent("tool.complete", partSessionId, {
  toolName,
  toolResult: toolState?.output,  // Raw output from tool
  toolInput,
  success: toolState?.status === "completed",
});
```

OpenCode's `toolState.output` structure varies:
- Can be a direct string containing file content
- Can be wrapped in an object: `{ title, output, metadata }`
- Can be nested: `{ file: { filePath, content } }`

#### Claude SDK (`src/sdk/claude-client.ts:851-852`)

```typescript
// PostToolUse hook provides tool_response (not tool_result)
if (hookInput.tool_response !== undefined) {
  eventData.toolResult = hookInput.tool_response;
}
```

Claude's `tool_response` structure:
- May be a JSON string containing `{ type: "text", file: { filePath, content } }`
- May be raw string content
- May be an object with `content` field

#### Copilot SDK (`src/sdk/copilot-client.ts:536-547`)

```typescript
case "tool.execution_complete": {
  const toolName = state?.toolCallIdToName.get(event.data.toolCallId) ?? event.data.toolCallId;
  eventData = {
    toolName,
    success: event.data.success,
    toolResult: event.data.result?.content,  // Nested in result.content
    error: event.data.error?.message,
  };
  break;
}
```

Copilot's `result.content` structure:
- Extracted from `event.data.result?.content`
- Could be undefined if result structure differs
- Similar object structure to other SDKs

### 3. Current Output Normalization Logic

**File:** `src/ui/tools/registry.ts:80-113`

The `readToolRenderer.render()` method attempts to normalize outputs:

1. **String output:** Try JSON parse, then check for:
   - `parsed.file.content` (Claude nested format)
   - `parsed.content` (simple wrapped format)
   - Fall back to raw string

2. **Object output:** Check for:
   - `output.file.content` (Claude nested format)
   - `output.output` (OpenCode format)
   - `output.content` (generic format)
   - Fall back to `JSON.stringify(output, null, 2)`

**Problem:** The extraction logic has gaps:
- If output is an object with `output.text` or `output.value` fields, these aren't checked
- If OpenCode returns content directly in `toolState.output` as a string, it should work
- The JSON.parse fallback may not handle all variations

### 4. Data Flow from SDK to UI

```
SDK Layer (different formats)
    │
    ├── Claude: hookInput.tool_response → toolResult
    ├── OpenCode: toolState.output → toolResult  
    └── Copilot: result?.content → toolResult
    │
    ▼
Event Subscription Layer (src/ui/index.ts:464-499)
    │
    │  client.on("tool.complete", (event) => {
    │    const data = event.data as { toolResult?: unknown };
    │    state.toolCompleteHandler(toolId, data.toolResult);
    │  });
    │
    ▼
Chat App Handler (src/ui/chat.tsx:1851-1900)
    │
    │  handleToolComplete(toolId, output: unknown) {
    │    setMessages(prev => prev.map(msg => ({
    │      ...msg,
    │      toolCalls: msg.toolCalls.map(tc =>
    │        tc.id === toolId ? { ...tc, output, status: "completed" } : tc
    │      )
    │    })));
    │  }
    │
    ▼
Tool Renderer (src/ui/tools/registry.ts:76-125)
    │
    │  readToolRenderer.render({ input, output }) {
    │    // Extract content from output
    │    return { content: content ? content.split("\n") : ["(empty file)"] };
    │  }
```

### 5. Test Coverage Gaps

**File:** `tests/ui/tools/registry.test.ts`

Current tests cover:
- Empty file with output="" (line 63-71)
- OpenCode format with `{ title, output, metadata }` (line 73-92)
- Claude format with `{ file: { filePath, content } }` (line 94-111)

Missing tests:
- OpenCode returning content directly as string
- OpenCode returning `{ output: "content" }` without `title`/`metadata`
- Copilot format variations
- Edge cases with undefined/null output

## Code References

| Description | File | Lines |
|-------------|------|-------|
| "(empty file)" generation | `src/ui/tools/registry.ts` | 121 |
| Output extraction logic | `src/ui/tools/registry.ts` | 76-125 |
| OpenCode tool.complete emission | `src/sdk/opencode-client.ts` | 482-491 |
| OpenCode stream tool_result yield | `src/sdk/opencode-client.ts` | 1015-1038 |
| Claude tool_response mapping | `src/sdk/claude-client.ts` | 850-855 |
| Copilot result.content extraction | `src/sdk/copilot-client.ts` | 536-547 |
| Unified ToolCompleteEventData type | `src/sdk/types.ts` | 333-342 |
| Tool complete subscription | `src/ui/index.ts` | 464-499 |
| Tool complete handler | `src/ui/chat.tsx` | 1851-1900 |
| Tool renderer test | `tests/ui/tools/registry.test.ts` | 63-111 |

## Architecture Documentation

### Current Output Format Patterns

| SDK | Primary Location | Format Pattern |
|-----|------------------|----------------|
| OpenCode | `toolState.output` | Variable: string, `{ output, title, metadata }`, or `{ file: { content } }` |
| Claude | `hookInput.tool_response` | JSON string or object: `{ content }`, `{ file: { content } }` |
| Copilot | `result?.content` | String or object |

### Unified Interface

```typescript
// src/sdk/types.ts:333-342
export interface ToolCompleteEventData extends BaseEventData {
  toolName: string;
  toolResult?: unknown;  // Can be any type - string, object, etc.
  success: boolean;
  error?: string;
}
```

### Recommended Extraction Order

1. Check if output is a string:
   - Try JSON parse
   - Extract `file.content` or `content` from parsed
   - Fall back to raw string

2. Check if output is an object:
   - `output.file?.content` (Claude nested)
   - `output.output` (OpenCode wrapped)
   - `output.content` (generic)
   - `output.text` (alternative generic)
   - `output.value` (another alternative)
   - Fall back to `JSON.stringify`

### UI Consistency Requirements

From existing research (`research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md`):

1. **Collapsed tool outputs by default**: Show summary like `Read 2 files (ctrl+o to expand)`
2. **Consistent error handling**: Show error toast for failed tool calls
3. **Tool categories**:
   - Inline tools: Glob, Read, Grep, List, WebFetch, WebSearch
   - Block tools: Bash, Write, Edit, Task, TodoWrite, AskUserQuestion

## Historical Context (from research/)

### From `2026-02-04-agent-subcommand-parity-audit.md`

- All three SDKs implement unified `CodingAgentClient` interface
- Event mapping is normalized but output formats vary
- Tool registration handled differently per SDK (Claude: MCP, OpenCode: server-side, Copilot: session config)

### From `2026-02-01-chat-tui-parity-implementation.md`

- **No-Permission Mode is Intentional**: Atomic runs all agents in auto-approve mode
- **Tool Events via Hooks**: Claude streaming yields `message.delta`, tool events only via hooks
- **OpenCode Has SSE Tool Events**: Already emits via SSE, just needs proper wiring

### From `2026-02-01-claude-code-ui-patterns-for-atomic.md`

- **Message Queuing Gap**: Claude Code allows typing while assistant responds
- **Tool Output Pattern**: Show collapsed summary with expand hint
- **Verbose Mode (Ctrl+O)**: Toggle for expanded output transcripts

## Related Research

- `research/docs/2026-02-04-agent-subcommand-parity-audit.md` - SDK interface parity
- `research/docs/2026-02-01-chat-tui-parity-implementation.md` - TUI parity progress
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` - UI patterns reference
- `research/docs/2026-01-31-opencode-sdk-research.md` - OpenCode SDK details
- `research/docs/2026-01-31-claude-agent-sdk-research.md` - Claude SDK details

## Open Questions

1. **What is the exact format OpenCode returns for read_file?** Need to inspect actual SDK responses
2. **Should extraction logic be moved to SDK clients?** Normalization at source vs. at renderer
3. **Should there be a unified output format contract?** Define expected structure in `ToolCompleteEventData`
4. **How to handle partial file reads?** With offset/limit parameters
5. **Should "(empty file)" be shown for actually empty files vs. extraction failures?** Different messages needed

## Implementation Recommendations

### Priority 1: Fix OpenCode Content Extraction

Update `src/ui/tools/registry.ts` to handle additional OpenCode output formats:

```typescript
// Add these checks in the object extraction logic:
else if (typeof output.text === "string") {
  content = output.text;
} else if (typeof output.value === "string") {
  content = output.value;
} else if (typeof output.data === "string") {
  content = output.data;
}
```

### Priority 2: Add Debug Logging

Add temporary debug logging to capture actual SDK output formats:

```typescript
// In readToolRenderer.render()
console.log("[DEBUG] readToolRenderer output:", {
  type: typeof props.output,
  keys: typeof props.output === 'object' ? Object.keys(props.output) : null,
  preview: typeof props.output === 'string' ? props.output.slice(0, 100) : null
});
```

### Priority 3: Normalize at SDK Layer

Consider adding output normalization in each SDK client before emitting `tool.complete`:

```typescript
// In opencode-client.ts emitEvent for tool.complete
this.emitEvent("tool.complete", partSessionId, {
  toolName,
  toolResult: normalizeToolOutput(toolState?.output, toolName),
  success: toolState?.status === "completed",
});
```

### Priority 4: Add Comprehensive Tests

Add test cases in `tests/ui/tools/registry.test.ts`:

- OpenCode direct string output
- OpenCode `{ output: "content" }` without metadata
- Copilot format variations
- Undefined/null output handling
- Various JSON string formats
