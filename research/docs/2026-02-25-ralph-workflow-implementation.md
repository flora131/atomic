# Ralph Workflow Implementation

Technical documentation of the Ralph autonomous implementation workflow, the graph
execution engine infrastructure it builds on, session management, and reusable
workflow templates.

---

## 1. Ralph Graph (`src/workflows/ralph/graph.ts`)

### Overview

`createRalphWorkflow()` (line 98) constructs a three-phase compiled graph typed
over `RalphWorkflowState`. The function returns a `CompiledGraph<RalphWorkflowState>`
produced by the fluent `GraphBuilder` API. The three phases are:

1. **Task Decomposition** (Phase 1) -- a planner sub-agent decomposes a user
   prompt into a structured task list, then a tool node parses the output.
2. **Worker Loop** (Phase 2) -- iteratively selects ready tasks and dispatches a
   worker sub-agent until all tasks are complete, errored, or the iteration cap
   is reached.
3. **Review & Fix** (Phase 3) -- a reviewer sub-agent evaluates the completed
   work, and a conditional fixer sub-agent applies corrections if the review
   finds actionable issues.

### Utility Functions (lines 35--84)

Three pure utility functions support the worker loop:

| Function | Lines | Purpose |
|---|---|---|
| `parseTasks(content)` | 35--52 | Parses LLM text output into `TaskItem[]`. Tries `JSON.parse` first; falls back to a regex extraction of the first `[...]` block. Returns `[]` on failure. |
| `getReadyTasks(tasks)` | 57--73 | Filters tasks to those with `status === "pending"` whose `blockedBy` dependencies are all in a completed set. Normalises IDs by trimming, lowercasing, and stripping leading `#`. Recognises `"completed"`, `"complete"`, and `"done"` as finished statuses. |
| `hasActionableTasks(tasks)` | 78--84 | Returns `true` if any task is `"in_progress"` or is a pending task that `getReadyTasks` considers ready. Used as part of the loop exit condition. |

### Phase 1: Task Decomposition (lines 100--123)

Two nodes chained sequentially via the fluent builder:

#### Node 1: `planner` (subagent, lines 101--110)

- Builder method: `.subagent({ ... })` which internally creates a
  `subagentNode` via `src/workflows/graph/nodes.ts:1664`.
- Agent name: `"planner"`.
- Task prompt: `buildSpecToTasksPrompt(state.yoloPrompt ?? "")`.
- `outputMapper` (lines 105--107): maps `result.output` to `{ specDoc: result.output ?? "" }`.

#### Node 2: `parse-tasks` (tool, lines 111--123)

- Builder method: `.tool({ ... })` which internally creates a `toolNode`.
- `execute` (line 114): calls `parseTasks(args.specDoc)`.
- `args` (line 115): reads `state.specDoc`.
- `outputMapper` (lines 116--120): sets `tasks`, `currentTasks`, and resets
  `iteration` to `0`.

### Phase 2: Worker Loop (lines 126--187)

Constructed via `.loop(bodyNodes, config)` on the builder (see
`src/workflows/graph/builder.ts:647`). The loop body is an array of two nodes:

#### Node 3: `select-ready-tasks` (tool, lines 128--138)

- Created with the `toolNode` factory.
- `execute`: calls `getReadyTasks(args.tasks)`.
- `args`: reads `state.tasks`.
- `outputMapper`: replaces `currentTasks` with the ready tasks.

#### Node 4: `worker` (custom `NodeDefinition`, lines 141--178)

- Implemented as a raw `NodeDefinition<RalphWorkflowState>` (satisfies check at
  line 178) rather than using the `subagentNode` factory. This allows the node
  to handle worker failures gracefully.
- `type`: `"agent"`, `id`: `"worker"`.
- `retry`: `{ maxAttempts: 1, backoffMs: 0, backoffMultiplier: 1 }` -- no
  retries.
- Execution flow (lines 147--177):
  1. Retrieves the `SubagentGraphBridge` from `ctx.config.runtime?.subagentBridge`
     (line 148). Throws if absent.
  2. Takes the first ready task from `ctx.state.currentTasks` (line 153).
  3. Builds a worker prompt via `buildWorkerAssignment(task, ctx.state.tasks)`
     (line 155).
  4. Spawns a sub-agent with `agentId: "worker-{taskId}"`, `agentName: "worker"`
     (lines 158--163).
  5. Returns a `stateUpdate` that:
     - Increments `iteration` by 1 (line 167).
     - Maps over all tasks: any task that was in `currentTasks` gets its status
       set to `"completed"` if the bridge result was successful, or `"error"`
       otherwise (lines 168--174).

