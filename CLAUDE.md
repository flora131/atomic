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
    - global: `~/.opencode`
    - local: `.opencode` in the project directory
2. Claude Code:
    - global: `~/.claude`
    - local: `.claude` in the project directory
3. Copilot CLI:
    - global: `~/.config/.copilot`
    - local: `.github` in the project directory

## Tips

1. Note: for the `.github` config for GitHub Copilot CLI, ignore the `.github/workflows` and `.github/dependabot.yml` files as they are NOT for Copilot CLI.
2. Use many research sub-agents in parallel for documentation overview to avoid populating your entire
   context window. Spawn as many sub-agents as you need. You are an agent and can execute tasks until you
   believe you are finished with the task even if it takes hundreds of iterations.

<EXTREMELY_IMPORTANT>
This is a `bun` project. Do NOT use `node`, `npm`, `npx`, `yarn`, or `pnpm` commands. Always use `bun` commands.
</EXTREMELY_IMPORTANT>
