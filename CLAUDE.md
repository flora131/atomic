# @bastani/atomic-workflows

## Overview

This repo houses `@bastani/atomic-workflows` — a first-party extension for [oh-my-pi](https://github.com/can1357/oh-my-pi) that brings multi-stage, DAG-driven workflow execution to oh-my-pi sessions.

`@bastani/atomic-workflows` ships as **raw TypeScript** (no compile step) and is loaded directly by oh-my-pi. The layout mirrors oh-my-pi's extension conventions.

## Tech Stack

- Node.js ≥ 22 for the runtime (required for `--experimental-strip-types` / `--experimental-transform-types`)
- TypeScript ≥ 5.x (strict, `noUnusedLocals`, `noUnusedParameters`)
- `node:test` + `node:assert/strict` for tests
- `@sinclair/typebox` for schema definitions
- `jiti` for runtime TS loading where needed

## Quick Reference

### Commands

Default to using npm + Node, not Bun.

- Use `node --experimental-strip-types <file.ts>` instead of `bun <file.ts>` or `ts-node <file>`
- Use `node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/...` instead of `bun test`
- Use `npm run typecheck` to run TypeScript type checks (`tsc --noEmit`)
- Use `npm install` instead of `bun install`, `yarn install`, or `pnpm install`
- Use `npm run <script>` instead of `bun run <script>`
- Use `npx <package> <command>` instead of `bunx <package> <command>`
- Repo commands: `npm run test:unit`, `npm run test:integration`, `npm run test:all`, `npm run typecheck`

## Best Practices

- Avoid ambiguous types like `any` and `unknown`. Use specific types instead.
- Source files use `.js` import extensions (TypeScript ESM convention). The repo ships as `.ts` files; Node's loader + `test/support/ts-loader.mjs` rewrites `.js` → `.ts` at resolution time.
- Do not add a build step (`dist/`, `tsconfig.build.json`, etc.). The package distributes raw TypeScript and oh-my-pi loads it directly.

## Design Context

Refer to `.impeccable.md`

## Testing

Use `npm run test:unit` (or `test:integration`, `test:all`) and make use of your tdd skill to write high quality tests. Tests use `node:test` + `node:assert/strict`:

```ts#test/unit/index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("hello world", () => {
  assert.equal(1, 1);
});
```

### AI Agent Integration

`node:test`'s default reporter is already quiet enough for AI assistants. If you want even leaner output, pass `--test-reporter=tap` or filter for `^ℹ` summary lines:

```bash
npm run test:unit 2>&1 | grep "^ℹ"
```

This prints just the pass/fail/duration summary without the per-test list.

### Code Quality

- Frequently run linters and type checks using `npm run lint` and `npm run typecheck` (both are `tsc --noEmit`).
- Avoid `any` and `unknown` types.
- Modularize code and avoid re-inventing the wheel. Use functionality of libraries and SDKs whenever possible.

## Debugging

You are bound to run into errors when testing. As you test and run into issues/edge cases, address issues in a file you create called `issues.md` to track progress and support future iterations. Delegate to the debugging sub-agent for support. Delete the file when all issues are resolved to keep the repository clean.

## Docs

Relevant resources (use your `playwright-cli` skill if the information is not available in the local docs):

1. Node.js (runtime): `nodejs/node`
    1. [`node:test` runner](https://nodejs.org/api/test.html)
    2. [`node:assert`](https://nodejs.org/api/assert.html)
    3. [Type stripping](https://nodejs.org/api/typescript.html#type-stripping)
2. oh-my-pi: `can1357/oh-my-pi`
    1. Extension loading + SDK docs under `docs/`
3. TypeScript: `microsoft/TypeScript`
    1. [Module resolution](https://www.typescriptlang.org/docs/handbook/module-resolution.html)
    2. [`paths`](https://www.typescriptlang.org/tsconfig#paths)
4. Schema tooling:
    1. `@sinclair/typebox` for runtime-validated schemas
    2. `jiti` for on-demand TS loading

### Coding Agent Configuration Locations

Note: oh-my-pi is the primary coding agent for this repo. Other agents (Claude Code, OpenCode, Copilot CLI) may be used for local development; their configurations live in standard locations:

1. oh-my-pi:
    - global:
        - Linux/MacOS: `~/.omp/agent/`
        - Windows: `%HOMEPATH%\\.omp\\agent\\`
    - extensions: `~/.omp/agent/extensions/<name>/`
    - local: `.omp/` in the project directory

2. Claude Code:
    - global:
        - Linux/MacOS: `~/.claude`
        - Windows: `%HOMEPATH%\\.claude`
    - local: `.claude` in the project directory

3. OpenCode:
    - global:
        - Linux/MacOS: `$XDG_CONFIG_HOME/.opencode` AND `~/.opencode`
        - Windows: `%HOMEPATH%\\.opencode`

4. Copilot CLI:
    - global:
        - Linux/MacOS: `$XDG_CONFIG_HOME/.copilot` AND `~/.copilot`
        - Windows: `%HOMEPATH%\\.copilot`
    - local: `.github` in the project directory

**Agent Skill Locations**
    - local:
        - `.agents/skills` (`.claude/skills` is a symlink to `.agents/skills`)
    - global:
      - `~/.agents/skills` for OpenCode and Copilot CLI
      - `~/.claude/skills` for Claude Code

## Releasing

### Branch Naming Convention

- **Release branches**: `release/v<major>.<minor>.<patch>` (e.g. `release/v0.1.1`)
- **Prerelease branches**: `prerelease/v<major>.<minor>.<patch>-<prerelease>` (e.g. `prerelease/v0.1.1-0`)

### Bumping Versions

Update the `version` field in the root `package.json` directly.

### Workflow

1. Create a branch following the naming convention above.
2. Edit `package.json` to set the target version.
3. Commit with the message `chore(release): bump to v<version>`.
4. Open a PR to `main`.
5. Once approved and merged, publish to npm with `npm publish --provenance` (provenance is enabled in CI; no `NPM_TOKEN` is needed for OIDC-authenticated publishes).

## CI

CI runs typecheck and test:all on PRs. See `.github/workflows/` (or add one if missing) for the canonical pipeline.

Note: Remember that npm publishing with provenance does NOT require a token. That's the whole point. So if you see any steps in the CI related to setting up npm tokens (e.g., `NPM_TOKEN` / `NODE_AUTH_TOKEN`) for publishing, those are likely mistakes and should be removed.

## Tips

1. The `@bastani/atomic-workflows` extension is installed under `~/.omp/agent/extensions/workflows` when linked locally or loaded by oh-my-pi. For local development, symlink this repo's checkout into that path if you want host-level discovery.
2. Rely on agent skills to provide information on best practices during implementation. Here is a short list of Agent Skills that are incredibly relevant to this project that you should try to use when applicable:
   - typescript-advanced-types
   - typescript-expert
   - typescript-react-reviewer
   - tdd
   - impeccable
3. Ask for clarity if you are unsure about a change. The developer is your best friend and oftentimes can clarify intent.
4. When modifying this extension, follow oh-my-pi's extension and SDK conventions.

<EXTREMELY_IMPORTANT>
This repo uses npm + Node.js (≥ 22), NOT Bun. Do NOT use `bun`, `bunx`, `yarn`, or `pnpm` commands. Always use `npm`, `npx`, and `node`.

`@bastani/atomic-workflows` ships raw `.ts` files with no build step — do NOT introduce `dist/`, `tsconfig.build.json`, `outDir`, or any bundling. Tests run via `node --experimental-strip-types` / `--experimental-transform-types` + the `test/support/register-loader.mjs` hook.
</EXTREMELY_IMPORTANT>
