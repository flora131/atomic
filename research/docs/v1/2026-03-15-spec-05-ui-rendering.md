---
date: 2026-03-15 18:32:54 UTC
researcher: Claude Opus 4.6
git_commit: d3f22e2b5bf791dcc57580e001ac279c85390fce
branch: lavaman131/feature/code-cleanup
repository: code-cleanup
topic: "Spec 05: UI Rendering - Screens, components, message parts, OpenTUI"
tags: [spec, ui, components, rendering, opentui, message-parts, v2]
status: complete
last_updated: 2026-03-15
last_updated_by: Claude Opus 4.6
parent: 2026-03-15-atomic-v2-rebuild-spec-index.md
---

# Spec 05: UI Rendering

## Current State

### Overview (7,218 lines in components/ + 204 in screens/ + 840 in theme/ + 433 in hooks/)

**Entry Points**:
- `app.tsx` - TUI entry, sets up providers (theme, event bus)
- `cli.ts` - CLI entry, commander-based

**Screens** (`screens/`, 204 lines):
- `chat-screen.tsx` - The main (and only) screen

**Components** (`components/`, 7,218 lines):
- **Chat**: `chat-header.tsx`, `chat-message-bubble.tsx`, `chat-loading-indicator.tsx`
- **Input**: `autocomplete.tsx`, `user-question-dialog.tsx`, `hitl-response-widget.tsx`
- **Message Parts** (`message-parts/`, registry pattern):
  - `registry.tsx` - Part type → component mapping
  - `message-bubble-parts.tsx` - Container for all parts in a message
  - `text-part-display.tsx` - Text rendering
  - `tool-part-display.tsx` - Tool call rendering
  - `agent-part-display.tsx` - Subagent rendering
  - `reasoning-part-display.tsx` - Thinking/reasoning rendering
  - `task-list-part-display.tsx` - Task list rendering
  - `task-result-part-display.tsx` - Task result rendering
  - `skill-load-part-display.tsx` - Skill loading rendering
  - `compaction-part-display.tsx` - Compaction rendering
  - `mcp-snapshot-part-display.tsx` - MCP snapshot rendering
  - `workflow-step-part-display.tsx` - Workflow step rendering
  - `subagent-tool-summary.ts` - Subagent tool summary formatting
- **Tool Registry** (`tool-registry/`, nested):
  - `registry/catalog.ts` - Tool name → renderer mapping
  - `registry/aliases.ts` - Tool name aliases
  - `registry/types.ts` - Tool renderer types
  - `registry/renderers/` - Per-tool renderers (bash, read, write, edit, grep, glob, apply-patch, mcp, todo-write, task, ask-question, skill, default)
  - `registry/helpers/` - File path and language helpers
- **Transcript**: `transcript-view.tsx`, `transcript/` (formatters, helpers, types)
- **Model Selector**: `model-selector/views.tsx`, `model-selector/helpers.ts`, `model-selector-dialog.tsx`
- **Status**: `footer-status.tsx`, `queue-indicator.tsx`, `task-list-panel.tsx`, `task-list-indicator.tsx`, `skill-load-indicator.tsx`
- **Agents**: `parallel-agents-tree.tsx`
- **Other**: `animated-blink-indicator.tsx`, `error-exit-screen.tsx`, `mcp-server-list.tsx`, `timestamp-display.tsx`, `tool-result.tsx`, `tool-preview-truncation.ts`, `task-list-lifecycle.ts`, `task-order.ts`

**Hooks** (`hooks/`, 433 lines):
- `use-message-queue.ts` - Buffers messages for sequential processing
- `use-verbose-mode.ts` - Verbose mode toggle

**Theme** (`theme/`, 840 lines):
- `context.tsx` - Theme React context
- `index.tsx` - Theme provider with dark/light themes
- `banner/` - ASCII art banner

### Issues Documented

1. **Component Count**: 38+ component files across deeply nested directories. Many are small (~50-100 lines) but the directory structure is 4 levels deep (components/tool-registry/registry/renderers/).

2. **Dual Registry Pattern**: Both `message-parts/registry.tsx` (Part type → component) and `tool-registry/registry/catalog.ts` (tool name → renderer) exist as separate registries. Tool parts go through both.

3. **Transcript Complexity**: The transcript system has a view component, separate formatters, types, and helpers directory - significant complexity for rendering a list of messages.

4. **Controller Mediation**: Components don't subscribe to state directly. They go through the controller layer (2,178 lines in `state/chat/controller/`), adding indirection.

5. **No Virtual List**: Messages are rendered as a flat list. For long sessions, this causes performance issues.

6. **OpenTUI Dependency**: The TUI framework (`@opentui/core`, `@opentui/react`) handles terminal rendering, but its API constraints affect how components are structured.

---

## V2 Spec: UI Rendering

### Design Principle: Components Subscribe to State, Render Parts

