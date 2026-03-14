# Atomic CLI

## Overview

This project is a TUI application built on OpenTUI and powered in the backend by coding agent SDKs: OpenCode SDK, Claude Agent SDK, and Copilot SDK.

It works out of the box by reading and configuring `.claude`, `.opencode`, `.github` configurations for the Claude Code, OpenCode, and Copilot CLI coding agents and allowing users to build powerful agent workflows defined by TypeScript files.

## Tech Stack

- bun.js for the runtime
- TypeScript
- @clack/prompts for CLI prompts
- figlet for ASCII art
- OpenTUI for tui components
- OpenCode SDK
- Claude Agent SDK
- Copilot SDK

## Quick Reference

### Commands by Workspace

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun lint` to run the linters
- Use `bun typecheck` to run TypeScript type checks
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads `.env`, so don't use `dotenv`.

## Architecture

### Layered Architecture

The codebase follows a **strict layered architecture with a shared types layer**. Each layer may only depend on the layer directly below it and the shared layer.

```
┌──────────────────────────────────────────────────────────┐
│  CLI Entry:  cli.ts → commands/cli/{chat,init,update}    │
│  TUI Entry:  app.tsx                                     │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│  UI Layer (screens/, components/, theme/, hooks/)         │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│  State Layer (state/chat/, state/parts/, state/runtime/,  │
│              state/streaming/)                            │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│  Service Layer (services/agents/, services/events/,       │
│     services/workflows/, services/config/,                │
│     services/agent-discovery/, services/models/,          │
│     services/telemetry/, services/system/)                │
└──────────────────────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│  Shared Layer (types/, lib/)                              │
│  - types/ = pure type definitions, no runtime values      │
│  - lib/   = genuinely reusable, domain-agnostic utilities │
└──────────────────────────────────────────────────────────┘
```

### Dependency Rules

**Unidirectional flow — no upward or circular imports:**

| Source Layer | May Import From | Must NOT Import From |
|---|---|---|
| UI (screens, components) | State, Services, Shared | — |
| State | Services, Shared | UI |
| Services | Shared | UI, State |
| Shared (types, lib) | — | UI, State, Services |

- `services/` must never import from `commands/` (use `services/agent-discovery/` for shared discovery logic)
- `state/` must never import types from UI components (use `types/` for shared type definitions)
- `lib/` must contain only domain-agnostic utilities — domain-specific helpers belong near their consumers

### `state/chat/` Sub-Module Boundaries

The `state/chat/` module is decomposed into 8 sub-modules with **enforced boundary rules**:

```
state/chat/
├── agent/       # Agent state (background agents, parallel trees)
├── command/     # Slash command execution context
├── composer/    # Input composition (submit, mention, attachment)
├── controller/  # UI controller bridge
├── keyboard/    # Keyboard shortcuts + input handling
├── session/     # Session lifecycle (create, resume, destroy)
├── shell/       # Shell UI state (scroll, layout, footer)
├── stream/      # Stream lifecycle (start, stop, finalize)
├── shared/      # Types and helpers shared across sub-modules
│   ├── types/   # Shared type definitions
│   └── helpers/ # Shared helper functions
└── exports.ts   # Public API barrel for external consumers
```

**Rules (enforced by `bun run lint:boundaries` and pre-commit hooks):**
1. No sub-module may import from another sub-module's internal files
2. Sibling imports must go through the sub-module's barrel (`index.ts`)
3. Imports from `shared/` are always allowed from any sub-module
4. External consumers must import from `state/chat/exports.ts`

### Barrel Export Rules

- **Max re-export depth: 1** — a barrel file may only re-export from its immediate children, never from other barrels
- `state/chat/exports.ts` is the single public API surface for the chat state domain
- Each module's `index.ts` re-exports from sibling implementation files only

### Key Architectural Patterns

| Pattern | Usage |
|---|---|
| Strategy | `CodingAgentClient` interface with 3 SDK implementations |
| Pub/Sub | `EventBus` with 30 typed events + batched dispatch |
| Builder | `GraphBuilder` fluent API (LangGraph-inspired) |
| Registry | `ToolRegistry`, `PART_REGISTRY`, `CommandRegistry`, `ProviderRegistry` |
| Adapter | 3 SDK-specific stream adapters → unified `BusEvent` |
| Reducer | `applyStreamPartEvent` pure state reducer |
| Factory | `createChatUIController()`, `createStreamAdapter()` |
| Interface Segregation | `RalphWorkflowContext` (workflow-specific) vs `CommandContext` (shared) |

### Key Interfaces

- **`CommandContext`** — shared interface for slash command execution; must NOT contain workflow-specific fields
- **`RalphWorkflowContext`** (`services/workflows/ralph/types.ts`) — Ralph-specific workflow context passed to graph nodes; isolates Ralph state from shared interfaces
- **`CodingAgentClient`** (`services/agents/contracts/`) — strategy interface for SDK-specific agent implementations

### Path Aliases

- `@/*` → `src/*` (the only import alias; configured in `tsconfig.json`)

## Architecture

### Layered Architecture

The codebase follows a **strict layered architecture with a shared types layer**. Each layer may only depend on the layer directly below it and the shared layer.

```
┌──────────────────────────────────────────────────────────┐
│  CLI Entry:  cli.ts → commands/cli/{chat,init,update}    │
│  TUI Entry:  app.tsx                                     │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│  UI Layer (screens/, components/, theme/, hooks/)         │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│  State Layer (state/chat/, state/parts/, state/runtime/,  │
│              state/streaming/)                            │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│  Service Layer (services/agents/, services/events/,       │
│     services/workflows/, services/config/,                │
│     services/agent-discovery/, services/models/,          │
│     services/telemetry/, services/system/)                │
└──────────────────────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│  Shared Layer (types/, lib/)                              │
│  - types/ = pure type definitions, no runtime values      │
│  - lib/   = genuinely reusable, domain-agnostic utilities │
└──────────────────────────────────────────────────────────┘
```

### Dependency Rules

**Unidirectional flow — no upward or circular imports:**

| Source Layer | May Import From | Must NOT Import From |
|---|---|---|
| UI (screens, components) | State, Services, Shared | — |
| State | Services, Shared | UI |
| Services | Shared | UI, State |
| Shared (types, lib) | — | UI, State, Services |

- `services/` must never import from `commands/` (use `services/agent-discovery/` for shared discovery logic)
- `state/` must never import types from UI components (use `types/` for shared type definitions)
- `lib/` must contain only domain-agnostic utilities — domain-specific helpers belong near their consumers

### `state/chat/` Sub-Module Boundaries

The `state/chat/` module is decomposed into 8 sub-modules with **enforced boundary rules**:

```
state/chat/
├── agent/       # Agent state (background agents, parallel trees)
├── command/     # Slash command execution context
├── composer/    # Input composition (submit, mention, attachment)
├── controller/  # UI controller bridge
├── keyboard/    # Keyboard shortcuts + input handling
├── session/     # Session lifecycle (create, resume, destroy)
├── shell/       # Shell UI state (scroll, layout, footer)
├── stream/      # Stream lifecycle (start, stop, finalize)
├── shared/      # Types and helpers shared across sub-modules
│   ├── types/   # Shared type definitions
│   └── helpers/ # Shared helper functions
└── exports.ts   # Public API barrel for external consumers
```

**Rules (enforced by `bun run lint:boundaries` and pre-commit hooks):**
1. No sub-module may import from another sub-module's internal files
2. Sibling imports must go through the sub-module's barrel (`index.ts`)
3. Imports from `shared/` are always allowed from any sub-module
4. External consumers must import from `state/chat/exports.ts`

### Barrel Export Rules

- **Max re-export depth: 1** — a barrel file may only re-export from its immediate children, never from other barrels
- `state/chat/exports.ts` is the single public API surface for the chat state domain
- Each module's `index.ts` re-exports from sibling implementation files only

### Key Architectural Patterns

| Pattern | Usage |
|---|---|
| Strategy | `CodingAgentClient` interface with 3 SDK implementations |
| Pub/Sub | `EventBus` with 30 typed events + batched dispatch |
| Builder | `GraphBuilder` fluent API (LangGraph-inspired) |
| Registry | `ToolRegistry`, `PART_REGISTRY`, `CommandRegistry`, `ProviderRegistry` |
| Adapter | 3 SDK-specific stream adapters → unified `BusEvent` |
| Reducer | `applyStreamPartEvent` pure state reducer |
| Factory | `createChatUIController()`, `createStreamAdapter()` |
| Interface Segregation | `RalphWorkflowContext` (workflow-specific) vs `CommandContext` (shared) |

### Key Interfaces

- **`CommandContext`** — shared interface for slash command execution; must NOT contain workflow-specific fields
- **`RalphWorkflowContext`** (`services/workflows/ralph/types.ts`) — Ralph-specific workflow context passed to graph nodes; isolates Ralph state from shared interfaces
- **`CodingAgentClient`** (`services/agents/contracts/`) — strategy interface for SDK-specific agent implementations

### Path Aliases

- `@/*` → `src/*` (the only import alias; configured in `tsconfig.json`)

## Best Practices

- Avoid ambiguous types like `any` and `unknown`. Use specific types instead.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

### Code Quality

- Frequently run linters and type checks using `bun lint` and `bun typecheck`.
- Avoid Any and Unknown types.
- Modularize code and avoid re-inventing the wheel. Use functionality of libraries and SDKs whenever possible.

### E2E Tests

Strictly follow the guidelines in the [E2E Testing](docs/e2e-testing.md) doc.

## Debugging

You are bound to run into errors when testing. As you test and run into issues/edges cases, address issues in a file you create called `issues.md` to track progress and support future iterations. Delegate to the debugging sub-agent for support. Delete the file when all issues are resolved to keep the repository clean.

### UI Issues

Fix UI issues by referencing your frontend-design skill and referencing the experience of other coding agents like Claude Code with the `tmux-cli` tool (e.g. run `claude` in a `tmux` session using the `tmux-cli` tool).

## Docs

Relevant resources (use the deepwiki mcp `ask_question` tool for repos):

1. OpenCode SDK / OpenCode repo: `anomalyco/opencode`
2. OpenTUI repo: `anomalyco/opentui`
3. Copilot:
    1. SDK repo: `github/copilot-sdk`
    2. [CLI](docs/copilot-cli/usage.md)
        1. [Hooks](docs/copilot-cli/hooks.md)
        2. [Skills](docs/copilot-cli/skills.md)
4. [Claude Agent SDK](docs/claude-agent-sdk.md)
    - v1 preferred (v2 is unstable and has many bugs)

### Coding Agent Configuration Locations

1. OpenCode:
    - global:
        - Linux/MacOS: `$XDG_CONFIG_HOME/.opencode` AND `~/.opencode`
        - Windows: `%HOMEPATH%\\.opencode`
    - local: `.opencode` in the project directory
2. Claude Code:
    - global:
        - Linux/MacOS: `~/.claude`
        - Windows: `%HOMEPATH%\\.claude`
    - local: `.claude` in the project directory
3. Copilot CLI:
    - global:
        - Linux/MacOS: `$XDG_CONFIG_HOME/.copilot` AND `~/.copilot`
        - Windows: `%HOMEPATH%\\.copilot`
    - local: `.github` in the project directory

## Tips

1. Note: for the `.github` config for GitHub Copilot CLI, ignore the `.github/workflows` and `.github/dependabot.yml` files as they are NOT for Copilot CLI.
2. Use many research sub-agents in parallel for documentation overview to avoid populating your entire
   context window. Spawn as many sub-agents as you need. You are an agent and can execute tasks until you
   believe you are finished with the task even if it takes hundreds of iterations.

<EXTREMELY_IMPORTANT>
This is a `bun` project. Do NOT use `node`, `npm`, `npx`, `yarn`, or `pnpm` commands. Always use `bun` commands.
</EXTREMELY_IMPORTANT>
