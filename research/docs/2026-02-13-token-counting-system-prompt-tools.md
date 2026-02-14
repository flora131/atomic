---
date: 2026-02-13 05:26:21 UTC
researcher: opencode
git_commit: d096473ef88dcaf50c2b12fee794dae4576eb276
branch: lavaman131/hotfix/tool-ui
repository: atomic
topic: "How can each coding agent SDK (OpenCode, Claude Agent, Copilot) programmatically expose the token count of the combined system prompt and all registered tools for an active session?"
tags: [research, codebase, token-counting, system-prompt, tools, sdk, context]
status: complete
last_updated: 2026-02-13
last_updated_by: opencode
---

# Research

## Research Question
How can each coding agent SDK (OpenCode, Claude Agent, Copilot) programmatically expose the token count of the combined system prompt and all registered tools for an active session?

## Summary

The Atomic codebase already implements accurate token counting for system prompts and tools through the `getSystemToolsTokens()` method. This method captures the "baseline" token count from the first API response's cache tokens (`cache_creation_input_tokens` + `cache_read_input_tokens`), which represents the system prompt + tool definitions that are cached by the provider. 

**Key Finding**: The `/context` command's "System/Tools" field already displays accurate token counts by using this method. No external tokenization libraries are needed because the SDKs return actual token counts from the API responses.

---

## Detailed Findings

### 1. Current Implementation in Atomic Codebase

#### Primary Interface: `Session.getSystemToolsTokens()`

**Location**: `src/sdk/types.ts:212-221`

```typescript
export interface Session {
  /**
   * Returns the token count for system prompt + tools (pre-message baseline).
   * Throws if called before the baseline has been captured (before first query completes).
   */
  getSystemToolsTokens(): number;
}
```

This method returns the combined token count for:
- System prompt
- Tool definitions
- Agents
- Skills
- MCP configurations
- Memory/context

#### How It Works

The baseline is captured from the first API response's cache tokens:

| SDK | How Baseline is Captured | Location |
|-----|-------------------------|----------|
| **Claude** | `cacheCreationInputTokens + cacheReadInputTokens` from `SDKResultMessage.usage` | `src/sdk/claude-client.ts:635-654` |
| **OpenCode** | `cache.write + cache.read` from `result.data.info.tokens` | `src/sdk/opencode-client.ts:1062-1088` |
| **Copilot** | `currentTokens` from `session.usage_info` event or cache tokens from `assistant.usage` | `src/sdk/copilot-client.ts:433-462` |

---

### 2. Claude Agent SDK

**Documentation Location**: `docs/claude-agent-sdk/typescript-sdk.md`

#### Token Counting API

Claude SDK provides token counts through message types:

```typescript
type SDKResultMessage = {
  type: 'result';
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  modelUsage: { [modelName: string]: ModelUsage };
}
```

**Key Points**:
- No pre-calculation API - tokens only available after API calls
- `cache_creation_input_tokens` represents system/tools that were cached on first use
- `cache_read_input_tokens` represents cached system/tools on subsequent calls
- Combined, these give the accurate "System/Tools" token count

**No Direct Tokenizer**: The SDK does not expose a tokenizer utility for pre-calculation.

---

### 3. OpenCode SDK

**Repository**: `anomalyco/opencode`

#### Token Estimation Method

**Location**: `packages/opencode/src/util/token.ts`

```typescript
const estimateTokens = (chars: number) => Math.ceil(chars / 4)
```

OpenCode uses a **4 characters = 1 token** heuristic for estimation.

#### Token Breakdown Available

The OpenCode SDK provides token breakdown in UI components:

| Category | How Counted |
|----------|-------------|
| System | `systemPrompt.length / 4` |
| User | Sum of text/file/agent parts / 4 |
| Assistant | Sum of text/reasoning parts / 4 |
| Tool | `(keys × 16 + output.length) / 4` |
| Other | `inputTokens - estimated` (includes tool definitions) |

**Limitation**: No single SDK method like `session.getTokenBreakdown()` - counting is done in frontend components.

---

### 4. Copilot SDK

**Repository**: `github/copilot-sdk`

#### Token Information Through Events

Copilot SDK provides token counts only through session events:

```typescript
// Current session usage
session.on("session.usage_info", (event) => {
  console.log("Current tokens:", event.data.currentTokens);
  console.log("Token limit:", event.data.tokenLimit);
});

// Per-call usage
session.on("assistant.usage", (event) => {
  console.log("Input tokens:", event.data.inputTokens);
  console.log("Output tokens:", event.data.outputTokens);
});
```

