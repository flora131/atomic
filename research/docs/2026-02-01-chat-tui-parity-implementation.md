---
date: 2026-02-01 09:50:00 UTC
researcher: Claude
git_commit: pending
branch: lavaman131/feature/tui
repository: atomic
topic: Chat TUI Parity Implementation Progress
tags: [research, tui, chat, parity, claude, opencode, copilot]
status: in_progress
last_updated: 2026-02-01
last_updated_by: Claude
---

# Chat TUI Parity Implementation

## Summary

This document tracks the progress of implementing parity between claude, opencode, and copilot chat commands (`bun run src/cli.ts chat -a <agent>`).

## Completed Tasks

### 1. Fix Skill Commands (Task #1) ✅

**Problem**: Skill commands like `/research-codebase` were showing empty results in the TUI.

**Solution**: Updated `src/ui/commands/skill-commands.ts` to:
- Load skill prompts from disk (`.claude/commands/`, `.opencode/command/`, `.github/commands/`)
- Strip YAML frontmatter from skill files
- Expand `$ARGUMENTS` placeholder with user arguments
- Send the slash command to the agent for native handling

**Files Modified**:
- `src/ui/commands/skill-commands.ts` - Added skill prompt loading and expansion

**Limitation**: The TUI uses SDK directly, not the native CLI. Skill prompts with dynamic injection syntax (`!`command``) won't work as the SDK doesn't understand them. Skills should be invoked via `atomic run <agent>` for full functionality.

### 2. Session-Based File Paths (Task #3) ✅

**Problem**: Multiple Ralph loops could conflict when accessing `progress.txt`, `feature-list.json`, and `ralph-loop.local.md`.

**Solution**: Added session-based file path generation in `src/config/ralph.ts`:
- `generateRalphSessionId()` - Creates unique session IDs
- `getRalphSessionPaths(agentType, sessionId)` - Returns session-specific paths
- Paths include session ID suffix when provided (e.g., `feature-list-sess_123_abc.json`)

**Files Modified**:
- `src/config/ralph.ts` - Added session path generation utilities

### 3. Workflow Session Management (Task #3) ✅

**Problem**: No mechanism for human-in-the-loop with auto context clearing.

**Solution**: Added workflow session types and management in `src/ui/commands/workflow-commands.ts`:
- `WorkflowSession` interface for tracking multi-step workflow state
- `WorkflowStep` type for workflow phases
- Session management functions: `createWorkflowSession`, `getActiveSession`, `updateSessionStep`, `completeSession`

**Files Modified**:
- `src/ui/commands/workflow-commands.ts` - Added workflow session management

### 4. Agent UI Parity (Task #4) ✅

**Verified**: All three agents have identical TUI interfaces:
- Same slash commands available (`/help`, `/status`, `/clear`, `/approve`, `/reject`, `/theme`)
- Same workflow commands (`/atomic`)
- Same skill commands (`/commit`, `/research-codebase`, etc.)
- Same autocomplete behavior
- Only difference: SDK-level features (streaming, tools, models)

### 5. E2E Testing (Task #5) ✅

**Tested via tmux-cli**:
- Created test project at `/tmp/snake-game-test.QR509C`
- Verified all three agents (claude, opencode, copilot) start correctly
- Verified `/help` displays identical command lists
- Verified `/status` shows workflow state
- Verified `/clear` clears messages
- Verified basic message exchange works

## In Progress

### 6. Workflow Slash Commands from .atomic/workflows/*.ts (Task #2) 🔄

**Status**: Partially implemented

**Completed**:
- Created workflow directory discovery in `src/ui/commands/workflow-commands.ts`
- Created directory structure: `~/.atomic/workflows/` and `.atomic/workflows/`
- Added `discoverWorkflowFiles()` function to find workflow files

**Remaining**:
- Implement dynamic TypeScript file loading at runtime
- Register discovered workflows as slash commands
- Handle local vs global workflow name conflicts (local takes priority)

## Known Limitations

1. **Skill Execution**: TUI uses SDK directly, so:
   - Native CLI features (dynamic injection `!`command``) don't work
   - Full skill functionality requires `atomic run <agent>` instead

2. **Tool Execution**: TUI chat doesn't have tool execution capabilities:
   - Claude SDK needs tools registered separately
   - OpenCode requires server connection
   - Copilot requires CLI server

