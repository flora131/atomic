---
date: 2026-05-12 00:51:14 UTC
researcher: pi specialist agent
git_commit: 6423aeed02f8036c985f7ddb68c0b0d6edcb0422
branch: refactor/pi-rewrite
repository: atomic-pi-rewrite
topic: "Workflow authoring and registry core"
tags: [research, codebase, workflows, registry, authoring, discovery]
status: complete
last_updated: 2026-05-12
last_updated_by: pi specialist agent
---

# Research: Workflow Authoring and Registry Core

## Research Question

Investigate the codebase partition: Workflow authoring and registry core (`src/workflows`, `workflows`, `examples`) in the context of the broader query: `test query`.

Scout context included adjacent areas: tests (`test/unit`, `test/integration`, `test/support`, `package.json` scripts), runtime execution paths (`src/runs`, `src/shared`), and Pi extension/UI integrations (`src/extension`, `src/tui`, `src/intercom`).

## Summary

The workflow authoring core is a small TypeScript DSL centered on `defineWorkflow(name).description(...).input(...).run(fn).compile()`. A compiled workflow is a frozen `WorkflowDefinition` object with a `__piWorkflow: true` sentinel, authored name, normalized registry key, input schema map, optional input bindings such as `.worktreeFromInputs(...)`, and async run function. Registry state is immutable-style: operations return a new registry backed by an ordered `Map` keyed by normalized workflow name.

Builtin workflows are authored using the same public DSL under `workflows/` and re-exported from `workflows/index.ts`. The extension discovery layer imports that manifest for bundled workflows and also discovers project/user/settings workflow files, validates exported workflow definitions structurally, applies source precedence, and returns a populated `WorkflowRegistry` plus source records and diagnostics. Runtime dispatch uses the registry for `list`, `inputs`, and `run`, then forwards execution to foreground or background runners.

## Detailed Findings

### 1. Public authoring API

- `src/index.ts` is the package authoring entry point. It exports `defineWorkflow`, `createRegistry`, name identity helpers, public shared types, execution helpers, graph inference, store, and cancellation APIs (`src/index.ts:6-23`).
- `defineWorkflow()` validates that the workflow name is a non-empty string, initializes builder state with empty description, empty inputs, and no run function, then returns a builder (`src/workflows/define-workflow.ts:136-148`).
- The builder is typed in two phases:
  - `WorkflowBuilder` exposes `description()`, `input()`, and `run()` before compilation (`src/workflows/define-workflow.ts:37-50`).
  - `CompletedWorkflowBuilder` exposes `compile()` only after `run()` has been called at the type level (`src/workflows/define-workflow.ts:56-64`).
- Builder methods are immutable/chained. `description()`, `input()`, `worktreeFromInputs()`, and `run()` call `makeBuilder()` with copied state rather than mutating the previous builder (`src/workflows/define-workflow.ts:71-88`).
- Runtime `compile()` still guards against missing `.run(fn)` and throws `defineWorkflow("..."): .run(fn) must be called before .compile()` (`src/workflows/define-workflow.ts:90-95`).
- `compile()` computes `normalizedName`, freezes a shallow copy of the inputs map, constructs the sentinel-bearing definition, and freezes the top-level definition (`src/workflows/define-workflow.ts:97-111`).

### 2. Workflow definition and context shape

- `WorkflowDefinition` is defined in shared types and consists of `__piWorkflow: true`, `name`, `normalizedName`, `description`, readonly `inputs`, optional `inputBindings`, and async `run` (`src/shared/types.ts:291-300`).
- Input schemas support `text`/`string`, `number`, `boolean`, and `select`, with optional `description`, `required`, and type-specific defaults. `select` includes a readonly `choices` array (`src/shared/types.ts:21-56`).
- Workflow run functions receive a `WorkflowRunContext<TInputs>` with readonly `inputs`, a `stage(name, options?)` factory, and HIL `ui` primitives (`src/shared/types.ts:231-245`).
- `StageContext` intentionally mirrors much of pi's `AgentSession` surface while wrapping `prompt()` and `subscribe()` and retaining deprecated `subagent()` and `complete()` helpers (`src/shared/types.ts:177-225`).
- `StageOptions` extends pi `CreateAgentSessionOptions` and adds optional per-stage MCP gating plus reusable Git worktree defaults (`gitWorktreeDir`, `baseBranch`) (`src/shared/types.ts:89-109`).
- `.worktreeFromInputs({ gitWorktreeDir, baseBranch })` binds resolved workflow input values to workflow-wide worktree defaults. When the bound worktree input is non-empty, `ctx.stage`, `ctx.task`, `ctx.chain`, and `ctx.parallel` default their cwd to the corresponding reusable Git worktree cwd unless explicitly overridden.

