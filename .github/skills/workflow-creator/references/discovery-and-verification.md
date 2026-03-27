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

### Structural checks (7 properties)

1. **Reachability** — all nodes reachable from start
2. **Termination** — all paths reach an end node
3. **Deadlock-freedom** — no node can get stuck
4. **Loop bounds** — all loops have bounded iterations
5. **State data-flow** — all reads have preceding writes on all paths
6. **Model validation** — models and reasoning efforts declared in `sessionConfig` are valid for each agent type
7. **Type checking** — workflow source files are free of TypeScript type errors (invalid fields, wrong function signatures, missing required properties, incorrect `sessionConfig` shapes)

### Node validation

In addition to the 7 structural checks, the verifier validates every graph node:

- **Required `name`** — every node (stage, tool, ask-user) must have a `name` field
- **Required `agent` on stages** — every agent-type node must have `agent` explicitly set (to a string or `null`)
- **Unique names** — no two nodes may share the same `name`, regardless of node type
- **Agent definition matching** — when `agent` is a non-null string, the verifier checks it against discovered agent definition files and warns if no match is found

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
  PASS  Type Checking

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
  FAIL  Type Checking: my-workflow.ts:12:5 - error TS2353: Object literal may only specify known properties, and 'reads' does not exist in type 'StageOptions'
  Errors:
    ✗ Stage "deploy" is missing required "agent" field. Set to an agent name or null.
  Warnings:
    ⚠ Stage "custom-agent" has no matching agent definition file. Available agents: planner, reviewer, worker
```

Workflows that fail verification at startup are rejected with a warning:

```
● Warning: Failed to load workflow: broken-workflow
```

The verifier exits with code 1 on any failure, making it suitable for CI pipelines.
