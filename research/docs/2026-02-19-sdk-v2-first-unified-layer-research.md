---
date: 2026-02-19 08:43:48 UTC
researcher: OpenCode
git_commit: 89497d5b1bb7d29b90d7375737ff21a11e35dc4c
branch: lavaman131/hotfix/sub-agent-fixes
repository: atomic
topic: "Research current codebase for Claude SDK v2-first integration with v1 fallback, plus latest OpenCode/Copilot SDK conventions for a unified TUI layer"
tags: [research, codebase, claude-agent-sdk, opencode-sdk, copilot-sdk, tui, abstraction-layer]
status: complete
last_updated: 2026-02-19
last_updated_by: OpenCode
---

# Research

## Research Question
Research the current codebase to use the latest v2 version of the Claude Agent SDK in `docs/claude-agent-sdk/typescript-v2-sdk.md` (preferred where possible, fallback to v1 for unsupported functionality), reference latest OpenCode SDK and Copilot SDK information from AGENTS-linked sources, and document how conventions can be unified into a common layer for the TUI with production-focused practices.

## Summary
The current codebase already uses a unified provider abstraction (`CodingAgentClient` + shared `Session` + normalized event model) consumed by one TUI pipeline. Claude integration currently uses V1-style `query()` patterns and does not use `unstable_v2_*` APIs in runtime code. OpenCode integration uses SDK v2 client/server surfaces with SSE event subscriptions and normalized event mapping. Copilot integration uses `CopilotClient`/`CopilotSession` with streaming deltas, permission and user-input callbacks, and skill directory injection. Configuration and capability discovery already follow the three ecosystem roots (`.claude`, `.opencode`, `.github`) with merged MCP/skill/agent loading.

## Detailed Findings

### 1) Unified multi-provider layer already present
- Shared client contract: `src/sdk/types.ts:571` defines `CodingAgentClient`.
- Shared session contract: `src/sdk/types.ts:222` defines `Session` (`send`, `stream`, `summarize`, context usage, destroy).
- Shared event/message schema: `src/sdk/types.ts:193`, `src/sdk/types.ts:276`, `src/sdk/types.ts:485`, `src/sdk/types.ts:504`.
- Shared event emitter base: `src/sdk/base-client.ts:32`.
- Provider factories are centralized in chat bootstrap: `src/commands/chat.ts:69`, `src/commands/chat.ts:72`, `src/commands/chat.ts:74`, `src/commands/chat.ts:76`.
- TUI consumes providers via one interface: `src/ui/index.ts:275`, `src/ui/index.ts:1024`, `src/ui/index.ts:1059`.

### 2) Claude integration is currently v1-style in runtime
- Claude client imports v1-style SDK symbols (`query`, hooks, MCP helpers): `src/sdk/claude-client.ts:24`.
- Claude adapter class: `src/sdk/claude-client.ts:220`.
- `createSession()` wraps turn-based `query()` usage into unified `Session`: `src/sdk/claude-client.ts:986`, `src/sdk/claude-client.ts:475`.
- Turn send/stream both instantiate fresh `query()` cycles: `src/sdk/claude-client.ts:509`, `src/sdk/claude-client.ts:579`.
- Resume/compat behavior is handled through `options.resume` + captured session IDs: `src/sdk/claude-client.ts:465`, `src/sdk/claude-client.ts:877`, `src/sdk/claude-client.ts:1029`.
- Hook/event normalization path: `src/sdk/claude-client.ts:99`, `src/sdk/claude-client.ts:112`, `src/sdk/claude-client.ts:1044`, `src/sdk/claude-client.ts:956`.
- Local Claude v2 reference documents v2 APIs and fallback boundaries (`forkSession`, advanced input patterns remain v1): `docs/claude-agent-sdk/typescript-v2-sdk.md:333`, `docs/claude-agent-sdk/typescript-v2-sdk.md:344`, `docs/claude-agent-sdk/typescript-v2-sdk.md:358`, `docs/claude-agent-sdk/typescript-v2-sdk.md:384`.

