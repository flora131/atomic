# Discovery and Verification

## Setup

```bash
bun init                                   # Create a new project
bun add @bastani/atomic                    # Install the workflow SDK
bun add @github/copilot-sdk               # For Copilot workflows
bun add @anthropic-ai/claude-agent-sdk    # For Claude workflows
bun add @opencode-ai/sdk                  # For OpenCode workflows
```

Install only the agent SDK(s) you need.

Create workflow files at `.atomic/workflows/<name>/<agent>/index.ts`.

## Workflow file structure

```
.atomic/workflows/
├── my-workflow/
│   ├── claude/index.ts
│   ├── copilot/index.ts
│   └── opencode/index.ts
└── my-other-workflow/
    ├── claude/index.ts
    ├── copilot/index.ts
    ├── opencode/index.ts
    └── helpers/
        ├── prompts.ts
        └── parsers.ts
```

The SDK ships two built-in workflows as reference implementations:
- **`ralph`** — iterative plan → orchestrate → review → debug loop (`src/sdk/workflows/builtin/ralph/`)
- **`deep-research-codebase`** — deterministic scout → parallel explorers → aggregator (`src/sdk/workflows/builtin/deep-research-codebase/`)

Built-in workflows are **reserved** — a local or global workflow with the
same name cannot shadow the built-in at resolution time. Pick distinct names
for your own workflows. In installed projects, built-ins are resolved from
the SDK package's bundled `workflows/builtin/` directory.

## Discovery paths

| Scope | Path | Resolution |
|-------|------|------------|
| **Built-in** | SDK modules shipped with `@bastani/atomic` | **Reserved** — cannot be shadowed by local or global workflows of the same name |
| **Local** | `.atomic/workflows/<name>/<agent>/index.ts` | Highest precedence among non-reserved names |
| **Global** | `~/.atomic/workflows/<name>/<agent>/index.ts` | Lowest precedence among non-reserved names |

Built-in workflow names (`ralph`, `deep-research-codebase`) are dropped from user sources before any merge. For non-reserved names, local overrides global.

The `<agent>` subdirectory determines which SDK the workflow targets: `claude/`, `copilot/`, or `opencode/`.

## Workflows directory hygiene

The workflows directory maintains its own auto-generated `.gitignore`. The
runtime regenerates it if missing and uses it during discovery, so ignored
directories such as `node_modules/`, `dist/`, `build/`, `coverage/`, `.cache/`,
and `*.tsbuildinfo` do not pollute workflow discovery.

## Export format

Every workflow file must use `export default` with a compiled workflow:

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

Standard module resolution handles all imports. The project's `tsconfig.json` should use `"moduleResolution": "bundler"` (Bun's default).

## Type checking

Run the project's typecheck script to catch TypeScript errors before testing:

```bash
bun typecheck
```

This catches:
- Invalid `SessionContext` / `WorkflowContext` field access
- Wrong session callback signatures
- Missing required fields (`name`)
- SDK type mismatches (e.g., passing wrong types to `s.save()`)
- Incorrect provider-specific method calls (e.g., calling `s.session.query()` in a Copilot workflow)

**Note on generic type parameter:** Using `defineWorkflow<"claude">()`, `defineWorkflow<"copilot">()`, or `defineWorkflow<"opencode">()` narrows `s.client` and `s.session` to the correct provider types throughout the `.run()` callback and all `ctx.stage()` callbacks. Without the type parameter, `s.client` and `s.session` resolve to a union of all provider types, which requires type guards to use provider-specific methods.

## Testing

Run a free-form workflow by passing the prompt as a positional argument:

```bash
atomic workflow -n <workflow-name> -a <agent> "<your prompt>"
```

Where:
- `-n` / `--name` — workflow name (matches directory name)
- `-a` / `--agent` — target agent (`claude`, `copilot`, or `opencode`)
- The quoted string is the user prompt, which the runtime stores under `ctx.inputs.prompt` so workflow authors can read it via `ctx.inputs.prompt ?? ""`

Run a workflow with declared inputs by passing one `--<field>=<value>` flag per entry in its schema:

```bash
atomic workflow -n <workflow-name> -a <agent> --field_a=value --field_b=value
```

Or discover and run any workflow interactively through the picker:

```bash
atomic workflow -a <agent>
```

See `workflow-inputs.md` for the full `WorkflowInput` schema shape, validation rules, and picker behaviour.
