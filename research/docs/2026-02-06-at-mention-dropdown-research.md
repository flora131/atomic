---
date: 2026-02-06 09:35:00 UTC
researcher: Claude Opus 4.6
git_commit: 196037794048ec119e4a32812db944fee949717c
branch: lavaman131/feature/tui
repository: atomic
topic: "How do Claude Code and OpenCode implement the @ mention dropdown for sub-agent invocation and file context loading?"
tags: [research, codebase, ui, at-mention, autocomplete, dropdown, opentui, opencode, claude-code, agents, file-context, extmarks, solidjs, ink, react]
status: complete
last_updated: 2026-02-06
last_updated_by: Claude Opus 4.6
---

# Research: `@` Mention Dropdown for Sub-Agent Invocation and File Context Loading

## Research Question

How does Claude Code's TUI implement the `@` mention dropdown for sub-agent invocation and file context loading, and how does OpenCode (via OpenTUI) implement similar functionality? What are the UI interaction patterns, rendering approaches, state management, and architectural differences?

## Summary

Both Claude Code and OpenCode implement `@` mention dropdowns that combine file path autocompletion with agent invocation in a unified interface. Claude Code uses React/Ink (a custom `@bcherny/ink` fork with differential rendering), while OpenCode uses SolidJS on top of OpenTUI (a Zig-backed TUI framework). The core UX pattern is identical: typing `@` triggers a fuzzy-filtered dropdown showing files, directories, and agents. Selection inserts the reference into the input. The key architectural difference is that OpenCode uses an **extmark system** (virtual styled ranges in the textarea that the cursor jumps over) to make `@` mentions behave as atomic "pills," while Claude Code inserts plain text references (potentially quoted for agent names with spaces).

The Atomic TUI codebase has **no existing `@` mention implementation** but has a mature **slash command (`/`) autocomplete system** (`src/ui/components/autocomplete.tsx`, `src/ui/chat.tsx:1418-1990`) that provides the complete architectural pattern for input detection, dropdown rendering, keyboard navigation, and command registry search.

## Detailed Findings

### 1. Claude Code `@` Mention Implementation

#### 1.1 Trigger Mechanism

The `@` character is one of three "quick command" prefixes in Claude Code:

| Prefix | Trigger Position | Purpose |
|--------|-----------------|---------|
| `/` | Start of input (v2.1.0: anywhere) | Slash commands and skills |
| `!` | Start of input | Bash mode |
| `@` | Anywhere in input | File path and agent autocomplete |

When `@` is typed, the TUI detects it and presents an autocomplete dropdown. Characters typed after `@` serve as a fuzzy filter query. The trigger respects context: it does not fire in bash mode (`!` prefix) as of v2.1.14.

#### 1.2 Dropdown Categories and Visual Indicators

Two item categories appear in the dropdown, each with a distinct prefix icon:

| Icon | Category | Example |
|------|----------|---------|
| `+` | File or directory | `+ src/cli.ts`, `+ src/` |
| `*` | Agent (subagent) | `* debugger (agent) – Debugging specialist for errors...` |

Agent entries display: agent name, literal `(agent)` label, em-dash separator, and truncated description.

As of v2.1.6, type-specific icons were added and items were changed to single-line formatting.

#### 1.3 Observed Behavior (Live tmux Capture)

**Initial dropdown (`@` alone)** -- shows files/directories from project root:
```
❯ @
  + install.ps1
  + .gitignore
  + oxlint.json
  + src/
  + .opencode/
  + prompt.txt
```

**Filtered dropdown (`@debugger`)** -- mixed files and agents:
```
❯ @debugger
  + .claude/agents/debugger.md
  * debugger (agent) – Debugging specialist for errors, test failures, and unexpec…
  + .github/agents/debugger.md
  + .opencode/agents/debugger.md
  + tests/e2e/subagent-debugger.test.ts
```

**Agent-heavy filter (`@a`):**
```
❯ @a
  + assets/
  * Bash (agent) – Command execution specialist for running bash commands. Use…
  * Plan (agent) – Software architect agent for designing implementation plans…
  * claude-code-guide (agent) – Use this agent when the user asks questions ("Can Claude...…
  * statusline-setup (agent) – Use this agent to configure the user's Claude Code status l…
  * codebase-analyzer (agent) – Analyzes codebase implementation details. Call the codebase…
```