Components read from the store (Spec 03) and render parts. No intermediate controllers.

### 1. Component Architecture

```
components/
├── app.tsx                        # App shell, provider setup
├── chat/
│   ├── chat-screen.tsx            # Main screen layout
│   ├── transcript.tsx             # Message list with virtual scrolling
│   ├── message.tsx                # Single message (user or assistant)
│   ├── input-bar.tsx              # Text input with autocomplete
│   └── footer.tsx                 # Status footer
├── parts/                         # Part renderers (flat directory)
│   ├── registry.ts                # Part type → component mapping
│   ├── text.tsx                   # Text part
│   ├── tool.tsx                   # Tool call part (unified)
│   ├── agent.tsx                  # Subagent part
│   ├── thinking.tsx               # Reasoning/thinking part
│   ├── task-list.tsx              # Task list part
│   ├── compaction.tsx             # Compaction notice part
│   └── workflow-step.tsx          # Workflow progress part
├── tools/                         # Tool-specific detail renderers
│   ├── registry.ts                # Tool name → renderer mapping
│   ├── bash.tsx
│   ├── file-op.tsx                # Read, Write, Edit (similar rendering)
│   ├── search.tsx                 # Grep, Glob (similar rendering)
│   └── default.tsx                # Fallback renderer
├── dialogs/
│   ├── permission-dialog.tsx      # Permission request
│   ├── human-input-dialog.tsx     # Human input request
│   ├── model-selector.tsx         # Model selection
│   └── mcp-overlay.tsx            # MCP server list
├── indicators/
│   ├── loading.tsx                # Streaming indicator
│   ├── agent-tree.tsx             # Parallel agents tree
│   └── queue.tsx                  # Message queue indicator
└── theme/
    ├── provider.tsx               # Theme context
    └── tokens.ts                  # Color/style tokens
```

**Target**: ~25 component files in flat directories (down from 38+ in nested dirs).

### 2. Part Registry (Unified)

Merge the two registries into one:

```typescript
// components/parts/registry.ts

type PartType = "text" | "tool" | "agent" | "thinking" | "task-list" | "compaction" | "workflow-step";

interface PartRenderer {
  component: React.FC<{ part: Part; verbose: boolean }>;
  /** For tool parts, resolve the tool-specific sub-renderer */
  toolRenderer?: (toolName: string) => React.FC<ToolPartProps>;
}

const PART_REGISTRY: Record<PartType, PartRenderer> = {
  text: { component: TextPart },
  tool: { component: ToolPart, toolRenderer: resolveToolRenderer },
  agent: { component: AgentPart },
  thinking: { component: ThinkingPart },
  "task-list": { component: TaskListPart },
  compaction: { component: CompactionPart },
  "workflow-step": { component: WorkflowStepPart },
};
```

Tool parts resolve their sub-renderer internally:

```typescript
// components/parts/tool.tsx

function ToolPart({ part, verbose }: { part: ToolPartData; verbose: boolean }) {
  const Renderer = resolveToolRenderer(part.toolName);
  return <Renderer part={part} verbose={verbose} />;
}
```

### 3. Transcript with Virtual Scrolling

```typescript
// components/chat/transcript.tsx

function Transcript() {
  const messageIds = useAppStore(state => state.messages.messageIds);
  const isStreaming = useAppStore(selectIsStreaming);

  return (
    <VirtualList
      items={messageIds}
      renderItem={(messageId) => <Message key={messageId} messageId={messageId} />}
      stickyBottom={isStreaming}
    />
  );
}
```

If OpenTUI doesn't support virtual lists natively, implement a windowed renderer:

```typescript
// components/chat/windowed-transcript.tsx

function WindowedTranscript() {
  const messageIds = useAppStore(state => state.messages.messageIds);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });

  // Only render messages in the visible window
  const visibleIds = messageIds.slice(visibleRange.start, visibleRange.end);

  return (
    <ScrollView onScroll={(offset) => updateVisibleRange(offset, messageIds.length, setVisibleRange)}>
      {visibleIds.map(id => <Message key={id} messageId={id} />)}
    </ScrollView>
  );
}
```

### 4. Message Component

```typescript
// components/chat/message.tsx

function Message({ messageId }: { messageId: string }) {
  const message = useAppStore(state => state.messages.messages.get(messageId));
  const parts = useAppStore(state => state.messages.parts.get(messageId) ?? []);
  const verbose = useAppStore(state => state.ui.verboseMode);

  if (!message) return null;

  return (
    <Box flexDirection="column">
      <MessageHeader role={message.role} timestamp={message.timestamp} />
      {parts.map((part, i) => {
        const Renderer = PART_REGISTRY[part.type]?.component;
        return Renderer ? <Renderer key={i} part={part} verbose={verbose} /> : null;
      })}
    </Box>
  );
}
```

### 5. Direct State Subscription

