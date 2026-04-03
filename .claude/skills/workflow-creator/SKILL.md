---
name: workflow-creator
description: Create custom multi-agent workflows for Atomic CLI using the defineWorkflow() chainable DSL. Use this skill whenever the user wants to create a workflow, build an agent pipeline, define a multi-stage automation, set up a review loop, or connect multiple coding agents together. Also trigger when they mention workflow files, .atomic/workflows/, defineWorkflow, or ask how to automate a sequence of agent tasks — even if they don't use the word "workflow" explicitly.
---

# Workflow Creator

You are a workflow architect specializing in the Atomic CLI `defineWorkflow()` chainable DSL. Your role is to translate user intent into well-structured, verification-passing workflow files that orchestrate multiple coding agent stages.

## Reference Files

Load the topic-specific reference files from `references/` as needed. Start with `getting-started.md` for a quick-start example, then consult the others based on the task:

| File | When to load |
|---|---|
| `getting-started.md` | Always — quick-start example, SDK exports, and reference index |
| `nodes/stage.md` | Creating agent stages (`name`, `agent`, `prompt`, `outputMapper`), `StageContext` fields, `StageOutput` shape |
| `nodes/tool.md` | Adding deterministic computation (validation, I/O, transforms), Zod schema validation |
| `nodes/ask-user-question.md` | Collecting user input mid-workflow |
| `control-flow.md` | Conditionals (`.if()`) or bounded loops (`.loop()` / `.break()`) |
| `state-and-reducers.md` | Custom state fields, reducers, type inference via `InferState`, data flow |
| `session-config.md` | Per-stage model, reasoning, or permission overrides |
| `discovery-and-verification.md` | File discovery, export format, verifier CLI, tsc type checking |

## Before You Start

Before designing a workflow, discover what agents are available:

```bash
atomic list agents
```

This shows all agent definitions from project-level directories (`.claude/agents/`, `.opencode/agents/`, `.github/agents/`) **and** global directories (`~/.claude/agents/`, `~/.opencode/agents/`, `~/.copilot/agents/`). Use these names in `.stage({ agent: "<name>" })`, or set `agent: null` to inherit SDK default instructions.

## How Workflows Work

A workflow is a TypeScript file that chains `.stage()`, `.tool()`, `.askUserQuestion()`, `.if()`, `.loop()`, and other methods to define a directed graph of agent stages. The chain reads top-to-bottom as the execution order. At the end, `.compile()` produces a branded `CompiledWorkflow` blueprint that the CLI binary compiles at load time.

Each `.stage()` launches a fresh agent session with its own context window. The `prompt` function builds what the agent sees, and `outputMapper` extracts structured data from its response for downstream stages to consume.

Workflows are saved to `.atomic/workflows/<name>.ts` (local) or `~/.atomic/workflows/<name>.ts` (global), and exported as the default export.

## Authoring Process

### 1. Understand the User's Goal

Map the user's intent to DSL constructs:

| Question | Maps to |
|----------|---------|
| What are the distinct steps? | Each step → `.stage()` |
| Does any step need deterministic computation (no LLM)? | → `.tool()` |
| Do any steps need to repeat? | → `.loop()` / `.break()` / `.endLoop()` |
| Are there conditional paths? | → `.if()` / `.elseIf()` / `.else()` / `.endIf()` |
| What data flows between steps? | → `outputMapper` return keys (auto-inferred) |
| Does the workflow need user input? | → `.askUserQuestion()` |
| Do any steps need a specific model? | → `sessionConfig` with per-agent-type model |
| Does a tool need to validate data shapes? | → Zod schemas from the SDK (see `nodes/tool.md`) |

### 2. Discover Available Agents

Before designing stages, find out which agent definitions already exist. Agents are discovered from both **project-level** and **global (user-level)** directories:

```bash
atomic list agents
```

This lists all discovered agents with their source (project or global) and description. Use these names directly in `.stage({ agent: "<name>" })`. If no existing agent fits, create a new one (see `nodes/stage.md`). Set `agent: null` to run with the SDK's default session instructions (no custom system prompt).

**Why this matters for verification:** The verifier resolves agent names against **all** discovered agent definitions — including global ones installed at `~/.claude/agents/`, `~/.opencode/agents/`, and `~/.copilot/agents/`. A workflow referencing an agent like `"worker"` will pass verification if that agent exists in *any* discovery path (project or global), even if it is not visible in the project directory. Always run `atomic list agents` to see the full picture.

### 3. Design the Stage Graph

Map the user's intent to a sequence of stages. Every stage requires these fields:

| Field | Purpose |
|-------|---------|
| **`name`** | Unique identifier for this stage. Used as the key in `ctx.stageOutputs.get("<name>")` for downstream access. |
| **`agent`** | Which agent definition to invoke. Set to an agent name (e.g., `"planner"`) or `null` for SDK default instructions. **Required — must be explicitly set.** |
| **`description`** | Short label for logging (use emoji prefixes: ⌕ 🔍 ⚡ 🔧 📋 ✨) |
| **`prompt`** | Function receiving `StageContext` that builds the prompt text. Has access to `ctx.userPrompt`, `ctx.stageOutputs`, `ctx.state`, and `ctx.tasks`. |
| **`outputMapper`** | Function that extracts structured data from the raw response string. Returns `Record<string, JsonValue>`. |

Think of `name` as the database key and `agent` as the worker type. A `"writer"` agent could power both a `"draft"` stage and a `"revise"` stage — each referenced by its own `name`. Set `agent: null` when you want the raw SDK behavior without a custom system prompt.

### 4. Write the Workflow File

Follow this template:

```ts
// .atomic/workflows/<workflow-name>.ts
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "<workflow-name>",
    description: "<what this workflow does>",
    // Optional: declare custom state fields (types are auto-inferred)
    globalState: {
      // fieldName: { default: <value>, reducer: "<strategy>" },
    },
  })
  .version("1.0.0")
  .argumentHint("<task-description>")
  .stage({
    name: "<unique-stage-name>",
    agent: "<agent-definition-name>",  // or null for SDK defaults
    description: "<STAGE LABEL>",
    prompt: (ctx) => `Your prompt using ${ctx.userPrompt}`,
    outputMapper: (response) => ({ /* structured output */ }),
  })
  .compile();
```

When you declare `globalState`, the SDK infers types automatically — `ctx.state.fieldName` in prompt functions will have the correct type based on the `default` value. For example, `{ default: 0, reducer: "sum" }` gives `ctx.state.fieldName` the type `number`. See `state-and-reducers.md` for details.

### 5. Type-Check the Workflow

Before running the verifier, run `tsc` to catch TypeScript errors:

```bash
bunx tsc --noEmit --pretty false
```

This catches invalid fields, wrong function signatures, missing required properties, and incorrect `sessionConfig` shapes. Fix all errors before proceeding.

### 6. Verify the Workflow

After writing, run the workflow verifier:

```bash
atomic workflow verify .atomic/workflows/<workflow-name>.ts
```

This runs 6 structural checks plus node validation:

1. **Reachability** — all nodes reachable from start
2. **Termination** — all paths reach an end node
3. **Deadlock-freedom** — no node can get stuck
4. **Loop bounds** — all loops have bounded iterations
5. **State data-flow** — all reads have preceding writes on all paths
6. **Model validation** — models and reasoning efforts in `sessionConfig` are valid

The verifier also enforces:
- Every node has a `name` field
- Every agent-type node has an `agent` field (string or null)
- No duplicate node names across all node types
- Agent names reference valid agent definition files (error if not found)

All checks must pass. The verifier exits with code 1 on failure, making it CI-ready.

## Key Patterns

### Linear Pipeline

```ts
defineWorkflow({ name: "pipeline", description: "Sequential pipeline" })
  .stage({ name: "analyze", agent: "analyzer", ... })
  .stage({ name: "implement", agent: null, ... })
  .stage({ name: "test", agent: "tester", ... })
  .compile();
```

### Review Loop

```ts
defineWorkflow({ name: "review-loop", description: "Iterative review" })
  .stage({ name: "implement", agent: null, ... })
  .loop({ maxCycles: 5 })
    .stage({ name: "review", agent: "reviewer", ... })
    .break(() => (state) => state.reviewResult?.allPassing === true)
    .stage({ name: "fix", agent: null, ... })
  .endLoop()
  .compile();
```

### Conditional Branching

```ts
defineWorkflow({ name: "branching", description: "Conditional routing" })
  .stage({ name: "triage", agent: "planner", ... })
  .if((ctx) => ctx.stageOutputs.get("triage")?.parsedOutput?.type === "bug")
    .stage({ name: "fix-bug", agent: null, ... })
  .elseIf((ctx) => ctx.stageOutputs.get("triage")?.parsedOutput?.type === "feature")
    .stage({ name: "build-feature", agent: null, ... })
  .else()
    .stage({ name: "research", agent: "researcher", ... })
  .endIf()
  .compile();
```

### Human-in-the-Loop