#### Loop Exit Condition (lines 181--186)

The `until` predicate (line 181) returns `true` when:
- All tasks have status `"completed"` or `"error"`, **OR**
- `state.iteration >= state.maxIterations`, **OR**
- `hasActionableTasks(state.tasks)` returns `false`.

The hard safety cap `maxIterations` on the loop config itself is `100` (line 186).

### Phase 3: Review & Fix (lines 189--235)

#### Node 5: `reviewer` (subagent, lines 190--208)

- Agent name: `"reviewer"`.
- Task prompt: `buildReviewPrompt(tasks, yoloPrompt, progressFilePath)` where
  `progressFilePath` is `"{ralphSessionDir}/progress.txt"` (line 197).
- `outputMapper` (lines 199--205): calls `parseReviewResult(result.output)`; on
  null, provides a default `ReviewResult` with empty findings and
  `overall_correctness: "patch is correct"`.

#### Conditional Fixer (lines 210--234)

- Built with `.if({ condition, then })` config-based syntax (see
  `src/workflows/graph/builder.ts:394`).
- `condition` (lines 211--214): fires when `reviewResult` is non-null **AND**
  has at least one finding **AND** `overall_correctness` is not `"patch is
  correct"`.
- `then` branch contains a single node:

##### Node 6: `fixer` (subagent, lines 216--232)

- Created with the `subagentNode` factory.
- Agent name: `"debugger"`.
- Task prompt: `buildFixSpecFromReview(reviewResult, tasks, yoloPrompt)` (lines
  219--225). Returns `"No fixes needed"` if the spec is empty.
- `outputMapper`: sets `{ fixesApplied: true }`.

### Compiled Graph Structure

After `.compile()` (line 235), the graph contains:

| Node ID | Type | Factory |
|---|---|---|
| `planner` | agent | `subagentNode` via `.subagent()` |
| `parse-tasks` | tool | `toolNode` via `.tool()` |
| `select-ready-tasks` | tool | `toolNode` (inside loop body) |
| `worker` | agent | Raw `NodeDefinition` (inside loop body) |
| `reviewer` | agent | `subagentNode` via `.subagent()` |
| `fixer` | agent | `subagentNode` (inside `.if()` then-branch) |

Plus auto-generated structural nodes from the builder:
- `loop_start_*`, `loop_check_*` (decision nodes for loop iteration control)
- `decision_*` (decision node for the `.if()` conditional)
- `merge_*` (merge node to rejoin after the conditional)

---

## 2. Ralph State (`src/workflows/ralph/state.ts`)

### `RalphWorkflowState` Interface (lines 51--80)

The interface contains 30 fields. They can be grouped as follows:

#### Base State Fields (from `BaseState` in `src/workflows/graph/types.ts:114--121`)

| Field | Type | Purpose |
|---|---|---|
| `executionId` | `string` | Unique ID for this graph execution |
| `lastUpdated` | `string` | ISO timestamp of last state mutation |
| `outputs` | `Record<NodeId, unknown>` | Map of node outputs keyed by node ID |

#### Workflow Pipeline Fields (shared with AtomicWorkflowState)

| Field | Type | Purpose |
|---|---|---|
| `researchDoc` | `string` | Research document content |
| `specDoc` | `string` | Specification document content |
| `specApproved` | `boolean` | Whether the spec has been approved |
| `tasks` | `TaskItem[]` | Full task list |
| `currentTasks` | `TaskItem[]` | Tasks selected for current iteration |
| `reviewResult` | `ReviewResult \| null` | Reviewer output |
| `fixesApplied` | `boolean` | Whether fixer ran |
| `featureList` | `Feature[]` | Feature list entries |
| `currentFeature` | `Feature \| null` | Currently active feature |
| `allFeaturesPassing` | `boolean` | Whether all features pass |
| `contextWindowUsage` | `ContextWindowUsage \| null` | Token tracking |
| `iteration` | `number` | Current worker loop iteration |
| `prUrl` | `string \| null` | Pull request URL |
| `debugReports` | `DebugReport[]` | Accumulated debug reports |
| `prBranch` | `string \| undefined` | PR branch name |
| `completedFeatures` | `string[]` | List of completed feature descriptions |
| `sourceFeatureListPath` | `string \| undefined` | Path to feature list source file |
| `maxIterationsReached` | `boolean \| undefined` | Flag if iteration cap was hit |