3. **Workflow Graph Execution**: Graph-based workflow is defined but:
   - Requires `ATOMIC_USE_GRAPH_ENGINE=true` flag
   - Currently in experimental phase

## File References

| File | Purpose |
|------|---------|
| `src/ui/commands/skill-commands.ts` | Skill command implementation |
| `src/ui/commands/workflow-commands.ts` | Workflow command and session management |
| `src/ui/commands/registry.ts` | Command registry |
| `src/config/ralph.ts` | Ralph configuration and session paths |
| `src/commands/chat.ts` | Chat command entry point |
| `src/sdk/claude-client.ts` | Claude SDK client |
| `src/sdk/opencode-client.ts` | OpenCode SDK client |
| `src/sdk/copilot-client.ts` | Copilot SDK client |

## Next Steps

1. Implement TypeScript workflow file loader using Bun's dynamic import
2. Test workflow registration from both local and global directories
3. Add human-in-the-loop pause after `/research-codebase` and `/create-spec`
4. Implement automatic context clearing between workflow steps

---

## SDK Research: Tool Call Rendering Patterns

### OpenCode SDK Architecture

#### Tool Component Structure

OpenCode uses two display modes for tool calls:

| Mode | Components | Characteristics |
|------|------------|-----------------|
| `InlineTool` | Glob, Read, Grep, List, WebFetch | Single line, icon + message |
| `BlockTool` | Bash, Write, Edit, Task, TodoWrite | Bordered box, multi-line |

**BasicTool Props:**
```typescript
interface BasicToolProps {
  icon: IconName;
  trigger: TriggerTitle | JSX.Element;
  children?: JSX.Element;
  hideDetails?: boolean;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  locked?: boolean;
  onSubtitleClick?: () => void;
}
```

#### Tool State Lifecycle

```
ToolStatePending → ToolStateRunning → ToolStateCompleted
                                   ↘ ToolStateError
```

States include:
- `pending`: `{input, raw}`
- `running`: `{input, title?, metadata?, start}`
- `completed`: `{input, output, title, metadata, start, end, compacted?, attachments?}`
- `error`: `{input, error, metadata?, start, end}`

#### SSE Event Flow

```
Bus.publish() → GlobalBus.emit() → SSE endpoint → Frontend subscription → Store update
```

Key events: `session.created`, `session.idle`, `session.error`, `message.part.updated`

### Permission System Comparison

| Feature | OpenCode | Copilot | Claude |
|---------|----------|---------|--------|
| Config location | `opencode.json` | SDK callback | `PreToolUse` hook |
| Options | allow/ask/deny | approved/denied | allow/deny/ask |
| Pattern matching | Wildcard (`git *`) | N/A | Hook-based |
| Special guards | `doom_loop`, `external_directory` | N/A | `PermissionRequest` event |

**OpenCode Permission Config:**
```json
{
  "permission": {
    "*": "ask",
    "read": "allow",
    "bash": { "git *": "allow", "rm *": "deny" }
  }
}
```

### Error Propagation Patterns

**OpenCode:**
1. Tool execution catches error in `batch.ts`
2. `Session.updatePart()` with `status: "error"`
3. Bus publishes `Session.Event.Error`
4. TUI subscribes → Toast notification

**Copilot:**
- Event type: `session.error`
- Data: `{ error: event.data.message }`

**Claude:**
- Result subtypes: `error_max_turns`, `error_max_budget_usd`
- Emits `session.error` with code

### Claude Agent SDK v2 Details (From Research)

**Streaming Event Types:**
- `message_start` - Beginning of message
- `content_block_start` - Start of content block (text or tool_use)
- `content_block_delta` - Incremental content updates
- `content_block_stop` - End of content block
- `message_delta` - Message-level updates
- `message_stop` - End of message

**Key Interface: `canUseTool` Callback:**
```typescript
type CanUseTool = (
  toolName: string,
  input: ToolInput,
  options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }
) => Promise<PermissionResult>;

type PermissionResult =
  | { behavior: 'allow'; updatedInput: ToolInput; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean };
```

**Error Result Subtypes:**
- `error_max_turns` - Hit turn limit
- `error_during_execution` - Runtime error
- `error_max_budget_usd` - Budget exceeded
- `error_max_structured_output_retries` - Output parsing failed

