---
date: 2026-02-25 04:46:55 UTC
researcher: Copilot
git_commit: 9b083f05a44982ff45dbd5a8bf7c88972a879994
branch: lavaman131/hotfix/ralph-reliability
repository: ralph-reliability
topic: "@ Command Duplicate Sub-Agent Tree Spawning Investigation"
tags: [research, codebase, at-commands, subagent-tree, duplicate-rendering, parallel-agents, stream-pipeline]
status: complete
last_updated: 2026-02-25
last_updated_by: Copilot
---

# Research: @ Command Duplicate Sub-Agent Tree Spawning

## Research Question

Why do `@` commands temporarily spawn a duplicate sub-agent tree that then collapses, instead of merging cleanly like the natural language (LLM-driven) pathway?

## Summary

The `@` command pathway and the natural language pathway create sub-agent UI state through **two fundamentally different execution flows** that converge on the same `parallelAgents` React state. The duplicate tree issue stems from a **dual assistant message creation pattern** combined with a **fire-and-forget race condition** in the `@` command pathway. Specifically:

1. **The `@` submit handler creates a placeholder assistant message** (chat.tsx:5665) with `isAgentOnlyStreamRef = true`
2. **Then `sendSilentMessage` creates a SECOND assistant message** (chat.tsx:3507) with `isAgentOnlyStreamRef = false`, attempting to finalize and remove the first
3. **Meanwhile, SDK events (`tool.start` → eager agent, `subagent.start` → merge attempt)** create `ParallelAgent` entries in `state.parallelAgents`
4. **React state batching** means these updates may not be applied atomically, causing a transient state where both the placeholder message and the real streaming message each get their own agent tree rendering

The natural language pathway avoids this because it has a **single linear flow**: user message → SDK stream → `tool.start` → eager agent → `subagent.start` → merge — all through a single assistant message with unified streaming state.

## Detailed Findings

### 1. @ Command Execution Flow (Pathway A)

**Entry point:** `src/ui/chat.tsx:5632-5678`

When a user types `@worker do X` and presses Enter:

#### Step 1: Detection and Parsing
```
chat.tsx:5633 → if (trimmedValue.startsWith("@"))
chat.tsx:5634 → parseAtMentions(trimmedValue)  // from mention-parsing.ts:58-83
```
`parseAtMentions()` tokenizes the input, looks up each `@name` in `globalRegistry`, filters for `category === "agent"`, and returns `{ agentName, args }[]`.

#### Step 2: User Message + Placeholder Assistant Message
```
chat.tsx:5658 → addMessage("user", trimmedValue)
chat.tsx:5665 → const assistantMsg = createMessage("assistant", "", true)  // streaming=true
chat.tsx:5667 → isAgentOnlyStreamRef.current = true  // ⚠️ KEY FLAG #1
chat.tsx:5668 → isStreamingRef.current = true
```
**Creates an empty streaming assistant message** as a container for the agent tree.

#### Step 3: Fire-and-Forget Command Execution
```
chat.tsx:5675-5677 →
  for (const mention of atMentions) {
    void executeCommand(mention.agentName, mention.args, "mention");
  }
  return;  // ⚠️ Returns immediately!
```
**Critical:** `void` means the Promises are NOT awaited. `handleSubmit` returns before any agent is actually spawned.

#### Step 4: Inside `executeCommand` → Agent Command → `sendSilentMessage`

`executeCommand` (chat.tsx:3415) looks up the command in `globalRegistry` and calls its `execute()`:

**For Claude/Copilot** (agent-commands.ts:320-325):
```typescript
const instruction = `Use the Task tool to invoke the ${agent.name} sub-agent...`;
context.sendSilentMessage(instruction);
```

**For OpenCode** (agent-commands.ts:315-319):
```typescript
context.sendSilentMessage(task, { agent: agent.name });
```

#### Step 5: `sendSilentMessage` Creates SECOND Assistant Message

**`sendSilentMessage`** (chat.tsx:3466-3520):

1. **Tries to finalize the first placeholder** (lines 3477-3489):
   ```typescript
   const prevStreamingId = streamingMessageIdRef.current;
   if (prevStreamingId) {
     setMessagesWindowed((prev) =>
       prev.map(msg => msg.id === prevStreamingId && msg.streaming
         ? { ...finalizeStreamingReasoningInMessage(msg), streaming: false }
         : msg
       ).filter(msg =>
         !(msg.id === prevStreamingId && !msg.content.trim())  // Remove if empty
       )
     );
   }
   ```