#### Ralph-Specific Fields

| Field | Type | Purpose |
|---|---|---|
| `ralphSessionId` | `string` | UUID for the Ralph session |
| `ralphSessionDir` | `string` | Filesystem path `~/.atomic/workflows/sessions/{id}` |
| `yolo` | `boolean` | Whether running in yolo (autonomous) mode |
| `yoloPrompt` | `string \| null` | The user's original prompt |
| `yoloComplete` | `boolean` | Whether yolo execution finished |
| `maxIterations` | `number` | Worker loop iteration cap |
| `shouldContinue` | `boolean` | Continuation flag |

### State Annotation System (`RalphStateAnnotation`, lines 82--119)

The annotation object maps each field name to an `Annotation<T>` created by the
local `annotation()` helper (line 9), which mirrors the public
`annotation()` from `src/workflows/graph/annotation.ts:184`.

Each `Annotation<T>` contains:
- `default`: a static value or factory function.
- `reducer`: an optional `Reducer<T>` that controls how state updates merge.

Notable reducer assignments:

| Field | Reducer | Behavior |
|---|---|---|
| `tasks` | `mergeByIdReducer<TaskItem>("id")` (line 91) | Merges task arrays by `id` field; existing tasks with matching IDs are shallow-merged with update. |
| `currentTasks` | `(current, update) => update` (line 92) | Always replaces with the update value. |
| `featureList` | `mergeByIdReducer<Feature>("description")` (line 96) | Merges features by `description`. |
| `debugReports` | `concatReducer` (line 100) | Appends new reports to existing array. |
| `completedFeatures` | `concatReducer` (line 116) | Appends new entries. |

All other fields use the implicit default reducer (`Reducers.replace` from
`src/workflows/graph/annotation.ts:72`), which replaces the current value
entirely.

#### Custom Reducers (lines 16--49)

Two reducers are defined locally in `state.ts`:

1. **`concatReducer<T>`** (lines 16--20): concatenates two arrays, guarding
   against non-array inputs.
2. **`mergeByIdReducer<T>(idField)`** (lines 22--49): returns a reducer that
   merges two object arrays by a specified ID field. Items in the update array
   with matching IDs are shallow-merged onto existing items; new IDs are
   appended.

### State Factory: `createRalphState()` (lines 128--156)

1. Calls `initializeState(RalphStateAnnotation)` to produce an object with all
   annotation defaults (line 132).
2. Generates a `ralphSessionId` via `crypto.randomUUID()` (line 133).
3. Spreads the initialized state, applies specific overrides from `options`, and
   computes `ralphSessionDir` as
   `~/.atomic/workflows/sessions/{ralphSessionId}` (line 144).
4. Spreads `...options` last (line 154), allowing callers to override any field.

### State Update: `updateRalphState()` (lines 165--174)

Delegates to `applyStateUpdate(RalphStateAnnotation, current, update)` from the
annotation module (`src/workflows/graph/annotation.ts:265`), which iterates each
key in the update and applies the field's reducer. Then stamps `lastUpdated`
with the current ISO timestamp.

### Type Guard: `isRalphWorkflowState()` (lines 179--209)

Checks for the presence and type of all mandatory fields across three groups:
base state fields, atomic workflow fields, and Ralph-specific fields.

---

## 3. Ralph Prompts (`src/workflows/ralph/prompts.ts`)

### Types (lines 15--21, 141--158)

- **`TaskItem`** (lines 15--21): `{ id?: string; content: string; status: string; activeForm: string; blockedBy?: string[] }`.
- **`ReviewFinding`** (lines 141--150): includes `title`, `body`,
  `confidence_score?`, `priority?`, and optional `code_location` with
  `absolute_file_path` and `line_range`.
- **`ReviewResult`** (lines 153--158): `{ findings: ReviewFinding[]; overall_correctness: string; overall_explanation: string; overall_confidence_score?: number }`.

### Helper: `isCompletedStatus()` (lines 23--30)

Normalises a status string (trim + lowercase) and returns `true` for
`"completed"`, `"complete"`, or `"done"`.

### Phase 1: `buildSpecToTasksPrompt(specContent)` (lines 37--77)

Constructs a prompt that:
- Wraps `specContent` in `<specification>` XML tags (lines 42--44).
- Defines the output JSON schema with fields `id`, `content`, `status`,
  `activeForm`, `blockedBy` (lines 50--60).
