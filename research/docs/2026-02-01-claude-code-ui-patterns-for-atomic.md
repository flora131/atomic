---
date: 2026-02-01 01:44:39 UTC
researcher: Claude Code Research Agent
git_commit: dfafc428ec23bfe8416c387010a869bb26b3bd32
branch: lavaman131/feature/tui
repository: atomic
topic: "Claude Code CLI UI Patterns for Atomic TUI Enhancement"
tags: [research, tui, ui-patterns, message-queuing, autocomplete, timing-display, collapsible-outputs, opentui]
status: complete
last_updated: 2026-02-01
last_updated_by: Claude Code Research Agent
---

# Research: Claude Code CLI UI Patterns for Atomic TUI Enhancement

## Research Question

How can Atomic's terminal chat UI be enhanced to match Claude Code CLI's user experience, specifically focusing on:
1. Message queuing support (sending messages while another request processes)
2. Slash command autocomplete patterns
3. Execution timing display
4. Collapsible tool call outputs
5. Leveraging OpenTUI pre-built components

## Summary

This research documents the UI/UX patterns observed in Claude Code CLI and maps them to Atomic's existing TUI implementation. The goal is to identify specific enhancements that can be made using OpenTUI components while preserving Atomic's current feature set.

### Key Findings

1. **Message Queuing**: Claude Code allows users to type and queue messages while the assistant is "thinking" - input is not blocked during streaming
2. **Collapsible Tool Outputs**: Tool calls are collapsed by default with "(ctrl+o to expand)" hint
3. **Timing Display**: Messages show timestamps and the model name in verbose mode
4. **Autocomplete**: Two-column layout showing command name and description with keyboard navigation
5. **Spinner Customization**: Varied spinner verbs ("Marinating...", "Jitterbugging...") provide visual feedback

---

## Detailed Findings

### 1. Claude Code CLI UI Observations (Live Session)

**Source**: Interactive observation via tmux session with `claude-yolo`

#### Header Component
```
 ▐▛███▜▌   Claude Code v2.1.29
▝▜█████▛▘  Opus 4.5 · Claude Max
  ▘▘ ▝▝    ~/Documents/projects/atomic
```
- Block letter logo with gradient styling
- Version, model name, tier (subscription level)
- Working directory

#### Input Box Pattern
```
──────────────────────────────────────────────────────────────────────────────────────────────
❯ [input text here]
──────────────────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle)
```
- Horizontal divider lines above and below
- Prompt character: `❯`
- Footer showing current permission mode with toggle hint

#### Slash Command Autocomplete
```
❯ /
──────────────────────────────────────────────────────────────────────────────────────────────
  /commit                    Create well-formatted commits with conventional commit format.
  /research-codebase         Document codebase as-is with research directory...
  /frontend-design           Create distinctive, production-grade frontend interfaces...
```
- Appears immediately when `/` is typed
- Two-column layout: command name (fixed width) + description
- Keyboard navigation: Up/Down arrows
- Tab to complete, Enter to execute
- Escape to dismiss

#### Tool Call Display (Collapsed vs Expanded)

**Collapsed (Default)**:
```
● Read 1 file (ctrl+o to expand)
```

**Expanded (Ctrl+O pressed)**:
```
● Read(package.json)
  ⎿  Read 5 lines

● Here are the first 5 lines of package.json:                     01:58 AM  claude-opus-4-5-20251101
```
- Tool name with arguments shown
- Output summary with connector line (`⎿`)
- Timestamp and model name aligned right
- Shows "Showing detailed transcript · ctrl+o to toggle · ctrl+e to show all"

#### Thinking Display
```
∴ Thinking…

  The user asked for the first 5 lines of package.json...
```
- Symbol `∴` (therefore) for reasoning indicator
- Italic/dimmed text for internal reasoning
- Only visible in verbose mode

#### Spinner/Loading Patterns
```
* Marinating… (thinking)
* Jitterbugging… (thinking)
```
- Customizable spinner verbs (configured via settings)
- Parenthetical indicator "(thinking)"

