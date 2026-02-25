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
| `bun run lint` | Run oxlint |
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
├── commands/      # CLI command implementations
├── config/        # Configuration loading and merging
├── graph/         # Graph workflow engine
├── models/        # Model operations and management
├── sdk/           # SDK adapters (OpenCode, Claude, Copilot)
├── telemetry/     # Telemetry and monitoring
├── ui/            # UI components, commands, tools, utils
├── utils/         # Shared utilities
└── workflows/     # Workflow definitions
```

## CI/CD
PRs are checked with:
1. TypeScript type checking (`bun run typecheck`)
2. Linting (`bun run lint`)
3. Tests with coverage (`bun test --coverage`)
4. Coverage uploaded to Codecov
