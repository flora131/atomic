# Atomic Monorepo

This repository is the private Bun workspace root for Atomic packages.

## Packages

- [`@bastani/atomic`](./packages/coding-agent/README.md) — Atomic-branded fork of the pi coding-agent CLI.
- [`@bastani/workflows`](./packages/workflows/README.md) — private workspace source for the bundled workflows extension.

## Development

```bash
bun install
bun run typecheck
bun run test:all
```

The root `package.json` is intentionally private and named `atomic-monorepo`. CI publishes only `@bastani/atomic`; workflows and companion extensions are bundled into it.
