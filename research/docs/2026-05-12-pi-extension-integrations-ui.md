---
date: 2026-05-12 00:51:35 UTC
researcher: pi-coding-agent
git_commit: 6423aeed02f8036c985f7ddb68c0b0d6edcb0422
branch: refactor/pi-rewrite
repository: atomic-pi-rewrite
topic: "Pi extension integrations and UI partition"
tags: [research, codebase, pi-extension, tui, intercom, workflows]
status: complete
last_updated: 2026-05-12
last_updated_by: pi-coding-agent
---

# Research

## Research Question

Investigate the `Pi extension integrations and UI` partition for the broader research question: `test query`.

Partition scope:

- `src/extension`
- `src/tui`
- `src/intercom`

Scout context also identified the adjacent test harness (`test/unit`, `test/integration`, `test/support`, `package.json` scripts), workflow authoring/registry core (`src/workflows`, `workflows`, `examples`), and runtime execution paths (`src/runs`, `src/shared`) as surrounding context.

## Summary

This partition is the pi extension composition layer for `@bastani/atomic-workflows`. It registers a single `workflow` tool, `/workflow` and `/workflow:<name>` slash commands, `/workflows-doctor`, CLI flags, message renderers, live above-editor widgets, an on-demand orchestrator graph overlay, MCP scope events, persistence ports, pi-subagents adapters, and pi-intercom routing.

The extension entry point is `src/extension/index.ts`. It composes discovery/config/runtime wiring, builds an `ExtensionRuntime`, registers pi surfaces, then delegates workflow execution to `src/extension/dispatcher.ts` and `src/runs/*`. TUI state is store-driven: `src/shared/store.ts` is observed by `src/tui/store-widget-installer.ts` for compact live progress and by `src/tui/overlay-adapter.ts`/`src/tui/graph-view.ts` for the full graph pane. Intercom glue is in `src/intercom/*`, using pi's event bus and optional `pi.setSessionName` surface.

The project declares this extension and its sibling dependencies in `package.json` under `pi.extensions`: this package's `./src/extension/index.ts` plus `pi-subagents`, `pi-mcp-adapter`, `pi-intercom`, and `pi-web-access`.

## Detailed Findings

### 1. Package-level pi integration

- `package.json` exposes `@bastani/atomic-workflows` as a pi package and registers five extensions: this workflow extension, `pi-subagents`, `pi-mcp-adapter`, `pi-intercom`, and `pi-web-access`.
- The same `pi` block registers sibling skills and prompts from `pi-subagents`, `pi-intercom`, and `pi-web-access`.
- Runtime dependencies include `@bastani/atomic`, `@earendil-works/pi-tui`, `@sinclair/typebox`, `jiti`, and the four sibling pi extensions.
- Scripts use Node's raw TypeScript mode: `node --experimental-transform-types --import ./test/support/register-loader.mjs --test ...` for unit/integration tests and `tsc --noEmit` for typecheck/lint.

### 2. Extension entry point and registration flow

Primary file: `src/extension/index.ts`.

The file defines structural pi API types rather than importing the concrete `ExtensionAPI` type. Registration methods are optional so the extension degrades in older or partial runtimes (`src/extension/index.ts:254-363`).

Startup flow in `factory(pi)`:

1. Builds runtime stage adapters with `buildRuntimeAdapters(pi)` and a startup UI adapter with `buildUIAdapter(pi)` (`src/extension/index.ts:791-800`).
2. Builds the graph overlay adapter using `buildGraphOverlayAdapter(pi, store)` (`src/extension/index.ts:803`).
3. Seeds persistence, MCP, runtime config, status writer, and runtime refs from defaults and bundled workflow discovery (`src/extension/index.ts:814-874`).
4. Starts async config + discovery via `loadWorkflowConfig().then(...)`, converts config to scoped discovery paths, calls `discoverWorkflows`, resolves defaults, rebuilds status writer/persistence/runtime, and registers aliases for newly discovered workflows (`src/extension/index.ts:895-950`).
5. Registers the `workflow` tool if `pi.registerTool` exists (`src/extension/index.ts:961-982`).
6. Registers the `/workflow` command with admin subcommands and workflow dispatch (`src/extension/index.ts:986-1249`).
7. Registers `/workflow:<name>` aliases for bundled workflows synchronously and later for non-bundled workflows after discovery (`src/extension/index.ts:541-590`, `src/extension/index.ts:1255`).
8. Registers `/workflows-doctor` (`src/extension/index.ts:1261-1302`).
9. Registers run-level message renderers (`workflow.run.start`, `workflow.run.end`) (`src/extension/index.ts:1313-1320`).
10. Registers workflow CLI flags and lifecycle hooks for session restore, compaction, shutdown cleanup, widget install, and startup CLI flag dispatch (`src/extension/index.ts:1327-1397`).
11. Installs the live widget and tool execution hooks, then F2/ctrl+h overlay shortcuts (`src/extension/index.ts:1401-1436`).
12. Subscribes to pi-intercom control events and wires them to store/UI callbacks (`src/extension/index.ts:1449-1464`).

The extension deliberately avoids auto-opening the graph overlay when workflows start; comments state the above-editor widget is the default live progress surface and the overlay is on-demand (`src/extension/index.ts:552-557`, `src/extension/index.ts:1163-1168`).

### 3. Workflow tool and slash command semantics

`makeExecuteWorkflowTool()` adapts tool calls to workflow actions (`src/extension/index.ts:413-507`):

- `list`, `inputs`, and `run` delegate to `ExtensionRuntime.dispatch()`.
- `status` reads in-flight background runs via `statusRuns({ all: false })`.
- `kill` supports a `--all` sentinel and otherwise delegates to `killRun`.
- `resume` calls `resumeRun` and reports snapshot metadata.

The registered `workflow` tool has TypeBox parameters for `name`, `inputs`, `action`, and `detach` (`src/extension/index.ts:379-405`). Its pi-facing `execute` returns a normal AgentToolResult with text content from `renderResult(details, {})` and structured `details` carrying the workflow-specific result (`src/extension/index.ts:961-980`).

The `/workflow` command supports:

- `list` / empty input: print registered workflows.
- `status`: print in-flight run prefixes, names, status, and stage counts.
- `kill <runId|prefix|--all>`: abort in-flight runs; prefix resolution uses the store (`src/extension/index.ts:596-609`, `src/extension/index.ts:1040-1091`).
- `resume <runId>`: opens the overlay and reports stored snapshot metadata (`src/extension/index.ts:1097-1110`).
- `inputs <name>` and `<name> --help`: render the input schema (`src/extension/index.ts:1113-1159`).
- `<workflowName> [key=value|json] [--detach|--bg]`: run foreground or detached (`src/extension/index.ts:1171-1195`).

Argument parsing is intentionally small: `stripDetachFlags()` removes `--detach`/`--bg` anywhere, and `parseWorkflowArgs()` accepts `key=value` tokens plus object-shaped JSON tokens (`src/extension/index.ts:640-694`).

### 4. Runtime facade and dispatcher

`src/extension/runtime.ts` owns the `ExtensionRuntime` facade. It accepts either a prebuilt registry or definitions, plus adapters, UI, store, cancellation, persistence, MCP, and runtime config (`src/extension/runtime.ts:28-59`). Its `dispatch()` method forwards to the pure dispatcher with the captured options (`src/extension/runtime.ts:93-111`).

`src/extension/dispatcher.ts` handles registry-bound actions only:

