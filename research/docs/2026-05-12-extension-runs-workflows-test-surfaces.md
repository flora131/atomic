---
date: 2026-05-12 00:58:02 UTC
researcher: specialist agent
git_commit: 6423aeed02f8036c985f7ddb68c0b0d6edcb0422
branch: refactor/pi-rewrite
repository: atomic-pi-rewrite
topic: "src/extension + src/runs + src/workflows test-facing runtime surfaces"
tags: [research, codebase, extension, runs, workflows, tests]
status: complete
last_updated: 2026-05-12
last_updated_by: specialist agent
---

# Research

## Research Question

Investigate the codebase partition `src/extension + src/runs + src/workflows` in depth for the broader research question: `test`.

Scout context identified adjacent areas:

- `test/unit` + `test/support`: core unit coverage and TypeScript test loader setup
- `test/integration` + `test/manual`: extension entrypoints, runtime wiring, HIL/overlay/MCP behavior
- `package.json` + `.github/workflows/test.yml` + specs/research testing docs: test scripts, CI, and historical testing plans

## Summary

The partition is the executable core of the pi workflows extension. `src/workflows` provides the authoring DSL, normalized workflow identity, and immutable-style registry. `src/extension` adapts pi's extension/runtime surfaces into workflow ports, performs config/discovery, registers tools/commands/renderers/flags/lifecycle hooks, and routes tool/slash actions. `src/runs` executes compiled workflow definitions in foreground or detached background mode, tracking run/stage state, cancellation, persistence, concurrency, MCP scoping, HIL UI, and CLI flag startup dispatch.

The test suite directly imports these surfaces heavily: this partition has 26 source files, and `test/unit`, `test/integration`, and `test/manual` contain 59 files with about 194 import/comment references to `src/extension`, `src/runs`, or `src/workflows`. Unit coverage is concentrated around pure or port-shaped modules; integration coverage exercises the factory-registered pi entrypoints through mocked pi surfaces.

## Detailed Findings

### 1. Workflow authoring and registry layer (`src/workflows`)

- `defineWorkflow()` is the public builder API. It validates a non-empty name, then returns an immutable/chained builder over `name`, `description`, `inputs`, and a sealed run function (`src/workflows/define-workflow.ts:18`, `src/workflows/define-workflow.ts:71`, `src/workflows/define-workflow.ts:136`).
- Builder typing is two-phase: `WorkflowBuilder` exposes `.description()`, `.input()`, and `.run()` before compile, while `CompletedWorkflowBuilder` adds `.compile()` after `.run()` has been called (`src/workflows/define-workflow.ts:37`, `src/workflows/define-workflow.ts:56`).
- `.compile()` runtime-guards missing `.run(fn)`, normalizes the name, freezes a shallow copy of the inputs map, adds the `__piWorkflow: true` sentinel, and freezes the top-level `WorkflowDefinition` (`src/workflows/define-workflow.ts:90`).
- `normalizeWorkflowName()` trims, lowercases, maps whitespace/underscores to hyphens, strips non-alphanumeric/hyphen characters, collapses hyphens, and trims edge hyphens; `workflowNamesEqual()` compares normalized names (`src/workflows/identity.ts:20`, `src/workflows/identity.ts:37`).
- `createRegistry()` wraps an insertion-ordered `Map` keyed by `definition.normalizedName`. `register`/`upsert`, `merge`, and `remove` return new registry wrappers, while `get`/`has` normalize caller input (`src/workflows/registry.ts:14`, `src/workflows/registry.ts:56`, `src/workflows/registry.ts:117`).

### 2. Extension composition root and pi-facing APIs (`src/extension/index.ts`)

- `ExtensionAPI` is structural and optional-capability based: tool/command/flag/shortcut registration, message renderers, lifecycle hooks, event bus, subagents, exec, persistence, session manager, and UI methods are all optional fields (`src/extension/index.ts:254`).
- `makeExecuteWorkflowTool()` handles tool actions. `list`, `inputs`, and `run` delegate to the active `ExtensionRuntime`; `status`, `kill`, and `resume` are handled against the run store/status/cancellation helpers (`src/extension/index.ts:413`).
- `factory(pi)` builds runtime adapters and UI adapters, graph overlay adapter, default persistence/MCP/runtime config refs, a status writer, a bundled-workflow runtime, and then starts async config+discovery to swap in the full registry and runtime config (`src/extension/index.ts:791`, `src/extension/index.ts:813`, `src/extension/index.ts:844`, `src/extension/index.ts:894`).
- A stable `runtimeProxy` delegates to `runtimeRef.current`, letting already-registered tool and slash-command closures see the latest async-discovered registry (`src/extension/index.ts:858`).
- Registered pi surfaces include the `workflow` tool (`src/extension/index.ts:953`), `/workflow` command (`src/extension/index.ts:986`), `/workflow:<name>` aliases (`src/extension/index.ts:541`, `src/extension/index.ts:1255`), `/workflows-doctor` (`src/extension/index.ts:1261`), run-level message renderers (`src/extension/index.ts:1305`), CLI flags (`src/extension/index.ts:1327`), lifecycle hooks (`src/extension/index.ts:1333`), store widget/tool hooks (`src/extension/index.ts:1401`), F2/ctrl+h overlay shortcuts (`src/extension/index.ts:1404`), and intercom control subscription (`src/extension/index.ts:1446`).
- Slash helpers include canonical `registerCommand` with legacy `registerSlashCommand` fallback (`src/extension/index.ts:519`), run-id prefix resolution for kill (`src/extension/index.ts:601`), detach flag stripping (`src/extension/index.ts:640`), and small `key=value`/JSON-object argument parsing (`src/extension/index.ts:657`).

