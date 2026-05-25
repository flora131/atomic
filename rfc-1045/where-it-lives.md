# Issue #1045 — where it lives

## Orchestrator graph panel / workflow graph UI
- `packages/workflows/src/tui/graph-view.ts` — graph/orchestrator panel rendering and navigation.
- `packages/workflows/src/tui/graph-canvas.ts` — graph canvas layout/edge drawing.
- `packages/workflows/src/tui/graph-theme.ts` — graph panel theme tokens.
- `packages/workflows/src/tui/workflow-attach-pane.ts` — attach-pane shell that hosts graph/chat switching.
- `packages/workflows/src/tui/stage-chat-view.ts` — stage/chat view used alongside the graph panel.
- `packages/workflows/src/tui/overlay-adapter.ts` — overlay/popup hosting used by the graph panel.
- `packages/workflows/src/tui/session-overlays.ts` — overlay orchestration for session panels.

## Workflows / subagents UI + TUI
- `packages/workflows/src/extension/workflow-schema.ts` — workflow definitions and UI-facing schema.
- `packages/workflows/src/runs/shared/workflow-runner.ts` — workflow run execution shared by UI/TUI.
- `packages/workflows/src/runs/shared/graph-inference.ts` — graph structure inference for workflow display.
- `packages/workflows/src/workflows/define-workflow.ts` — workflow authoring/entry definition.
- `packages/workflows/src/tui/workflow-list.ts` — workflow picker/list UI.
- `packages/subagents/src/runs/background/subagent-runner.ts` — subagent background execution.
- `packages/subagents/src/runs/foreground/subagent-executor.ts` — foreground subagent execution.
- `packages/subagents/src/runs/shared/subagent-control.ts` — subagent control/status messaging.
- `packages/subagents/src/runs/shared/subagent-prompt-runtime.ts` — subagent prompt/runtime boundaries.
- `packages/subagents/src/runs/shared/nested-events.ts` — nested subagent event routing/storage.
- `packages/subagents/src/runs/shared/mcp-direct-tool-allowlist.ts` — MCP tool allowlist used by subagents.
- `packages/subagents/src/tui/render.ts` — subagent result rendering.
- `packages/subagents/src/agents/skills.ts` — subagent skill resolution/caching.
- `packages/subagents/src/slash/slash-bridge.ts` — slash-command bridge for subagent execution.
- `packages/subagents/src/slash/slash-live-state.ts` — live subagent state used by the UI.

## MCP extension OAuth initialization / suppression
- `packages/mcp/index.ts` — startup path that calls OAuth initialization and logs the repeated failure message.
- `packages/mcp/mcp-auth-flow.ts` — OAuth flow startup, callback server setup, and auth lifecycle.
- `packages/mcp/mcp-auth.ts` — OAuth state/token storage helpers.
- `packages/mcp/mcp-oauth-provider.ts` — MCP OAuth provider implementation.
- `packages/mcp/mcp-callback-server.ts` — OAuth callback server.
- `packages/mcp/oauth-handler.ts` — OAuth handler for provider flow completion.
- `packages/mcp/direct-tools.ts` — direct MCP tool auth/error messaging and suppression-related auth behavior.
- `packages/mcp/mcp-panel.ts` — MCP panel UI entry point.
- `packages/mcp/mcp-setup-panel.ts` — MCP setup/auth panel.
- `packages/mcp/OAUTH.md` — MCP OAuth docs.
- `packages/mcp/README.md` — MCP package overview and usage.
- `packages/mcp/CHANGELOG.md` — historical MCP/auth changes.
- `.mcp.json` — repository MCP configuration.