- Provides field definitions (lines 63--68).
- Includes ordering/dependency guidelines (lines 72--75).
- Instructs the LLM to output only the JSON array with no surrounding text
  (line 76).

### Phase 2: `buildWorkerAssignment(task, allTasks)` (lines 84--134)

Constructs a worker prompt with up to four sections:

1. **Task Assignment header** (lines 122--126): shows `**Task ID:**` and
   `**Task:**` with the current task's details.
2. **Dependencies section** (lines 104--111, conditionally included): lists each
   `blockedBy` entry with its content from `allTasks`, or `"(not found)"` if the
   dependency ID is missing. Omitted when `blockedBy` is empty or undefined.
3. **Completed Tasks section** (lines 113--120, conditionally included): lists
   all tasks matching `isCompletedStatus()`. Omitted when none are completed.
4. **Instructions section** (lines 127--133): directs the worker to focus solely
   on the task, implement until complete and tested, not modify unrelated tasks,
   and record errors.

### Phase 3a: `buildReviewPrompt(tasks, userPrompt, progressFilePath)` (lines 161--247)

Constructs a code review prompt with:
- The original user request in `<user_request>` XML tags (lines 177--179).
- A list of completed tasks (lines 166--169).
- A reference to the progress file path (line 189).
- Six review focus areas: Correctness, Error Handling, Edge Cases, Security,
  Performance, Test Coverage (lines 195--206).
- A JSON output schema defining `findings`, `overall_correctness`,
  `overall_explanation`, `overall_confidence_score` (lines 209--229).
- Priority definitions P0--P3 (lines 233--236).
- Guidelines directing the reviewer to set `overall_correctness` to
  `"patch is incorrect"` only for P0/P1 issues (line 244).

### Phase 3b: `buildFixSpecFromReview(review, tasks, userPrompt)` (lines 250--316)

Returns `""` if findings are empty (lines 256--262). Otherwise builds a document
with:
- The original user prompt (line 269).
- The review verdict (lines 273--274).
- Findings sorted by priority (ascending, lines 282--286), each as a subsection
  with priority label, code location (or `"Location not specified"`), issue body,
  and a rubric statement (lines 289--303).
- Fix guidelines section (lines 307--313): address in priority order, run tests,
  minimal changes, document blockers.

### `parseReviewResult(content)` (lines 323--382)

Three-stage JSON extraction with progressive fallback:

1. **Direct parse** (lines 324--339): `JSON.parse(content)`. Checks for
   `findings` and `overall_correctness` fields.
2. **Markdown code fence** (lines 341--360): regex
   `` /```(?:json)?\s*\n([\s\S]*?)\n```/ `` extraction.
3. **Embedded JSON** (lines 362--379): regex `/\{[\s\S]*"findings"[\s\S]*\}/`
   extraction.

All three stages filter out P3 findings (priority 3) from the findings array
(e.g., lines 329--331). Findings with `priority === undefined` are kept. Returns
`null` if all attempts fail.

---

## 4. Ralph Tests

### Integration Tests (`src/workflows/ralph/graph.test.ts`)

756 lines. Uses `bun:test`. Imports `executeGraph` and `streamGraph` from
`../graph/compiled.ts` and `createRalphWorkflow` / `createRalphState` from the
Ralph module.

#### Mock Infrastructure (lines 28--100)

- **`createMockBridge(responses)`** (lines 28--55): creates a mock
  `SubagentGraphBridge` with `spawn()` and `spawnParallel()` methods. The
  `responses` map keys agent names to handler functions returning
  `SubagentResult`.
- **`createMockRegistry()`** (lines 60--78): returns a registry that accepts any
  agent name and returns a dummy entry.
- **`createWorkflowWithMockBridge(responses)`** (lines 83--100): compiles the
  real `createRalphWorkflow()` graph, then injects the mock bridge and registry
  into `workflow.config.runtime`.

#### Test Suites