- `list` returns `opts.registry.names()` (`src/extension/dispatcher.ts:67-70`).
- `inputs` returns a normalized input schema array or a structured not-found result (`src/extension/dispatcher.ts:75-94`).
- `run` returns a structured failed result for not-found workflows, calls `runDetached()` when `detach === true`, otherwise calls foreground `run()` and maps its run result into `WorkflowToolResult` (`src/extension/dispatcher.ts:100-151`).
- `status`, `kill`, and `resume` are intentionally handled upstream in `index.ts`, because they operate on background run tracking rather than the registry.

### 5. Runtime wiring to pi SDK and UI dialogs

`src/extension/wiring.ts` is the adapter layer from pi surfaces to workflow runtime ports.

Current runtime adapter behavior:

- `buildRuntimeAdapters()` uses `createAgentSession` from `@bastani/atomic` and returns an `agentSession` adapter that creates SDK sessions from stage options after stripping workflow-only `mcp` (`src/extension/wiring.ts:19-20`, `src/extension/wiring.ts:84-94`, `src/extension/wiring.ts:109-121`).
- It also optionally exposes a legacy `subagent` adapter when `pi.subagents.run` or `pi.callTool` is available, injecting `PI_WORKFLOW_RUN_ID` and `PI_WORKFLOW_STAGE_ID` into subagent calls (`src/extension/wiring.ts:99-153`).
- `extractAssistantText()` remains as a deprecated helper for older NDJSON tests (`src/extension/wiring.ts:55-75`).

UI adapter behavior:

- `buildUIAdapter()` returns `undefined` if `pi.ui` is absent or no dialog methods exist (`src/extension/wiring.ts:309-319`).
- It maps workflow `input`, `confirm`, `select`, and `editor` to pi UI dialogs with deterministic fallbacks for dismissed/missing dialogs: empty string for input, `false` for confirm, first option for select, and initial text for editor (`src/extension/wiring.ts:321-344`).

### 6. Config loading, discovery, and doctor output

`src/extension/config-loader.ts` reads workflow extension config from:

- Global: `<homeDir>/.pi/agent/extensions/workflow/config.json`.
- Project candidates: `<projectRoot>/.pi/extensions/workflow/config.json`, then `<projectRoot>/.pi/agent/extensions/workflow/config.json`.

It validates `workflows`, `maxDepth`, `defaultConcurrency`, `persistRuns`, `statusFile`, and `resumeInFlight`; invalid JSON or shape returns `CONFIG_INVALID` diagnostics rather than silent success (`src/extension/config-loader.ts:94-244`). Global and project configs merge with project values winning, and workflow maps merge key-by-key (`src/extension/config-loader.ts:247-283`, `src/extension/config-loader.ts:438-498`). Defaults are centralized in `WORKFLOW_CONFIG_DEFAULTS` (`src/extension/config-loader.ts:288-295`).

`toScopedDiscoveryConfig()` preserves provenance by resolving global workflow paths under `<homeDir>/.pi/agent` and project workflow paths under `projectRoot`, with project keys overriding global keys (`src/extension/config-loader.ts:391-435`).

`src/extension/discovery.ts` discovers workflow definitions in precedence order:

1. settings-project
2. project-local `.pi/workflows`
3. settings-global
4. user-global `~/.pi/agent/workflows`
5. bundled `workflows/index.js`

It validates the `__piWorkflow` sentinel, name, normalizedName, and run function, and records diagnostics for invalid definitions, duplicate names, import failures, missing config paths, and invalid config (`src/extension/discovery.ts:46-132`, `src/extension/discovery.ts:139-221`, `src/extension/discovery.ts:323-414`).

`src/extension/doctor.ts` builds `/workflows-doctor` output. It reports registry count, sources, discovery diagnostics, config diagnostics, effective tunables, configured workflow entries, sibling availability, UI/shortcut/persistence capabilities, and runtime adapter configuration (`src/extension/doctor.ts:86-213`). The factory populates this with structural checks for pi-subagents, pi-mcp-adapter, pi-intercom, pi-web-access, HIL UI, `ui.custom`, shortcuts, `pi.exec`, persistence, and subagent adapter route (`src/extension/index.ts:1261-1302`).