```ts
import { defineWorkflow, USER_DECLINED_ANSWER } from "@bastani/atomic-workflows";

// ...
.askUserQuestion({
  name: "approve-plan",
  question: {
    question: "Approve this implementation plan?",
    options: [{ label: "Approve" }, { label: "Reject" }],
  },
  // USER_DECLINED_ANSWER is passed when the user presses ESC / Ctrl+C
  outputMapper: (answer) => ({
    planApproved: answer !== USER_DECLINED_ANSWER && answer === "Approve",
  }),
})
// __userDeclined is set automatically by the compiler — no need to set it in outputMapper
.if((ctx) => ctx.state.__userDeclined === true)
  // User pressed ESC/Ctrl+C — skip gracefully
  .tool({ name: "log-cancel", execute: async () => ({ cancelled: true }) })
.elseIf((ctx) => ctx.state.planApproved === true)
  .stage({ name: "implement", agent: null, ... })
.else()
  .stage({ name: "re-plan", agent: "planner", ... })
.endIf()
```

### Custom State with Reducers

```ts
defineWorkflow({
    name: "stateful",
    description: "With custom state",
    globalState: {
      findings: { default: () => [], reducer: "concat" },
      score: { default: 0, reducer: "max" },
      tasks: { default: () => [], reducer: "mergeById", key: "id" },
    },
  })
  // ...stages...
  .compile();
```

Built-in reducers: `replace` (default), `concat`, `merge`, `mergeById`, `max`, `min`, `sum`, `or`, `and`. Custom functions also work: `reducer: (current, update) => ...`.

Use factory functions (`() => []`) for mutable defaults like arrays and objects.

### Per-Stage Session Config

```ts
.stage({
  name: "deep-review",
  agent: "reviewer",
  description: "🔍 DEEP REVIEW",
  prompt: (ctx) => `Thoroughly review: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ reviewResult: JSON.parse(response) }),
  sessionConfig: {
    model: { claude: "opus", copilot: "claude-sonnet-4.6" },
    reasoningEffort: { claude: "high" },
    maxThinkingTokens: 32000,
  },
})
```

### Validation with Zod Schemas

The SDK exports Zod schemas for runtime validation — especially useful in `.tool()` nodes:

```ts
import { defineWorkflow, TaskItemSchema } from "@bastani/atomic-workflows";