### 3. Identity normalization

- `normalizeWorkflowName()` trims, lowercases, replaces whitespace/underscores with hyphens, strips non-`[a-z0-9-]` characters, collapses duplicate hyphens, and trims edge hyphens (`src/workflows/identity.ts:20-30`).
- `workflowNamesEqual()` compares normalized forms (`src/workflows/identity.ts:37-39`).
- The registry and compiled definitions use the normalized form as the canonical key.

### 4. Registry core

- `WorkflowRegistry` exposes `register`, `upsert`, `merge`, `get`, `has`, `remove`, `names`, and `all` (`src/workflows/registry.ts:14-46`).
- `makeRegistry()` stores definitions in an ordered `Map<string, WorkflowDefinition>` keyed by `definition.normalizedName` (`src/workflows/registry.ts:53-61`).
- `register()`/`upsert()` replace existing definitions for the same key and return a new registry (`src/workflows/registry.ts:58-66`).
- `merge()` copies the current store, then applies `other.all()` so the other registry wins on collisions (`src/workflows/registry.ts:68-74`).
- `get()`, `has()`, and `remove()` normalize caller-provided names before lookup/removal (`src/workflows/registry.ts:76-89`).
- `names()` and `all()` expose insertion-ordered arrays (`src/workflows/registry.ts:92-98`).
- `createRegistry(initial)` constructs the initial `Map` from `initial.map((d) => [d.normalizedName, d])` and returns the registry wrapper (`src/workflows/registry.ts:117-121`).

### 5. Builtin workflow manifest and examples

- `workflows/index.ts` re-exports the three builtins: `deepResearchCodebase`, `ralph`, and `openClaudeDesign` (`workflows/index.ts:8-10`). The file comment states pi runtime discovers the directory via the `pi.workflows` key in `package.json` (`workflows/index.ts:1-5`).
- `package.json` includes `"pi.workflows": ["./workflows"]`, ships `workflows/**/*.ts`, and registers the extension entrypoint under `pi.extensions` (`package.json:31-64`).
- `examples/hello-world.ts` demonstrates a minimal workflow: define name, description, text input with default, single `ctx.stage("greet").prompt(...)`, compile, then print metadata.
- `examples/parallel-fan-out.ts` demonstrates importing `createRegistry`, registering a compiled definition, and writing concurrent stage prompts with `Promise.all` followed by an aggregator stage.

### 6. Builtin workflow shapes

- `deep-research-codebase` has required `prompt` and numeric `max_partitions` defaulting to 4 (`workflows/deep-research-codebase.ts:16-27`). Its run function performs scout, partition, parallel specialist stages via `Promise.all`, then aggregator, returning `findings`, `partitions`, and `specialist_count` (`workflows/deep-research-codebase.ts:28-70`).
- `ralph` has required `prompt` and numeric `max_iterations` defaulting to 3 (`workflows/ralph.ts:20-33`). It creates an initial plan, enters a bounded `for` loop, uses `ctx.ui.editor()` before orchestration, runs `orchestrate-N`, reviews with `complete()`, optionally asks `ctx.ui.confirm()` to continue, and may run `replan-N` (`workflows/ralph.ts:34-102`).
- `open-claude-design` has optional `reference`, select `output_type` defaulting to `component`, and optional `design_system` inputs (`workflows/open-claude-design.ts:19-39`). It runs onboarding, import, generate, refine, and export-handoff stages, returning artifact, handoff, selected output type, design system label, and intermediate stage outputs (`workflows/open-claude-design.ts:40-94`).

### 7. Discovery and registry loading connection

Although discovery is outside `src/workflows`, it is the main consumer of the registry core.

