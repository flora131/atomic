# Agent Subcommand Parity Audit

Date: 2026-02-04
Phase: 9.1 - Audit and standardize agent subcommands

## Overview

This document audits the subcommands and features available across the three supported coding agent SDKs (Claude, OpenCode, Copilot) and identifies opportunities for unification as well as unavoidable SDK-specific differences.

## 1. Subcommands/Features by Agent Type

### Claude (ClaudeAgentClient)

| Feature | Status | Notes |
|---------|--------|-------|
| `createSession()` | ✅ Implemented | Creates session via `query()` API |
| `resumeSession()` | ✅ Implemented | Uses SDK's `resume` option |
| `send()` | ✅ Implemented | Blocking message send |
| `stream()` | ✅ Implemented | Streaming via AsyncGenerator |
| `summarize()` | ⚠️ Passthrough | SDK handles context compaction automatically |
| `getContextUsage()` | ✅ Implemented | Tracks input/output tokens |
| `destroy()` | ✅ Implemented | Closes query and cleans up |
| Event subscription | ✅ Implemented | Maps to SDK hooks |
| Tool registration | ✅ Implemented | Via `createSdkMcpServer()` |
| Permission handling | ✅ Implemented | `canUseTool` callback |
| Model selection | ✅ Implemented | Via `options.model` |
| HITL (Human-in-the-loop) | ✅ Implemented | `AskUserQuestion` tool handling |

**Claude-Specific Features:**
- Native hooks (PreToolUse, PostToolUse, SessionStart, etc.)
- Permission modes: auto, prompt, deny, bypass
- Max budget USD limit
- Max turns limit

### OpenCode (OpenCodeClient)

| Feature | Status | Notes |
|---------|--------|-------|
| `createSession()` | ✅ Implemented | Via `session.create()` API |
| `resumeSession()` | ✅ Implemented | Via `session.get()` API |
| `send()` | ✅ Implemented | Via `session.prompt()` |
| `stream()` | ✅ Implemented | Via SSE event stream |
| `summarize()` | ✅ Implemented | Via `session.summarize()` |
| `getContextUsage()` | ✅ Implemented | Estimated from message lengths |
| `destroy()` | ✅ Implemented | Via `session.delete()` |
| Event subscription | ✅ Implemented | SSE event mapping |
| Tool registration | ⚠️ No-op | Tools configured server-side |
| Permission handling | ⚠️ Config-based | Via `opencode.json` |
| Model selection | ⚠️ Limited | Via provider config |
| HITL | ✅ Implemented | Via `question.asked` events |

**OpenCode-Specific Features:**
- Agent modes: build, plan, general, explore
- Server auto-start/spawn
- Health check endpoint
- Session listing
- Config-based permission (not SDK option)

### Copilot (CopilotClient)

| Feature | Status | Notes |
|---------|--------|-------|
| `createSession()` | ✅ Implemented | Via `createSession()` API |
| `resumeSession()` | ✅ Implemented | Via `resumeSession()` API |
| `send()` | ✅ Implemented | Via `sendAndWait()` |
| `stream()` | ✅ Implemented | Via event subscription |
| `summarize()` | ⚠️ Passthrough | SDK handles automatically |
| `getContextUsage()` | ✅ Implemented | Via `assistant.usage` events |
| `destroy()` | ✅ Implemented | Via `session.destroy()` |
| Event subscription | ✅ Implemented | Full event mapping |
| Tool registration | ✅ Implemented | Via session config |
| Permission handling | ✅ Implemented | Via `onPermissionRequest` |
| Model selection | ✅ Implemented | Via session config |
| HITL | ✅ Implemented | Via permission handler |

**Copilot-Specific Features:**
- Connection modes: stdio, port, cliUrl
- Session listing
- Session deletion
- Custom agents support
- Auto-start/restart options

## 2. Commands That Should Be Unified

### Already Unified (CodingAgentClient Interface)

The following methods are part of the unified `CodingAgentClient` interface:

```typescript
interface CodingAgentClient {
  readonly agentType: AgentType;
  createSession(config?: SessionConfig): Promise<Session>;
  resumeSession(sessionId: string): Promise<Session | null>;
  on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void;
  registerTool(tool: ToolDefinition): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  getModelDisplayInfo(modelHint?: string): Promise<ModelDisplayInfo>;
}
```

### Candidates for Unification

| Feature | Current State | Recommendation |
|---------|---------------|----------------|
| Session listing | OpenCode + Copilot have it, Claude doesn't | Add to interface (optional) |
| Session deletion | Copilot has it, others don't | Add to interface (optional) |
| Health check | OpenCode has it | Not needed for other SDKs |

### Recommended Interface Extension

```typescript
interface CodingAgentClient {
  // ... existing methods ...

  /** List available sessions (if supported by SDK) */
  listSessions?(): Promise<Array<{ id: string; title?: string }>>;

  /** Delete a session by ID (if supported by SDK) */
  deleteSession?(sessionId: string): Promise<void>;
}
```

## 3. Unavoidable SDK-Specific Differences

### Permission Configuration

| Agent | Configuration Method |
|-------|---------------------|
| Claude | SDK option (`permissionMode`) |
| OpenCode | Config file (`opencode.json`) |
| Copilot | SDK callback (`onPermissionRequest`) |

**Conclusion:** Cannot be unified - each SDK has a fundamentally different approach.

### Agent Modes