**AskUserQuestion Tool:**
```typescript
interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  answers?: Record<string, string>;  // Filled by canUseTool
}
```

### Claude Code UI Features

**Permission Modes (Shift+Tab to cycle):**
1. `default`: Prompt on first use
2. `acceptEdits`: Auto-accept file edits
3. `planMode`: Read-only, creates plan
4. `dontAsk`: Auto-deny unless pre-approved
5. `bypassPermissions`: Skip all prompts

**Status Line Config:**
```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh"
  }
}
```

**Verbose Mode:** `Ctrl+O` toggles detailed tool output

**Checkpoint/Rewind:** `Esc+Esc` or `/rewind` for error recovery

---

## Implementation Gap Analysis

### Important Design Decision: No-Permission Mode

**Atomic CLI runs all agents in NO-PERMISSION MODE (auto-approve).** This is intentional and expected behavior. Permission prompts for tool execution (Read, Write, Bash, etc.) are NOT needed because:

1. The CLI is designed for automated/scripted workflows
2. Users invoke the CLI with explicit intent to let the agent work
3. Permission prompts would block automated Ralph Loop iterations

**Exception: `AskUserQuestion` Tool**
The ONLY human-in-the-loop interaction needed is the `AskUserQuestion` tool, which is used for:
- Clarifying ambiguous user requirements
- Offering choices when multiple approaches exist
- Getting user preferences during spec approval workflows

This is fundamentally different from permission prompts - it's about **addressing ambiguity**, not **approving tool execution**.

### Current Atomic Gaps vs Native CLIs

| Feature | Native CLIs | Atomic Status | Priority |
|---------|-------------|---------------|----------|
| Tool call visibility during streaming | ✅ | ❌ Missing | **P1** |
| InlineTool/BlockTool distinction | ✅ | ❌ Missing | P2 |
| Error toast notifications | ✅ | ❌ Missing | P2 |
| `AskUserQuestion` dialog | ✅ | ⚠️ Exists, not wired | P2 |
| Tool state transitions | ✅ | ✅ Implemented | Done |
| Verbose toggle | ✅ | ✅ Implemented | Done |
| Checkpoint/rewind | ✅ (Claude) | ❌ Missing | P3 |
| Status line | ✅ (Claude) | ❌ Missing | P3 |
| Subagent progress UI | ✅ | ❌ Missing | P3 |
| Permission prompts | ✅ | N/A - Not needed | N/A |

### Key Missing Wiring

1. **Claude tool events not streamed (P1):**
   - Streaming yields `message.delta`, not `tool.start`/`tool.complete`
   - Tool events only available through hooks
   - **Fix:** Enable `includePartialMessages: true` and emit tool events from stream

2. **`AskUserQuestion` not wired (P2):**
   - `UserQuestionDialog` exists at `src/ui/components/user-question-dialog.tsx`
   - `handleHumanInputRequired` callback exists but never invoked
   - **Note:** This is for ambiguity resolution, NOT tool permissions
   - **Fix:** Wire `AskUserQuestion` tool responses through `canUseTool` callback

3. **No error recovery UI (P2):**
   - Hooks silently continue with `{ continue: true }`
   - No toast notifications for errors
   - **Fix:** Add error toast system, subscribe to `session.error` events

---

## Implementation Plan

### Priority 1: Real-time Tool Streaming (P1)

**Goal:** Make tool calls visible during streaming, so users can see what the agent is doing in real-time.

**For Claude Client (claude-client.ts):**
```typescript
// Enable partial messages for real-time updates
const options = {
  includePartialMessages: true,
  // ...
};

// In streaming loop
for await (const msg of query({ prompt, options })) {
  if (msg.type === 'stream_event') {
    const event = msg.event;
    if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
      // Tool call starting - emit tool.start event
      this.emitEvent('tool.start', sessionId, {
        toolName: event.content_block.name,
        toolUseId: event.content_block.id,
      });
    }
    if (event.type === 'content_block_stop') {
      // Tool completed - emit tool.complete event
      this.emitEvent('tool.complete', sessionId, {
        toolUseId: event.content_block.id,
      });
    }
  }
}
```

**For OpenCode Client:** Already emits tool events via SSE - wire to TUI.

