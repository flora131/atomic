# Open Issues

## Cross-agent E2E dependency blockers

- `bun test src/ui/index.protocol-ordering.test.ts` fails: missing `@opentui/core`.
- `bun test src/ui/parts/claude-rendering-e2e.test.ts` fails to load: missing `@opencode-ai/sdk/v2/client`.
- `bun test src/sdk/unified-event-parity.test.ts` fails to load: missing `@anthropic-ai/claude-agent-sdk`.
- `bun test src/sdk/clients/copilot.test.ts` fails to load: missing `@github/copilot-sdk`.
- `bun test src/sdk/clients/opencode.events.test.ts` fails to load: missing `@opencode-ai/sdk/v2/client`.

These are environment provisioning issues, not regressions introduced by this branch.