2. **Creates a NEW assistant message** (lines 3506-3510):
   ```typescript
   const assistantMessage = createMessage("assistant", "", true);
   streamingMessageIdRef.current = assistantMessage.id;
   isAgentOnlyStreamRef.current = false;  // ⚠️ KEY: Set to false!
   ```

**🔴 THE RACE CONDITION:** The `setMessagesWindowed` call at step 5.1 is a React state setter — it schedules an update but **does NOT execute synchronously**. By the time step 5.2 creates the new message and adds it to state, the filter removing the empty placeholder may not have been applied yet. This causes a **transient state with TWO assistant messages**.

#### Step 6: SDK Events Create Agent Tree Entries

After `onSendMessage(content)` fires (chat.tsx:3469), the SDK processes the instruction and:

1. **`tool.start` event** (index.ts:683-754) — Creates **eager ParallelAgent**:
   ```typescript
   const newAgent: ParallelAgent = {
     id: toolId,              // Temporary tool call ID
     taskToolCallId: toolId,
     name: agentType,
     status: isBackground ? "background" : "running",
     // ...
   };
   state.parallelAgents = [...state.parallelAgents, newAgent];
   state.parallelAgentHandler(state.parallelAgents);  // → setParallelAgents()
   ```

2. **`subagent.start` event** (index.ts:1181-1350) — Attempts to **merge** with eager agent:
   ```typescript
   if (hasEagerAgent && eagerToolId) {
     // Update existing entry: replace temp ID with real subagentId
     state.parallelAgents = state.parallelAgents.map(a =>
       a.id === eagerToolId ? { ...a, id: data.subagentId!, ... } : a
     );
   } else {
     // No eager agent → create fresh (potential duplicate!)
     state.parallelAgents = [...state.parallelAgents, newAgent];
   }
   ```

#### Step 7: `parallelAgents` useEffect Injects Into Message

The `parallelAgents` state change triggers a useEffect (chat.tsx:2870-2889):
```typescript
useEffect(() => {
  if (parallelAgents.length === 0) return;
  const messageId = streamingMessageIdRef.current;
  if (messageId) {
    setMessagesWindowed((prev) =>
      prev.map((msg, index) => {
        if (msg.id === messageId && msg.streaming) {
          return applyStreamPartEvent(msg, {
            type: "parallel-agents",
            agents: parallelAgents,
            isLastMessage: index === prev.length - 1,
          });
        }
        return msg;
      })
    );
  }
}, [parallelAgents]);
```

**🔴 THE DUPLICATE TREE:** If both assistant messages still exist in state when this effect fires, and `streamingMessageIdRef.current` points to the **second** one, only the second gets the agent tree. But if React renders between the two state updates, the **first** placeholder message may have briefly received agents from an earlier state update, showing a transient duplicate.

---

### 2. Natural Language Execution Flow (Pathway B)

**Entry point:** Normal `sendMessage` call in `handleSubmit`

1. User sends "use the worker agent to do X"
2. `sendMessage()` creates a **single** assistant message
3. SDK streams LLM response
4. LLM calls Task tool → `tool.start` fires → **single eager ParallelAgent** created
5. `subagent.start` fires → **merges** with eager agent (updates `id` from temp to real)
6. `parallelAgents` useEffect applies agents to the **single** streaming message
7. Tree renders once, cleanly

**Key difference:** Only ONE assistant message exists throughout the entire flow. The `parallelAgents` effect always targets the same message ID.

---

### 3. Comparison Table

| Aspect | @ Command (Pathway A) | Natural Language (Pathway B) |
|--------|----------------------|---------------------------|
| Assistant messages created | **2** (placeholder + sendSilentMessage) | **1** |
| `isAgentOnlyStreamRef` | Set `true`, then `false` | Stays `false` |
| Command execution | Fire-and-forget (`void`) | Synchronous SDK stream |
| Agent tree creation | Through `sendSilentMessage` → SDK events | Through SDK events directly |
| Race condition risk | **HIGH** — multiple async state updates | **LOW** — linear event flow |
| `streamingMessageIdRef` changes | Changes from msg1.id → msg2.id mid-flow | Stays constant |

---

### 4. Root Cause Analysis

The duplicate tree spawning is caused by a **multi-factor race condition**:

#### Factor 1: Dual Assistant Message Pattern
The `@` pathway creates TWO assistant messages:
- Message A: Created at `chat.tsx:5665` (the placeholder)
- Message B: Created at `chat.tsx:3507` (by `sendSilentMessage`)

The cleanup code (chat.tsx:3477-3489) uses React's `setMessagesWindowed` to remove Message A, but this is **asynchronous**. Both messages coexist transiently.

#### Factor 2: `isAgentOnlyStreamRef` Flag Toggle
- Set to `true` at line 5667 (for Message A)
- Set to `false` at line 3509 (for Message B)

This flag affects finalization logic. The toggle creates an inconsistent state where finalization guards (`shouldFinalizeOnToolComplete`, `shouldFinalizeDeferredStream`) may behave differently during the transition.

#### Factor 3: `streamingMessageIdRef` Mutation
When `sendSilentMessage` creates Message B, it replaces `streamingMessageIdRef.current`:
```typescript
// From Message A's ID → Message B's ID
streamingMessageIdRef.current = assistantMessage.id;
```

If the `parallelAgents` useEffect fires during the transition, it may apply agents to the **wrong** message, or agents may have been applied to Message A before it's cleaned up.

#### Factor 4: SDK Event Timing
The `tool.start` and `subagent.start` events fire asynchronously from the SDK. If they arrive before `sendSilentMessage` has finished setting up Message B, the eager agent may be created and associated with Message A's context.

#### Factor 5: Deduplication Timing
`deduplicateAgents()` in `parallel-agents-tree.tsx:206` runs at **render time**, not at state update time. It successfully merges duplicates by `taskToolCallId` correlation, which is why the tree **collapses** after the initial duplicate appears. The dedup catches up on the next render cycle.

---

### 5. Deduplication System (Why It Eventually Collapses)

The deduplication system in `parallel-agents-tree.tsx` is the reason the duplicate tree eventually resolves:

1. **`deduplicateAgents()`** (line 206) — Groups agents by `taskToolCallId` and merges each group
2. **`mergeAgentPair()`** (line 249) — Combines two entries, preferring the one with a real task description and higher status priority
3. **`isLikelyEagerPlaceholder()`** (line 277) — Identifies placeholder agents (where `id === taskToolCallId` or starts with `"tool_"`)
4. **`canMergeUncorrelatedDuplicate()`** (line 302) — Validates merge candidates by name, task genericness, and background flag

The deduplication runs during component rendering (`AgentPartDisplay` calls `deduplicateAgents` at line 56 before splitting into foreground/background). Once React re-renders with the consolidated state, the duplicates merge.

**The visual artifact occurs because:**
1. React renders with the duplicate state (before dedup runs on the next render)
2. Or, two separate `AgentPart` entries exist in the `parts` array (one per assistant message) before Message A is cleaned up

---

### 6. Stream Pipeline Merge Logic

`mergeParallelAgentsIntoParts()` (stream-pipeline.ts:643-771) handles integrating agents into the message parts array:

- **Grouped mode** (`shouldGroupSubagentTrees` returns true): Creates a **single** `AgentPart` with all agents
- **Per-task mode**: Groups agents by `taskToolCallId` and creates separate `AgentPart` entries per Task tool call group

The `shouldGroupSubagentTrees()` function (line 577) checks:
1. Is this the last message?
2. Are all tool parts Task tools (no non-Task tools)?
3. Are agents active or already grouped?

When the `@` pathway creates its agent, the grouping decision may differ between the two assistant messages, causing different tree layouts that appear as "duplicates."

---

### 7. Historical Context — Precedent: Skill Loading Indicator Duplicate