#### Message History Navigation
```
───────────────────────────────────────── ctrl+e to show 8 previous messages ─────────────────
```
- Hidden messages indicator with keyboard shortcut

---

### 2. Atomic's Current UI Implementation

**Source**: Analysis of `src/ui/chat.tsx` and related components

#### Current Features (Already Implemented)

| Feature | File | Status |
|---------|------|--------|
| Block letter logo with gradient | `src/ui/chat.tsx:48-67` | ✅ Complete |
| Message bubble rendering | `src/ui/chat.tsx:453-543` | ✅ Complete |
| Loading indicator (wave dots) | `src/ui/chat.tsx:321-380` | ✅ Complete |
| Slash command autocomplete | `src/ui/components/autocomplete.tsx` | ✅ Complete |
| Tool result component | `src/ui/components/tool-result.tsx` | ✅ Complete |
| Workflow status bar | `src/ui/components/workflow-status-bar.tsx` | ✅ Complete |
| Streaming state hook | `src/ui/hooks/use-streaming-state.ts` | ✅ Complete |
| User question dialog | `src/ui/components/user-question-dialog.tsx` | ✅ Complete |

#### Current Gaps (Need Enhancement)

| Feature | Current State | Claude Code Behavior |
|---------|---------------|---------------------|
| Message queuing | Input blocked during streaming (`isStreaming` flag) | Input available during processing |
| Tool output collapse | Collapsible but not default-collapsed | Default collapsed with expand hint |
| Timing display | Timestamps in messages but not visible | Shows timestamp + model in verbose mode |
| Verbose mode toggle | Not implemented | Ctrl+O toggle for expanded transcript |
| Spinner verbs | Fixed "Loading..." | Customizable verbs ("Marinating...", etc.) |
| Permission mode display | Not shown in footer | Shows mode with Shift+Tab hint |

---

### 3. OpenTUI Components Available for Reuse

**Source**: DeepWiki analysis of `anomalyco/opencode`

#### TUI Core Components

| Component | Location | Purpose | Reusable for Atomic? |
|-----------|----------|---------|---------------------|
| `scrollbox` | `@opentui/core` | Viewport with sticky scroll | ✅ Already using |
| `TextareaRenderable` | `@opentui/core` | Multi-line input with extmarks | ✅ Already using |
| `Prompt` | `packages/opencode/src/cli/cmd/tui/component/prompt/` | User input with autocomplete | ⚠️ Custom implementation exists |
| `Autocomplete` | `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` | Suggestions with frecency | ✅ Pattern can be adopted |
| `DialogSelect` | `packages/opencode/src/cli/cmd/tui/ui/dialog-select.tsx` | Filterable list selection | ✅ Could enhance UserQuestionDialog |
| `Toast` | `packages/opencode/src/cli/cmd/tui/ui/toast.tsx` | Temporary notifications | ✅ New component opportunity |

#### Key Patterns from OpenTUI

1. **AsyncQueue for Request Management**
   ```typescript
   // From packages/opencode/src/util/queue.ts
   class AsyncQueue<T> {
     push(item: T) { /* resolve waiting consumer or queue */ }
     next(): Promise<T> { /* return from queue or wait */ }
   }
   ```

2. **Event Batching for Performance**
   ```typescript
   // Batch events within 16ms to reduce re-renders
   function handleEvent(event) {
     queue.push(event);
     if (Date.now() - lastFlush < 16) {
       timer = setTimeout(flush, 16);
     } else {
       flush();
     }
   }
   ```

3. **Duration Formatting**
   ```typescript
   // From packages/opencode/src/util/locale.ts
   function duration(ms: number): string {
     if (ms < 1000) return `${ms}ms`;
     if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
     // etc.
   }
   ```

---

### 4. Message Queuing Implementation Strategy

**Current Atomic Behavior** (`src/ui/chat.tsx:1085-1087`):
```typescript
const handleSubmit = useCallback(() => {
  const trimmedValue = value.trim();
  if (!trimmedValue || isStreaming) {  // ❌ Blocks input during streaming
    return;
  }
  // ...
});
```