**Directory navigation (`@src/`):**
```
❯ @src/
  + src/
  + src/ui/
  + src/sdk/
  + src/graph/
  + src/cli.ts
  + src/utils/
```

**Absolute path (`@/`)** -- switches to filesystem root:
```
❯ @/
  /bin.usr-is-merged/
  /boot/
  /cdrom/
  /dev/
  /etc/
  /home/
```

#### 1.4 Keyboard Navigation

| Key | Action |
|-----|--------|
| `@` | Trigger autocomplete dropdown |
| Characters after `@` | Fuzzy-filter results in real-time |
| Up/Down arrows | Navigate selection (circular wrapping) |
| Tab | Select item; drills into directories instead of selecting them |
| Enter | Select item (may also submit the message) |
| Escape | Dismiss dropdown, keep typed text |
| Backspace | Update filter live (remove last character) |
| Space after `@` | Dismisses dropdown |

#### 1.5 Selection Behavior

**File selection (Tab):** Replaces `@filter` with `@path/to/file.ts` and closes dropdown.

**Directory selection (Tab):** Appends `/` and keeps dropdown open showing directory contents. A second Tab selects the first sub-item.

**Agent selection (Tab):** Inserts `@"agent-name (agent)"` with quotes because agent labels contain spaces and parentheses.

**Multiple mentions:** Multiple `@` references can be chained in one prompt. Each `@` triggers an independent dropdown: `@src/cli.ts and @package.json`.

**Mid-sentence mentions:** `@` triggers work at any cursor position: `look at @src/cli.ts`.

#### 1.6 Dropdown Layout

- Renders **below the input field**, replacing the status bar area
- Fixed **6-item viewport** with circular scrolling
- Selected item highlighted with color (ANSI styling, invisible in plain captures)
- As of v2.1.10, selected files are shown as **removable attachments** rather than raw text

#### 1.7 Tech Stack

| Technology | Role |
|-----------|------|
| TypeScript | Primary language |
| React | Component model and state management |
| `@bcherny/ink` | Custom Ink fork with differential terminal rendering |
| Yoga | Flexbox layout engine for terminal |
| Bun | Build tool and runtime |
| Native Rust fuzzy finder | Fast file path matching (v2.0.35+) |
| Vendored ripgrep | File search |
| Tree-sitter WASM | Code structure understanding |

The custom Ink fork replaced the original clear-and-redraw renderer with a differential rendering approach (~5ms per frame budget) that diffs screen buffers and emits only changed ANSI sequences.

#### 1.8 Feature Evolution Timeline

| Version | Change |
|---------|--------|
| v0.2.75+ | Initial `@` mention support for files |
| v1.0.30 | Improved filename matching |
| v1.0.53 | File truncation limit: 100 → 2000 lines |
| v1.0.62 | `@` mention support for custom agents with typeahead |
| v2.0.35 | Native Rust-based fuzzy finder |
| v2.0.62 | Support for files with spaces in paths |
| v2.0.71 | Fixed incorrect trigger when cursor is mid-path |
| v2.1.6 | Type-specific icons, single-line formatting |
| v2.1.10 | Files shown as removable attachments |
| v2.1.14 | Fixed `@` incorrectly triggering in bash mode |

---

### 2. OpenCode `@` Mention Implementation

#### 2.1 Repository Landscape

| Repository | Framework | Status |
|-----------|-----------|--------|
| `sst/opentui` | TypeScript + Zig core | Active TUI framework |
| `sst/opencode` | TypeScript + SolidJS + OpenTUI | Active application |
| `opencode-ai/opencode` | Go + Bubble Tea | Legacy (archived) |

OpenTUI is a general-purpose TUI framework providing primitives (`Textarea`, `Box`, `ScrollBox`, `Text`, `Select`, `ExtmarksController`). It does **not** provide an `@` mention autocomplete widget. OpenCode builds the entire `@` mention system as application-level code on top of OpenTUI primitives using SolidJS reactivity.

#### 2.2 Core File Map