A nearly identical bug was previously fixed for skill loading indicators (Issue #205):

**Root cause:** Two independent rendering paths both produced the same component:
- Path A: `skill.invoked` SDK event → `message.skillLoads` → renders indicator
- Path B: `tool.execution_start` with `toolName === "skill"` → `visibleToolCalls` → renders indicator

**Fix applied:** Filter skill tools from `visibleToolCalls` (chat.tsx:1299-1303):
```typescript
const isSkillTool = (name: string) => name === "Skill" || name === "skill";
const visibleToolCalls = toolCalls.filter(
  (tc) => !isHitlTool(tc.toolName) && !isSubAgentTool(tc.toolName) && !isSkillTool(tc.toolName)
);
```

**Relevance:** The `@` command duplicate tree issue follows the same **dual rendering path** pattern. The architectural fix was to **eliminate one rendering path** rather than trying to coordinate both.

---

### 8. Background Agents SDK Pipeline (Issue #258)

Research from `research/docs/2026-02-23-258-background-agents-sdk-event-pipeline.md` documents a 6-stage pipeline:

```
Stage 1: SDK emits tool.start / subagent.start / subagent.complete
Stage 2: UI Integration (index.ts) creates ParallelAgent objects
Stage 3: UI Integration calls parallelAgentHandler(agents)
Stage 4: ChatApp receives agents, applies parallel-agents event
Stage 5: Stream pipeline merges agents into AgentPart objects
Stage 6: ParallelAgentsTree component renders
```

For `@` commands, stages 1-2 are complicated by the **`sendSilentMessage` indirection** — the instruction is sent to the SDK as a regular message, and the SDK must then decide to call the Task tool. This adds latency and creates the window for the race condition.

---

## Code References

### @ Command Entry & Dispatch
- `src/ui/chat.tsx:5632-5678` — Submit handler with `@` detection and fire-and-forget dispatch
- `src/ui/chat.tsx:3177-3210` — `dispatchQueuedMessage()` for deferred @ mentions during streaming
- `src/ui/utils/mention-parsing.ts:58-83` — `parseAtMentions()` parser
- `src/ui/commands/agent-commands.ts:312-328` — Agent command `execute()` with SDK-specific dispatch

### Silent Message (Dual Message Creation)
- `src/ui/chat.tsx:3466-3520` — `sendSilentMessage()` — creates second assistant message, tries to clean up first
- `src/ui/chat.tsx:3475-3476` — Comment acknowledging duplicate spinner issue
- `src/ui/chat.tsx:5660-5664` — Comment explaining placeholder message purpose

### SDK Event Handlers
- `src/ui/index.ts:683-754` — `tool.start` handler: eager `ParallelAgent` creation
- `src/ui/index.ts:1181-1350` — `subagent.start` handler: merge-or-create logic
- `src/ui/index.ts:658-660` — `tool.complete` handler: status finalization

### Agent Tree Deduplication
- `src/ui/components/parallel-agents-tree.tsx:206-360` — `deduplicateAgents()` and helpers
- `src/ui/components/parallel-agents-tree.tsx:249-275` — `mergeAgentPair()` merge logic
- `src/ui/components/parallel-agents-tree.tsx:277-284` — `isLikelyEagerPlaceholder()` detection

### Stream Pipeline
- `src/ui/parts/stream-pipeline.ts:577-605` — `shouldGroupSubagentTrees()`
- `src/ui/parts/stream-pipeline.ts:643-771` — `mergeParallelAgentsIntoParts()`
- `src/ui/parts/stream-pipeline.ts:818-884` — `applyStreamPartEvent()` with `parallel-agents` case

### React State Integration
- `src/ui/chat.tsx:1789` — `parallelAgents` state declaration
- `src/ui/chat.tsx:2851-2864` — Handler registration connecting SDK to React
- `src/ui/chat.tsx:2870-2889` — useEffect injecting agents into streaming message

### SDK Clients
- `src/sdk/clients/claude.ts:1210-1225` — Subagent event counter tracking
- `src/sdk/clients/copilot.ts:633-659` — Copilot subagent event mapping
- `src/sdk/clients/opencode.ts:777-815` — OpenCode agent/subtask part to subagent.start mapping

### Lifecycle Guards
- `src/ui/parts/guards.ts:20-27` — `shouldFinalizeOnToolComplete()` background guard
- `src/ui/parts/guards.ts:30-36` — `hasActiveForegroundAgents()`

## Architecture Documentation

### Current Dual-Path Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    @ COMMAND PATHWAY                         │
│                                                              │
│  User types "@worker do X"                                   │
│       ↓                                                      │
│  handleSubmit detects "@" prefix                             │
│       ↓                                                      │
│  Creates user message + placeholder assistant (Message A)    │
│  Sets isAgentOnlyStreamRef = true                            │
│       ↓                                                      │
│  void executeCommand("worker", "do X")  ← fire-and-forget   │
│       ↓                                                      │
│  agent-commands.ts → sendSilentMessage(instruction)          │
│       ↓                                                      │
│  sendSilentMessage:                                          │
│    1. Tries to remove Message A (async React setState)       │
│    2. Creates Message B (new assistant message)              │
│    3. Sets isAgentOnlyStreamRef = false                      │
│    4. Calls onSendMessage → SDK                              │
│       ↓                                                      │
│  ⚠️ TRANSIENT STATE: Both Message A & B may exist briefly   │
│       ↓                                                      │
│  SDK processes instruction → LLM calls Task tool             │
│       ↓                                                      │
│  tool.start → eager ParallelAgent created                    │
│  subagent.start → merge with eager agent                     │
│       ↓                                                      │
│  parallelAgents useEffect → applies to Message B             │
│       ↓                                                      │
│  deduplicateAgents() at render → collapses duplicates        │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                NATURAL LANGUAGE PATHWAY                       │
│                                                              │
│  User types "use the worker agent to do X"                   │
│       ↓                                                      │
│  sendMessage() → creates single assistant message            │
│       ↓                                                      │
│  SDK streams LLM response                                    │
│       ↓                                                      │
│  LLM calls Task tool                                         │
│       ↓                                                      │
│  tool.start → eager ParallelAgent created                    │
│  subagent.start → merge with eager agent                     │
│       ↓                                                      │
│  parallelAgents useEffect → applies to same message          │
│       ↓                                                      │
│  ✅ Single message, single tree, clean rendering             │
└──────────────────────────────────────────────────────────────┘
```

### Deduplication Defense Layers

The codebase has multiple deduplication layers that eventually resolve the duplicate:

1. **Layer 1 — Eager Merge** (index.ts:1269-1286): `subagent.start` handler merges with eager agent by `taskToolCallId`
2. **Layer 2 — Pipeline Grouping** (stream-pipeline.ts:643): `mergeParallelAgentsIntoParts` groups by `taskToolCallId`
3. **Layer 3 — Render-Time Dedup** (parallel-agents-tree.tsx:206): `deduplicateAgents()` catches remaining duplicates
4. **Layer 4 — Shadow Detection** (background-agent-footer.ts:24-69): `isShadowForegroundAgent()` hides duplicate foreground entries

These layers explain why the duplicate **collapses** — the system catches it, but not before a brief visual flash.

## Historical Context (from research/)

- `research/tickets/2026-02-15-205-skill-loading-indicator-duplicate.md` — Identical dual-path rendering issue for skills, fixed by filtering one path
- `specs/skill-loading-indicator-duplicate-fix.md` — Established the pattern of filtering tools with dedicated renderers from `visibleToolCalls`
- `research/docs/2026-02-16-sub-agent-tree-inline-state-lifecycle-research.md` — Documents premature lifecycle finalization at 4+ code sites
- `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md` — Documents two-path agent creation (eager + subagent.start) and SDK parity
- `research/docs/2026-02-15-subagent-premature-completion-investigation.md` — Detailed root cause of `tool.complete` unconditionally finalizing status
- `research/docs/2026-02-23-258-background-agents-sdk-event-pipeline.md` — 6-stage pipeline architecture and per-SDK correlation analysis
- `research/docs/2026-02-06-at-mention-dropdown-research.md` — @ mention dropdown implementation research

## Related Research

- `specs/background-agents-ui-issue-258-parity-hardening.md` — Background agents UI parity spec
- `specs/background-agents-sdk-pipeline-fix.md` — SDK pipeline fix spec
- `specs/sub-agent-tree-inline-state-lifecycle-fix.md` — Tree lifecycle fix spec
- `specs/chat-system-parts-based-rendering.md` — Parts-based rendering architecture spec

## Open Questions

1. **Is the duplicate tree visible across ALL SDKs, or only Claude/Copilot?** The OpenCode path uses `sendSilentMessage(task, { agent: name })` which dispatches differently than Claude/Copilot's instruction-based approach.

2. **Does the `dispatchQueuedMessage()` path (chat.tsx:3177-3210) for queued @ mentions during streaming have the same issue?** It loops through parsed mentions and calls `executeCommand()` for each — same fire-and-forget pattern.

3. **Would eliminating the placeholder assistant message (Message A) and relying solely on `sendSilentMessage`'s message creation (Message B) resolve the issue?** The placeholder was added so "the parallel agents tree view renders right away" (comment at line 5660), but this creates the dual-message problem.

4. **Can the `@` command pathway bypass `sendSilentMessage` entirely and instead use the `spawnSubagent` / `spawnSubagentParallel` bridge directly?** This would create a single, controlled execution path similar to the natural language pathway.

5. **Is there a timing window where the `parallelAgents` useEffect applies agents to Message A before it's cleaned up?** If so, Message A renders a tree, then gets removed — causing the visual "flash" of a duplicate tree.
