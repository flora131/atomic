# UI Design Patterns

## Iconography

- ● symbol is used at the beginning of text blocks, tool blocks, and sub-agent trees.
- unicode icons are preferred rather than emojis to ensure consistent rendering across platforms and avoid issues with emoji rendering in certain environments

## Colors

### Status Colors

- **Green ●**: Indicates successful operations, such as completed tasks or successful tool calls.
- **Yellow ●**: Interrupted operations, such as when a user interrupts an agent or a tool call.
- **Red ●**: Failed operations, such as when an agent encounters an error or a tool call fails.

## Blocks

## Text Blocks

- Prefixed with ●, text blocks are used to display agent text outputs

### Single-line Text Block

```
● I'll start by exploring the codebase to understand the current sub-agent design and then create a detailed plan. Let me research the relevant files in parallel.
```

### Multi-line Text Block

```
● I've launched 5 research agents in parallel to explore:

  1. Copilot adapter & sub-agent tracking in the workflow SDK
  2. Copilot SDK source code for event types
  3. Copilot CLI agent runtime for sub-agent spawning
  4. Claude adapter as a reference implementation
  5. UI rendering of the parallel agents tree
```

### Sub-agents

Each sub-agent renders as its own independent block prefixed with `●`. Parallel sub-agents are **not** nested under a parent grouping node — they are listed sequentially. Each sub-agent shows its tool calls as a flat tree with `├─` / `└─` connectors, and tool calls display the tool name plus a brief argument summary.

**Foreground Sub-agent Invocation**

1. During initialization (no tool calls or streaming started):

    ```
    ● codebase-locator
    └─ Initializing…

    ● codebase-analyzer
    └─ Initializing…
    ```

2. During execution (tool calls stream for each sub-agent):

    ```
    ● codebase-locator
    ├─ Glob **/* in .github
    ├─ Glob **/* in src
    └─ Read src/services/events/bus.ts

    ● codebase-analyzer
    ├─ Grep "EventBus" in src
    ├─ Read src/state/store.ts
    └─ Read src/state/reducer.ts
    ```

3. During execution with many tool calls (truncated view):

    When a sub-agent has made more than 3 tool calls, show only the **last 3 tool calls** with a `+N earlier tool calls` indicator. This keeps the tree compact while preserving recency (what the agent is doing *now*) and total count.

    ```
    ● codebase-locator
    ├─ +1 earlier tool call
    ├─ Glob **/* in .github
    ├─ Glob **/* in src
    └─ Glob **/* in tests

    ● codebase-analyzer
    ├─ +2 earlier tool calls
    ├─ Glob **/Cargo.toml in opencode
    ├─ Glob **/go.mod in opencode
    └─ Glob **/pyproject.toml in opencode
    ```

    When 3 or fewer tool calls have been made, no truncation indicator is shown.

    **Rules:**
    - Maximum visible tool calls per sub-agent: **3**
    - Truncation line format: `+N earlier tool calls` (singular `call` when N = 1)
    - Tool calls shown are always the **most recent** (tail of the list)
    - Tool call format: `ToolName args-summary` (e.g., `Glob **/* in src`, `Read src/state/store.ts`)

**Background Sub-agent Invocation**

1. During initialization (no tool calls or streaming started):

    ```
    ● codebase-locator
    └─ Running in background…

    ● codebase-analyzer
    └─ Running in background…
    ```

    Background agent progress is shown via the footer status text below the chatbox:

    ```
    [CHATBOX]
    [N] local agents · ctrl+f to kill all background tasks
    ```

    When the chatbox is streaming AND background agents are running, the footer combines both:

    ```
    [CHATBOX]
    esc to interrupt · [N] local agents · ctrl+f to kill all background tasks
    ```

2. During execution: N/A, footer status text is updated with agent count.

3. Finished state:

    ```
    ● Agent "Explore Claude adapter for comparison" completed

    ● Agent [TASK_DESCRIPTION] completed
    ```