| File | Purpose |
|------|---------|
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | Prompt component: wires textarea, extmarks, and autocomplete together |
| `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` | ~560 lines: trigger detection, filtering, dropdown rendering, selection, `insertPart` |
| `packages/opencode/src/cli/cmd/tui/component/prompt/history.tsx` | `PromptInfo` type definition, prompt history persistence |
| `packages/opencode/src/cli/cmd/tui/component/prompt/frecency.tsx` | Frecency scoring for file ranking |
| `packages/opencode/src/cli/cmd/tui/context/theme.tsx` | Extmark styling: `extmark.file`, `extmark.agent`, `extmark.paste` |

#### 2.3 Trigger Detection: Dual-Path System

OpenCode uses **two detection paths** for robustness:

**Path 1: `onKeyDown` -- immediate trigger on `@` keypress:**

```typescript
if (e.name === "@") {
  const cursorOffset = props.input().cursorOffset
  const charBeforeCursor =
    cursorOffset === 0 ? undefined : props.input().getTextRange(cursorOffset - 1, cursorOffset)
  const canTrigger =
    charBeforeCursor === undefined ||
    charBeforeCursor === "" ||
    /\s/.test(charBeforeCursor)
  if (canTrigger) show("@")
}
```

The `canTrigger` guard ensures `@` only triggers when:
- At the beginning of input (`cursorOffset === 0`)
- The character before the cursor is whitespace

This prevents false triggers mid-word (e.g., `user@example.com`).

**Path 2: `onInput` -- re-detection after text changes (handles backspace, paste):**

```typescript
onInput(value) {
  if (store.visible) {
    if (
      props.input().cursorOffset <= store.index ||
      props.input().getTextRange(store.index, props.input().cursorOffset).match(/\s/) ||
      (store.visible === "/" && value.match(/^\S+\s+\S+\s*$/))
    ) {
      hide()
    }
    return
  }
  const text = value.slice(0, offset)
  const idx = text.lastIndexOf("@")
  if (idx === -1) return
  const between = text.slice(idx)
  const before = idx === 0 ? undefined : value[idx - 1]
  if ((before === undefined || /\s/.test(before)) && !between.match(/\s/)) {
    show("@")
    setStore("index", idx)
  }
}
```

This `lastIndexOf("@")` approach handles edge cases where backspace re-exposes a prior `@` trigger.

#### 2.4 State Management

```typescript
const [store, setStore] = createStore({
  index: 0,         // character offset of the "@" trigger in the textarea
  selected: 0,      // currently highlighted option index
  visible: false as false | "@" | "/",
  input: "keyboard" as "keyboard" | "mouse",
})
```

The `index` field is critical: it stores where the `@` sits in the textarea, used to extract the filter text, know where to replace on selection, and detect when the cursor has moved before the trigger (dismissing autocomplete).

Additional reactive signals:
- **`filter`** (createMemo): extracts search query between `@` and cursor
- **`search`** (createSignal): stabilized copy of `filter` that updates after rendering settles
- **`position`** (createMemo): calculates dropdown x/y/width from anchor element
- **`options`** (createMemo): combined and fuzzy-filtered list of all options

#### 2.5 Dropdown Population: Three Sources

**Agents** (synchronous memo from sync state):
```typescript
const agents = createMemo(() => {
  return sync.data.agent
    .filter((agent) => !agent.hidden && agent.mode !== "primary")
    .map((agent): AutocompleteOption => ({
      display: "@" + agent.name,
      onSelect: () => insertPart(agent.name, { type: "agent", name: agent.name, ... }),
    }))
})
```

**Files** (async resource via SDK):
```typescript
const [files] = createResource(
  () => search(),
  async (query) => {
    const result = await sdk.client.find.files({ query: baseQuery })
    return result.data.sort((a, b) => {
      // Sort: frecency desc → directory depth asc → alphabetical
    })
  }
)
```

Files support line range syntax: `@file.ts#10-20`.

**MCP Resources** (synchronous memo):
```typescript
const mcpResources = createMemo(() => {
  return Object.values(sync.data.mcp_resource).map(res => ({
    display: `${res.name} (${res.uri})`,
    onSelect: () => insertPart(res.name, { type: "file", url: res.uri, ... }),
  }))
})
```