### 3. Runtime facade, dispatcher, discovery, config, and diagnostics

- `createExtensionRuntime()` accepts either a registry or definitions plus adapters/ports, then delegates all dispatches to `dispatch()` with captured store, cancellation, persistence, MCP, UI, and config (`src/extension/runtime.ts:28`, `src/extension/runtime.ts:93`).
- `dispatch()` is the registry-bound action router: `list` returns registry names, `inputs` maps the workflow input schema, `run` returns a structured failed result for missing workflows, `runDetached()` for `detach: true`, or foreground `run()` otherwise (`src/extension/dispatcher.ts:59`).
- `discoverWorkflows()` supports precedence from settings-project, project-local `.pi/workflows`, settings-global, user-global `~/.pi/agent/workflows`, then bundled workflows (`src/extension/discovery.ts:1`, `src/extension/discovery.ts:375`).
- Discovery validates candidate exports structurally by sentinel, non-empty `name`, non-empty `normalizedName`, and function `run`; invalid definitions, duplicate names, import failures, missing config paths, and invalid discovery config are captured as diagnostics (`src/extension/discovery.ts:149`, `src/extension/discovery.ts:200`).
- `loadWorkflowConfig()` reads global and first-found project config, validates `workflows`, `maxDepth`, `defaultConcurrency`, `persistRuns`, `statusFile`, and `resumeInFlight`, merges global+project with project winning, and exposes pre-merge configs for scoped discovery provenance (`src/extension/config-loader.ts:38`, `src/extension/config-loader.ts:130`, `src/extension/config-loader.ts:438`).
- `WORKFLOW_CONFIG_DEFAULTS` centralizes runtime defaults: `maxDepth: 4`, `defaultConcurrency: 4`, `persistRuns: true`, `statusFile: false`, `resumeInFlight: "ask"` (`src/extension/config-loader.ts:288`).
- `/workflows-doctor` output is built by `buildDoctorReport()`, formatting registry/sources/diagnostics/tunables/configured workflows and sibling/runtime capabilities (`src/extension/doctor.ts:86`).

### 4. Runtime wiring, rendering, persistence, MCP, and subagent helpers

- `buildRuntimeAdapters()` creates an `agentSession` adapter using `createAgentSession()` from `@bastani/atomic`, stripping workflow-only `mcp` from stage options before session creation (`src/extension/wiring.ts:109`, `src/extension/wiring.ts:85`).
- The same wiring optionally exposes a subagent adapter via `pi.subagents.run` or `pi.callTool("subagent", ...)`, injecting workflow env from process env and stage metadata (`src/extension/wiring.ts:99`, `src/extension/wiring.ts:123`).
- `buildUIAdapter()` maps pi dialog methods into workflow HIL primitives and returns `undefined` when no dialog methods exist (`src/extension/wiring.ts:309`).
- `renderCall()`, `renderResult()`, and `renderers.ts` supply compact tool-call, tool-result, and run lifecycle message strings (`src/extension/render-call.ts:16`, `src/extension/render-result.ts:64`, `src/extension/renderers.ts:58`).
- `makePersistencePort()` adapts pi `appendEntry`, optional `setLabel`, and optional `appendCustomMessageEntry` only when `persistRuns` is enabled and `appendEntry` exists (`src/extension/index.ts:735`).
- `createStatusWriter()` subscribes to store snapshots and atomically writes JSON status to `<projectRoot>/.pi/workflows/status.json` when `config.statusFile` is true (`src/extension/status-writer.ts:101`).
- MCP scoping is event-based: `setMcpScope()` and `clearMcpScope()` emit `mcp.scope.set` with stage ID plus allow/deny arrays or nulls (`src/extension/mcp.ts:76`, `src/extension/mcp.ts:95`).
- Subagent helper functions provide workflow env injection/readback, stage start/end event emission, structural presence checks, and a human-readable missing dependency assertion (`src/extension/subagents.ts:51`, `src/extension/subagents.ts:62`, `src/extension/subagents.ts:93`, `src/extension/subagents.ts:126`).

