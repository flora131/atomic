---
date: 2026-02-08 20:01:42 UTC
researcher: Claude Opus 4.6
git_commit: 5b33b79c1b8a4a2131b4640b077b16dd3a9bf352
branch: lavaman131/feature/tui
repository: atomic
topic: "Skill loading from .opencode/.claude/.github configs with custom status UI"
tags: [research, skills, config-loading, ui-components, opentui, skill-discovery, SKILL.md, status-indicator]
status: complete
last_updated: 2026-02-08
last_updated_by: Claude Opus 4.6
---

# Research: Skill Loading from Configs with Custom Status UI

## Research Question

How to add proper support to load skills from the local and global configs from `.opencode`, `.claude`, `.github`, and implement a custom UI that triggers when a skill is loaded (similar UI to tool calls running with the circle icon that turns green on success or red on failure/cancellation).

## Summary

This research covers three interconnected areas: (1) how each agent SDK defines and discovers skills from their respective config directories, (2) how the Atomic CLI currently handles skill loading and where gaps exist, and (3) how to implement a skill-loading status indicator in the TUI using OpenTUI components. The project already has partial skill loading via `BUILTIN_SKILLS` in `skill-commands.ts`, but lacks runtime discovery from disk-based SKILL.md files. All three SDKs (OpenCode, Claude Agent SDK, Copilot) use the Agent Skills open standard (`SKILL.md` files with YAML frontmatter) but with different discovery paths and loading mechanisms.

---

## Detailed Findings

### 1. The Agent Skills Open Standard (SKILL.md)

