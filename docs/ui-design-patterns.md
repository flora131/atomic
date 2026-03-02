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

Sub-agents use a tree-based UI with the following design patterns depending on whether they are invoked in the foreground or background.

**Foreground Sub-agent Invocation**

1. During initialization (no tool calls or streaming started)

    ```
    ● Running 2 agents…
    ├─● Locate sub-agent message handling
    │    ╰  Initializing codebase-locator… (2s)
    └─● Find sub-agent text rendering code
         ╰  Initializing codebase-pattern-finder… (5s)
    ```

2. During execution (tools and tool counts stream for each branch):

    Here's how a correct UI looks during execution:

    ```
    ● Running 2 agents…
    ├─● Locate sub-agent message handling
    │    ╰ codebase-locator: (10 tool uses)
    │      · rg
    └─● Find sub-agent text rendering code
         ╰ codebase-pattern-finder: (5 tool uses)
           · ls
    ```

    Here's how an incorrect UI looks:

    ```
    ● Running 2 codebase-analyzer agents…
    ├─● codebase-analyzer
    · 39 tool uses
    │    ╰  bash (2m 22s)
    └─● codebase-analyzer
    · 35 tool uses
        ╰  view (2m 22s)
    ```

**Background Sub-agent Invocation**

1. During initialization (no tool calls or streaming started)

```
● 2 Task agents launched…
├─● Locate OpenCode SDK integration
│    ╰  Running codebase-locator in background…
└─● Analyze SDK tool display patterns
      ╰  Running codebase-analyzer in background…
```

Background agent progress is shown via the footer status text below the chatbox:

```

[CHATBOX]
[N] local agents · ctrl+f to kill all background tasks

```

When the chatbox is streaming AND background agents are running, the footer combines both:

```

[CHATBOX]
esc to interrupt · ctrl+shift+enter enqueue · [N] local agents · ctrl+f to kill all background tasks

```

2. During execution: N/A, under the chatbox ui contains status and should be updated

3. Finished state:

```
● Agent "Explore Claude adapter for comparison" completed

● Agent [TASK_DESCRIPTION] completed
```