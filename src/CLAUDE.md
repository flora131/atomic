# Atomic CLI

## Overview
This project is a slim CLI that copies the configuration files in the root of the repo (e.g. `.claude`, `.opencode`, `.github`) for various coding agents (e.g., Claude Code, OpenCode, GitHub Copilot CLI) into the current directory.

## Tech Stack

- bun.js for the runtime
- TypeScript
- @clack/prompts for CLI prompts
- figlet for ASCII art

## Quick Reference

### Commands by Workspace

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

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

## Docs

For latest docs on dependencies, use the DeepWiki MCP `ask_question` tool with the repos:
- bun: `oven-sh/bun`
- @clack/prompts: `bombshell-dev/clack`
- figlet: `patorjk/figlet.js`

## Tips

Note: for the `.github` config for GitHub Copilot CLI, ignore the `.github/workflows` and `.github/dependabot.yml` files as they are NOT for Copilot CLI.