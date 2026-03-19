# Developer Setup

## Prerequisites
- Bun (latest)
- Git
- At least one coding agent CLI installed (claude, copilot, or opencode)

## Getting Started
1. Clone the repository
2. Run `bun install` (automatically installs git hooks via Lefthook)
3. Run `bun test` to verify setup

## Development Commands
| Command | Description |
|---------|-------------|
| `bun test` | Run all tests with coverage |
| `bun test --bail` | Stop on first failure (fast feedback) |
| `bun run typecheck` | TypeScript type checking |
| `bun run lint` | Run oxlint + sub-module boundary checks |
| `bun run lint:fix` | Auto-fix linting issues |
| `bun run dev` | Run CLI in development mode |

## Testing

### Running Tests
```bash
bun test              # Run all tests with coverage
bun test --bail       # Stop on first failure
bun test src/workflows/graph/   # Run tests for a specific module
```

### Writing Tests
- **Colocated test files**: Place `*.test.ts` next to the source file it tests
- **Import from bun:test**: `import { describe, expect, test } from "bun:test";`
- **Use describe blocks**: Group related tests logically
- **Test behavioral contracts**: Focus on inputs → outputs, not implementation details

#### Filesystem tests with cleanup
```typescript
const root = await mkdtemp(join(tmpdir(), "atomic-test-"));
try {
  // test logic
} finally {
  await rm(root, { recursive: true, force: true });
}
```

#### Typed inline mocks
```typescript
const mockClient = {
  mcp: { status: async () => ({ data: { /* ... */ } }) },
} satisfies Partial<SdkClient>;
```

### Coverage Requirements
- Coverage is measured automatically when running `bun test`
- Current threshold: configured in `bunfig.toml`
- Target: ≥85% line and function coverage

### Testing Anti-Patterns to Avoid
1. **❌ Substring matching on rendered output** — Test structured data, not concatenated strings
2. **❌ Coupling to implementation details** — Don't check color hex values, emoji characters, or internal method call counts
3. **❌ Testing private internals via type casting** — Minimize `as unknown as X` patterns. Extract logic into pure functions instead
4. **✅ Test behavioral contracts** — Focus on inputs → outputs
5. **✅ Test edge cases** — Empty inputs, partial failures, null returns, boundary values

## Pre-Commit Hooks

### What Runs
- **On commit** (parallel): `bun run typecheck` + `bun run lint` + `bun test --bail`
- **On push**: `bun test --coverage` (full coverage check)

### Skipping Hooks
For emergencies only:
```bash
git commit --no-verify
git push --no-verify
```

## Project Structure
```
src/
├── commands/          # CLI + TUI command implementations
│   ├── cli/           # CLI commands (chat, init, update, uninstall)
│   ├── tui/           # TUI slash commands + registry
│   └── catalog/       # Agent and skill discovery catalogs
├── components/        # React/OpenTUI UI components
│   ├── message-parts/ # Message part renderers (PART_REGISTRY)
│   └── tool-registry/ # Tool output renderers
├── hooks/             # Shared React hooks
├── lib/               # Domain-agnostic utilities only
├── screens/           # Top-level screen components
├── scripts/           # Build, lint, and boundary-check scripts
├── services/          # Business logic and SDK integrations
│   ├── agent-discovery/ # Agent info discovery + session registration
│   ├── agents/        # CodingAgentClient strategy + 3 SDK clients
│   ├── config/        # Multi-tier config resolution
│   ├── events/        # EventBus + stream adapters + consumers
│   ├── models/        # Model operations and transforms
│   ├── telemetry/     # Telemetry tracking and upload
│   ├── system/        # System detection, clipboard, downloads
│   ├── terminal/      # Terminal integration (tree-sitter)
│   └── workflows/     # Graph engine + Ralph workflow + runtime
├── state/             # State management
│   ├── chat/          # 8 sub-modules + shared (boundary-enforced)
│   ├── parts/         # Part store + helpers
│   ├── runtime/       # Controller + adapters
│   └── streaming/     # Pipeline reducers
├── theme/             # Palettes, icons, spacing
├── types/             # Shared type definitions (pure types, no runtime)
└── version.ts
```

## CI/CD
PRs are checked with:
1. TypeScript type checking (`bun run typecheck`)
2. Linting (`bun run lint`)
3. Tests with coverage (`bun test --coverage`)
4. Coverage uploaded to Codecov