**Claude Code Behavior**:
- Users can type while assistant is responding
- Messages are queued and sent after current response completes
- Input remains focused and functional

**Recommended Approach**:

1. **Remove `isStreaming` block from submit handler**
2. **Add message queue state**:
   ```typescript
   interface QueuedMessage {
     id: string;
     content: string;
     timestamp: string;
   }
   const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
   ```

3. **Process queue on stream completion**:
   ```typescript
   const handleComplete = () => {
     // ... existing completion logic ...

     // Check for queued messages
     if (messageQueue.length > 0) {
       const nextMessage = messageQueue[0];
       setMessageQueue(prev => prev.slice(1));
       // Process next message
       handleSendMessage(nextMessage.content);
     }
   };
   ```

4. **Visual indicator for queued messages**:
   ```
   ● Queued: "what about package-lock.json"
   ```

---

### 5. Collapsible Tool Output Enhancement

**Current Implementation** (`src/ui/components/tool-result.tsx`):
- Has `CollapsibleContent` component
- Uses `maxCollapsedLines` prop (default: 10)
- Expand/collapse toggle exists

**Claude Code Pattern**:
```
● Read 2 files (ctrl+o to expand)
```

**Recommended Enhancements**:

1. **Summary Line for Collapsed State**:
   ```typescript
   function getToolSummary(toolName: string, input: Record<string, unknown>, output: unknown): string {
     switch (toolName) {
       case 'Read':
         return `Read ${countFilesRead(output)} file${plural}`;
       case 'Bash':
         return `Ran command`;
       // etc.
     }
   }
   ```

2. **Verbose Mode Toggle** (Ctrl+O):
   ```typescript
   const [verboseMode, setVerboseMode] = useState(false);

   // In useKeyboard handler:
   if (event.ctrl && event.name === 'o') {
     setVerboseMode(prev => !prev);
   }
   ```

3. **Default Collapsed with Hint**:
   ```typescript
   <ToolResult
     collapsed={!verboseMode}
     collapsedHint="(ctrl+o to expand)"
   />
   ```

---

### 6. Timing Display Implementation

**Claude Code Shows**:
```
● Here are the first 5 lines:                          01:58 AM  claude-opus-4-5-20251101
```

**Current Atomic State**:
- `ChatMessage.timestamp` exists but not displayed
- Model name available in header but not per-message

**Recommended Implementation**:

1. **Add to MessageBubble** (verbose mode only):
   ```typescript
   {verboseMode && (
     <box flexDirection="row" justifyContent="flex-end">
       <text style={{ fg: theme.colors.muted }}>
         {formatTimestamp(message.timestamp)}  {model}
       </text>
     </box>
   )}
   ```

2. **Duration Tracking**:
   ```typescript
   interface ChatMessage {
     // ... existing fields ...
     durationMs?: number;  // Time from send to complete
   }
   ```

3. **Format Function** (based on OpenTUI pattern):
   ```typescript
   function formatDuration(ms: number): string {
     if (ms < 1000) return `${ms}ms`;
     if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
     const min = Math.floor(ms / 60000);
     const sec = Math.round((ms % 60000) / 1000);
     return `${min}m ${sec}s`;
   }
   ```

---

### 7. Spinner Verb Customization

**Claude Code Pattern**:
```
* Marinating… (thinking)
* Jitterbugging… (thinking)
```

**Current Atomic** (`src/ui/chat.tsx:321-380`):
- Wave animation with dots
- No text spinner verbs

**Recommended Enhancement**:

1. **Spinner Verb Configuration**:
   ```typescript
   const SPINNER_VERBS = [
     "Thinking",
     "Analyzing",
     "Processing",
     "Computing",
     "Reasoning",
   ];

   function getRandomVerb(): string {
     return SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)];
   }
   ```

2. **Update Loading Indicator**:
   ```typescript
   function LoadingIndicator({ speed = 120, showVerb = true }: LoadingIndicatorProps) {
     const [verb] = useState(getRandomVerb);

     return (
       <text>
         <LoadingDots speed={speed} />
         {showVerb && <span style={{ fg: MUTED_LAVENDER }}> {verb}…</span>}
       </text>
     );
   }
   ```

