# Contributing to Atomic

Thanks for your interest in contributing to Atomic. This guide explains how to prepare a local checkout, make changes, and submit them for review.

## Getting started

1. Fork and clone the repository.
2. Install dependencies with Bun:

   ```bash
   bun install
   ```

3. Read [`DEV_SETUP.md`](DEV_SETUP.md) for the full development setup, local CLI workflow, testing notes, and repository layout.

## Development guidelines

- Use **Bun** for development commands (`bun`, `bun run`, `bunx`). Do not use npm, yarn, pnpm, or npx for normal development tasks.
- Keep changes focused and small enough to review.
- Follow the existing TypeScript style and package conventions.
- Add or update tests when changing behavior.
- Do not add build output, generated artifacts, or unrelated formatting changes.

## Testing and checks

Before opening a pull request, run the most relevant checks for your change:

```bash
bun run typecheck
bun run lint
bun run test:unit
```

For broader changes, use:

```bash
bun run test:all
```

## Pull requests

When opening a PR:

- Describe the problem and the solution clearly.
- Link related issues or discussions when applicable.
- Include test output or explain why tests were not run.
- Call out breaking changes, migration steps, or follow-up work.

## Workflows contributions

Looking to contribute workflows? Check out the atomic-workflows repo [here](https://github.com/lavaman131/atomic-workflows).

## Questions

For questions, help, feedback, or feature ideas, join the [Atomic Discord community](https://discord.gg/9CvdXUGXR4).
