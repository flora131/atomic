---
date: 2026-02-15 18:27:11 UTC
researcher: Copilot
git_commit: 2da2ff784656a19186f01b81ddcab37aa12fb146
branch: lavaman131/hotfix/sub-agents-ui
repository: atomic
topic: "TUI Skill Loading Indicator Appears Twice (Issue #205)"
tags: [research, codebase, skill-loading, tui-rendering, duplicate-indicator, bug-investigation]
status: complete
last_updated: 2026-02-15
last_updated_by: Copilot
---

# Research: Skill Loading Indicator Duplication (Issue #205)

## Research Question

Investigate GitHub issue [flora131/atomic#205](https://github.com/flora131/atomic/issues/205): When a skill is loaded via a slash command, the terminal UI displays the skill loading indicator (e.g., `skill (prompt-engineer)`) **twice**. Determine whether this is a functional bug (skill invoked twice) or a rendering issue, and whether it affects all skills.

## Summary

The duplication bug is caused by **two independent rendering paths** that both produce a `SkillLoadIndicator` component for the same skill invocation:

1. **Path A — `skill.invoked` SDK event**: The Copilot SDK emits a `skill.invoked` event, which triggers `handleSkillInvoked()` in `chat.tsx`. This adds a `MessageSkillLoad` entry to `message.skillLoads`, which renders as a `SkillLoadIndicator` at the top of the message.

2. **Path B — `tool.execution_start` SDK event with `toolName: "skill"`**: The SDK also emits a `tool.execution_start` event with `toolName: "skill"`. This creates a tool call entry in `message.toolCalls`, which renders via the `ToolResult` component. The `ToolResult` component has a special case (line 251) that detects `normalizedToolName === "skill"` and renders a `SkillLoadIndicator` inline.

Both paths render the **exact same component** (`SkillLoadIndicator`) with the **exact same format** (`Skill(name)` + `Successfully loaded skill`), producing visually identical duplicate indicators.

The `visibleToolCalls` filter at `chat.tsx:1303` excludes HITL tools and sub-agent Task tools but does **not** exclude skill tools, so the "skill" tool call passes through to rendering.

**This affects ALL skills** — both builtin and disk-based — because the dual-event emission is a property of the Copilot SDK, not any individual skill's configuration.

## Detailed Findings

### 1. Skill Loading Indicator Component

**File**: [`src/ui/components/skill-load-indicator.tsx`](https://github.com/flora131/atomic/blob/2da2ff784656a19186f01b81ddcab37aa12fb146/src/ui/components/skill-load-indicator.tsx)

The `SkillLoadIndicator` component renders:
```
● Skill(skill-name)
  └ Successfully loaded skill
```

- **Line 19**: `SkillLoadStatus` type: `"loading" | "loaded" | "error"`
- **Line 31-81**: Component renders a dot icon, `Skill({skillName})` text, and status message
- **Line 83-98**: `AnimatedDot` sub-component for loading state

### 2. Rendering Path A — `skill.invoked` Event (via `message.skillLoads`)

**Event emission**: [`src/sdk/copilot-client.ts:576-580`](https://github.com/flora131/atomic/blob/2da2ff784656a19186f01b81ddcab37aa12fb146/src/sdk/copilot-client.ts#L576-L580)
- SDK maps `"skill.invoked"` event → extracts `skillName` and `skillPath`

**Event subscription**: [`src/ui/index.ts:727-732`](https://github.com/flora131/atomic/blob/2da2ff784656a19186f01b81ddcab37aa12fb146/src/ui/index.ts#L727-L732)
- `client.on("skill.invoked", ...)` forwards to `skillInvokedHandler`

**Handler**: [`src/ui/chat.tsx:2302-2335`](https://github.com/flora131/atomic/blob/2da2ff784656a19186f01b81ddcab37aa12fb146/src/ui/chat.tsx#L2302-L2335)
- **Line 2307**: Deduplication check via `loadedSkillsRef.current.has(skillName)`
- **Line 2308**: Adds skill name to `loadedSkillsRef` Set
- **Lines 2310-2313**: Creates `MessageSkillLoad { skillName, status: "loaded" }`
- **Lines 2315-2334**: Appends to `message.skillLoads` of current streaming or last assistant message

**Rendering**: [`src/ui/chat.tsx:1592-1601`](https://github.com/flora131/atomic/blob/2da2ff784656a19186f01b81ddcab37aa12fb146/src/ui/chat.tsx#L1592-L1601)
- Maps `message.skillLoads` array → renders `<SkillLoadIndicator>` for each entry

### 3. Rendering Path B — `tool.execution_start` Event (via `message.toolCalls`)

**Event emission**: [`src/sdk/copilot-client.ts:540-551`](https://github.com/flora131/atomic/blob/2da2ff784656a19186f01b81ddcab37aa12fb146/src/sdk/copilot-client.ts#L540-L551)
- SDK emits `tool.execution_start` with `toolName: "skill"` when it processes the skill as a tool call

**Tool call rendering filter**: [`src/ui/chat.tsx:1299-1303`](https://github.com/flora131/atomic/blob/2da2ff784656a19186f01b81ddcab37aa12fb146/src/ui/chat.tsx#L1299-L1303)
```typescript
const isHitlTool = (name: string) =>
  name === "AskUserQuestion" || name === "question" || name === "ask_user";
const isSubAgentTool = (name: string) =>
  name === "Task" || name === "task";
const visibleToolCalls = toolCalls.filter(tc => !isHitlTool(tc.toolName) && !isSubAgentTool(tc.toolName));
```
- **"skill"/"Skill" tools are NOT filtered** — they pass through to `visibleToolCalls`

**Tool result special case**: [`src/ui/components/tool-result.tsx:249-265`](https://github.com/flora131/atomic/blob/2da2ff784656a19186f01b81ddcab37aa12fb146/src/ui/components/tool-result.tsx#L249-L265)
```typescript
if (normalizedToolName === "skill") {
  const skillName = (input.skill as string) || (input.name as string) || "unknown";
  const skillStatus: SkillLoadStatus =
    status === "completed" ? "loaded" : status === "error" ? "error" : "loading";
  return (
    <box marginBottom={1}>
      <SkillLoadIndicator skillName={skillName} status={skillStatus} errorMessage={errorMessage} />
    </box>
  );
}
```
- Bypasses standard tool result layout and renders `SkillLoadIndicator` directly

**Tool renderer registry**: [`src/ui/tools/registry.ts:806-807`](https://github.com/flora131/atomic/blob/2da2ff784656a19186f01b81ddcab37aa12fb146/src/ui/tools/registry.ts#L806-L807)
```typescript
Skill: skillToolRenderer,
skill: skillToolRenderer,
```

### 4. Why Both Paths Fire Simultaneously

The Copilot SDK emits **two** distinct events for a single skill invocation:

1. `skill.invoked` — a semantic event indicating which skill was activated
2. `tool.execution_start` with `toolName: "skill"` — the underlying tool call that implements the skill

Both events are mapped in `copilot-client.ts` and propagated independently to the UI layer. There is **no coordination** between the two rendering paths:

- Path A checks `loadedSkillsRef` to prevent duplicate `skill.invoked` events but does NOT suppress tool calls
- Path B renders tool calls unconditionally if they pass the `visibleToolCalls` filter
- Neither path is aware of the other

### 5. Command Result Handler (Third Path)

**File**: [`src/ui/chat.tsx:3577-3599`](https://github.com/flora131/atomic/blob/2da2ff784656a19186f01b81ddcab37aa12fb146/src/ui/chat.tsx#L3577-L3599)

A third code path exists where command execution results also add skill load indicators:
- **Line 3577**: Checks `result.skillLoaded` AND either has error or skill not in `loadedSkillsRef`
- **Lines 3581-3598**: Creates `MessageSkillLoad` and appends to last assistant message

This path shares the `loadedSkillsRef` guard with Path A, so duplication between Path A and Path C is prevented. However, it provides no coordination with Path B (tool calls).

### 6. All Skills Are Affected

**11 total skills** exist in the system:

| Type | Skills | Registration |
|------|--------|-------------|
| Builtin (7) | `research-codebase`, `create-spec`, `explain-code`, `prompt-engineer`, `testing-anti-patterns`, `init`, `frontend-design` | `BUILTIN_SKILLS` array in `skill-commands.ts:72-1247` |
| Disk-based (4) | `gh-commit`, `gh-create-pr`, `sl-commit`, `sl-submit-diff` | `.github/skills/*/SKILL.md` |

All skills flow through the same `createSkillCommand()` or `createDiskSkillCommand()` → `sendSilentMessage()` code path. The dual SDK event emission is at the SDK level, not the skill definition level, so **all skills are equally affected**.

### 7. PR #201 Context

PR #201 ("fix(ui): improve sub-agent tree rendering, skill loading, and lifecycle management") introduced the `loadedSkillsRef` deduplication mechanism in commit `42eb3ff`:

- Added session-level `Set<string>` tracking for loaded skills
- Both `handleSkillInvoked` (line 2307) and command result handler (line 3577) check this Set
- This successfully prevents duplicate indicators from **Path A** firing multiple times
- However, **it does not address Path B** (tool call rendering), which is the other half of the duplication

## Code References

- `src/ui/components/skill-load-indicator.tsx:31-81` — SkillLoadIndicator component
- `src/ui/chat.tsx:2302-2335` — handleSkillInvoked handler (Path A)
- `src/ui/chat.tsx:1592-1601` — message.skillLoads rendering (Path A output)
- `src/ui/chat.tsx:1299-1303` — visibleToolCalls filter (missing skill exclusion)
- `src/ui/components/tool-result.tsx:249-265` — Skill tool special-case rendering (Path B output)
- `src/ui/tools/registry.ts:757-773, 806-807` — skillToolRenderer definition and registration
- `src/sdk/copilot-client.ts:540-551` — tool.execution_start event mapping
- `src/sdk/copilot-client.ts:576-580` — skill.invoked event mapping
- `src/ui/index.ts:727-732` — skill.invoked event subscription
- `src/ui/chat.tsx:3577-3599` — Command result skill load handler (Path C)
- `src/ui/commands/skill-commands.ts:1327-1368` — Skill command execute functions

## Architecture Documentation

### Skill Event Flow
```
User types /skill-name
    → parseSlashCommand() [src/ui/commands/index.ts:210]
    → executeCommand() [src/ui/chat.tsx:3142]
    → command.execute() [src/ui/commands/skill-commands.ts:1327]
    → context.sendSilentMessage() [src/ui/chat.tsx:3193]
    → SDK processes skill invocation
        ├── Emits "skill.invoked" event → handleSkillInvoked() → message.skillLoads → SkillLoadIndicator ①
        └── Emits "tool.execution_start" (toolName: "skill") → handleToolStart() → message.toolCalls → ToolResult → SkillLoadIndicator ②
```

### Deduplication Mechanism
```
loadedSkillsRef: Set<string> (per-session, React ref)
    ├── Checked by handleSkillInvoked() [chat.tsx:2307] ✅ Prevents duplicate Path A
    ├── Checked by command result handler [chat.tsx:3577] ✅ Prevents duplicate Path C
    └── NOT checked by tool rendering path ❌ Path B always renders if tool call exists
```

### Existing Precedent: Tool Filtering
The codebase already filters certain tools from `visibleToolCalls`:
- `AskUserQuestion`, `question`, `ask_user` — HITL tools (hidden; dedicated dialog handles display)
- `Task`, `task` — Sub-agent tools (hidden; `ParallelAgentsTree` handles display)
- `Skill`, `skill` — **NOT filtered** (this is the gap)

## Historical Context (from research/)

- `research/docs/2026-02-08-skill-loading-from-configs-and-ui.md` — Original research for skill loading UI, proposed `SkillLoadIndicator` design
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md` — Documents content segmentation; skill load indicators are at priority 1 (top) via `message.skillLoads`
- `research/tickets/2026-02-09-171-markdown-rendering-tui.md` — Documents `toolEventsViaHooks` flag that prevents duplicate **tool** rendering; similar pattern needed for skills
- `research/docs/2026-02-14-subagent-output-propagation-issue.md` — Related sub-agent rendering issues
- `specs/skill-loading-from-configs-and-ui.md` — Technical spec for skill loading system and UI indicator

## Related Research

- `research/docs/2026-02-14-frontend-design-builtin-skill-integration.md` — Documents SkillLoadIndicator for frontend-design skill
- `research/docs/2026-02-13-emoji-unicode-icon-usage-catalog.md` — skill-load-indicator.tsx uses `●` (U+25CF) and `✕` (U+2715) icons
- `research/docs/2026-02-12-sdk-ui-standardization-comprehensive.md` — References skill loading UI standardization

## Open Questions

1. **SDK behavior confirmation**: Does the Copilot SDK always emit both `skill.invoked` AND `tool.execution_start` for every skill? Or does this depend on SDK version or skill type?
2. **Other SDK agents**: Do the Claude Agent SDK and OpenCode SDK exhibit the same dual-event pattern for skills, or is this Copilot-specific?
3. **Rendering timing**: When both indicators appear, does one show "loading" animation while the other shows "loaded" status, or do they appear simultaneously as "loaded"?