Combined options: when `@` is active, agents first, then files, then MCP resources. When `/` is active, only commands.

#### 2.6 Fuzzy Filtering with Frecency

Uses the `fuzzysort` library with a custom scoring function:

```typescript
const result = fuzzysort.go(searchValue, mixed, {
  keys: [
    (obj) => (obj.value ?? obj.display).trimEnd(),
    "description",
    (obj) => obj.aliases?.join(" ") ?? "",
  ],
  limit: 10,
  scoreFn: (objResults) => {
    let score = objResults.score
    if (displayResult.target.startsWith(store.visible + searchValue)) {
      score *= 2  // boost exact prefix matches
    }
    const frecencyScore = objResults.obj.path ? frecency.getFrecency(objResults.obj.path) : 0
    return score * (1 + frecencyScore)  // frecency multiplier
  },
})
```

Frecency formula: `frequency * (1 / (1 + daysSince))` -- recently accessed files decay less. Stored in `frecency.jsonl` (max 1000 entries).

#### 2.7 Selection: The `insertPart` Function

This is the core function that modifies the textarea when an option is selected:

```typescript
function insertPart(text: string, part: PromptInfo["parts"][number]) {
  const input = props.input()
  const append = "@" + text + (needsSpace ? " " : "")

  // 1. Delete from @ trigger to current cursor
  input.deleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)

  // 2. Insert formatted text
  input.insertText(append)

  // 3. Create virtual extmark for visual highlighting
  const extmarkId = input.extmarks.create({
    start: extmarkStart,
    end: extmarkEnd,
    virtual: true,       // cursor jumps over this range atomically
    styleId,             // colored background (file vs agent)
    typeId: props.promptPartTypeId(),
  })

  // 4. Store structured part data
  props.setPrompt((draft) => {
    draft.parts.push(part)
    props.setExtmark(partIndex, extmarkId)
  })

  // 5. Update frecency for files
  if (part.type === "file") frecency.updateFrecency(part.source.path)
}
```

The `virtual: true` property means the cursor **cannot be placed inside** the mention text. If the user arrows left, the cursor jumps over the entire `@filename` block. Backspace at the right edge deletes the entire mention.

#### 2.8 Extmark System (OpenTUI Core)

**Source**: `packages/core/src/lib/extmarks.ts`

Extmarks are range markers attached to the text buffer:

```typescript
interface Extmark {
  id: number;
  start: number;       // display-width offset
  end: number;         // display-width offset
  virtual: boolean;    // cursor jumps over this range
  styleId?: number;    // reference to a registered style
  data?: any;
  typeId: number;      // registered type (e.g., "prompt-part")
}
```

Key methods:
- `create(options)` -- creates an extmark
- `delete(id)` -- removes an extmark
- `adjustExtmarksAfterInsertion()` / `adjustExtmarksAfterDeletion()` -- automatically shifts positions
- `updateHighlights()` -- re-renders all extmarks

The `syncExtmarksWithPromptParts()` function in the Prompt component iterates all "prompt-part" extmarks and updates their corresponding part positions when text changes.

**Theme styling** (from `packages/opencode/src/cli/cmd/tui/context/theme.tsx`):

| Style Key | Applied To |
|-----------|-----------|
| `extmark.file` | File mention pills |
| `extmark.agent` | Agent mention tokens |
| `extmark.paste` | Pasted content blocks |

#### 2.9 Dropdown Rendering (JSX)

```tsx
<box
  visible={store.visible !== false}
  position="absolute"
  top={position().y - height()}
  left={position().x}
  width={position().width}
  zIndex={100}
  borderColor={theme.border}
>
  <scrollbox backgroundColor={theme.backgroundMenu} height={height()}>
    <Index each={options()} fallback={<text fg={theme.textMuted}>No matching items</text>}>
      {(option, index) => (
        <box
          backgroundColor={index === store.selected ? theme.primary : undefined}
          onMouseOver={() => moveTo(index)}
          onMouseUp={() => select()}
        >
          <text fg={index === store.selected ? selectedForeground(theme) : theme.text}>
            {option().display}
          </text>
          <Show when={option().description}>
            <text fg={index === store.selected ? selectedForeground(theme) : theme.textMuted}>
              {option().description}
            </text>
          </Show>
        </box>
      )}
    </Index>
  </scrollbox>
</box>
```