- `src/extension/discovery.ts` imports `createRegistry` and the bundled manifest from `../../workflows/index.js` (`src/extension/discovery.ts:26-31`).
- Discovery supports `bundled`, `project-local`, `user-global`, `settings-project`, and `settings-global` source kinds (`src/extension/discovery.ts:37-51`).
- `DiscoverySource` records normalized id, source kind, authored name, optional file path, and optional configured name (`src/extension/discovery.ts:53-70`).
- Diagnostics include `INVALID_DEFINITION`, `DUPLICATE_NAME`, `IMPORT_FAILED`, `PATH_NOT_FOUND`, and `CONFIG_INVALID` (`src/extension/discovery.ts:72-98`).
- Structural validation requires object shape, `__piWorkflow: true`, non-empty `name`, non-empty `normalizedName`, and function `run` (`src/extension/discovery.ts:149-168`). It does not deeply validate descriptions or input schemas.
- `applyBatch()` validates candidates, checks duplicates using `registry.has(key)`, registers the definition, and appends the source record. This implements first-seen-wins for discovery batches (`src/extension/discovery.ts:199-240`).
- Directory scanning includes `.ts`, `.js`, `.mjs`, and `.cjs` files, sorted by filename; missing or unreadable dirs are treated as empty (`src/extension/discovery.ts:243-255`).
- Dynamic import collects both default and named exports, default first (`src/extension/discovery.ts:258-298`).
- Config paths can be arrays or name-to-path maps. Relative paths resolve against `cwd` for project workflows and against `homeDir` for global workflows; missing paths emit `PATH_NOT_FOUND` (`src/extension/discovery.ts:317-359`).
- `discoverWorkflows()` applies precedence as settings-project, project-local, settings-global, user-global, then bundled. Bundled workflows are skipped when `includeBundled` is false (`src/extension/discovery.ts:365-461`).
- `discoverBundledWorkflowsSync()` validates and registers every export from the bundled manifest into a new registry (`src/extension/discovery.ts:484-498`).

### 8. Runtime dispatch connection

- `createExtensionRuntime()` accepts either a pre-populated `WorkflowRegistry` or seed definitions. If no registry is provided, it calls `createRegistry(opts.definitions ?? [])` (`src/extension/runtime.ts:93-95`).
- Runtime dispatch delegates to `dispatch(args, { registry, ...ports })` (`src/extension/runtime.ts:103-110`).
- Dispatcher `list` returns `registry.names()` (`src/extension/dispatcher.ts:67-72`).
- Dispatcher `inputs` looks up `registry.get(name)` and maps `def.inputs` into `WorkflowInputEntry[]` with `name`, `type`, `description`, `required`, and `default` (`src/extension/dispatcher.ts:77-97`).
- Dispatcher `run` looks up the definition via `registry.get(name)`. Missing workflows return a structured failed run result; detached workflows call `runDetached`; foreground workflows call `run(def, inputs, ...)` (`src/extension/dispatcher.ts:102-160`).

### 9. Test coverage around this partition

- `test/unit/define-workflow.test.ts` covers definition shape, missing run guard, empty name rejection, frozen definition, and multi-input accumulation.
- `test/unit/define-workflow-extended.test.ts` covers builder immutability for description/input/run, select schemas, normalizedName creation, and frozen inputs/top-level definition.
- `test/unit/identity.test.ts` covers lowercasing, trimming, space/underscore replacement, separator collapsing, punctuation stripping, edge hyphen stripping, empty/non-string errors, and equality semantics.
- `test/unit/registry.test.ts` covers empty registry, registering, immutable-style behavior, get-miss, overwrite same name, merge, all(), and initial array population.
- `test/unit/registry-extended.test.ts` covers normalized has/get/remove, upsert alias, merge collisions where other wins, insertion order, and re-register position preservation.
- `test/unit/builtin-workflows.test.ts` dynamically imports all builtin workflows, asserts definition shape and schemas, and executes run functions against mock contexts.
- `test/unit/discovery.test.ts` and `test/unit/discovery-module-imports.test.ts` cover bundled discovery, project-local/user-global/settings discovery, named maps, invalid definitions, path/config/import diagnostics, duplicate precedence, supported file extensions, default+named exports, and `includeBundled` behavior.
- `test/integration/custom-registry.test.ts` verifies custom project/user workflows discovered into a shared registry are visible to runtime dispatch, doctor reporting, CLI flag dispatch, `/workflow` slash command paths, and `/workflow:<name>` aliases.