**For Copilot Client:** Wire `tool.execution_start` and `tool.execution_complete` events to TUI.

### Priority 2: Wire AskUserQuestion for Ambiguity Resolution (P2)

**Goal:** Allow agents to ask clarifying questions when requirements are ambiguous. This is NOT for tool permissions (which are auto-approved), but for user input when the agent needs clarification.

**For Claude Client (claude-client.ts):**
```typescript
// Wire AskUserQuestion tool through canUseTool callback
const options = {
  canUseTool: async (toolName, input, { signal }) => {
    if (toolName === 'AskUserQuestion') {
      // Emit event to show question dialog in TUI
      this.emitEvent('question.ask', sessionId, {
        questions: input.questions,
      });

      // Wait for user response
      const answers = await this.waitForUserAnswers(signal);

      // Return with filled answers
      return {
        behavior: 'allow',
        updatedInput: { ...input, answers },
      };
    }
    // All other tools auto-approved (no permission prompts)
    return { behavior: 'allow', updatedInput: input };
  },
};
```

**TUI Component:** Wire `UserQuestionDialog` (already exists at `src/ui/components/user-question-dialog.tsx`) to handle `question.ask` events.

### Priority 3: Add InlineTool/BlockTool Components (P2)

Create new components:
- `InlineTool`: Single-line display with status indicator
- `BlockTool`: Bordered box with expandable content

Classification:
```typescript
const INLINE_TOOLS = ["Glob", "Read", "Grep", "List", "WebFetch", "WebSearch"];
const BLOCK_TOOLS = ["Bash", "Write", "Edit", "Task", "TodoWrite", "AskUserQuestion"];
```

### Priority 4: Error Toast System (P2)

Add toast provider to ChatApp:
```typescript
interface Toast {
  id: string;
  variant: "error" | "warning" | "info" | "success";
  message: string;
  duration?: number;
}
```

Subscribe to error events:
```typescript
client.on("session.error", (event) => {
  showToast({ variant: "error", message: event.data.error });
});
```

### Priority 5: Subagent Progress UI (P3)

Display subagent tasks inline:
```typescript
client.on("subagent.start", (event) => {
  addSubagentCard(event.data.subagentId, event.data.subagentType);
});

client.on("subagent.complete", (event) => {
  completeSubagentCard(event.data.subagentId, event.data.success);
});
```

---

## Testing Results (2026-02-01)

### Test Setup

- **Test Project:** `/tmp/snake-game-test`
- **Files Created:** `package.json`, `snake.js` (incomplete implementation)
- **Agents Tested:** Claude (via atomic chat)

### Observations

1. **Tool Call Visibility:** Tool calls (Read, Glob, etc.) are NOT displayed in the UI during streaming. Only the final text response is shown. This confirms the gap identified in research.

2. **Streaming Response:** The UI shows "Generating... ∙∙●" animation but no indication of which tools are being used.

3. **Session Working Directory:** The chat session uses the directory from which it was launched, not the cwd flag. This caused initial confusion with file paths.

4. **No Permission Prompts (Expected):** No permission prompts shown - this is CORRECT behavior. Atomic CLI runs in no-permission mode (auto-approve all tool execution).

### Key Findings

| Aspect | Expected (Native CLI) | Actual (Atomic) | Status |
|--------|----------------------|-----------------|--------|
| Tool call display | Shows tool name + args inline | Not displayed | ❌ Gap |
| Tool progress | Status indicator during execution | None | ❌ Gap |
| Tool output | Collapsible result | Only in final response | ❌ Gap |
| Permission prompts | N/A (no-permission mode) | Not displayed | ✅ Correct |
| AskUserQuestion | Interactive dialog for clarification | Not wired | ❌ Gap |
| Error states | Visual error indicator | Only in text response | ❌ Gap |

### Recommendations

1. **P1 - Immediate:** Enable `includePartialMessages: true` and wire `tool.start`/`tool.complete` events to UI rendering
2. **P2 - Short-term:** Wire `AskUserQuestion` tool to `UserQuestionDialog` for ambiguity resolution (NOT for permissions)
3. **P2 - Medium-term:** Implement InlineTool/BlockTool distinction for better UX
4. **P2 - Medium-term:** Add error toast system
5. **P3 - Long-term:** Add subagent progress UI and checkpoint/rewind capability