// ... in a tool node:
.tool({
  name: "validate-tasks",
  execute: async (ctx) => {
    const result = TaskItemSchema.array().safeParse(ctx.state.tasks);
    return { tasksValid: result.success, validationErrors: result.error?.issues ?? [] };
  },
})
```

Available schemas: `TaskItemSchema`, `StageOutputSchema`, `SessionConfigSchema`, `AgentTypeSchema`, `AskUserQuestionConfigSchema`, `JsonValueSchema`.

## Type System

The SDK uses precise types — **no `unknown` or `any`**. All data flowing between stages is typed as `JsonValue`:

```ts
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
```

When you provide `globalState`, the SDK uses `InferState` to derive a concrete type from your field defaults. This means `ctx.state` in prompt functions and `.if()` conditions is fully typed — `ctx.state.count` will be `number` if `default: 0`, `ctx.state.items` will be `string[]` if `default: () => [] as string[]`, etc.

The SDK also exports Zod schemas for runtime validation in `.tool()` nodes: `TaskItemSchema`, `StageOutputSchema`, `SessionConfigSchema`, `AgentTypeSchema`, `AskUserQuestionConfigSchema`, `JsonValueSchema`. See `nodes/tool.md` for usage patterns.

## Structural Rules

These are enforced by the builder and compiler at build time:

1. **`name` and `agent` required on stages** — `name` is the unique stage key, `agent` selects the agent definition (or `null` for SDK defaults). Both must be explicitly set.
2. **Unique node names** — every `name` must be unique across all `.stage()`, `.tool()`, and `.askUserQuestion()` calls.
3. **`.compile()` required** — the chain must end with `.compile()`.
4. **Balanced control flow** — every `.if()` needs `.endIf()`, every `.loop()` needs `.endLoop()`.
5. **`.break()` inside loops only** — `.break()` can only appear inside `.loop()` / `.endLoop()`.
6. **Non-empty branches** — every branch in a conditional block must contain at least one node.
7. **`export default` required** — workflow files must use `export default` for discovery.
8. **Forward-only data flow** — `ctx.stageOutputs.get("<name>")` only has data from already-executed stages. The compiler auto-infers reads/outputs and the verifier validates all paths.

## Agent Discovery and Resolution

The verifier resolves `agent` values against agent definition files discovered from **both project-level and global directories**. Understanding this is critical for debugging verification results.

### Discovery paths

| Scope | Directories searched |
|-------|---------------------|
| **Project** | `.claude/agents/`, `.opencode/agents/`, `.github/agents/` (relative to project root) |
| **Global** | `~/.claude/agents/`, `~/.opencode/agents/`, `~/.copilot/agents/` |

Project agents take priority over global agents when names collide (same name, different source). The verifier deduplicates by name.

### Why verification passes for "unknown" agents

When `agent: "worker"` passes verification but no `worker.md` exists in the project directory, the agent exists at **global** scope (e.g., `~/.copilot/agents/worker.md`). Global agents are first-class — they are discoverable by the verifier and usable at runtime.

Run `atomic list agents` to see all available agents with their source:

```bash
atomic list agents
# Output:
#   Project agents (3):
#     planner  Decomposes user prompts into structured task lists.
#     reviewer  Code reviewer for proposed code changes.
#     worker   Implement a SINGLE task from a task list.
#
#   Global agents (2):
#     debugger  Debug errors, test failures, and unexpected behavior.
#     researcher  Online research agent.
```

### Choosing an agent value

- **Named agent** (`agent: "planner"`) — the verifier checks that a matching `.md` file exists in any discovery path. The agent file's markdown body becomes the stage's system prompt.
- **`null`** (`agent: null`) — no agent definition is loaded. The stage runs with the SDK's default session instructions (e.g., Claude Code preset, Copilot guardrails). Use this for general-purpose implementation stages that don't need a specialized system prompt.

Always run `atomic list agents` first to see what's available before creating new agent definitions.

## The `task_list` Tool

The `task_list` tool provides SQLite-backed CRUD operations for managing tasks within a workflow session. It is the primary mechanism for tracking work items across stages and is automatically available to agent stages that declare it in their `tools` frontmatter.

### When to use `task_list` in workflows

Use `task_list` when your workflow needs to:
- **Plan work** — a planner stage creates tasks with `create_tasks`, then worker stages consume them
- **Track progress** — worker stages update task status with `update_task_status` and log progress with `update_task_progress`
- **Coordinate parallel work** — tasks have `blockedBy` arrays for dependency management, enabling the orchestrator to maximize parallel execution

### Available actions

| Action | Required Fields | Description |
|--------|----------------|-------------|
| `create_tasks` | `tasks[]` | Bulk-create tasks (INSERT OR REPLACE) |
| `list_tasks` | — | Return all tasks |
| `add_task` | `task` | Add a single task |
| `update_task_status` | `taskId`, `status` | Update a task's status (`pending`, `in_progress`, `completed`, `error`) |
| `update_task_blockedBy` | `taskId`, `blockedBy[]` | Update a task's dependency list |
| `update_task_progress` | `taskId`, `progress` | Append a progress log entry |
| `get_task_progress` | `taskId` | Retrieve progress entries for a task |
| `delete_task` | `taskId` | Delete a task and clean up dependencies |
| `clear_progress` | `taskId` | Clear all progress entries for a task |

### Referencing `task_list` in agent definitions

Agent definitions declare tool access in their frontmatter. The `task_list` tool must be listed for any agent that needs to read or write tasks:

```yaml
# .github/agents/planner.md
---
name: planner
description: Decomposes user prompts into structured task lists.
tools: ["search", "read", "execute", "task_list"]
---
```

### Using tasks in workflow stages

The current task list is available in `StageContext.tasks` for prompt functions:

```ts
.stage({
  name: "implement",
  agent: "worker",
  description: "⚡ WORKER",
  prompt: (ctx) => {
    const pending = ctx.tasks.filter(t => t.status === "pending");
    return `Implement the highest priority task:\n${JSON.stringify(pending[0])}`;
  },
  outputMapper: () => ({}),
})
```

### Task schema

Each task item has these fields:

```ts
interface TaskItem {
  id: string;              // Unique task identifier (kebab-case recommended)
  description: string;     // Human-readable task description
  status: string;          // "pending" | "in_progress" | "completed" | "error"
  summary: string;         // Present-participle phrase (e.g., "Fixing bug")
  blockedBy?: string[];    // Task IDs this task depends on
}
```

The SDK exports `TaskItemSchema` (Zod) for runtime validation in `.tool()` nodes:

```ts
import { defineWorkflow, TaskItemSchema } from "@bastani/atomic-workflows";

.tool({
  name: "validate-tasks",
  execute: async (ctx) => {
    const result = TaskItemSchema.array().safeParse(ctx.state.tasks);
    return { tasksValid: result.success };
  },
})
```