| Agent | Modes | Notes |
|-------|-------|-------|
| Claude | N/A | Single mode |
| OpenCode | build, plan, general, explore | Task-specific modes |
| Copilot | N/A | Single mode |

**Conclusion:** OpenCode-specific feature, already handled via `SessionConfig.agentMode`.

### Token Usage Tracking

| Agent | Method |
|-------|--------|
| Claude | Tracked from `message.usage` |
| OpenCode | Estimated from message lengths |
| Copilot | Via `assistant.usage` events |

**Conclusion:** Different precision levels, but unified interface works.

### Model Selection

| Agent | Format | Examples |
|-------|--------|----------|
| Claude | Aliases or full IDs | `opus`, `sonnet`, `claude-opus-4-5-20251101` |
| OpenCode | Provider/Model format | `anthropic/claude-sonnet-4-20250514` |
| Copilot | Model IDs | `gpt-5`, `claude-sonnet-4.5` |

**Conclusion:** Already handled via `ModelSpec` type with JSDoc documentation.

### Streaming Behavior

| Agent | Mechanism |
|-------|-----------|
| Claude | AsyncGenerator from `query()` |
| OpenCode | SSE events via `event.subscribe()` |
| Copilot | Session event callbacks |

**Conclusion:** Abstracted behind `Session.stream()` interface.

## 4. Command Parity Mapping

### Atomic CLI Commands

| Command | Claude | OpenCode | Copilot | Notes |
|---------|--------|----------|---------|-------|
| `atomic run <agent>` | ✅ | ✅ | ✅ | Spawns agent process |
| `atomic chat -a <agent>` | ✅ | ✅ | ✅ | Chat UI with SDK |
| `atomic init -a <agent>` | ✅ | ✅ | ✅ | Setup configuration |
| `atomic ralph setup -a <agent>` | ✅ | ❌ | ❌ | Claude-only for now |

### Session Operations

| Operation | Claude | OpenCode | Copilot | Unified? |
|-----------|--------|----------|---------|----------|
| Create session | ✅ | ✅ | ✅ | ✅ Yes |
| Resume session | ✅ | ✅ | ✅ | ✅ Yes |
| Send message | ✅ | ✅ | ✅ | ✅ Yes |
| Stream response | ✅ | ✅ | ✅ | ✅ Yes |
| Context usage | ✅ | ✅ | ✅ | ✅ Yes |
| Destroy session | ✅ | ✅ | ✅ | ✅ Yes |
| List sessions | ❌ | ✅ | ✅ | ❌ Optional |
| Delete session | ❌ | ✅ | ✅ | ❌ Optional |

### Event Types

| Event | Claude | OpenCode | Copilot | Unified? |
|-------|--------|----------|---------|----------|
| session.start | ✅ | ✅ | ✅ | ✅ Yes |
| session.idle | ✅ | ✅ | ✅ | ✅ Yes |
| session.error | ✅ | ✅ | ✅ | ✅ Yes |
| message.delta | ✅ | ✅ | ✅ | ✅ Yes |
| message.complete | ✅ | ✅ | ✅ | ✅ Yes |
| tool.start | ✅ | ✅ | ✅ | ✅ Yes |
| tool.complete | ✅ | ✅ | ✅ | ✅ Yes |
| subagent.start | ✅ | ❌ | ✅ | ⚠️ Partial |
| subagent.complete | ✅ | ❌ | ✅ | ⚠️ Partial |
| permission.requested | ✅ | ✅ | ✅ | ✅ Yes |
| human_input_required | ✅ | ✅ | ✅ | ✅ Yes |

## 5. Modularity Assessment

### Current State

The SDK client implementations are already modular:

1. **Factory pattern:** Each client has a `create*Client()` factory function
2. **Unified interface:** All implement `CodingAgentClient`
3. **Event normalization:** SDK events are mapped to unified `EventType`
4. **Session abstraction:** All return a unified `Session` interface

### Areas Already Modular

```
src/sdk/
├── types.ts          # Unified types (CodingAgentClient, Session, etc.)
├── index.ts          # Public exports
├── init.ts           # Client initialization helpers
├── claude-client.ts  # Claude implementation
├── opencode-client.ts # OpenCode implementation
└── copilot-client.ts  # Copilot implementation
```

### Recommendations for Further Modularity

1. **No refactoring needed:** The current structure is already well-modularized
2. **Optional interface extension:** Consider adding `listSessions()` and `deleteSession()` as optional methods
3. **Agent mode handling:** Already abstracted via `SessionConfig.agentMode` (OpenCode-only)

## 6. Summary

### What's Already Unified

- ✅ Core session lifecycle (create, resume, destroy)
- ✅ Message operations (send, stream)
- ✅ Event subscription and handling
- ✅ Tool registration interface
- ✅ Model display information
- ✅ Context usage tracking

### SDK-Specific Differences (Unavoidable)

- Permission configuration approaches differ fundamentally
- Token tracking precision varies
- Agent modes are OpenCode-only
- Session listing/deletion not universal

### No Refactoring Required

The per-agent logic is already modular:
- Each client is a separate file implementing the same interface
- No shared code needs to be extracted
- Event mapping is already normalized
- Factory functions provide clean instantiation

### Future Considerations

1. Add optional `listSessions()` to interface when needed
2. Add optional `deleteSession()` to interface when needed
3. Ralph loop could potentially be extended to other agents in the future