### 7. Persistence, status file, MCP, and subagent integration

Persistence:

- `makePersistencePort()` returns undefined when `persistRuns` is false or `pi.appendEntry` is absent; otherwise it forwards `appendEntry`, optional `setLabel`, and optional `appendCustomMessageEntry` (`src/extension/index.ts:735-759`).
- Session lifecycle hooks clear/kills runs on `session_start` and `session_shutdown`, restore persisted session runs via `restoreOnSessionStart`, and install the compaction hook (`src/extension/index.ts:1334-1397`).

Status file:

- `createStatusWriter()` writes store snapshots to `<projectRoot>/.pi/workflows/status.json` only when `config.statusFile` is true (`src/extension/status-writer.ts:29-56`, `src/extension/status-writer.ts:101-136`).
- Writes are atomic via temp file and rename; write failures are recorded as deduplicated warning notices in the store (`src/extension/status-writer.ts:76-88`, `src/extension/status-writer.ts:113-132`).

MCP:

- `makeMcpPort()` requires `pi.events.emit` and adapts `setMcpScope`/`clearMcpScope` for the executor (`src/extension/index.ts:764-787`).
- `src/extension/mcp.ts` emits `mcp.scope.set` with `{ stageId, allow, deny }`, using null allow/deny to clear scope (`src/extension/mcp.ts:40-109`).

Subagents:

- `src/extension/subagents.ts` provides env injection, env reading, workflow stage event emit helpers, and structural presence checks (`src/extension/subagents.ts:38-130`).
- Runtime wiring currently uses `readWorkflowEnv()` plus stage metadata to build child env records for subagent calls (`src/extension/wiring.ts:99-153`).

### 8. Intercom integration

`src/intercom/intercom-bridge.ts` derives a stable parent session name from the current working directory: `pi-workflows-parent-<8-char sha256 cwd hash>` (`src/intercom/intercom-bridge.ts:41-61`). `registerIntercomParentSession()` calls `pi.setSessionName()` when available and is invoked during `session_start`, not at extension load time, to avoid pi action-method loader guards (`src/intercom/intercom-bridge.ts:83-93`, `src/extension/index.ts:1346-1349`).

`src/intercom/result-intercom.ts` subscribes to `pi.events.on("subagent:control-intercom", ...)` when available (`src/intercom/result-intercom.ts:100-140`). It routes payloads by `type`:

- `need_decision` → `callbacks.onNeedDecision`
- `notify` → `callbacks.onNotify`
- anything else → `callbacks.onUnknown`

The subscription returns a cleanup function that flips an internal `active` flag; it does not unregister from the event bus because the structural `events.on` surface does not expose an unsubscribe (`src/intercom/result-intercom.ts:100-143`).

`src/intercom/intercom-routing.ts` builds callbacks that:

- Record `need_decision` as a warning notice requiring ack, run `confirm("Subagent needs decision", payload.message)` when available, emit `subagent:control-intercom:response`, then ack the notice (`src/intercom/intercom-routing.ts:71-101`).
- Record `notify` notices at `info`, `warning`, or `error` (`src/intercom/intercom-routing.ts:103-113`).
- Record unknown types as warning notices (`src/intercom/intercom-routing.ts:115-125`).

### 9. Above-editor widget

The compact live progress widget is implemented by `src/tui/store-widget-installer.ts` and `src/tui/widget.ts`.

`installStoreWidget()`:

- No-ops if `pi.ui.setWidget` is absent (`src/tui/store-widget-installer.ts:90-94`).
- Re-issues `ui.setWidget("workflow.run", freshFactory, { placement: "aboveEditor" })` on every store mutation, then calls `ui.requestRender()` (`src/tui/store-widget-installer.ts:97-132`).
- Maintains an 80ms spinner timer while any stage is running, and clears it as soon as no stages are animated (`src/tui/store-widget-installer.ts:97-130`).
- Handles stale pi contexts by stopping the timer rather than propagating the known stale-context error (`src/tui/store-widget-installer.ts:57-66`, `src/tui/store-widget-installer.ts:133-152`).