## Main chat MCP extension / OAuth UI
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts` — main chat mode that wires provider login/auth UI.
- `packages/coding-agent/src/modes/interactive/components/oauth-selector.ts` — OAuth/login selection UI in the main chat extension.
- `packages/coding-agent/src/modes/interactive/components/login-dialog.ts` — login dialog shown from interactive mode.
- `packages/coding-agent/src/modes/interactive/components/index.ts` — exports interactive auth UI components.
- `packages/coding-agent/src/modes/interactive/components/scoped-models-selector.ts` — adjacent auth/model selection UI.
- `packages/coding-agent/src/modes/interactive/components/model-selector.ts` — provider selection path near login UX.

## Tests relevant to this issue
- `test/unit/overlay-graph.test.ts` — overlay graph panel behavior.
- `test/unit/graph-frontier-tracker.test.ts` — graph traversal/frontier behavior.
- `test/unit/graph-inference.test.ts` — graph inference logic.
- `test/unit/graph-theme.test.ts` — graph theme rendering tokens.
- `test/unit/workflow-attach-pane.test.ts` — workflow attach pane UI.
- `test/unit/workflow-list-render.test.ts` — workflow list UI rendering.
- `test/unit/workflow-runner.test.ts` — workflow execution path.
- `test/unit/workflow-schema.test.ts` — workflow schema validation.
- `test/unit/subagents-nested-render.test.ts` — nested subagent UI rendering.
- `test/unit/subagents-nested-events.test.ts` — nested subagent event flow.
- `test/unit/subagents-result-intercom.test.ts` — subagent result/intercom routing.
- `test/unit/subagents-render-stability.test.ts` — subagent render stability.
- `test/unit/subagents-mcp-direct-tool-allowlist.test.ts` — subagent MCP allowlist behavior.
- `test/unit/mcp-init-statusbar.test.ts` — MCP startup/status UI behavior.
- `test/unit/integrations-mcp.test.ts` — MCP integration coverage.
- `test/unit/mcp-security.test.ts` — MCP auth/security behavior.
- `test/unit/mcp-stage-scoping.test.ts` — MCP stage scoping behavior.
- `test/integration/mcp-entrypoint.test.ts` — MCP entrypoint/startup integration.
- `packages/coding-agent/test/oauth-selector.test.ts` — OAuth selector UI in main chat.
- `packages/coding-agent/test/interactive-mode-status.test.ts` — interactive-mode status/auth flows.
- `packages/coding-agent/test/integrations-mcp.test.ts` — MCP integration coverage in coding-agent tests.
- `packages/coding-agent/test/suite/regressions/3592-no-builtin-tools-keeps-extension-tools.test.ts` — extension/tool retention behavior.

## Docs / research / specs that reference the same area
- `packages/workflows/README.md` — workflows package docs.
- `packages/coding-agent/docs/subagents.md` — subagents docs.
- `packages/coding-agent/examples/extensions/subagent/README.md` — subagent extension example docs.
- `packages/coding-agent/docs/images/workflow-graph.png` — workflow graph UI reference image.
- `research/docs/2026-05-11-pi-mcp-adapter-and-subagents.md` — MCP adapter + subagents notes.
- `research/docs/2026-05-12-extension-runs-workflows-test-surfaces.md` — workflows test-surface notes.
- `research/docs/2026-02-06-mcp-tool-calling-opentui.md` — MCP tool-calling research.
- `research/docs/2026-02-08-164-mcp-support-discovery.md` — MCP support/discovery research.
- `research/docs/2026-02-14-mcp-tool-discovery-startup-bugs.md` — MCP startup bug research.
- `research/docs/2026-02-14-failing-tests-mcp-config-discovery.md` — MCP config discovery failures.
- `specs/2026-02-09-mcp-support-and-discovery.md` — MCP support/discovery spec.
- `specs/2026-02-14-mcp-project-level-config-discovery-fix.md` — MCP config discovery fix spec.
- `specs/2026-05-11-pi-workflows-extension.md` — workflows extension spec.
- `specs/2026-05-14-workflow-sdk-pi-subagents-api-parity.md` — workflows/subagents API parity spec.
- `specs/2026-02-05-subagent-ui-independent-context.md` — subagent UI context spec.
