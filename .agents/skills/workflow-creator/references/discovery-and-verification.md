# Discovery and Verification

## Workflow file structure

Workflows are organized per workflow name, with agent-specific implementations as subdirectories:

```
.atomic/workflows/
├── tsconfig.json                   # Optional: TS path alias for editor types
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

Every workflow file must use `export default` with a compiled workflow. Pass the agent type as a generic parameter to `defineWorkflow` for precise `s.client` and `s.session` types. `ctx.stage()` takes four positional arguments: stage options, client init options, session create options, and the callback.

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
    name: "my-workflow",
    description: "What this workflow does",
  })
  .run(async (ctx) => {
    await ctx.stage({ name: "step-1" }, {}, {}, async (s) => { /* ... */ });
    await ctx.stage({ name: "step-2" }, {}, {}, async (s) => { /* ... */ });
  })
  .compile();
```

The `.compile()` method returns a `WorkflowDefinition` with `__brand: "WorkflowDefinition"`. The runtime checks this brand at load time.

## Validation

### Compile-time checks

The `WorkflowBuilder` enforces these rules at definition time:

1. **Non-empty workflow** — `.compile()` throws if no `.run()` call was made
2. **Required workflow name** — `defineWorkflow()` throws if `name` is empty

Session name uniqueness is enforced at runtime when `ctx.stage()` is called — duplicate names within the same workflow run will throw.

### Provider validation warnings

The SDK includes regex-based validation for all three providers:

- **Claude** (`validateClaudeWorkflow`): Warns on direct `createClaudeSession` or `claudeQuery` usage — the runtime now handles init/cleanup automatically. Use `s.session.query(prompt)` instead.
- **Copilot** (`validateCopilotWorkflow`): Warns on manual `new CopilotClient` or `client.createSession()` usage — the runtime auto-creates and cleans up the client and session. Use `s.client` and `s.session` instead. Pass session config as the third argument to `ctx.stage()`.
- **OpenCode** (`validateOpenCodeWorkflow`): Warns on manual `createOpencodeClient()` or `client.session.create()` usage — the runtime auto-creates the client and session. Use `s.client` and `s.session` instead. Pass client config as the second argument and session config as the third argument to `ctx.stage()`.

These are non-blocking warnings — the workflow will still load.

### Runtime brand check

At load time, the runtime verifies:
- The file has a `default` export
- The export has `__brand === "WorkflowDefinition"`
- The definition has a `name` and a `run` callback

## TypeScript configuration

### `tsconfig.json` (optional)

Workflow files run without any scaffold files — the Atomic loader registers a
Bun `onLoad` plugin that rewrites `@bastani/atomic/workflows` (and atomic's
transitive deps like `@github/copilot-sdk`, `@opencode-ai/sdk`, `zod`) to
absolute paths inside the installed atomic package at load time. No
`package.json` or `node_modules` is required in the workflow directory.

For editor type support (VS Code, tsserver), you can commit a minimal
`.atomic/workflows/tsconfig.json` that maps the SDK import to atomic's source:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun"],
    "paths": {
      "@bastani/atomic/workflows": ["../../src/sdk/workflows.ts"]
    }
  },
  "include": ["**/claude/**/*.ts", "**/copilot/**/*.ts", "**/opencode/**/*.ts", "**/helpers/**/*.ts"]
}
```

This file is purely for editor hints — the runtime does not read it.

## Type checking

Run `tsc` to catch TypeScript errors before testing:

```bash
bunx tsc --noEmit --pretty false
```

This catches:
- Invalid `SessionContext` / `WorkflowContext` field access
- Wrong session callback signatures
- Missing required fields (`name`)
- SDK type mismatches (e.g., passing wrong types to `s.save()`)
- Incorrect provider-specific method calls (e.g., calling `s.session.query()` in a Copilot workflow)

**Note on generic type parameter:** Using `defineWorkflow<"claude">()`, `defineWorkflow<"copilot">()`, or `defineWorkflow<"opencode">()` narrows `s.client` and `s.session` to the correct provider types throughout the `.run()` callback and all `ctx.stage()` callbacks. Without the type parameter, `s.client` and `s.session` resolve to a union of all provider types, which requires type guards to use provider-specific methods.

## Testing

Test a workflow by running it:

```bash
atomic workflow -n <workflow-name> -a <agent> "<your prompt>"
```

Where:
- `-n` / `--name` — workflow name (matches directory name)
- `-a` / `--agent` — target agent (`claude`, `copilot`, or `opencode`)
- The quoted string is the user prompt passed as `ctx.userPrompt`