Key rendering details:
- Positioned **absolutely above** the textarea (`top = position().y - height()`)
- Uses `zIndex={100}` to render above other content
- Supports both mouse and keyboard interaction
- Selected item gets `theme.primary` background color
- `store.input` mode (`"keyboard"` vs `"mouse"`) prevents mouse hover from interfering during typing

#### 2.10 Prompt Data Model

```typescript
type PromptInfo = {
  input: string;
  mode?: "normal" | "shell";
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | Omit<TextPart, "id" | "messageID" | "sessionID">
  )[];
}
```

Each `@` mention becomes a structured `part`:
- **FilePart**: `url`, `mime`, `filename`, `source` (path, line range, or MCP resource URI)
- **AgentPart**: `name` (the subagent identifier)
- **TextPart**: pasted text with summarized display

History is persisted to `prompt-history.jsonl` (max 50 entries).

#### 2.11 Keyboard Navigation

| Key | Action |
|-----|--------|
| Up arrow / Ctrl+P | Move selection up |
| Down arrow / Ctrl+N | Move selection down |
| Enter | Select current item |
| Tab | Select item, or expand if directory |
| Escape | Dismiss dropdown |

The `expandDirectory()` function replaces the current filter text with the directory path, allowing drill-down without fully selecting.

---

### 3. Atomic TUI Current State

#### 3.1 No `@` Mention Implementation Exists

Searches across the entire `src/` directory found **zero** references to:
- `@` character handling in input components
- File picker or file context loading logic
- Agent selection UI beyond slash commands
- "mention", "suggestion", or "completion" concepts beyond `/` commands

#### 3.2 Existing Slash Command Autocomplete System

The Atomic TUI has a fully implemented `/` command autocomplete that provides the architectural pattern for `@` mentions:

**Input detection** (`src/ui/chat.tsx:1418-1459`):
- `handleInputChange` monitors textarea for `/` prefix
- Runs on every keystroke via `setTimeout` at `src/ui/chat.tsx:2019-2022`

**Autocomplete state** (`src/ui/chat.tsx:328-336`):
- `showAutocomplete: boolean` -- visibility toggle
- `autocompleteInput: string` -- prefix text after `/`
- `selectedSuggestionIndex: number` -- keyboard navigation index
- `argumentHint: string` -- hint text after command name

**Command registry** (`src/ui/commands/registry.ts:198-398`):
- `CommandRegistry.search(prefix)` returns matching commands (case-insensitive, sorted by category priority)
- `CommandDefinition` includes `name`, `description`, `category`, `execute`, `aliases`

**Autocomplete component** (`src/ui/components/autocomplete.tsx:146-234`):
- `<scrollbox>` with `SuggestionRow` children
- Calls `globalRegistry.search(input)` for filtering
- Selected rows use theme accent color
- `useEffect` keeps selected item visible in scrollbox viewport

**Keyboard navigation** (`src/ui/chat.tsx:1867-1990`):
- Up/Down arrows: navigate with circular wrapping
- Tab: completes selected command (inserts `/{commandName} `)
- Enter: executes selected command immediately
- Escape: hides autocomplete, resets state

**Rendering position** (`src/ui/chat.tsx:2344-2355`):
- Dropdown renders **below the input area** inside the scrollbox

**Textarea capabilities** (`src/ui/chat.tsx:1412`, `TextareaRenderable` ref):
- `plainText` (read value)
- `insertText(text)` (insert at cursor)
- `gotoBufferHome()` / `gotoBufferEnd({ select })`
- `deleteChar()`, `hasSelection()`, `getSelectedText()`
- No direct `onChange` -- monitoring via `setTimeout` after key events

---

### 4. Architecture Comparison