| Suite | Lines | Tests | Coverage Focus |
|---|---|---|---|
| Basic Compilation | 106--120 | 1 | Verifies `compile()` succeeds, `nodes.size > 0`, `startNode === "planner"`, and all 6 named nodes exist. |
| 3-Phase Flow | 122--453 | 4 | Full end-to-end: simple tasks (2 independent), task dependencies (ordered execution via `blockedBy`), fixer triggered on review findings, fixer skipped on clean review. |
| Worker Loop | 456--608 | 2 | Loop exits when no actionable tasks remain (task #1 errors, #2 stays pending/blocked). Respects `maxIterations` limit (3 of 5 chained tasks completed). |
| Edge Cases | 611--755 | 2 | Empty task list from planner. P3 findings filtered out by `parseReviewResult`, preventing fixer dispatch. |

Key assertions across tests:
- Task dependency ordering verified by capturing execution order via worker
  prompt regex parsing (line 241).
- Worker call counts verify one-at-a-time dispatch (the worker node processes
  the first ready task each iteration).
- Fixer dispatch verified via a `fixerCalled` flag and checking
  `state.fixesApplied`.
- The mock bridge handler for the fixer is keyed by `"debugger"` (the fixer's
  `agentName`), not `"fixer"`.

### Unit Tests (`src/workflows/graph/nodes/ralph.test.ts`)

734 lines. Tests the four exported prompt-building functions and
`parseReviewResult` in isolation.

| Suite | Lines | Tests | Coverage Focus |
|---|---|---|---|
| `buildSpecToTasksPrompt` | 12--37 | 3 | Verifies spec content wrapped in XML tags, JSON schema fields present, "Output ONLY the JSON array" instruction. |
| `buildWorkerAssignment` | 39--392 | 16 | Task ID/content inclusion, missing ID fallback (`"unknown"`), dependency section presence/absence, completed tasks section, status variant recognition (`completed`/`complete`/`done`), missing dependency graceful handling (`"(not found)"`), special characters, large task lists (100 items), deterministic output, section formatting. |
| `buildReviewPrompt` | 394--480 | 7 | User prompt in XML tags, completed tasks listed (pending excluded), progress file path, review focus areas, JSON output format fields, priority definitions, tasks without IDs. |
| `parseReviewResult` | 482--579 | 7 | Direct JSON, markdown code fence, embedded JSON in prose, P3 filtering, findings without priority kept, invalid JSON returns null, missing required fields returns null. |
| `buildFixSpecFromReview` | 582--733 | 7 | Empty string on no findings, fix spec structure, priority sorting (P0 < P1 < P2), missing code location, default priority P2, fix guidelines, rubric per finding. |

---

## 5. Session Management (`src/workflows/session.ts`)

### Overview

A generic workflow session manager (not Ralph-specific). Manages persistent
session directories at `~/.atomic/workflows/sessions/{sessionId}/` for all
workflow executions.

### Types

**`WorkflowSession`** (lines 17--26):

| Field | Type |
|---|---|
| `sessionId` | `string` |
| `workflowName` | `string` |
| `sessionDir` | `string` |
| `createdAt` | `string` |
| `lastUpdated` | `string` |
| `status` | `"running" \| "paused" \| "completed" \| "failed"` |
| `nodeHistory` | `string[]` |
| `outputs` | `Record<string, unknown>` |

### Constants

`WORKFLOW_SESSIONS_DIR` (lines 32--37): resolves to `~/.atomic/workflows/sessions`.

### Functions

#### `generateWorkflowSessionId()` (lines 43--45)

Returns `crypto.randomUUID()`.

#### `getWorkflowSessionDir(sessionId)` (lines 47--49)

Returns `join(WORKFLOW_SESSIONS_DIR, sessionId)`.

#### `initWorkflowSession(workflowName, sessionId?)` (lines 51--77)

1. Generates or uses the provided `sessionId`.
2. Creates the session directory and three subdirectories (`checkpoints`,
   `agents`, `logs`) by writing `.gitkeep` sentinel files via `Bun.write()`.
3. Constructs a `WorkflowSession` object with status `"running"`.
4. Calls `saveWorkflowSession(session)` to persist.

#### `saveWorkflowSession(session)` (lines 79--85)

Stamps `lastUpdated`, writes `session.json` as formatted JSON to
`{sessionDir}/session.json`.

#### `saveSubagentOutput(sessionDir, agentId, result)` (lines 87--95)

Writes a `SubagentResult` as JSON to `{sessionDir}/agents/{agentId}.json`.
Returns the output path.

### Relationship to Ralph

The Ralph state's `ralphSessionDir` field (from `state.ts:144`) points to a
directory under `WORKFLOW_SESSIONS_DIR`. The `SubagentGraphBridge` class
(`src/workflows/graph/subagent-bridge.ts:235`) calls `saveSubagentOutput()` to
persist each sub-agent's result in the `agents/` subdirectory.

---

## 6. Workflow Templates (`src/workflows/graph/templates.ts`)

### Overview

Four template functions that produce `GraphBuilder` instances encoding common
workflow patterns. Each accepts a configuration object and returns an
uncomplied builder (callers must call `.compile()` themselves).

### Shared Helpers (lines 42--105)

- **`isRecord(value)`** (lines 42--44): type guard for `Record<string, unknown>`.
- **`isCompletedStatus(status)`** (lines 46--49): mirrors the Ralph version;
  returns `true` for `"completed"`, `"complete"`, `"done"`.
- **`defaultTaskLoopUntil(state, workerNodeId)`** (lines 51--77): default exit
  condition for `taskLoop`. Checks `state.shouldContinue === false`,
  `state.allTasksComplete === true`, then inspects
  `state.outputs[workerNodeId]` for the same flags, and finally checks if all
  tasks in the worker output array have a completed status.
- **`applyDefaultConfig(builder, defaultConfig?)`** (lines 79--105): monkey-patches
  the builder's `compile()` method to merge `defaultConfig` (including nested
  `metadata`) before delegating to the original `compile()`.