### 5. Foreground execution (`src/runs/foreground`)

- `run()` validates max depth before store/persistence side effects, resolves defaults and required inputs, creates or accepts a run ID, builds an owned `AbortController`, records run start, registers cancellation, appends persistence, and constructs a `WorkflowRunContext` (`src/runs/foreground/executor.ts:186`).
- `resolveInputs()` fills defaults and throws `TypeError` for missing required inputs (`src/runs/foreground/executor.ts:86`). CLI validation is stricter and lives separately in `validate-inputs.ts`.
- Each `ctx.stage(name, options?)` call allocates a stage ID, infers parent IDs from `GraphFrontierTracker`, records a pending stage, creates an inner `StageContext`, then wraps `prompt`, `complete`, and `subagent` so actual work acquires a per-run `ConcurrencyLimiter`, records running/start/end lifecycle, applies MCP scope, races against abort, updates result/error/duration, persists stage end, settles graph frontier, and releases the limiter (`src/runs/foreground/executor.ts:242`, `src/runs/foreground/executor.ts:270`).
- Run completion records `completed`; caught errors record `failed`; aborted paths finalize as `killed`. The executor unregisters cancellation in `finally` (`src/runs/foreground/executor.ts:353`, `src/runs/foreground/executor.ts:386`, `src/runs/foreground/executor.ts:160`).
- `createStageContext()` lazily creates an SDK `AgentSession` (or legacy prompt-session fallback for tests), wires subscriptions registered before session creation, aborts the active session on workflow abort, exposes pi-like session methods/properties, and preserves deprecated `complete`/`subagent` helper paths (`src/runs/foreground/stage-runner.ts:145`).

### 6. Background/detached execution and run controls (`src/runs/background`)

- `runDetached()` preallocates a run ID, creates an `AbortController`, registers it before starting execution, calls foreground `run()` in a fire-and-forget promise with the preallocated ID and signal, registers a voided promise in `JobTracker`, unregisters on settle, and returns an immediate accepted result (`src/runs/background/runner.ts:85`).
- `CancellationRegistry` tracks primary and child abort controllers by run ID, supports replacement registration, aborts children before primary, unregisters ended runs, and exposes `isAborted()` (`src/runs/background/cancellation-registry.ts:38`).
- `JobTracker` is an in-memory map of background run IDs to abort controllers and void promises; it is not the source of status truth (`src/runs/background/job-tracker.ts:43`).
- `statusRuns()` summarizes in-flight runs from the store unless `all` is requested (`src/runs/background/status.ts:47`).
- `killRun()` checks store existence/terminal state before aborting, aborts through the cancellation registry, records `killed`, and optionally appends run-end persistence; `killAllRuns()` maps that over in-flight runs (`src/runs/background/status.ts:81`, `src/runs/background/status.ts:116`).
- `resumeRun()` is read-only: it returns a JSON deep-copy snapshot for active or ended runs, or `not_found` (`src/runs/background/status.ts:143`).

### 7. Shared runtime helpers (`src/runs/shared`)

- `registerWorkflowCliFlags()` registers literal pi flags: `workflow`, `workflow-inputs`, `workflow-inputs-file`, and `workflow-help`; comments document why dynamic per-input flags are not used (`src/runs/shared/cli-flags.ts:91`).
- `parseWorkflowFlags()` handles `--flag=value` and `--flag value` forms, last-wins inline JSON inputs, mutual exclusion with inputs file, and `--workflow-help` (`src/runs/shared/cli-flags.ts:154`).
- `runWorkflowFromCliFlags()` parses argv, optionally renders schema help, loads JSON input files, validates against registered workflow schemas, dispatches through `ExtensionRuntime`, and returns a handled/unhandled result for startup hooks (`src/runs/shared/cli-flags.ts:305`).
- `validateInputs()` reports unknown keys, missing required values, wrong JSON types, and invalid select choices without coercion (`src/runs/shared/validate-inputs.ts:24`).
- `ConcurrencyLimiter` is a small semaphore with `acquire`, `release`, and `run` helpers; `createRunLimiter()` defaults to concurrency 4 (`src/runs/shared/concurrency.ts:9`, `src/runs/shared/concurrency.ts:74`).
- `GraphFrontierTracker` infers DAG parents from JavaScript execution order using a frontier of settled, not-yet-consumed stage IDs (`src/runs/shared/graph-inference.ts:17`).

### 8. Test-facing structure