| Aspect | Claude Code | OpenCode | Atomic TUI (current) |
|--------|------------|----------|---------------------|
| **Framework** | React + `@bcherny/ink` | SolidJS + OpenTUI (Zig) | React + OpenTUI (`@opentui/react`) |
| **`@` trigger** | Character detection in input handler | Dual-path: `onKeyDown` + `onInput` | Not implemented |
| **Guard** | No `@` in bash mode | Whitespace before `@` or start-of-input | N/A |
| **Filtering** | Rust-based native fuzzy finder | `fuzzysort` library + frecency multiplier | `CommandRegistry.search()` for `/` |
| **Dropdown position** | Below input (replaces status bar) | Absolutely above textarea (`zIndex: 100`) | Below input (inside scrollbox) |
| **Viewport** | Fixed 6 items, circular scroll | Scrollbox, configurable | Scrollbox with `maxSuggestions` (default 8) |
| **File source** | Native filesystem + optional custom command | `sdk.client.find.files()` async | Not implemented |
| **Agent source** | Built-in + `.claude/agents/` markdown | `sync.data.agent` (filtered) | `CommandRegistry` (slash commands only) |
| **MCP resources** | MCP server resources via `@server:uri` | `sync.data.mcp_resource` | Not implemented |
| **Selection insert** | Plain text (`@path` or `@"name (agent)"`) | `insertPart()` with extmark (virtual pill) | `/{commandName} ` (slash commands) |
| **Extmark system** | None visible (plain text references) | Full extmark system (virtual, styled, cursor-skipping) | Not available |
| **Frecency** | Not documented | `frequency * (1/(1+daysSince))`, JSONL persistence | Not implemented |
| **Line ranges** | `@file.ts#5-10` (VS Code extension) | `@file.ts#10-20` via `extractLineRange()` | Not implemented |
| **Directory drill-down** | Tab on directory keeps dropdown open | Tab on directory calls `expandDirectory()` | Not applicable |
| **Mouse support** | Not documented | `onMouseOver`, `onMouseUp` with input mode tracking | Not implemented |

---

### 5. OpenTUI Framework Primitives Used

OpenTUI provides the building blocks but **not** the autocomplete feature itself:

| Primitive | Source | Usage in OpenCode's `@` System |
|-----------|--------|-------------------------------|
| `TextareaRenderable` | `packages/core/src/renderables/Textarea.ts` | Main prompt input; provides `cursorOffset`, `getTextRange()`, `insertText()`, `deleteRange()` |
| `ExtmarksController` | `packages/core/src/lib/extmarks.ts` | Virtual styled ranges for `@` mention pills |
| `Box` | `packages/core/src/renderables/Box.ts` | Dropdown container |
| `ScrollBox` | `packages/core/src/renderables/ScrollBox.ts` | Scrollable option list |
| `Text` | `packages/core/src/renderables/Text.ts` | Option text display |
| Style system | `packages/core/src/lib/extmarks.ts` | `registerStyle()` for file/agent extmark colors |

The `SelectRenderable` (`packages/core/src/renderables/Select.ts`) is **not** used by OpenCode's autocomplete -- the custom dropdown using `<box>`, `<scrollbox>`, and `<text>` provides more flexibility.

---

### 6. Legacy OpenCode Implementation (Go/Bubble Tea)

The archived Go version (`opencode-ai/opencode`) used a different architecture:

| File | Purpose |
|------|---------|
| `internal/tui/page/chat.go` | `chatPage` with `showCompletionDialog` boolean |
| `internal/tui/components/dialog/completion.go` | `completionDialogCmp` with `CompletionProvider` interface |
| `internal/tui/components/chat/editor.go` | `editorCmp` handles `CompletionSelectedMsg` |

Flow: `@` keypress → `chatPage.Update()` sets `showCompletionDialog = true` → `completionDialogCmp` renders overlay via `layout.PlaceOverlay()` → Tab/Enter sends `CompletionSelectedMsg` → `editorCmp` replaces search string with completion value → `CompletionDialogCloseMsg` closes dialog.

---

### 7. Complete Data Flow: OpenCode `@` Mention