- **`toStateUpdates(value)`** (lines 128--144): normalises a value (Array, Map,
  or single object) into `Partial<TState>[]` for the map-reduce merger.

### Template 1: `sequential(nodes, config?)` (lines 110--126)

**Config type**: `NodeDefinition<TState>[]` plus optional `GraphConfig`.

**Graph structure**: Linear chain. Calls `graph<TState>().start(nodes[0])` then
`.then(node)` for each remaining node. Throws if `nodes` is empty.

### Template 2: `mapReduce(options)` (lines 152--175)

**Config type**: `MapReduceOptions<TState>` (lines 11--16) with fields:
- `splitter`: `NodeDefinition<TState>` -- produces items to map over.
- `worker`: `NodeDefinition<TState>` -- processes each item.
- `merger`: `(results: Partial<TState>[], state: TState) => Partial<TState>` --
  combines worker outputs.

**Graph structure**: Three-node chain: `splitter -> worker -> {worker.id}_reduce`.
The auto-generated reducer node (lines 157--167) reads
`state.outputs[worker.id]`, normalises it via `toStateUpdates()`, and calls
`options.merger()`.

### Template 3: `reviewCycle(options)` (lines 180--191)

**Config type**: `ReviewCycleOptions<TState>` (lines 21--28) with fields:
- `executor`, `reviewer`, `fixer`: three `NodeDefinition<TState>` nodes.
- `until`: exit condition function.
- `maxIterations?`: safety cap.

**Graph structure**: A single `.loop([executor, reviewer, fixer], { until, maxIterations })` followed by `.end()`. All three nodes execute sequentially within each
loop iteration.

### Template 4: `taskLoop(options)` (lines 196--211)

**Config type**: `TaskLoopOptions<TState>` (lines 33--40) with fields:
- `decomposer`: `NodeDefinition<TState>` -- runs once before the loop.
- `worker`: `NodeDefinition<TState>` -- runs each iteration.
- `reviewer?`: optional `NodeDefinition<TState>` -- runs after worker each
  iteration.
- `until?`: exit condition (defaults to `defaultTaskLoopUntil`).
- `maxIterations?`: safety cap.

**Graph structure**: `.start(decomposer)` then `.loop(loopNodes, { until, maxIterations })` then `.end()`. If `reviewer` is provided, the loop body is
`[worker, reviewer]`; otherwise just `worker`.

### Relationship to Ralph

The Ralph workflow (`src/workflows/ralph/graph.ts`) does **not** use these
templates. It builds its graph directly via the `GraphBuilder` fluent API,
constructing the same pattern as a `taskLoop` with an additional review-and-fix
phase. The templates exist as reusable alternatives for custom workflow authors.

---

## Data Flow Summary

```
User prompt (yoloPrompt)
    |
    v
[planner subagent] --> specDoc (raw LLM output)
    |
    v
[parse-tasks tool] --> tasks: TaskItem[], currentTasks: TaskItem[], iteration: 0
    |
    v
+--- LOOP START ---+
|                   |
|  [select-ready-tasks tool] --> currentTasks (filtered ready tasks)
|       |
|  [worker subagent] --> tasks (status updated), iteration++
|       |
+--- LOOP CHECK ---+ (exit when all done, all errored, or maxIterations)
    |
    v
[reviewer subagent] --> reviewResult: ReviewResult
    |
    v
[IF reviewResult has findings AND patch is incorrect]
    |-- YES --> [fixer subagent (debugger)] --> fixesApplied: true
    |-- NO  --> (skip)
    v
[MERGE] --> END
```
