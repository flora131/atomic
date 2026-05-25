# Prior Art: graph orchestrator panels, DAG workflows, MCP init/OAuth, error suppression

## Most relevant
- 🟢 `specs/2026-05-11-pi-workflows-extension.md` — `pi-workflows` extension spec; read §§1–2, 5.7, 5.9, and the overlay/widget sections for DAG panel + workflow execution.
- 🟢 `docs/2026-05-08-workflow-pane-offload-and-resume.md` — workflow pane offload/resume UI behavior; read the panel lifecycle and resume flow.
- 🟢 `docs/2026-05-11-pi-workflows-extension.md` (if mirrored in docs) — same extension architecture; read the top summary and DAG/UI integration notes.
- 🟢 `specs/2026-05-11-atomic-pi-coding-agent-rewrite.md` — Atomic rebrand / extension bundle context; read package/extension composition and startup assumptions.
- 🟢 `packages/mcp/OAUTH.md` — MCP OAuth 2.1 + PKCE flow, callback server, dynamic client registration, token storage.
- 🟢 `packages/mcp/CHANGELOG.md` — recent MCP init/auth changes; read 2.6.0–2.6.1 and the older `init`/`lazy`/`stderr` entries for startup + error suppression behavior.

## Workflow DAG / orchestrator UI
- 🟢 `research/docs/2026-02-25-ui-workflow-coupling.md` — UI ↔ workflow coupling; read the command dispatch and Ralph-specific sections.
- 🟢 `research/docs/2026-02-25-graph-execution-engine.md` — graph builder/executor basics; read the builder, execution, and error handling sections.
- 🟢 `research/docs/2026-02-25-unified-workflow-execution-research.md` — hardcoded workflow dispatch and missing generic runtime; read the summary + UI coupling sections.
- 🟢 `research/docs/2026-02-25-graph-execution-engine-technical-documentation.md` — deeper graph engine reference; read node types, compile/execute flow, and retries.
- 🟢 `docs/2026-03-02-workflow-tui-rendering-unification.md` — rendering pipeline for workflow/task panels; read the suppression and panel placement sections.
- 🟢 `docs/2026-05-07-custom-workflows-settings-json.md` — custom workflow loading and startup warnings; read the startup summary / warning behavior.

## MCP discovery / startup / OAuth
- 🟢 `research/docs/2026-02-08-164-mcp-support-discovery.md` — original MCP discovery design; read the config formats + `/mcp` command notes.
- 🟢 `research/docs/2026-02-14-mcp-tool-discovery-startup-bugs.md` — startup discovery bugs; read the root-cause section and `/mcp` output notes.
- 🟢 `research/docs/2026-02-14-failing-tests-mcp-config-discovery.md` — missing project-level `.mcp.json`; read the failing tests and proposed fix.
- 🟢 `packages/mcp/README.md` — install/setup/startup behavior, config precedence, lazy startup, and first-run UX.
- 🟢 `packages/mcp/init.ts`, `packages/mcp/mcp-auth-flow.ts`, `packages/mcp/mcp-oauth-provider.ts` — implementation paths for init + OAuth flow; read alongside OAUTH.md.

## Error suppression / noisy output / hidden panels
- 🟢 `CHANGELOG.md` — read the `/mcp` auth picker, compact rendering, and `Suppress server stderr by default` entries.
- 🟢 `research/docs/2026-03-11-copilot-post-stream-file-warning-rendering-fix.md` — suppression strategy for post-stream warnings/file-path noise; read the adapter-vs-rendering split.
- 🟢 `research/docs/2026-03-14-event-bus-callback-elimination-sdk-event-types.md` — suppression flags (`suppressFromMainChat`) and event pipeline; read the mapping tables.
- 🟢 `research/docs/2026-03-02-streaming-architecture-event-bus-migration.md` — echo suppression and shared event bus design; read the EchoSuppressor section.
- 🟢 `research/docs/2026-02-15-ui-inline-streaming-vs-pinned-elements.md` — inline vs pinned panel rendering, including task suppression.

## Older but still useful
- 🟡 `research/docs/2026-01-31-graph-execution-pattern-design.md` — early graph/DAG execution pattern reference; potentially superseded by the 2026-02-25 docs.
- 🟡 `research/docs/2026-01-31-sdk-migration-and-graph-execution.md` — SDK migration + graph execution context; likely superseded by later unified-workflow docs.
- 🟡 `specs/2026-03-02-unified-workflow-execution.md` — formalized unified execution interface; read if you need spec-level requirements.
- 🟡 `specs/2026-03-02-workflow-tui-rendering-unification-refactor.md` — workflow rendering architecture; useful for panel placement and suppression rules.
- 🟡 `docs/2026-04-02-logging-debugging-traces-unified-research.md` — debug logging / trace suppression context; useful for noise-control policy.

## Shortlist
If you only read 5 files, start with:
1. `specs/2026-05-11-pi-workflows-extension.md`
2. `research/docs/2026-02-25-unified-workflow-execution-research.md`
3. `research/docs/2026-02-25-ui-workflow-coupling.md`
4. `packages/mcp/OAUTH.md`
5. `research/docs/2026-02-14-failing-tests-mcp-config-discovery.md`