Components subscribe to the zustand store directly, eliminating the controller layer:

```typescript
// Direct subscription - no controller needed
function Footer() {
  const footer = useAppStore(selectFooterState);
  return (
    <Box>
      <Text>{footer.modelId}</Text>
      {footer.isStreaming && <LoadingIndicator />}
      {footer.queuedCount > 0 && <Text>({footer.queuedCount} queued)</Text>}
    </Box>
  );
}

function AgentTree() {
  const agents = useAppStore(selectActiveAgents);
  return (
    <Box flexDirection="column">
      {agents.map(agent => (
        <AgentRow key={agent.id} agent={agent} />
      ))}
    </Box>
  );
}
```

### 6. Theme

Simplify to a token-based system:

```typescript
// components/theme/tokens.ts

interface ThemeTokens {
  colors: {
    primary: string;
    secondary: string;
    error: string;
    warning: string;
    success: string;
    text: string;
    textMuted: string;
    background: string;
    border: string;
  };
  syntax: {
    keyword: string;
    string: string;
    comment: string;
    function: string;
  };
}

const darkTheme: ThemeTokens = { /* ... */ };
const lightTheme: ThemeTokens = { /* ... */ };
```

### 7. Input Bar

```typescript
// components/chat/input-bar.tsx

function InputBar() {
  const [text, setText] = useState("");
  const isStreaming = useAppStore(selectIsStreaming);
  const sendMessage = useAppStore(state => state.actions.sendMessage);

  const handleSubmit = () => {
    if (!text.trim() || isStreaming) return;
    sendMessage(text);
    setText("");
  };

  return (
    <Box>
      <TextInput
        value={text}
        onChange={setText}
        onSubmit={handleSubmit}
        placeholder={isStreaming ? "Streaming..." : "Type a message..."}
      />
    </Box>
  );
}
```

Autocomplete for @mentions and /commands is handled as a local component concern, not global state.

### 8. Dialog System

Dialogs (permission, human input, model selector) are driven by store state:

```typescript
// In app.tsx or chat-screen.tsx
function ChatScreen() {
  const pendingPermission = useAppStore(state => state.ui.pendingPermission);
  const pendingInput = useAppStore(state => state.ui.pendingHumanInput);

  return (
    <Box flexDirection="column" height="100%">
      <Transcript />
      {pendingPermission && <PermissionDialog request={pendingPermission} />}
      {pendingInput && <HumanInputDialog request={pendingInput} />}
      <InputBar />
      <Footer />
    </Box>
  );
}
```

### 9. Tool Renderer Consolidation

Current: 13 separate tool renderer files. Many are similar (Read, Write, Edit all show file paths and content).

Spec: Group similar tools:

| Current Files                              | V2 File            | Covers                |
| ------------------------------------------ | ------------------ | --------------------- |
| read.ts, write.ts, edit.ts, apply-patch.ts | file-op.tsx        | All file operations   |
| grep.ts, glob.ts                           | search.tsx         | All search operations |
| bash.ts                                    | bash.tsx           | Shell commands        |
| task.ts, todo-write.ts                     | task.tsx           | Task-related tools    |
| ask-question.ts                            | (inline in dialog) | User interaction      |
| mcp.ts                                     | mcp.tsx            | MCP tools             |
| skill.ts                                   | (inline in parts)  | Skill loading         |
| default.ts                                 | default.tsx        | Fallback              |

**Target**: ~6 tool renderers (down from 13).

## Code References (Current)

- `src/app.tsx` - TUI entry
- `src/screens/chat-screen.tsx` - Main screen (204 lines)
- `src/components/transcript-view.tsx` - Transcript rendering
- `src/components/chat-message-bubble.tsx` - Message bubble
- `src/components/message-parts/registry.tsx` - Part registry
- `src/components/tool-registry/registry/catalog.ts` - Tool registry
- `src/components/tool-registry/registry/renderers/` - 13 tool renderers
- `src/components/parallel-agents-tree.tsx` - Agent tree
- `src/components/footer-status.tsx` - Footer
- `src/hooks/use-message-queue.ts` - Message queue hook
- `src/hooks/use-verbose-mode.ts` - Verbose mode hook
- `src/theme/context.tsx` - Theme context
- `src/state/chat/controller/` - Controller bridge (2,178 lines)

## Related Research

- `research/docs/2026-02-16-chat-system-design-ui-research.md`
- `research/docs/2026-02-16-opentui-rendering-architecture.md`
- `research/docs/2026-02-16-opencode-message-rendering-patterns.md`
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md`
- `research/docs/2026-02-15-ui-inline-streaming-vs-pinned-elements.md`
- `research/docs/2026-02-17-message-truncation-dual-view-system.md`
- `research/docs/2026-02-27-workflow-tui-rendering-unification.md`
- `research/docs/2026-02-28-workflow-tui-rendering-unification-refactor.md`