---

### 8. Footer Status Line

**Claude Code Pattern**:
```
  ⏵⏵ bypass permissions on (shift+tab to cycle)
```

**Recommended Implementation**:

```typescript
interface FooterStatusProps {
  permissionMode: 'default' | 'auto-edit' | 'plan';
  isStreaming: boolean;
  queuedCount: number;
}

function FooterStatus({ permissionMode, isStreaming, queuedCount }: FooterStatusProps) {
  const modeIcons = {
    'default': '▶',
    'auto-edit': '⏵⏵',
    'plan': '📝',
  };

  return (
    <box flexDirection="row" gap={2}>
      <text style={{ fg: theme.colors.muted }}>
        {modeIcons[permissionMode]} {permissionMode} mode (shift+tab to cycle)
      </text>
      {queuedCount > 0 && (
        <text style={{ fg: theme.colors.accent }}>
          ({queuedCount} queued)
        </text>
      )}
    </box>
  );
}
```

---

## Code References

### Atomic Files to Modify

| File | Line | Change |
|------|------|--------|
| `src/ui/chat.tsx` | 1085-1087 | Remove `isStreaming` block for queuing |
| `src/ui/chat.tsx` | 321-380 | Enhance LoadingIndicator with verbs |
| `src/ui/chat.tsx` | 453-543 | Add verbose mode timestamp/model display |
| `src/ui/components/tool-result.tsx` | 198-298 | Add collapsed summary and hint |
| `src/ui/hooks/use-streaming-state.ts` | 54-64 | Add message queue state |

### New Components Needed

| Component | Purpose |
|-----------|---------|
| `FooterStatus` | Permission mode and queue indicator |
| `TimestampDisplay` | Right-aligned timestamp + model |
| `ToolSummary` | Collapsed tool output summary |

---

## Architecture Documentation

### Current Atomic UI Architecture

```
ChatApp
├── AtomicHeader (logo, version, model)
├── WorkflowStatusBar (when workflow active)
├── scrollbox
│   ├── MessageBubble[] (user, assistant, system)
│   │   └── ToolResult[] (for assistant messages with tool calls)
│   ├── Input Box (textarea with prompt char)
│   └── Autocomplete (when / typed)
└── UserQuestionDialog (HITL overlay)
```

### Proposed Enhanced Architecture

```
ChatApp
├── AtomicHeader (logo, version, model)
├── WorkflowStatusBar (when workflow active)
├── scrollbox
│   ├── MessageBubble[]
│   │   ├── ToolResult[] (collapsed by default)
│   │   └── TimestampDisplay (verbose mode)
│   ├── QueuedMessageIndicator[] (when messages queued)
│   ├── Input Box
│   └── Autocomplete
├── FooterStatus (permission mode, queue count)
└── UserQuestionDialog
```

---

## Historical Context (from research/)

No prior research documents found on this specific topic.

---

## Related Research

- OpenTUI documentation: https://deepwiki.com/wiki/anomalyco/opencode#4.2
- Claude Code features: https://code.claude.com/docs/en/features-overview
- Claude Agent SDK: https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview

---

## Open Questions

1. **Queue Size Limit**: Should there be a maximum number of queued messages?
2. **Queue Persistence**: Should queued messages survive session restart?
3. **Verbose Mode Default**: Should verbose mode be on by default or off?
4. **Spinner Verb Config**: Should spinner verbs be user-configurable?
5. **Permission Modes**: Does Atomic need permission mode cycling like Claude Code?

---

## Implementation Priority

Based on user request and complexity:

| Priority | Feature | Complexity | Impact |
|----------|---------|------------|--------|
| 1 | Message queuing | Medium | High |
| 2 | Collapsible tool outputs (default collapsed) | Low | Medium |
| 3 | Verbose mode toggle (Ctrl+O) | Medium | Medium |
| 4 | Timing display | Low | Low |
| 5 | Spinner verb customization | Low | Low |
| 6 | Footer status line | Low | Low |