`buildThemedWidgetLines()`:

- Shows only active runs (`endedAt === undefined`) and collapses to `[]` when none are active (`src/tui/widget.ts:164-181`).
- Renders the latest active run as one line with status glyph/spinner, bold run name, stage counts, active stage, elapsed time, failure count, `ctrl+h` hint, and a copyable `/workflow kill <prefix>` hint (`src/tui/widget.ts:81-162`).
- Adds a second `+N more` line when multiple active runs exist (`src/tui/widget.ts:183-190`).

`installToolExecutionHooks()` subscribes to pi `tool_execution_start`, `tool_execution_update`, and `tool_execution_end` events when the event bus exists. It resolves run/stage IDs from payload fields or the active run/running stage and records tool start/end metadata in the store (`src/tui/store-widget-installer.ts:155-240`).

### 10. Graph overlay and GraphView

The on-demand orchestrator pane is built by `src/tui/overlay-adapter.ts` and `src/tui/graph-view.ts`.

`buildGraphOverlayAdapter()`:

- Returns a port with `open(runId)`, `toggle(runId)`, and `close()` (`src/tui/overlay-adapter.ts:35-64`, `src/tui/overlay-adapter.ts:68-242`).
- No-ops when `pi.ui.custom` is absent (`src/tui/overlay-adapter.ts:130-133`).
- Supports the real pi `custom(factory, options)` shape and a legacy test-only `custom(opts)` shape (`src/tui/overlay-adapter.ts:135-209`).
- Uses pi-tui `overlay: true` with centered popup options (`width: "85%"`, `maxHeight: "90%"`, top margin) (`src/tui/overlay-adapter.ts:50-58`, `src/tui/overlay-adapter.ts:185-193`).
- Holds the real `OverlayHandle` to implement show/hide via `setHidden()` instead of remounting (`src/tui/overlay-adapter.ts:75-83`, `src/tui/overlay-adapter.ts:122-127`, `src/tui/overlay-adapter.ts:226-236`).
- Creates `GraphView` with `onClose` and `onKill`; `onKill` calls `killRun(id, { store, cancellation })` (`src/tui/overlay-adapter.ts:151-164`, `src/tui/overlay-adapter.ts:212-218`).

`GraphView`:

- Implements the pi-tui `Component` shape (`render`, `handleInput`, `invalidate`, `dispose`) (`src/tui/graph-view.ts:65-101`, `src/tui/graph-view.ts:196-203`, `src/tui/graph-view.ts:721-823`).
- Uses a fixed `OVERLAY_LINE_COUNT = 32` so overlay renders are stable and do not scroll/duplicate rows when content grows or shrinks (`src/tui/graph-view.ts:80-90`).
- Pins to the first active run it sees when constructed with `runId: null`, preserving visibility after `activeRunId()` clears (`src/tui/graph-view.ts:137-149`).
- Renders a 3-row header, centered graph body, optional stage switcher, toast overlay, and 3-row statusline (`src/tui/graph-view.ts:168-248`).
- Uses compact list mode when the canvas is too wide or there are more than 12 stages (`src/tui/graph-view.ts:281-291`).
- Supports keyboard navigation with arrows, `j/k`, `gg`, `/` switcher, Enter details toggle, `q` kill+close, Escape/ctrl+h close (`src/tui/graph-view.ts:721-780`).

Supporting renderers:

- `src/tui/layout.ts` computes DAG layout from `StageSnapshot[]`, supporting horizontal and vertical projections and centering sibling bands in vertical orientation (`src/tui/layout.ts:24-153`).
- `src/tui/node-card.ts` renders status-colored rounded cards with duration text and no decorative interior content (`src/tui/node-card.ts:24-166`).
- `src/tui/header.ts` renders the 3-row chrome header with `ORCHESTRATOR` pill and status count badges (`src/tui/header.ts:21-131`).
- `src/tui/switcher.ts` renders the `/` stage jump popup with filtering and selected-row styling (`src/tui/switcher.ts:17-121`).
- `src/tui/graph-canvas.ts` provides sparse ANSI-aware edge plotting (`src/tui/graph-canvas.ts:16-107`).
- `src/tui/graph-theme.ts` maps Catppuccin Mocha tokens to semantic graph roles (`src/tui/graph-theme.ts:13-122`).
- `src/tui/status-helpers.ts`, `src/tui/color-utils.ts`, and `src/tui/toast.ts` provide status colors/icons/durations, ANSI color helpers, and toast rendering.

### 11. Tool/result and message rendering

Tool call/result rendering is intentionally text-oriented:

- `renderCall()` maps workflow actions to compact strings like `workflow: list registered workflows`, `workflow: run "name"`, and `workflow: kill run "id"` (`src/extension/render-call.ts:16-35`).
- `renderResult()` handles the workflow result union for list/status/inputs/run/kill/resume. It supports partial run progress, detached run messages, failed run errors, result JSON summaries, and fallback rendering for coerced external values (`src/extension/render-result.ts:64-121`).
- `src/extension/renderers.ts` provides run/stage lifecycle string renderers, but `index.ts` currently registers only run-level start/end renderers in chat to avoid per-stage scroll noise (`src/extension/renderers.ts:58-85`, `src/extension/index.ts:1305-1320`).

### 12. Tests and coverage surfaces found

Relevant tests in the current tree include:

- Extension factory/tool/command/renderer/flag integration: `test/integration/mock-extension-api.test.ts`.
- Extension smoke test: `test/unit/extension.test.ts`.
- Slash dispatch behavior: `test/unit/slash-dispatch.test.ts`.
- Runtime/dispatcher/config/doctor/status writer: `test/unit/runtime.test.ts`, `test/unit/dispatcher.test.ts`, `test/unit/config-loader.test.ts`, `test/unit/config-provenance.test.ts`, `test/unit/doctor.test.ts`, `test/unit/status-writer.test.ts`, `test/integration/doctor.test.ts`, `test/integration/runtime-tunables.test.ts`.
- Wiring: `test/unit/wiring-adapters.test.ts`, `test/integration/runtime-wiring.test.ts`, `test/integration/entrypoint-hil.test.ts`.
- MCP/subagents/intercom: `test/unit/integrations-mcp.test.ts`, `test/unit/mcp-stage-scoping.test.ts`, `test/unit/integrations-subagents.test.ts`, `test/unit/integrations-intercom.test.ts`, `test/unit/intercom-routing.test.ts`, `test/integration/mcp-entrypoint.test.ts`.
- UI: `test/unit/widget-rendering.test.ts`, `test/unit/store-widget-installer.test.ts`, `test/unit/overlay-graph.test.ts`, `test/integration/overlay-entrypoints.test.ts`.

A targeted invocation of selected unit files with the repository's Node loader returned exit code `0`, but emitted `node:test run() is being called recursively within a test file. skipping running files.` This observation came from direct commands against selected test files and indicates the loader/test setup has a recursive-run guard active for that invocation path.

## Architecture Documentation

### Extension API posture

The partition mirrors pi extension guidance: export a default factory function, use `pi.registerTool`, `pi.registerCommand`, `pi.registerFlag`, `pi.registerMessageRenderer`, `pi.on`, `pi.registerShortcut`, `ctx.ui`/`pi.ui`, `pi.events`, and optional persistence APIs. The code avoids hard imports from sibling extensions and instead detects surfaces structurally.

### State flow

