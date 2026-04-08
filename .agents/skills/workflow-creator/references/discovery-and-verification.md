# Discovery and Verification

## Workflow file structure

Workflows are organized per workflow name, with agent-specific implementations as subdirectories:

```
.atomic/workflows/
├── package.json                    # Depends on @bastani/atomic-workflows
├── tsconfig.json                   # TypeScript config with path alias
├── hello/
│   ├── claude/index.ts             # Claude-specific workflow
│   ├── copilot/index.ts            # Copilot-specific workflow
│   └── opencode/index.ts           # OpenCode-specific workflow
├── ralph/
│   ├── claude/index.ts             # Claude-specific workflow
│   ├── copilot/index.ts            # Copilot-specific workflow
│   ├── opencode/index.ts           # OpenCode-specific workflow
│   └── helpers/                    # Self-contained shared helpers
│       ├── prompts.ts
│       └── parsers.ts
└── <workflow-name>/
    ├── <agent>/index.ts
    └── helpers/                    # Optional shared helpers
```

## Discovery paths

Workflows are discovered from:

| Scope | Path |
|-------|------|
| **Local** | `.atomic/workflows/<name>/<agent>/index.ts` |
| **Global** | `~/.atomic/workflows/<name>/<agent>/index.ts` |

Local workflows override global ones with the same name. The `<agent>` subdirectory determines which SDK the workflow targets: `claude/`, `copilot/`, or `opencode/`.

## Export format

Every workflow file must use `export default` with a compiled workflow:

```ts
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "my-workflow",
    description: "What this workflow does",
  })
  .session({ name: "step-1", run: async (ctx) => { /* ... */ } })
  .session({ name: "step-2", run: async (ctx) => { /* ... */ } })
  .compile();
```

The `.compile()` method returns a `WorkflowDefinition` with `__brand: "WorkflowDefinition"`. The runtime checks this brand at load time.

## Validation

### Compile-time checks

The `WorkflowBuilder` enforces these rules at definition time:

1. **Non-empty workflow** — `.compile()` throws if no `.session()` calls were made
2. **Unique session names** — `.session()` throws if a duplicate `name` is detected
3. **Required workflow name** — `defineWorkflow()` throws if `name` is empty

### Provider validation warnings

The SDK includes regex-based validation for Copilot and OpenCode workflows:

- **Copilot** (`validateCopilotWorkflow`): Warns if the workflow doesn't use `ctx.serverUrl` for `CopilotClient` or doesn't call `setForegroundSessionId()`
- **OpenCode** (`validateOpenCodeWorkflow`): Warns if the workflow doesn't use `ctx.serverUrl` for `createOpencodeClient` or doesn't call `tui.selectSession()`

These are non-blocking warnings — the workflow will still load.

### Runtime brand check

At load time, the runtime verifies:
- The file has a `default` export
- The export has `__brand === "WorkflowDefinition"`
- The definition has a `name` and at least one session

## TypeScript configuration

### `tsconfig.json`

The workflow directory needs a `tsconfig.json` that maps the SDK import:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun"],
    "paths": {
      "@bastani/atomic-workflows": ["../../packages/workflow-sdk/src/index.ts"]
    }
  },
  "include": ["./**/*.ts"]
}
```

### `package.json`

```json
{
  "name": "atomic-workflows",
  "private": true,
  "dependencies": {
    "@bastani/atomic-workflows": "*"
  }
}
```

The path alias in `tsconfig.json` maps `@bastani/atomic-workflows` to the local SDK source for type checking. At runtime, Bun resolves the import via the package.json dependency.

## Type checking

Run `tsc` to catch TypeScript errors before testing:

```bash
bunx tsc --noEmit --pretty false
```

This catches:
- Invalid `SessionContext` field access
- Wrong `run()` callback signatures
- Missing required fields (`name`, `run`)
- SDK type mismatches (e.g., passing wrong types to `ctx.save()`)

## Testing

Test a workflow by running it:

```bash
atomic workflow -n <workflow-name> -a <agent> "<your prompt>"
```

Where:
- `-n` / `--name` — workflow name (matches directory name)
- `-a` / `--agent` — target agent (`claude`, `copilot`, or `opencode`)
- The quoted string is the user prompt passed as `ctx.userPrompt`
