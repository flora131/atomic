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
  .stage({ name: "step1", description: "Step 1", ... })
  .stage({ name: "step2", agent: "step2", description: "Step 2", ... })
  .compile();
```

The `.compile()` result is a `WorkflowDefinition` that can be used directly — no unwrapping needed.

## Verification

All workflows are verified at load time for structural correctness:

1. **Reachability** — all nodes reachable from start
2. **Termination** — all paths reach an end node
3. **Deadlock-freedom** — no node can get stuck
4. **Loop bounds** — all loops have bounded iterations
5. **State data-flow** — all reads have preceding writes on all paths

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
```

Workflows that fail verification at startup are rejected with a warning:

```
● Warning: Failed to load workflow: broken-workflow
```

The verifier exits with code 1 on any failure, making it suitable for CI pipelines.
