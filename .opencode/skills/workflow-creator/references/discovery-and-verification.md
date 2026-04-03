# Discovery and Verification

## Discovery and registration

Custom workflow files are discovered from:

- `.atomic/workflows/*.ts` (local, highest priority)
- `~/.atomic/workflows/*.ts` (global)

Export your compiled workflow as the default export:

```ts
// .atomic/workflows/my-workflow.ts
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({ name: "my-workflow", description: "My custom workflow" })
  .stage({ name: "step1", agent: null, description: "Step 1", ... })
  .stage({ name: "step2", agent: "worker", description: "Step 2", ... })
  .compile();
```

The `.compile()` result is a `WorkflowDefinition` that can be used directly — no unwrapping needed.

## Verification

All workflows are verified at load time for structural correctness.

### Structural checks (6 properties)

1. **Reachability** — all nodes reachable from start
2. **Termination** — all paths reach an end node
3. **Deadlock-freedom** — no node can get stuck
4. **Loop bounds** — all loops have bounded iterations
5. **State data-flow** — all reads have preceding writes on all paths
6. **Model validation** — models and reasoning efforts declared in `sessionConfig` are valid for each agent type (includes both explicit DSL overrides and models merged from agent frontmatter `model` fields)

### Node validation

In addition to the 6 structural checks, the verifier validates every graph node:

- **Required `name`** — every node (stage, tool, ask-user) must have a `name` field
- **Required `agent` on stages** — every agent-type node must have `agent` explicitly set (to a string or `null`)
- **Unique names** — no two nodes may share the same `name`, regardless of node type
- **Agent definition matching** — when `agent` is a non-null string, the verifier checks it against discovered agent definition files and errors if no match is found

### Running the verifier

Verify all discoverable workflows (built-in + custom):

```bash
atomic workflow verify
```

Verify a specific workflow file:

```bash
atomic workflow verify .atomic/workflows/my-workflow.ts
```

### Example output

```
Verifying workflows...

Workflow "my-workflow" passed all verification checks

  PASS  Reachability
  PASS  Termination
  PASS  Deadlock-Freedom
  PASS  Loop Bounds
  PASS  State Data-Flow
  PASS  Model Validation

All workflows passed verification.
```

When verification fails, the report identifies the offending node/edge:

```
Workflow "broken-workflow" failed verification

  FAIL  Reachability: Node(s) "orphan" unreachable from start node "planner"
  PASS  Termination
  FAIL  Deadlock-Freedom: Node(s) "brancher" may deadlock
  PASS  Loop Bounds
  PASS  State Data-Flow
  PASS  Model Validation
  Errors:
    ✗ Stage "deploy" is missing required "agent" field. Set to an agent name or null.
  Errors:
    ✗ Stage "custom-agent" has no matching agent definition file. Available agents: planner, reviewer, worker
```

Workflows that fail verification at startup are rejected with a warning:

```
● Warning: Failed to load workflow: broken-workflow
```

The verifier exits with code 1 on any failure, making it suitable for CI pipelines.

## Type checking with tsc

TypeScript type-checking is **not** part of the built-in verifier. Instead, run `tsc` directly against your workflow files to catch type errors (invalid fields, wrong function signatures, missing required properties, incorrect `sessionConfig` shapes).

### Running tsc

From the workflow directory (where `tsconfig.json` is located):

```bash
bunx tsc --noEmit --pretty false
```

Or to check a specific file:

```bash
bunx tsc --noEmit --pretty false .atomic/workflows/my-workflow.ts
```

### What tsc catches

The SDK uses precise TypeScript types — `tsc` will flag:

- **Unknown fields** on `StageOptions` (e.g., `reads`, `outputs`, `onAnswer`)
- **Wrong function signatures** for `prompt`, `outputMapper`, or `execute`
- **Missing required fields** (e.g., `name`, `description`, `prompt`)
- **Invalid `sessionConfig`** field names or value types
- **Wrong `outputMapper` return type** (must be `Record<string, JsonValue>`)

### Example tsc errors

```
my-workflow.ts(12,5): error TS2353: Object literal may only specify known properties, and 'reads' does not exist in type 'StageOptions'.
my-workflow.ts(18,5): error TS2741: Property 'outputMapper' is missing in type '{ name: string; agent: null; description: string; prompt: (ctx: StageContext) => string; }'.
```

### Recommended workflow

1. Write the workflow file
2. Run `bunx tsc --noEmit` to check for type errors
3. Fix any errors
4. Run `atomic workflow verify` for structural checks
5. Test the workflow with `atomic workflow run <name>`