```
User types "@" in textarea
    │
    ▼
[onKeyDown in autocomplete.tsx]
    │── checks canTrigger (whitespace before @ or start-of-input)
    │── if true: show("@") → store.visible = "@", store.index = cursor offset
    │
    ▼
User types filter text (e.g., "readme")
    │
    ▼
[onInput in autocomplete.tsx]
    │── verifies autocomplete still valid (no whitespace, cursor after @)
    │── if invalid: hide()
    │
    ▼
[filter memo recomputes]
    │── extracts text between store.index+1 and cursorOffset
    │
    ▼
[search signal stabilizes]
    │
    ├──────────────────┬──────────────────┐
    ▼                  ▼                  ▼
[files resource]   [agents memo]    [mcpResources memo]
  (async SDK)       (sync state)      (sync state)
    │                  │                  │
    └──────────────────┴──────────────────┘
                       │
                       ▼
[options memo: combine + fuzzysort filter]
    │── [...agents, ...files, ...mcpResources]
    │── fuzzysort with frecency multiplier
    │── limit 10 results
    │
    ▼
[Dropdown JSX renders]
    │── absolutely positioned above textarea
    │── scrollbox with highlighted selection
    │
    ▼
User presses Enter/Tab
    │
    ▼
[select() → option.onSelect() → insertPart()]
    │── 1. Delete text from @ to cursor
    │── 2. Insert "@filename " (with trailing space)
    │── 3. Create virtual extmark (cursor-skipping pill)
    │── 4. Push part to PromptInfo.parts
    │── 5. Update frecency score
    │── 6. hide()
    │
    ▼
[syncExtmarksWithPromptParts()]
    │── keeps extmark positions in sync with parts array
```

## Code References

### Atomic TUI (current codebase)
- `src/ui/chat.tsx:1418-1459` -- Slash command input detection (`handleInputChange`)
- `src/ui/chat.tsx:328-336` -- Autocomplete state fields (`showAutocomplete`, etc.)
- `src/ui/chat.tsx:1867-1990` -- Keyboard navigation (Up/Down/Tab/Enter/Escape)
- `src/ui/chat.tsx:2019-2022` -- Post-keystroke input monitoring via `setTimeout`
- `src/ui/chat.tsx:2344-2355` -- Autocomplete rendering position
- `src/ui/chat.tsx:1658-1684` -- `handleAutocompleteSelect` handler
- `src/ui/chat.tsx:1412` -- `TextareaRenderable` ref
- `src/ui/components/autocomplete.tsx:146-234` -- `Autocomplete` component
- `src/ui/components/autocomplete.tsx:249-265` -- `navigateUp`/`navigateDown` utilities
- `src/ui/commands/registry.ts:198-398` -- `CommandRegistry` class
- `src/ui/commands/registry.ts:294` -- `search(prefix)` method
- `src/ui/components/model-selector-dialog.tsx:116-344` -- Dialog pattern reference

