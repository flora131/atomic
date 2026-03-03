# Atomic

## Overview

Atomic is a TUI-based CLI for AI-assisted software development, providing a chat interface that orchestrates coding agents (Claude Code, OpenCode, GitHub Copilot CLI) with research, spec, and autonomous implementation workflows.

## Project Structure

| Path | Type | Purpose |
| ---- | ---- | ------- |
| `src/cli.ts` | entry | CLI entry point and command registration |
| `src/commands/` | dir | CLI command implementations (`chat`, `init`, `config`, etc.) |
| `src/config/` | dir | Configuration loading and merging |
| `src/sdk/` | dir | SDK adapters for OpenCode, Claude, and Copilot agents |
| `src/ui/` | dir | TUI components, slash commands, tools, and utils |
| `src/workflows/` | dir | Workflow definitions (Ralph graph workflow) |
| `src/telemetry/` | dir | Anonymous telemetry and monitoring |
| `src/models/` | dir | Model management |
| `src/utils/` | dir | Shared utilities |
| `docs/` | dir | Developer and author documentation |
| `specs/` | dir | Feature spec files |
| `research/` | dir | Codebase research output |
| `.claude/` | dir | Claude Code agent config and skills |
| `.opencode/` | dir | OpenCode agent config and skills |
| `.github/` | dir | Copilot CLI config, skills, and agents (ignore `workflows/` and `dependabot.yml`) |

## Quick Reference

### Commands

```bash
bun run dev          # Run CLI in development mode
bun run build        # Compile to standalone binary
bun test             # Run all tests
bun run lint         # Lint with oxlint
bun run typecheck    # TypeScript type-check
bun run lint:fix     # Auto-fix lint issues
```

## Progressive Disclosure

| Topic | Location |
| ----- | -------- |
| Dev setup & testing | `DEV_SETUP.md` |
| Workflow authoring | `docs/workflow-authors-getting-started.md` |
| UI design patterns | `docs/ui-design-patterns.md` |
| E2E testing | `docs/e2e-testing.md` |
| Claude Agent SDK | `docs/claude-agent-sdk.md` |
| Copilot CLI | `docs/copilot-cli/` |
| Style guide | `docs/style-guide.md` |

## Universal Rules

1. Run `bun run typecheck && bun run lint && bun test --bail` before commits
2. Keep PRs focused on a single concern
3. Colocate `*.test.ts` files next to the source file they test
4. Avoid `any` and `unknown` types — use specific types
5. Always use `bun` — never `node`, `npm`, `npx`, `yarn`, or `pnpm`
6. Use Claude Agent SDK v1 (v2 is unstable)
7. Use DeepWiki (`ask_question` tool) for SDK repos: `anomalyco/opencode`, `anomalyco/opentui`, `github/copilot-sdk`

## Code Quality

- `bun run lint` — oxlint (configured via `oxlint.json`)
- `bun run lint:fix` — auto-fix lint issues
- `bun run typecheck` — tsc --noEmit

Pre-commit hooks run typecheck + lint + tests automatically via Lefthook.