All three SDKs converge on the [Agent Skills specification](https://agentskills.io/specification) created by Anthropic and adopted by GitHub and OpenAI.

#### File Structure

```
<skill-name>/
├── SKILL.md          # Required: YAML frontmatter + markdown instructions
├── scripts/          # Optional: Executable code
├── references/       # Optional: Additional documentation
└── assets/           # Optional: Templates, images, resources
```

#### SKILL.md Frontmatter Schema

```yaml
---
name: skill-name           # Required: 1-64 chars, lowercase alphanumeric + hyphens
description: What it does   # Required: 1-1024 chars, when to use it
license: MIT               # Optional
compatibility: opencode    # Optional: environment requirements
allowed-tools: Bash Read   # Optional (experimental): space-delimited tool names
metadata:                  # Optional: string-to-string map
  author: org-name
  version: "1.0"
---

# Skill Instructions (Markdown body)
...
```

**Name constraints**: Regex `^[a-z0-9]+(-[a-z0-9]+)*$`. Must match the parent directory name. No leading/trailing hyphens or consecutive `--`.

#### Example from this project

`.github/skills/commit/SKILL.md` (line 1-4):
```yaml
---
name: commit
description: Create well-formatted commits with conventional commit format.
---
```

`.opencode/skills/prompt-engineer/SKILL.md` (line 1-4):
```yaml
---
name: prompt-engineer
description: Use this skill when creating, improving, or optimizing prompts...
---
```

#### Claude Code Extensions (non-standard fields)

| Field                      | Description                                              |
|----------------------------|----------------------------------------------------------|
| `argument-hint`            | Hint shown during autocomplete (e.g., `[issue-number]`) |
| `disable-model-invocation` | Prevent agent from auto-loading this skill               |
| `user-invocable`           | Set `false` to hide from `/` command menu                |
| `model`                    | Model to use when this skill is active                   |
| `context`                  | Set to `fork` to run in a forked subagent context        |
| `agent`                    | Which subagent type to use when `context: fork`          |

---

### 2. Skill Discovery Paths by SDK

#### 2a. OpenCode SDK

**Source**: [OpenCode Skills Docs](https://opencode.ai/docs/skills/) | DeepWiki `anomalyco/opencode`

**Project-level paths** (scanned from cwd to git worktree root):
- `.opencode/skills/<name>/SKILL.md`
- `.claude/skills/<name>/SKILL.md` (Claude-compatible, can be disabled with `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`)
- `.agents/skills/<name>/SKILL.md`

**Global paths**:
- `~/.config/opencode/skills/<name>/SKILL.md`
- `~/.claude/skills/<name>/SKILL.md`
- `~/.agents/skills/<name>/SKILL.md`

**Additional**: Custom paths from `skills.paths` in `opencode.json`.

**Loading mechanism**: Skills are surfaced as a built-in `skill` tool. The agent calls `Skill.all()` to list available skills, and `Skill.get(name)` to load the full content. Permission filtering (`allow`/`deny`/`ask`) is applied before loading.

**Key source files** (in `anomalyco/opencode` repo):
- `packages/opencode/src/skill/skill.ts` -- `Skill` namespace, `state()` discovery, `all()`, `get()`
- `packages/opencode/src/tool/skill.ts` -- `SkillTool` definition, `execute()`, permission filtering

#### 2b. Claude Agent SDK

**Source**: `docs/claude-agent-sdk/typescript-sdk.md`, `docs/claude-agent-sdk/typescript-v2-sdk.md`

Claude Agent SDK does **not** have a dedicated skills loading API. Instead, skills are managed by the Claude Code runtime based on `settingSources`:

```typescript
settingSources: ['user', 'project', 'local']
```

| Value       | Location                      | Skills path                           |
|-------------|-------------------------------|---------------------------------------|
| `'user'`    | `~/.claude/settings.json`     | `~/.claude/skills/<name>/SKILL.md`    |
| `'project'` | `.claude/settings.json`       | `.claude/skills/<name>/SKILL.md`      |
| `'local'`   | `.claude/settings.local.json` | `.claude/skills/<name>/SKILL.md`      |

The Claude Code runtime (not the SDK) automatically discovers and loads skills from `.claude/skills/` directories when `settingSources` includes `'project'` or `'user'`.

**Progressive disclosure**: Skills load in three levels:
1. **L1**: `name` + `description` always loaded into system prompt (~100 tokens)
2. **L2**: Full SKILL.md body loaded when request matches description (<5000 tokens recommended)
3. **L3**: `scripts/`, `references/`, `assets/` loaded only when agent accesses them

#### 2c. Copilot SDK

**Source**: `docs/copilot-cli/skills.md` | DeepWiki `github/copilot-sdk`

The Copilot SDK passes skill directories to the Copilot CLI via JSON-RPC:

```typescript
// In SessionConfig (nodejs/src/types.ts)
skillDirectories?: string[];
disabledSkills?: string[];
```

**Project-level paths**:
- `.github/skills/<name>/SKILL.md` (primary)
- `.claude/skills/<name>/SKILL.md` (backward compatible)

**Global paths**:
- `~/.copilot/skills/<name>/SKILL.md`
- `~/.claude/skills/<name>/SKILL.md` (backward compatible)

The CLI binary handles all discovery, YAML parsing, relevance matching, and context injection. The SDK is a thin client that passes paths.

---

### 3. Current Atomic CLI Skill Implementation

#### 3a. Skill Command System (`src/ui/commands/skill-commands.ts`)

**Current state**: Skills are defined as **hardcoded builtins** with embedded prompts.

**`BUILTIN_SKILLS`** array at line 70 contains 9 skills:
- `commit` (aliases: `ci`)
- `research-codebase` (aliases: `research`)
- `create-spec` (aliases: `spec`)
- `create-feature-list` (aliases: `features`)
- `implement-feature` (aliases: `impl`)
- `create-gh-pr` (aliases: `pr`)
- `explain-code` (aliases: `explain`)
- `prompt-engineer` (aliases: `prompt`)
- `testing-anti-patterns` (aliases: `test-patterns`, hidden)

**Types** (lines 27-58):
- `SkillMetadata`: Legacy type with `name`, `description`, `aliases`, `hidden`
- `BuiltinSkill`: Extends with `prompt` (full content) and `argumentHint`

**`expandArguments()`** at line 1548: Replaces `$ARGUMENTS` in prompts with user input or `"[no arguments provided]"`.

**`createBuiltinSkillCommand()`** at line 1624: Creates `CommandDefinition` with category `"skill"`, calls `context.sendSilentMessage(expandedPrompt)` to send the prompt without displaying it as a user message.

**`registerSkillCommands()`** at line 1699: Registers builtins first, then legacy `SKILL_DEFINITIONS` (which overlap).

#### 3b. What's Missing

1. **No disk-based SKILL.md discovery**: The system does not scan `.opencode/skills/`, `.claude/skills/`, `.github/skills/`, or global paths for SKILL.md files.
2. **No frontmatter parsing**: No code to parse YAML frontmatter from SKILL.md files (though `agent-commands.ts` has `parseMarkdownFrontmatter()` at line 1188 that could be reused).
3. **No global skill paths**: Only project-local builtin skills exist. No `~/.opencode/skills`, `~/.claude/skills`, `~/.copilot/skills` scanning.
4. **No skill-loading UI feedback**: When a skill command executes, there is no visual indicator showing the skill was loaded/invoked (unlike tool calls which show status icons).
5. **No per-SDK skill passthrough**: The Copilot SDK's `skillDirectories` and OpenCode's `Skill.all()` are not utilized.

#### 3c. Related Existing Infrastructure

**Agent discovery** (`src/ui/commands/agent-commands.ts`):
- `discoverAgentFiles()` at line 1493 scans project-local (`.claude/agents`, `.opencode/agents`, `.github/agents`, `.atomic/agents`) and global (`~/.claude/agents`, `~/.opencode/agents`, `~/.copilot/agents`, `~/.atomic/agents`) paths
- `parseAgentFile()` at line 1519 reads markdown content, calls `parseMarkdownFrontmatter()` at line 1188 to extract YAML frontmatter
- Priority system: project(4) > atomic(3) > user(2) > builtin(1)

**Config path resolution** (`src/utils/config-path.ts`):
- `getConfigRoot()` at line 77 resolves the project config root based on installation type (source/npm/binary)
- For binary installs, uses XDG conventions: `~/.local/share/atomic` or `$XDG_DATA_HOME/atomic`

**Settings** (`src/utils/settings.ts`):
- Two-tier resolution: local `.atomic/settings.json` at line 27 overrides global `~/.atomic/settings.json` at line 22
- Read pattern: check local first, fall back to global
- Write pattern: always write to global

**Command registry** (`src/ui/commands/registry.ts`):
- `CommandRegistry` class at line 209 with `register()`, `get()`, `search()` methods
- Category sort priority at line 383: `workflow(0) > skill(1) > agent(2) > builtin(3) > custom(4)`
- Idempotent registration via `globalRegistry.has()` guard

---

### 4. Skill Discovery Implementation Design

Based on the existing agent discovery pattern, disk-based skill discovery should follow a parallel structure:

#### 4a. Discovery Paths (Unified)

| Scope     | Path Pattern                             | Priority |
|-----------|------------------------------------------|----------|
| Project   | `.claude/skills/<name>/SKILL.md`         | 4        |
| Project   | `.opencode/skills/<name>/SKILL.md`       | 4        |
| Project   | `.github/skills/<name>/SKILL.md`         | 4        |
| Project   | `.atomic/skills/<name>/SKILL.md`         | 3        |
| Global    | `~/.claude/skills/<name>/SKILL.md`       | 2        |
| Global    | `~/.opencode/skills/<name>/SKILL.md`     | 2        |
| Global    | `~/.copilot/skills/<name>/SKILL.md`      | 2        |
| Global    | `~/.atomic/skills/<name>/SKILL.md`       | 2        |
| Builtin   | `BUILTIN_SKILLS` array (embedded)        | 1        |

Skills from higher-priority sources override lower-priority ones by name, matching the agent pattern at `agent-commands.ts:1595-1607`.

#### 4b. Frontmatter Parsing

Reuse `parseMarkdownFrontmatter()` from `agent-commands.ts:1188`. The function already handles:
1. Detecting `---` delimiters
2. Extracting YAML content
3. Parsing with a basic YAML parser
4. Returning `{ frontmatter, body }` tuple

For skills, extract:
- `name` (required) -- validate against directory name
- `description` (required)
- `aliases` (optional) -- map to `CommandDefinition.aliases`
- `argument-hint` (optional) -- map to `CommandDefinition.argumentHint`
- `hidden` / `user-invocable` (optional)
- `license`, `metadata` (optional, store but don't use)

#### 4c. SDK Passthrough

For each SDK client, discovered skill directories should be passed to the native session:

- **Claude**: Include `settingSources: ['project', 'user']` in SDK options (already done at `src/sdk/init.ts:24-33`)
- **OpenCode**: Skills are auto-discovered by the OpenCode server; no SDK passthrough needed
- **Copilot**: Pass discovered directories via `skillDirectories` in `SessionConfig` at session creation time (`src/sdk/copilot-client.ts`)

#### 4d. Registration Flow

```
initializeCommandsAsync()
  -> registerBuiltinCommands()          // /help, /theme, etc.
  -> await loadWorkflowsFromDisk()      // .atomic/workflows/
  -> registerWorkflowCommands()         // /ralph, etc.
  -> registerSkillCommands()            // BUILTIN_SKILLS (priority 1)
  -> await discoverAndRegisterDiskSkills()  // NEW: disk SKILL.md files
  -> await registerAgentCommands()      // agents from disk
```

Disk skills with higher priority override builtins via `globalRegistry.unregister()` + `globalRegistry.register()`, mirroring the agent pattern.

---

### 5. Skill Loading UI Design

#### 5a. Reference: Existing Tool Call UI

The project already has a polished tool call status indicator system:

**`StatusIndicator` component** (`src/ui/components/tool-result.tsx:76-108`):
```
Status icons:     pending=○  running=●  completed=●  error=✕  interrupted=●
Status colors:    pending=muted  running=accent  completed=success  error=error  interrupted=warning
```

**`AnimatedStatusIndicator`** (`src/ui/components/tool-result.tsx:53-74`): Alternates between `●` and `·` at 500ms for the running state.

**`ToolResult` component** (`src/ui/components/tool-result.tsx:256-353`):
- Header layout: `[status icon] [tool icon] [tool name] [title] [summary]`
- Content: `CollapsibleContent` with border, expandable

**Theme colors** (`src/ui/theme.tsx`):
- Dark theme: accent `#D4A5A5`, success `#8AB89A`, error `#C98A8A`, warning `#C9B896`, muted `#6A6A7A`

#### 5b. Target UI (from screenshot)

The screenshot shows:
```
● Skill(tmux-cli)
  └ Successfully loaded skill
```

This is a compact, non-collapsible status indicator with:
1. A green filled circle (`●`) indicating success
2. The label `Skill(<name>)` identifying the skill
3. A tree connector `└` with indentation
4. A status message ("Successfully loaded skill")

#### 5c. Proposed `SkillStatusIndicator` Component

The skill loading UI should be a lightweight component rendered inline in the chat message flow, similar to tool calls but simpler (no collapsible content).

**States:**

| State     | Icon | Color           | Message                          |
|-----------|------|-----------------|----------------------------------|
| loading   | ● (blinking) | accent `#D4A5A5` | `Loading skill...`             |
| loaded    | ●    | success `#8AB89A`| `Successfully loaded skill`     |
| error     | ✕    | error `#C98A8A`  | `Failed to load skill: <reason>` |

**Layout** (using OpenTUI `<box>` and `<text>` primitives):

```
<box flexDirection="column">
  <box flexDirection="row" gap={1}>
    <StatusIndicator status={status} />           // Reuse from tool-result.tsx
    <text style={{ fg: colors.accent }}> Skill</text>
    <text style={{ fg: colors.muted }}>({skillName})</text>
  </box>
  <box paddingLeft={2}>
    <text style={{ fg: colors.muted }}>└ {statusMessage}</text>
  </box>
</box>
```

**Integration points:**

1. **In `executeCommand()`** (`src/ui/chat.tsx:1973`): When a skill command is dispatched, render a `SkillStatusIndicator` in `loading` state before calling `command.execute()`.

2. **In `createBuiltinSkillCommand()`** (`src/ui/commands/skill-commands.ts:1624`): Return a `CommandResult` with metadata indicating that a skill was loaded, including the skill name and status.

3. **In the message bubble rendering** (`src/ui/chat.tsx:982`): When a command result contains skill metadata, render the `SkillStatusIndicator` component inline.

**Alternative approach (simpler)**: Instead of modifying `CommandResult`, the skill loading indicator could be injected as a system message in the messages array, similar to how compaction summaries are rendered. This avoids modifying the command return type.

#### 5d. OpenTUI Implementation Notes

OpenTUI does **not** have built-in status indicator or spinner components. The project already implements custom ones:

- `AnimatedStatusIndicator` at `tool-result.tsx:53-74` uses React `useState` + `useEffect` with `setInterval` for animation
- `LoadingIndicator` at `chat.tsx:660-681` cycles through `SPINNER_FRAMES` at 120ms
- `StreamingBullet` at `chat.tsx:766-777` alternates `●`/`·` at 500ms

All of these use basic `<text>` elements with `style={{ fg: color }}` -- no custom `Renderable` classes needed.

For the skill loading indicator, the same pattern works:
1. Use `<text style={{ fg: statusColor }}>{statusIcon}</text>` for the status dot
2. Use `useState` + `useEffect` + `setInterval` for the blinking animation during loading
3. Transition from `loading` -> `loaded` or `error` after the skill command executes

---

### 6. Cross-Agent Parity Considerations

#### 6a. Skill Definition Parity

The project already mirrors skill definitions across config directories:

| Skill              | `.opencode/skills/` | `.claude/skills/` | `.github/skills/` | `.codex/skills/` |
|--------------------|:-------------------:|:-----------------:|:------------------:|:----------------:|
| prompt-engineer    | ✓                   | ✓                 | ✓                  | ✓                |
| testing-anti-patterns | ✓                | ✓                 | ✓                  | ✓                |
| commit             | —                   | —                 | ✓                  | —                |
| create-feature-list | —                  | —                 | ✓                  | —                |
| create-gh-pr       | —                   | —                 | ✓                  | —                |
| create-spec        | —                   | —                 | ✓                  | —                |
| explain-code       | —                   | —                 | ✓                  | —                |
| implement-feature  | —                   | —                 | ✓                  | —                |
| research-codebase  | —                   | —                 | ✓                  | —                |

`.github/skills/` has the most complete set (9 skills). `.opencode/` and `.claude/` have only 2 each.

#### 6b. How Each SDK Client Should Handle Skills

**Claude** (`src/sdk/claude-client.ts`):
- Already passes `settingSources: ["project"]` in `initClaudeOptions()` at `src/sdk/init.ts:24-33`
- The Claude Code runtime auto-discovers `.claude/skills/` when `settingSources` includes `'project'`
- For global skills, add `'user'` to `settingSources`: `settingSources: ["project", "user"]`

**OpenCode** (`src/sdk/opencode-client.ts`):
- The OpenCode server auto-discovers skills from `.opencode/skills/` and `.claude/skills/`
- No SDK-level passthrough needed; the server handles discovery
- Discovered skills are exposed via the `GET /skill` API endpoint

**Copilot** (`src/sdk/copilot-client.ts`):
- Must pass skill directories explicitly via `skillDirectories` in `SessionConfig`
- Currently at `src/sdk/copilot-client.ts:585-645`, `createSession()` builds `SdkSessionConfig` but does not include `skillDirectories`
- Should collect discovered skill directories and pass them:
  ```typescript
  skillDirectories: [
    join(cwd, '.github', 'skills'),
    join(cwd, '.claude', 'skills'),
    join(homedir(), '.copilot', 'skills'),
    join(homedir(), '.claude', 'skills'),
  ].filter(dir => existsSync(dir))
  ```

#### 6c. Unified Skill Loading (Atomic-Level)

For Atomic's TUI command system, skill loading should be **agent-agnostic**:

1. **Discovery**: Atomic discovers all SKILL.md files across all config directories at startup (like agents)
2. **Registration**: Each skill is registered as a `/skill-name` slash command with category `"skill"`
3. **Execution**: When invoked, the skill's markdown body (with `$ARGUMENTS` expansion) is sent to whichever active session the user has
4. **SDK passthrough**: Additionally, skill directories are passed to each SDK's native mechanism so the agent runtime can also discover and auto-load skills based on relevance

This dual approach means:
- Users can explicitly invoke skills via slash commands (Atomic handles it)
- Agents can auto-discover and load relevant skills (SDK handles it)

---

## Code References

### Existing Skill Implementation
- `src/ui/commands/skill-commands.ts:27-58` -- `SkillMetadata` and `BuiltinSkill` type definitions
- `src/ui/commands/skill-commands.ts:70` -- `BUILTIN_SKILLS` array (9 skills with embedded prompts)
- `src/ui/commands/skill-commands.ts:1548` -- `expandArguments()` placeholder expansion
- `src/ui/commands/skill-commands.ts:1624` -- `createBuiltinSkillCommand()` factory
- `src/ui/commands/skill-commands.ts:1699` -- `registerSkillCommands()` registration

### Agent Discovery (Pattern to Follow)
- `src/ui/commands/agent-commands.ts:34-39` -- Project-local agent discovery paths
- `src/ui/commands/agent-commands.ts:46-51` -- Global agent discovery paths
- `src/ui/commands/agent-commands.ts:1188` -- `parseMarkdownFrontmatter()` YAML parser
- `src/ui/commands/agent-commands.ts:1493` -- `discoverAgentFiles()` disk scanner
- `src/ui/commands/agent-commands.ts:1519` -- `parseAgentFile()` file reader and parser
- `src/ui/commands/agent-commands.ts:1595-1607` -- `shouldAgentOverride()` priority system
- `src/ui/commands/agent-commands.ts:1700-1727` -- `registerAgentCommands()` with override logic

### Tool Call UI (Pattern to Follow for Skill UI)
- `src/ui/components/tool-result.tsx:41-47` -- `STATUS_ICONS` map
- `src/ui/components/tool-result.tsx:53-74` -- `AnimatedStatusIndicator` (blinking ● / · at 500ms)
- `src/ui/components/tool-result.tsx:76-108` -- `StatusIndicator` component
- `src/ui/components/tool-result.tsx:86-92` -- Status color map
- `src/ui/components/tool-result.tsx:256-353` -- `ToolResult` component layout

### Command System
- `src/ui/commands/registry.ts:209` -- `CommandRegistry` class
- `src/ui/commands/registry.ts:383-389` -- Category sort priority
- `src/ui/commands/index.ts:132-151` -- `initializeCommandsAsync()` registration flow
- `src/ui/chat.tsx:1973-2265` -- `executeCommand()` dispatch and result handling

### SDK Clients
- `src/sdk/init.ts:24-33` -- `initClaudeOptions()` with `settingSources: ["project"]`
- `src/sdk/copilot-client.ts:585-645` -- `createSession()` (missing `skillDirectories`)
- `src/sdk/opencode-client.ts:608-633` -- `createSession()` (skills auto-discovered by server)
- `src/sdk/types.ts:106-125` -- `SessionConfig` interface

### Config and Settings
- `src/utils/config-path.ts:77` -- `getConfigRoot()` installation-aware path resolution
- `src/utils/settings.ts:21-28` -- Two-tier settings paths (local/global)

### Existing Config Directory SKILL.md Files
- `.github/skills/commit/SKILL.md` -- 9 skill directories in `.github/skills/`
- `.opencode/skills/prompt-engineer/SKILL.md` -- 2 skill directories in `.opencode/skills/`
- `.claude/skills/prompt-engineer/SKILL.md` -- 2 skill directories in `.claude/skills/`
- `.codex/skills/prompt-engineer/SKILL.md` -- 2 skill directories in `.codex/skills/`

---

## Architecture Documentation

### Current Patterns

1. **Embedded Builtins + Disk Override**: Skills are hardcoded in `BUILTIN_SKILLS` with full prompt content. The `SKILL_DEFINITIONS` legacy array provides metadata-only fallbacks. Disk-based skills are not currently discovered.

2. **Agent-Agnostic Command Execution**: All commands (builtin, workflow, skill, agent) funnel through `CommandContext.sendMessage()` or `CommandContext.sendSilentMessage()`, which sends the prompt to whichever SDK client session is active. The command layer does not know or care which agent is running.

3. **Idempotent Registration with Priority Override**: The registry prevents duplicate names via `has()` guard. Higher-priority disk agents can override builtins via `unregister()` + `register()`. Skills should follow the same pattern.

4. **React-Based Animated Indicators**: All status indicators use React's `useState` + `useEffect` + `setInterval` for animation, rendered as OpenTUI `<text>` elements with `style={{ fg: color }}`. No custom `Renderable` classes are needed.

5. **Handler Registration Bridge**: The chat component provides handler callbacks (`registerToolStartHandler`, `registerToolCompleteHandler`) to the parent `startChatUI()` function, which wires them to SDK events. Skill loading events should follow this same bridge pattern.

### Component Architecture for Skill Loading UI

```
ChatApp (chat.tsx)
  └── MessageBubble (chat.tsx:982)
        ├── Text segments
        ├── ToolResult (tool-result.tsx)        // Existing: tool call status
        ├── SkillLoadIndicator (NEW)            // New: skill loading status
        │     ├── StatusIndicator (reused)      // ● / ✕ with colors
        │     └── Skill name + status message
        └── ParallelAgentsTree
```

---

## Historical Context (from research/)

### Directly Related Research
- `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` -- Unified entity registry normalizing commands/skills/agents from all config formats. References name-based node system (`skill:commit`).
- `research/docs/2026-02-02-atomic-builtin-workflows-research.md` -- Making slash commands built-in, configurable workflows from `.atomic/workflows`, skill loading from `.claude/commands/`, `.opencode/command/`, `.github/commands/`.
- `research/docs/2026-02-03-model-params-workflow-nodes-message-queuing.md` -- SDK-first architecture: Claude `settingSources`, OpenCode `Config.get()`, Copilot `skillDirectories` for skills discovery.
- `research/docs/2026-01-31-workflow-config-semantics.md` -- Three-level precedence (local > user/global > defaults), cross-platform directory resolution with XDG conventions.
- `research/docs/2026-01-19-slash-commands.md` -- Catalog of slash commands across Claude, OpenCode, and Copilot CLI config directories.

### UI Component Research
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` -- ParallelAgentsTree with status icons (animated dot = running, green dot = completed), tree connector lines.
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` -- Tool call status indicators, collapsible outputs, execution timing.
- `research/docs/2026-01-31-opentui-library-research.md` -- OpenTUI: flexbox layout (Yoga engine), native Zig rendering, React reconciler.
- `research/docs/2026-02-06-at-mention-dropdown-research.md` -- Existing autocomplete pattern in `src/ui/components/autocomplete.tsx` as architectural foundation.
- `research/claude-ui-analysis.md` -- Claude Code visual analysis: tool call states (in-progress, completed), diff rendering.

### SDK Research
- `research/docs/2026-01-31-claude-agent-sdk-research.md` -- Claude Agent SDK v2 TypeScript: session management, event handling.
- `research/docs/2026-01-31-opencode-sdk-research.md` -- OpenCode SDK: session management, plugin system, configuration.
- `research/docs/2026-01-31-github-copilot-sdk-research.md` -- Copilot SDK: session management, skills system, permission handling.

---

## Related Research

- `research/docs/2026-02-05-pluggable-workflows-sdk-design.md`
- `research/docs/2026-02-02-atomic-builtin-workflows-research.md`
- `research/docs/2026-02-03-model-params-workflow-nodes-message-queuing.md`
- `research/docs/2026-01-31-workflow-config-semantics.md`
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md`
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md`
- `research/docs/2026-01-31-opentui-library-research.md`

---

## External References

### Agent Skills Standard
- [Agent Skills Specification](https://agentskills.io/specification)
- [agentskills/agentskills GitHub](https://github.com/agentskills/agentskills) -- Reference Python library
- [anthropics/skills GitHub](https://github.com/anthropics/skills) -- Official Anthropic skill examples

### OpenCode
- [OpenCode Skills Docs](https://opencode.ai/docs/skills/)
- [OpenCode Config Docs](https://opencode.ai/docs/config/)
- [OpenCode Agents Docs](https://opencode.ai/docs/agents/)
- [DeepWiki - anomalyco/opencode](https://deepwiki.com/anomalyco/opencode)

### Copilot
- [GitHub Docs - About Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [Copilot SDK - github/copilot-sdk](https://github.com/github/copilot-sdk)
- [Claude Code Skills Docs](https://code.claude.com/docs/en/skills)

### OpenTUI
- [DeepWiki - anomalyco/opentui](https://deepwiki.com/anomalyco/opentui)

---

## Open Questions

1. **Skill auto-loading vs explicit invocation**: Should Atomic only support explicit `/skill-name` invocation, or should it also pass skill directories to SDKs for automatic relevance-based loading? (This research recommends both.)

2. **Skill content deduplication**: When the same skill exists in `.opencode/skills/`, `.claude/skills/`, and `.github/skills/`, which one should be loaded? (This research recommends the agent-commands priority pattern: project > atomic > global > builtin, with first-found within the same priority level winning.)

3. **Disk skill refresh**: Should skills be re-discovered on every command execution, or cached at startup? (Agent discovery happens once at startup via `initializeCommandsAsync()`. Skills should follow the same pattern for consistency.)

4. **Copilot `disabledSkills`**: The Copilot SDK supports `disabledSkills` in `SessionConfig`. Should Atomic expose a mechanism to disable specific skills?

5. **Skill loading indicator placement**: Should the indicator appear as an inline message (like tool results), or as a transient status bar element? (This research recommends inline, matching the screenshot reference and tool result pattern.)

6. **`.codex/skills/` support**: The project has a `.codex/` directory with skills. Should this be included in discovery paths? (Not a priority since Codex is not one of the three primary SDKs.)