### OpenCode (sst/opencode)
- `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` -- Core autocomplete (~560 lines)
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` -- Prompt component wiring
- `packages/opencode/src/cli/cmd/tui/component/prompt/history.tsx` -- `PromptInfo` type
- `packages/opencode/src/cli/cmd/tui/component/prompt/frecency.tsx` -- Frecency hook
- `packages/opencode/src/cli/cmd/tui/context/theme.tsx` -- Extmark styling

### OpenTUI (sst/opentui)
- `packages/core/src/renderables/Textarea.ts` -- Multi-line editor
- `packages/core/src/lib/extmarks.ts` -- ExtmarksController
- `packages/core/src/lib/extmarks-multiwidth.test.ts` -- Extmark creation test
- `packages/core/src/renderables/ScrollBox.ts` -- Scrollable container
- `packages/react/src/components/index.ts` -- React component catalogue

### Claude Code (anthropics/claude-code)
- CHANGELOG.md -- Feature evolution timeline
- Distributed as single obfuscated `cli.js` bundle (~7.6MB); internal component names not publicly available

## Architecture Documentation

### Key Architectural Patterns

1. **Dual trigger detection** (`onKeyDown` + `onInput`) is necessary for robustness. The `onKeyDown` path gives instant response on `@` press. The `onInput` path handles edge cases like backspace revealing a prior `@` trigger.

2. **Extmarks are the key abstraction** for making `@` mentions behave correctly. They provide: (a) virtual ranges the cursor skips over, (b) styled highlighting, (c) automatic position adjustment during edits, (d) stable anchors for mapping visual mentions to structured data.

3. **Each autocomplete option carries its own `onSelect` callback**, encapsulating the specific `insertPart` call with the correct part type. This avoids a complex switch statement in the selection handler.

4. **The `canTrigger` guard** prevents false positives. `@` only activates autocomplete when preceded by whitespace or at the start of input.

5. **Frecency scoring** (`frequency * (1 / (1 + daysSince))`) provides intelligent file ranking that improves with usage, used both as a sort key and as a fuzzysort score multiplier.

6. **The dropdown is positioned absolutely above the textarea** in OpenCode, vs below the input in Claude Code and the Atomic TUI's existing slash command autocomplete.

## Historical Context (from research/)

- `research/docs/2026-01-31-opentui-library-research.md` -- Earlier OpenTUI framework research
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` -- Claude Code UI patterns study
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` -- Subagent UI research
- `research/docs/2026-02-06-mcp-tool-calling-opentui.md` -- MCP tool calling research
- `specs/mcp-tool-calling-opentui.md` -- MCP tool calling specification

## Related Research

- `research/docs/2026-01-31-claude-implementation-analysis.md`
- `research/docs/2026-01-31-opencode-implementation-analysis.md`
- `research/docs/2026-02-01-chat-tui-parity-implementation.md`

## External References

| Resource | URL |
|----------|-----|
| OpenTUI GitHub | https://github.com/sst/opentui |
| OpenCode GitHub | https://github.com/sst/opencode |
| Legacy OpenCode GitHub | https://github.com/opencode-ai/opencode |
| Claude Code GitHub | https://github.com/anthropics/claude-code |
| Claude Code CHANGELOG | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |
| Claude Code Interactive Mode Docs | https://code.claude.com/docs/en/interactive-mode |
| Claude Code Settings Docs | https://code.claude.com/docs/en/settings |
| Claude Code MCP Docs | https://code.claude.com/docs/en/mcp |
| DeepWiki: OpenCode TUI Prompt | https://deepwiki.com/sst/opencode/6.5-tui-prompt-component-and-input-handling |
| DeepWiki: OpenTUI Overview | https://deepwiki.com/sst/opentui#1 |
| How Claude Code is Built (Pragmatic Engineer) | https://newsletter.pragmaticengineer.com/p/how-claude-code-is-built |
| The Signature Flicker (Peter Steinberger) | https://steipete.me/posts/2025/signature-flicker |
| Claude Code Internals Part 11: Terminal UI | https://kotrotsos.medium.com/claude-code-internals-part-11-terminal-ui-542fe17db016 |
| OpenCode TUI Docs | https://opencode.ai/docs/tui/ |
| OpenCode Agents Docs | https://opencode.ai/docs/agents/ |

## Open Questions

1. **Extmark support in Atomic TUI**: The Atomic TUI uses `@opentui/react` which wraps OpenTUI's `TextareaRenderable`. Does the React integration expose the `ExtmarksController` API? If so, the OpenCode pattern of virtual extmark pills can be replicated directly. If not, the Claude Code approach (plain text insertion with optional quoting) is the simpler alternative.

2. **File search backend**: What should the file search provider be? Options include: (a) native `glob`/`readdir` traversal, (b) git-indexed file listing (`git ls-files`), (c) a custom SDK endpoint, (d) ripgrep-based search. Claude Code uses a native Rust fuzzy finder; OpenCode uses an SDK-backed `find.files()`.

3. **Frecency persistence**: Should the Atomic TUI implement frecency scoring? OpenCode stores it in `frecency.jsonl` (max 1000 entries). This improves UX significantly for repeat file access patterns but adds persistence complexity.

4. **Dropdown position**: Claude Code renders below the input; OpenCode renders above. The Atomic TUI's existing slash command autocomplete renders below. Consistency with the existing pattern suggests below, but above (OpenCode's approach) avoids obscuring already-typed content.

5. **Agent invocation semantics**: When `@agent-name` is selected, what exactly should happen? (a) Insert text and let the user add a message before submitting, (b) immediately invoke the agent with the remaining prompt text, (c) open a sub-session with the agent.

6. **MCP resource integration**: Should MCP resources appear in the `@` dropdown alongside files and agents? This depends on the MCP tool calling implementation (see `specs/mcp-tool-calling-opentui.md`).