1. Workflow execution updates `src/shared/store.ts` through runtime paths.
2. `installStoreWidget()` observes the store and re-publishes a compact widget above the editor.
3. `GraphView` observes the same store through the overlay adapter and renders the full DAG view on demand.
4. Intercom callbacks and status-writer failures record `WorkflowNotice` entries in the store.
5. Status file writer serializes complete store snapshots when enabled.

### Degraded runtime behavior

Most integration points are guarded:

- No `registerTool` → no workflow tool.
- No command registration → slash commands are skipped.
- No `pi.ui` dialog methods → HIL adapter is undefined and executor fallbacks apply.
- No `pi.ui.custom` → overlay open/toggle no-op.
- No `pi.events.emit` → MCP scope port undefined.
- No `pi.events.on` → intercom control subscription is not established.
- No `appendEntry` or disabled `persistRuns` → persistence port undefined.
- No `setWidget` → live widget install no-op.

### UI design posture

The UI partition is terminal-first and ANSI-rendered. It uses pi-tui component contracts, explicit width handling, fixed overlay height, Catppuccin role tokens, stable Unicode glyphs, and store-pushed rerenders rather than polling animation loops. Comments document a recurring scrollback/duplicate-row constraint: high-frequency overlay redraws are avoided, and widgets are the default progress surface.

## Historical Context (from research/)

- `research/docs/2026-05-11-map-the-entire-atomic-cli-codebase.md` frames the pi rewrite as an architectural inversion: pi chat becomes the host and the workflow orchestrator becomes a pi extension/pane rather than a tmux top-level orchestrator.
- `research/docs/2026-05-11-atomic-codebase-inventory.md` identifies portable pieces from the old Atomic implementation: workflow primitives, status writer schema, graph/theme/layout/connectors, panel store model, and dispatch patterns.
- `research/docs/2026-05-11-pi-mcp-adapter-and-subagents.md` documents sibling extension idioms that this partition mirrors: one thin multifunctional tool, event-bus coordination, custom renderers, `session_start` lifecycle registration, pi-subagents live widgets, and pi-intercom parent/child escalation channels.

## Code References

- `package.json` — pi package registration and test/typecheck scripts.
- `src/extension/index.ts:791-1465` — main extension factory and pi registration flow.
- `src/extension/wiring.ts:109-153` — AgentSession and subagent runtime adapters.
- `src/extension/wiring.ts:309-344` — pi UI dialog adapter.
- `src/extension/dispatcher.ts:59-157` — registry-backed action dispatcher.
- `src/extension/config-loader.ts:438-498` — config file loading/merging.
- `src/extension/discovery.ts:323-414` — workflow discovery precedence.
- `src/extension/doctor.ts:86-213` — doctor report content.
- `src/extension/mcp.ts:76-109` — MCP scope set/clear event emission.
- `src/intercom/intercom-bridge.ts:41-93` — parent session name derivation and registration.
- `src/intercom/result-intercom.ts:100-143` — intercom event subscription/routing.
- `src/intercom/intercom-routing.ts:71-125` — store/UI/response handling for intercom controls.
- `src/tui/store-widget-installer.ts:90-152` — live widget installer.
- `src/tui/widget.ts:164-193` — themed widget line renderer.
- `src/tui/overlay-adapter.ts:68-242` — graph overlay adapter.
- `src/tui/graph-view.ts:65-823` — orchestrator graph component.
- `src/tui/layout.ts:24-153` — DAG layout algorithm.
- `src/tui/node-card.ts:113-166` — node card renderer.
- `src/tui/header.ts:72-131` — graph header renderer.

## Open Questions

- The broader research question was `test query`, so no domain-specific acceptance criteria were available beyond documenting the partition as-is.
- Some test files still describe older exec/NDJSON prompt/complete adapter behavior, while the current wiring file documents and implements SDK `createAgentSession` as the primary path. This is recorded here as an observed as-is mismatch in descriptions/tests versus implementation, not as a recommendation.