### 3) OpenCode integration matches SDK v2 event-first conventions
- OpenCode imports v2 SDK client/server modules: `src/sdk/opencode-client.ts:71`, `src/sdk/opencode-client.ts:75`.
- OpenCode adapter class: `src/sdk/opencode-client.ts:297`.
- Startup pattern supports connect-first + optional local server spawn: `src/sdk/opencode-client.ts:1462`, `src/sdk/opencode-client.ts:1471`, `src/sdk/opencode-client.ts:1475`, `src/sdk/opencode-client.ts:1488`.
- Session stream pipeline combines `session.prompt(...)` with event subscriptions and queueing: `src/sdk/opencode-client.ts:1116`, `src/sdk/opencode-client.ts:1109`, `src/sdk/opencode-client.ts:1249`.
- Event normalization maps OpenCode part/tool/subagent/hitl shapes into shared events: `src/sdk/opencode-client.ts:600`, `src/sdk/opencode-client.ts:607`, `src/sdk/opencode-client.ts:636`, `src/sdk/opencode-client.ts:686`.
- MCP registration path in session creation: `src/sdk/opencode-client.ts:853`, `src/sdk/opencode-client.ts:858`, `src/sdk/opencode-client.ts:861`.

### 4) Copilot integration follows Copilot session + stream + callback model
- Copilot SDK import and client class: `src/sdk/copilot-client.ts:54`, `src/sdk/copilot-client.ts:159`.
- Session creation and wrapping: `src/sdk/copilot-client.ts:741`, `src/sdk/copilot-client.ts:252`.
- Streaming event handling (`assistant.message_delta`, reasoning, usage, idle) maps into shared stream output: `src/sdk/copilot-client.ts:335`, `src/sdk/copilot-client.ts:349`, `src/sdk/copilot-client.ts:366`, `src/sdk/copilot-client.ts:407`, `src/sdk/copilot-client.ts:421`.
- Permission + user-input callbacks are wired through session config and translated to shared events: `src/sdk/copilot-client.ts:708`, `src/sdk/copilot-client.ts:818`, `src/sdk/copilot-client.ts:819`.
- Skills directories from project and global config roots are supplied at session creation: `src/sdk/copilot-client.ts:767`, `src/sdk/copilot-client.ts:770`, `src/sdk/copilot-client.ts:820`.

### 5) Config ecosystem convergence exists across `.claude`, `.opencode`, `.github`
- Agent config roots by ecosystem: `src/config.ts:34`, `src/config.ts:45`, `src/config.ts:62`.
- Manual agent paths include project + global roots: `src/config/copilot-manual.ts:126`, `src/config/copilot-manual.ts:130`, `src/config/copilot-manual.ts:132`.
- MCP parser supports ecosystem-specific formats and merged discovery: `src/utils/mcp-config.ts:41`, `src/utils/mcp-config.ts:73`, `src/utils/mcp-config.ts:148`, `src/utils/mcp-config.ts:168`, `src/utils/mcp-config.ts:172`.
- Skills materialization/discovery spans all three roots: `src/ui/commands/skill-commands.ts:1375`, `src/ui/commands/skill-commands.ts:1376`, `src/ui/commands/skill-commands.ts:1377`, `src/ui/commands/index.ts:104`, `src/ui/commands/index.ts:111`.

### 6) Latest external SDK documentation references gathered
- Claude Agent SDK v2 preview (official): https://docs.anthropic.com/en/docs/agent-sdk/typescript-v2-preview
- Claude TypeScript SDK reference (official): https://docs.anthropic.com/en/docs/agent-sdk/typescript
- Claude sessions reference (`forkSession` availability context): https://docs.anthropic.com/en/docs/agent-sdk/sessions
- Claude TypeScript SDK changelog (`unstable_v2_*` evolution): https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/CHANGELOG.md
- OpenCode SDK docs: https://opencode.ai/docs/sdk/
- OpenCode server/event docs: https://opencode.ai/docs/server/
- OpenCode generated SDK surface: https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/sdk.gen.ts
- OpenCode generated types/event union: https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts
- Copilot SDK repo docs (Node/.NET): https://raw.githubusercontent.com/github/copilot-sdk/main/nodejs/README.md
- Copilot SDK repo docs (overview): https://raw.githubusercontent.com/github/copilot-sdk/main/README.md
- Copilot CLI usage/hooks/skills docs: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli, https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks, https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills

## Code References
- `src/sdk/types.ts:571` - Unified cross-provider client contract (`CodingAgentClient`).
- `src/sdk/types.ts:222` - Shared session contract consumed by UI and graph runtime.
- `src/commands/chat.ts:69` - Provider factory switch (`claude` / `opencode` / `copilot`).
- `src/ui/index.ts:988` - Session orchestration lock and lifecycle.
- `src/ui/index.ts:1059` - Shared message streaming entry point.
- `src/sdk/claude-client.ts:24` - Claude SDK v1-style import surface (`query`, hooks).
- `src/sdk/claude-client.ts:509` - Claude turn send path via `query()`.
- `src/sdk/claude-client.ts:579` - Claude turn stream path via `query()`.
- `src/sdk/opencode-client.ts:71` - OpenCode SDK v2 client import.
- `src/sdk/opencode-client.ts:507` - OpenCode event subscription startup.
- `src/sdk/opencode-client.ts:1116` - OpenCode session prompt-based stream dispatch.
- `src/sdk/copilot-client.ts:54` - Copilot SDK import surface.
- `src/sdk/copilot-client.ts:335` - Copilot streaming delta event handlers.
- `src/sdk/copilot-client.ts:818` - Copilot permission/user-input callback wiring.
- `src/utils/mcp-config.ts:148` - Cross-ecosystem MCP config merge/discovery.
- `src/ui/commands/skill-commands.ts:1375` - Multi-ecosystem skill folder materialization.

## Architecture Documentation
Current implementation uses a thin-adapter architecture where each provider client converts provider-native sessions/events into one shared internal contract before data reaches TUI state. The common flow is:
1) `chatCommand` selects provider client and starts it,
2) session config is built with model, MCP, tools, and permissions,
3) UI ensures/owns one active `Session`,
4) provider stream events are normalized into `AgentMessage`/`AgentEvent`,
5) UI tool/subagent/permission widgets consume normalized signals.

Documented pattern classes present in code:
- Adapter: provider-specific event and payload normalization (`src/sdk/claude-client.ts`, `src/sdk/opencode-client.ts`, `src/sdk/copilot-client.ts`).
- Factory: provider selection and client creation (`src/commands/chat.ts:69`).
- Registry: commands/tools/subagent registries (`src/ui/commands/registry.ts:278`, `src/sdk/tools/registry.ts:29`, `src/graph/subagent-registry.ts:28`).
- Observer/Event bus: typed event subscriptions from clients to UI (`src/sdk/types.ts:504`, `src/ui/index.ts:490`, `src/ui/index.ts:601`, `src/ui/index.ts:839`).

## Historical Context (from research/)
- `research/docs/2026-02-12-sdk-ui-standardization-research.md` - Documents normalized event/payload contract strategy and provider-agnostic UI model.
- `research/docs/2026-01-31-atomic-current-workflow-architecture.md` - Documents architecture baseline for factory/adapter/observer patterns and unified session abstractions.
- `research/docs/2026-01-31-claude-agent-sdk-research.md` - Documents v2 preview surface and explicit v1-only boundaries.
- `research/docs/2026-01-31-opencode-sdk-research.md` - Documents OpenCode v2 generated SDK/event model integration baseline.
- `research/docs/2026-02-16-opencode-tui-chat-architecture.md` - Documents event-to-store ordering and subagent/hitl rendering behavior.
- `research/docs/2026-01-31-github-copilot-sdk-research.md` - Documents Copilot session/event/permission/skills behavior and preview-state constraints.

## Related Research
- `research/docs/2026-02-16-sub-agent-tree-inline-state-lifecycle-research.md`
- `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md`
- `research/docs/2026-02-17-legacy-code-removal-skills-migration.md`
- `research/tickets/2026-02-15-205-skill-loading-indicator-duplicate.md`

## Open Questions
- The current runtime code path for Claude uses v1 `query()` semantics; no `unstable_v2_*` runtime path was located in `src/**/*.ts` during this research.
- Existing branch state includes local doc changes in `docs/claude-agent-sdk/typescript-v2-sdk.md` and `docs/claude-agent-sdk/typescript-sdk.md`; this research records current code and document state without reconciling unpublished edits.
- GitHub permalinks were not generated for source references in this document because the current working branch does not track an upstream branch in local status.