## Code References

- `src/workflows/define-workflow.ts:37-64` — Two-phase builder interfaces.
- `src/workflows/define-workflow.ts:71-111` — Immutable builder implementation and frozen compiled definition.
- `src/workflows/define-workflow.ts:136-148` — `defineWorkflow()` entrypoint.
- `src/workflows/identity.ts:20-39` — Name normalization and equality helpers.
- `src/workflows/registry.ts:14-46` — Registry public interface.
- `src/workflows/registry.ts:56-121` — Ordered-Map immutable-style registry implementation.
- `src/shared/types.ts:21-56` — Workflow input schemas.
- `src/shared/types.ts:209-245` — Stage and run context shape.
- `src/shared/types.ts:291-300` — Compiled `WorkflowDefinition` shape.
- `workflows/index.ts:8-10` — Builtin manifest exports.
- `workflows/deep-research-codebase.ts:16-71` — Deep research builtin definition.
- `workflows/ralph.ts:20-102` — Ralph builtin definition and HIL loop.
- `workflows/open-claude-design.ts:19-94` — Design workflow definition.
- `src/extension/discovery.ts:149-240` — WorkflowDefinition validation and registry population.
- `src/extension/discovery.ts:365-461` — Unified discovery precedence.
- `src/extension/dispatcher.ts:67-160` — Registry-backed list/inputs/run dispatch.
- `package.json:31-64` — Published files and pi workflow directory registration.

## Architecture Documentation

The current architecture separates concerns into four layers:

1. **Authoring DSL** — `defineWorkflow()` and shared types let authors create frozen `WorkflowDefinition` objects without runtime coupling.
2. **Identity/Registry** — normalized workflow names provide stable keys; immutable-style registries enable replace/merge/remove operations while preserving insertion order.
3. **Discovery** — filesystem and bundled manifest loading collects candidate exports, validates sentinel-based shape, handles precedence and diagnostics, and returns a registry.
4. **Runtime dispatch/execution** — extension runtime owns a registry and routes `list`, `inputs`, and `run` actions to display schema or invoke foreground/background execution.

Builtin workflows are not special at the definition level. They are normal compiled `WorkflowDefinition` exports collected through the bundled manifest and can be overridden by higher-precedence discovered workflow files.

## Historical Context

- `research/docs/2026-02-25-workflow-registration-flow.md` documents an earlier Atomic CLI registration model using `.atomic/workflows` and `~/.atomic/workflows`, metadata exports, and slash-command registration. The current pi rewrite uses sentinel-bearing compiled workflow definitions, `.pi/workflows`, `~/.pi/agent/workflows`, and `DiscoveryConfig` sources.
- `research/docs/2026-02-25-workflow-sdk-standardization.md` describes the prior graph-oriented Workflow SDK with declarative graph building, typed state, node factories, and workflow discovery goals. The current partition implements a simpler stage-oriented authoring API where JavaScript control flow (`await`, `Promise.all`, `for`) plus executor graph inference replaces explicit graph builder syntax.
- `research/docs/2026-05-11-atomic-codebase-inventory.md` inventories the larger migration from Atomic CLI/SDK concepts into the pi extension rewrite and identifies workflow registry/execution pieces as portable to the extension.

## Open Questions

- The discovery validator accepts any non-empty `normalizedName` from external workflow files; it does not recompute or compare it to `normalizeWorkflowName(name)`.
- `defineWorkflow().input()` grows input types as `Record<K, unknown>` rather than deriving types from schema defaults; workflow builtins currently cast `ctx.inputs` manually.
- The `ralph` builtin returns `iterations_completed: Math.min(cap, cap)`, which documents the cap rather than the actual loop count in the current implementation.
- A targeted test command for relevant unit/integration tests emitted a Node warning: `node:test run() is being called recursively within a test file. skipping running files.` No code changes were made as part of this research.