- `package.json` test scripts run raw TypeScript through Node 24-compatible experimental transform types plus `test/support/register-loader.mjs`: `npm run test:unit`, `npm run test:integration`, and `npm run test:all` (`package.json:35`).
- CI runs on `ubuntu-latest` and `windows-latest`, installs with `npm install`, then runs typecheck, unit tests, and integration tests (`.github/workflows/test.yml:10`, `.github/workflows/test.yml:18`).
- Unit tests directly target most pure/port modules in this partition: workflow builder/identity/registry, discovery/config/doctor/dispatcher/runtime, wiring/UI adapters, renderers, slash parsing/dispatch, foreground executor/stage runner, background cancellation/status/detached runner, concurrency/graph inference/CLI flags/input validation/MCP/subagent helpers.
- Integration tests mock pi surfaces to exercise extension factory entrypoints and runtime wiring: custom registry discovery, doctor command, HIL entrypoint, MCP entrypoint, overlay entrypoints, runtime tunables, and runtime wiring.
- `test/manual/render-preview.ts` is the manual partition entry for renderer previewing.

## Code References

- `src/workflows/define-workflow.ts:37-64` — two-phase builder interfaces.
- `src/workflows/define-workflow.ts:71-111` — immutable builder implementation and compiled definition shape.
- `src/workflows/identity.ts:20-39` — workflow name normalization and equality.
- `src/workflows/registry.ts:14-46` — registry interface.
- `src/workflows/registry.ts:56-121` — ordered-map registry implementation.
- `src/extension/index.ts:413-490` — tool executor action routing.
- `src/extension/index.ts:791-951` — factory startup and async config/discovery runtime swap.
- `src/extension/index.ts:986-1247` — `/workflow` slash command behavior.
- `src/extension/index.ts:1333-1460` — lifecycle, widget, shortcut, and intercom wiring.
- `src/extension/dispatcher.ts:59-160` — registry-backed list/inputs/run dispatch.
- `src/extension/wiring.ts:109-149` — SDK session and subagent adapter construction.
- `src/runs/foreground/executor.ts:186-416` — foreground run lifecycle and stage wrapping.
- `src/runs/foreground/stage-runner.ts:145-253` — lazy stage `AgentSession` context.
- `src/runs/background/runner.ts:85-132` — detached background execution.
- `src/runs/background/status.ts:47-166` — status, kill, kill-all, and resume helpers.
- `src/runs/shared/cli-flags.ts:91-363` — pi CLI flag registration, parsing, validation, and dispatch.
- `package.json:35-40` — test scripts.
- `.github/workflows/test.yml:10-24` — matrix CI test workflow.

## Architecture Documentation

The partition is layered as follows:

1. **Authoring/registry** (`src/workflows`) — pure DSL, identity, and registry.
2. **Extension boundary** (`src/extension`) — structural pi API adapters, config/discovery, command/tool/render registration, status/doctor/helpers.
3. **Runtime execution** (`src/runs`) — foreground DAG execution, lazy stage sessions, background jobs, cancellation, status controls, CLI startup dispatch.
4. **Shared ports/store/types outside this partition** — `src/shared`, `src/tui`, and `src/intercom` supply data models, persistence helpers, UI rendering, and event routing consumed by this partition.

The code uses ports and structural optional capabilities rather than hard runtime coupling: pi APIs, persistence, MCP, HIL UI, subagents, event bus, lifecycle hooks, and overlay support all degrade when absent. This makes the partition highly mockable in tests.

## Historical Context (from research/)

- `research/docs/2026-05-12-workflow-authoring-registry-core.md` documents the workflow DSL/registry/discovery path and its tests in more detail.
- `research/docs/2026-05-12-extension-intercom-pi-integration-surfaces.md` documents `src/extension` plus adjacent intercom wiring.
- `research/docs/2026-05-12-pi-extension-integrations-ui.md` documents extension/TUI/intercom integration, including widget and overlay surfaces outside this partition.
- `research/docs/2026-05-11-pi-coding-agent-reference.md` provides pi API reference context for the structural extension methods used here.
- `research/docs/2026-03-24-test-suite-design.md` is older historical test-suite planning for the pre-rewrite Atomic CLI and is useful mostly as background; current scripts use npm + Node, not Bun.

## Related Research

- `research/docs/2026-05-12-workflow-authoring-registry-core.md`
- `research/docs/2026-05-12-extension-intercom-pi-integration-surfaces.md`
- `research/docs/2026-05-12-pi-extension-integrations-ui.md`
- `research/docs/2026-05-11-atomic-codebase-inventory.md`

## Open Questions

- The broader research question was only `test`; this report therefore documents the current runtime/test-facing surfaces rather than answering a narrower product or bug question.
- `DoctorSiblingStatus` labels `promptAdapter`/`completeAdapter` as requiring `pi.exec`, while the current runtime wiring uses SDK `createAgentSession()` as the primary stage session path. Tests may preserve legacy expectations around `pi.exec` labels.
- Discovery accepts external definitions whose `normalizedName` is any non-empty string; it does not recompute and compare against `normalizeWorkflowName(name)`.