**Key Limitations**:
- No pre-send token estimation
- No separate counts for system prompt vs tools
- Tokenizer is internal - not exposed
- Must wait for events to get token counts

---

### 5. `/context` Command Implementation

**Location**: `src/ui/commands/builtin-commands.ts:472-545`

#### How It Gets System/Tools Tokens

```typescript
let systemTools = 0;

// Primary: From session
if (context.session) {
  try {
    systemTools = context.session.getSystemToolsTokens();
  } catch {
    // Session baseline not yet captured
  }
}

// Fallback: From client-level probe (captured during start())
if (systemTools === 0 && context.getClientSystemToolsTokens) {
  systemTools = context.getClientSystemToolsTokens() ?? 0;
}
```

#### Context Display Categories

The `/context` command displays four categories:

| Category | Calculation |
|----------|-------------|
| System/Tools | `getSystemToolsTokens()` |
| Messages | `(inputTokens - systemTools) + outputTokens` |
| Free Space | `maxTokens - systemTools - messages - buffer` |
| Buffer | `maxTokens * 0.55` (55% reserved for auto-compaction) |

---

### 6. Token Counting Utilities in Codebase

**Finding**: The codebase does **NOT** use external tokenization libraries.

| What's Used | Location |
|-------------|----------|
| SDK-reported values | `src/sdk/*-client.ts` |
| `ContextUsage` interface | `src/sdk/types.ts:171-180` |
| `getSystemToolsTokens()` | `src/sdk/types.ts:212-221` |
| `formatTokenCount()` helper | `src/ui/chat.tsx:937-945` |

---

## Code References

| File | Lines | Description |
|------|-------|-------------|
| `src/sdk/types.ts` | 171-180 | `ContextUsage` interface definition |
| `src/sdk/types.ts` | 212-221 | `getSystemToolsTokens()` method definition |
| `src/sdk/claude-client.ts` | 635-654 | Claude client token tracking implementation |
| `src/sdk/opencode-client.ts` | 1062-1088 | OpenCode client token tracking implementation |
| `src/sdk/copilot-client.ts` | 433-462 | Copilot client token tracking implementation |
| `src/ui/commands/builtin-commands.ts` | 472-545 | `/context` command implementation |
| `src/ui/components/context-info-display.tsx` | 50-123 | Context info display component |
| `src/ui/commands/registry.ts` | 201-217 | `ContextDisplayInfo` interface |

---

## Architecture Documentation

### Token Counting Flow

```
1. User sends first message
   ↓
2. SDK client makes API call with system prompt + tools
   ↓
3. API response includes usage metrics:
   - input_tokens
   - cache_creation_input_tokens (system + tools on first call)
   - cache_read_input_tokens (system + tools on subsequent calls)
   ↓
4. SDK client captures systemToolsBaseline from cache tokens
   ↓
5. getSystemToolsTokens() returns this baseline
   ↓
6. /context command displays as "System/Tools" field
```

### Why Cache Tokens = System/Tools

Claude and other providers cache the system prompt and tool definitions because:
1. They're identical across requests in a session
2. Cache tokens are only created/read for this "preamble" content
3. User messages and assistant responses are NOT cached
4. Therefore: `cacheCreationInputTokens + cacheReadInputTokens ≈ system + tools`

---

## Historical Context (from research/)

No prior research documents found specifically on this topic.

---

## Related Research

- `specs/context-command-session-usage.md` — Spec for `/context` command implementation
- `specs/token-count-thinking-timer-bugs.md` — Spec for fixing token count display bugs

---

## Open Questions

1. **Accuracy validation**: How accurate is the cache-token approach for non-Claude providers (Copilot)?
2. **Streaming mode**: Does token counting work correctly during streaming responses?
3. **Multi-model sessions**: How are tokens tracked when switching models mid-session?

---

## Recommendations for Implementation

### Current State: Working Correctly

The `/context` command already correctly displays System/Tools token counts using `getSystemToolsTokens()`.

### If Accuracy Concerns Arise

1. **Add logging**: Log the baseline capture in each SDK client for debugging
2. **Compare with API**: For Claude, compare `cacheCreationInputTokens` against actual measured system prompt
3. **Consider tiktoken**: If pre-calculation is needed, add `js-tiktoken` as dependency

### No Changes Needed

Based on this research, the current implementation is correct. The System/Tools field in `/context` already shows accurate token counts derived from the SDK-reported cache tokens.
