---
date: 2026-02-17
researcher: Claude Opus 4.6
git_commit: dcbf84a00404a1279b60f56b344079f8a0d4dac3
branch: lavaman131/hotfix/sub-agent-display
repository: atomic
topic: "Legacy code removal for skills configuration migration and CI config distribution audit"
tags: [research, codebase, skills, commands, legacy-removal, ci-pipeline, agent-discovery, config-distribution]
status: complete
last_updated: 2026-02-17
last_updated_by: Claude Opus 4.6
---

# Research: Legacy Code Removal for Skills Configuration Migration

## Research Question

Identify all legacy code in the codebase that should be removed in favor of the new SKILL.md-based skills configuration discovery system. Ensure built-in skills/commands/sub-agents are imported by automatic discovery for all agent SDKs (Claude Code, OpenCode, Copilot CLI). Audit CI to verify proper copying of relevant configs.

## Summary

The codebase has undergone a migration from a "commands" pattern (`.claude/commands/*.md`, `.opencode/command/*.md`) to a "skills" pattern (`.claude/skills/<name>/SKILL.md`, `.opencode/skills/<name>/SKILL.md`, `.github/skills/<name>/SKILL.md`). The migration is mostly complete but several legacy artifacts remain: active source code referencing old `commands/` directories, on-disk command files in `.opencode/command/`, stale README documentation, tombstone comments, unused type/function exports, and a CI gap where `.github/agents/` is not distributed. Skills are correctly cross-synced across all three SDK directories and discovered by the automatic discovery system.

---

## Detailed Findings

### 1. Legacy "Commands" Directory Code in `src/commands/init.ts`

The `getCommandsSubfolder()` function at `src/commands/init.ts:66-77` still returns `"commands"` for Claude and `"command"` for OpenCode agents. This function is actively called at line 366 during `reconcileScmVariants()` which handles SCM-specific variant selection during `atomic init`.

```typescript
// src/commands/init.ts:66-77
function getCommandsSubfolder(agentKey: AgentKey): string {
  switch (agentKey) {
    case "claude":
      return "commands";   // Should be "skills" now
    case "opencode":
      return "command";    // Should be "skills" now
    case "copilot":
      return "skills";     // Already correct
    default:
      return "commands";
  }
}
```

The function's JSDoc (lines 58-65) explicitly references `.claude/commands/` and `.opencode/command/` as the target directories. The `reconcileScmVariants()` function at lines 96-129 uses this to locate SCM variant files (gh-commit, sl-commit, etc.) and remove unselected variants from the target directory.

**Impact**: When `atomic init` runs for Claude or OpenCode agents, it targets `.claude/commands/` and `.opencode/command/` for SCM variant reconciliation. Since skills have moved to `.claude/skills/<name>/SKILL.md` directory-based layout, this reconciliation logic needs to be updated to handle both the old file-based pattern AND the new directory-based pattern (or exclusively the new pattern if old commands are fully removed).

### 2. Legacy Test Code in `src/commands/init.test.ts`

The test file has three tests for `reconcileScmVariants()`:

- **Test 1 (lines 19-53)**: Tests `.claude/commands/` with `.md` files -- the OLD pattern. Creates files like `gh-commit.md` in `.claude/commands/` and asserts on their presence/absence after reconciliation.
- **Test 2 (lines 55-89)**: Tests `.github/skills/` with directory-based skills -- the CURRENT pattern. Creates `SKILL.md` files inside skill directories.
- **Test 3 (lines 91-110)**: Tests `.opencode` with `commandsSubfolder: "command"` -- the OLD pattern.

Test 1 and Test 3 exercise the legacy commands pattern. Test 2 exercises the current skills pattern.

### 3. On-Disk Legacy Command Files in `.opencode/command/`

Four command files still exist on disk and are tracked by git:

- `.opencode/command/gh-commit.md`
- `.opencode/command/gh-create-pr.md`
- `.opencode/command/sl-commit.md`
- `.opencode/command/sl-submit-diff.md`

The `.claude/commands/` directory files have already been staged for deletion (shown as `D` in git status), but the `.opencode/command/` files have NOT been staged for deletion.

### 4. Stale README Documentation

`README.md:479-480` contains a table documenting legacy directory paths:

```markdown
| Claude Code    | `.claude/`   | `.claude/commands/`  | `CLAUDE.md`  |
| OpenCode       | `.opencode/` | `.opencode/command/` | `AGENTS.md`  |
```

These reference the old commands directories. For Claude, the commands directory no longer exists. For OpenCode, it still exists but is superseded by `.opencode/skills/`. For Copilot, the table already correctly shows `.github/skills/`.

### 5. Tombstone Comments in `skill-commands.ts`

Two comment blocks document removed legacy code:

- `src/ui/commands/skill-commands.ts:1262-1268` -- Tombstone for removed `SKILL_DEFINITIONS` array
- `src/ui/commands/skill-commands.ts:1296` -- Tombstone for removed `createSkillCommand()` factory

These comments are informational only and have no executable impact.

### 6. Stale Line References in `src/sdk/tools/discovery.ts`

`src/sdk/tools/discovery.ts:9` references `skill-commands.ts:1663-1906` but the actual function `discoverAndRegisterDiskSkills()` is at line 1766 and the file ends at line 1831. This is a stale comment reference.

### 7. Unused Type: `SkillMetadata`

`src/ui/commands/skill-commands.ts:37-44` defines `SkillMetadata` interface. It is re-exported from `src/ui/commands/index.ts:81`. However, no file in the codebase imports or uses `SkillMetadata`. It was the metadata type for the old `SKILL_DEFINITIONS` array pattern. The current system uses `DiskSkillDefinition` and `BuiltinSkill` instead.

### 8. Unused Exports in `skill-commands.ts`

Several exports are defined but only consumed internally within the same file and never imported externally:

| Export | Line | Status |
|---|---|---|
| `builtinSkillCommands` | 1357 | Only used internally by `registerBuiltinSkills()` |
| `registerBuiltinSkills()` | 1367 | Only called by `registerSkillCommands()` |
| `expandArguments` | 1830 | Only used internally |
| `getDiscoveredSkillDirectories()` | 1762 | Exported and re-exported from index.ts but never called by any consumer |
| `discoverSkillFiles()` | 1583 | Only called internally by `discoverAndRegisterDiskSkills()` |
| `parseSkillFile()` | 1633 | Only called internally |
| `shouldSkillOverride()` | 1564 | Only called internally |
| `loadSkillContent()` | 1689 | Only called internally |
| `SKILL_DISCOVERY_PATHS` | 1519 | Only used internally |
| `GLOBAL_SKILL_PATHS` | 1525 | Only used internally |
| `PINNED_BUILTIN_SKILLS` | 1533 | Only used internally |
| `BUILTIN_SKILLS_WITH_LOAD_UI` | 1542 | Only used internally |

### 9. Unused Synchronous `initializeCommands()`

`src/ui/commands/index.ts:117` defines a synchronous `initializeCommands()` that is re-exported from `src/ui/index.ts:1731` but never called anywhere in the codebase. Only the async variant `initializeCommandsAsync()` is used (called at `src/ui/index.ts:1346`).

### 10. Backward-Compat Re-export in `agent-commands.ts`

`src/ui/commands/agent-commands.ts:91-92` re-exports `parseMarkdownFrontmatter` from `../../utils/markdown.ts` with a comment "Re-export for backward compatibility". No consumer imports this re-export -- all consumers import directly from `../../utils/markdown.ts`.

### 11. Unused `CommandCategory` Values

`src/ui/commands/registry.ts:244` defines `CommandCategory` type as:
```typescript
type CommandCategory = "builtin" | "workflow" | "skill" | "agent" | "custom" | "file" | "folder";
```

The values `"file"`, `"folder"`, and `"custom"` are never assigned to any command. They appear only in the `sortCommands` priority map (line 465-472) but no command uses these categories.

---

## CI/CD Config Distribution Audit

### Distribution Channels

The project distributes configs through two channels:

1. **npm package** (controlled by `package.json:22-27` `files` field)
2. **Binary release config archives** (controlled by `publish.yml:77-95`)

### What Is Distributed

| Directory | npm Package | Config Archive | In Repo |
|---|---|---|---|
| `.claude/` (entire directory) | Included | Included | Yes |
| `.opencode/` (entire directory) | Included | Included | Yes |
| `.github/skills/` | Included | Included | Yes |
| **`.github/agents/`** | **EXCLUDED** | **EXCLUDED** | **Yes (9 files)** |
| `.github/workflows/` | Excluded | Excluded | Yes (CI infra) |

### The `.github/agents/` Gap

The `.github/agents/` directory contains 9 agent definition files (same agents as `.claude/agents/` and `.opencode/agents/`). These are **not distributed** through either channel:

- `package.json:26` lists only `".github/skills"`, not `".github/agents"`
- `publish.yml:86` copies only `.github/skills`, not `.github/agents`

This means Copilot CLI users who install via npm or download binaries will NOT receive the `.github/agents/` definitions. They WILL receive `.github/skills/` (all 11 skills) but not the agents.

By contrast, `.claude/agents/` and `.opencode/agents/` ARE distributed because those parent directories (`.claude/` and `.opencode/`) are included wholesale.

### Config Archive Details

The publish workflow (`publish.yml:77-95`) creates staging directory:
```bash
cp -r .claude config-staging/
cp -r .opencode config-staging/
mkdir -p config-staging/.github
cp -r .github/skills config-staging/.github/   # Only skills, not agents
rm -rf config-staging/.opencode/node_modules
```

---

## Cross-Config Consistency

### Skills: Identical Across All Three Directories

All 11 SKILL.md files are byte-for-byte identical across `.claude/skills/`, `.opencode/skills/`, and `.github/skills/`. The cross-sync mechanism in `materializeBuiltinSkillsForSdk()` ensures this.

**Skills present in all three directories:**
`create-spec`, `explain-code`, `frontend-design`, `gh-commit`, `gh-create-pr`, `init`, `prompt-engineer`, `research-codebase`, `sl-commit`, `sl-submit-diff`, `testing-anti-patterns`

### Agents: Same Set, Different Frontmatter Per SDK

All three directories define the same 9 agents with consistent body content but SDK-specific frontmatter:

| Agent | `.claude/` | `.opencode/` | `.github/` |
|---|---|---|---|
| codebase-analyzer | Present | Present | Present |
| codebase-locator | Present | Present | Present |
| codebase-online-researcher | Present | Present | Present |
| codebase-pattern-finder | Present | Present | Present |
| codebase-research-analyzer | Present | Present | Present |
| codebase-research-locator | Present | Present | Present |
| debugger | Present | Present | Present |
| reviewer | Present | Present | Present |
| worker | Present | Present | Present |

**Frontmatter differences:**
- Claude Code: `model: opus`, `memory: project`, tools as comma-separated string
- OpenCode: `mode: subagent`, tools as key-value boolean map
- Copilot: `tools` as JSON array of strings, inline `mcp-servers` block

### Extra Files: `.opencode/command/` Still Present

`.opencode/command/` contains 4 legacy command files that duplicate the skills already available in `.opencode/skills/`:
- `gh-commit.md`, `gh-create-pr.md`, `sl-commit.md`, `sl-submit-diff.md`

---

## SDK Skill Discovery Documentation

### Claude Code
- **Project skills**: `.claude/skills/<name>/SKILL.md`
- **Personal skills**: `~/.claude/skills/<name>/SKILL.md`
- **Legacy commands**: `.claude/commands/` still works; skill takes precedence if same name exists
- **Agents**: `.claude/agents/<name>.md`
- SDK discovers skills when `settingSources` includes `'project'` and `"Skill"` is in `allowedTools`

### Copilot CLI
- **Project skills**: `.github/skills/<name>/SKILL.md` (also reads `.claude/skills/`)
- **Personal skills**: `~/.copilot/skills/<name>/SKILL.md` (also `~/.claude/skills/`)
- **Agents**: `.github/agents/<name>.md`
- No configuration needed; automatic discovery

### OpenCode
- **Project skills**: `.opencode/skills/<name>/SKILL.md` (also reads `.claude/skills/`, `.agents/skills/`)
- **Personal skills**: `~/.config/opencode/skills/<name>/SKILL.md` (also `~/.claude/skills/`)
- **Agents**: `.opencode/agents/<name>.md`
- Additional paths configurable via `config.skills.paths` in `opencode.json`
- Remote URL fetching via `config.skills.urls`

### Atomic's Discovery Flow

The initialization pipeline in `initializeCommandsAsync()` (`src/ui/commands/index.ts:139-167`) runs:

1. `registerBuiltinCommands()` -- 8 UI commands (help, theme, clear, etc.)
2. `loadWorkflowsFromDisk()` + `registerWorkflowCommands()` -- ralph workflow
3. `registerSkillCommands()` -- 7 builtin skills from `BUILTIN_SKILLS` array
4. `materializeBuiltinSkillsForSdk()` -- Writes SKILL.md to all 3 SDK dirs, cross-syncs non-builtins
5. `discoverAndRegisterDiskSkills()` -- Discovers from `.claude/skills/`, `.opencode/skills/`, `.github/skills/`, and global paths
6. `registerAgentCommands()` -- Discovers from `.claude/agents/`, `.opencode/agents/`, `.github/agents/`, and global paths

---

## Code References

- `src/commands/init.ts:66-77` -- Legacy `getCommandsSubfolder()` function
- `src/commands/init.ts:96-129` -- `reconcileScmVariants()` uses `commandsSubfolder` parameter
- `src/commands/init.ts:366` -- Call site passing `getCommandsSubfolder()` result
- `src/commands/init.test.ts:19-53` -- Test exercising legacy `.claude/commands/` pattern
- `src/commands/init.test.ts:91-110` -- Test exercising legacy `.opencode/command/` pattern
- `src/ui/commands/skill-commands.ts:37-44` -- Unused `SkillMetadata` interface
- `src/ui/commands/skill-commands.ts:1262-1268` -- `SKILL_DEFINITIONS` tombstone comment
- `src/ui/commands/skill-commands.ts:1296` -- `createSkillCommand` tombstone comment
- `src/ui/commands/skill-commands.ts:1357-1359` -- Unused export `builtinSkillCommands`
- `src/ui/commands/skill-commands.ts:1367-1374` -- Unused export `registerBuiltinSkills()`
- `src/ui/commands/skill-commands.ts:1762-1764` -- Unused `getDiscoveredSkillDirectories()`
- `src/ui/commands/skill-commands.ts:1830` -- Unused export `expandArguments`
- `src/ui/commands/index.ts:81` -- Unused re-export of `SkillMetadata`
- `src/ui/commands/index.ts:117` -- Unused sync `initializeCommands()`
- `src/ui/index.ts:1731` -- Unused re-export of `initializeCommands`
- `src/ui/commands/agent-commands.ts:91-92` -- Backward-compat re-export of `parseMarkdownFrontmatter`
- `src/ui/commands/registry.ts:244` -- Unused `CommandCategory` values `"file"`, `"folder"`, `"custom"`
- `src/sdk/tools/discovery.ts:9` -- Stale line number reference in comment
- `README.md:479-480` -- Stale commands directory documentation
- `.opencode/command/` -- 4 legacy command files still on disk
- `.github/workflows/publish.yml:86` -- Only copies `.github/skills`, not `.github/agents`
- `package.json:26` -- Only includes `.github/skills`, not `.github/agents`

## Architecture Documentation

### Current Skill Discovery Architecture

The system follows a "materialize-then-discover" pattern:

1. **Builtin skills** are hardcoded in the `BUILTIN_SKILLS` array in `skill-commands.ts` with embedded prompts
2. **Materialization** writes these as `SKILL.md` files to all three SDK directories so each SDK's native discovery can find them
3. **Cross-sync** propagates non-builtin skills (e.g., `gh-commit` from `.github/skills/`) to all three directories
4. **Discovery** reads back all `SKILL.md` files and registers them as slash commands with priority resolution
5. **Agent discovery** separately reads `.md` files from all three `agents/` directories

### Priority Resolution

- **Skills**: `project` (3) > `user/global` (2) > `builtin` (1). Pinned builtins (`prompt-engineer`, `testing-anti-patterns`) are never overridden.
- **Agents**: `project` (2) > `user/global` (1).

### Config Directories

| SDK | Config Dir | Skills Dir | Agents Dir | Commands Dir (Legacy) |
|---|---|---|---|---|
| Claude Code | `.claude/` | `.claude/skills/` | `.claude/agents/` | `.claude/commands/` (deleted) |
| OpenCode | `.opencode/` | `.opencode/skills/` | `.opencode/agents/` | `.opencode/command/` (still exists) |
| Copilot CLI | `.github/` | `.github/skills/` | `.github/agents/` | N/A |

## Historical Context (from research/)

- `research/docs/2026-02-03-command-migration-notes.md` -- Previous migration notes for removed commands
- `research/docs/2026-02-08-skill-loading-from-configs-and-ui.md` -- Skill loading from configs with custom status UI
- `research/docs/2026-02-14-frontend-design-builtin-skill-integration.md` -- Adding frontend-design as a built-in skill
- `research/docs/2026-02-04-agent-subcommand-parity-audit.md` -- Agent subcommand parity audit across agents
- `research/docs/2026-01-19-slash-commands.md` -- Original slash commands research

## Related Research

- `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md` -- Sub-agent SDK integration analysis
- `research/docs/2026-01-31-claude-agent-sdk-research.md` -- Claude Agent SDK v2 TypeScript research
- `research/docs/2026-01-31-opencode-sdk-research.md` -- OpenCode SDK research
- `research/docs/2026-01-31-github-copilot-sdk-research.md` -- GitHub Copilot SDK research

## Open Questions

1. **Should `reconcileScmVariants()` in `init.ts` be updated to always use `"skills"` as the subfolder for all agents?** Currently Claude and OpenCode use `"commands"`/`"command"` while Copilot uses `"skills"`. If the old commands directories are fully removed, the init flow will silently skip reconciliation for Claude/OpenCode (since the source directories won't exist). The question is whether this should be explicitly updated to target the skills directories.

2. **Should `.opencode/command/` files be deleted?** They duplicate the content now available in `.opencode/skills/`. However, OpenCode may still read from `command/` for backward compatibility in some configurations. The OpenCode SDK documentation shows it discovers skills from `.opencode/skills/` but may also support legacy command paths.

3. **Should `.github/agents/` be added to CI distribution?** Adding `".github/agents"` to both `package.json:files` and `publish.yml` config archive step would ensure Copilot CLI users receive agent definitions. However, Copilot's agent discovery from `.github/agents/` may have different semantics in the GitHub platform context (agents committed to default branch for Copilot coding agent).

4. **Should the backward-compat re-export of `parseMarkdownFrontmatter` from `agent-commands.ts` be removed?** No consumer uses it, but removing it is a breaking API change for any external consumers not tracked in this repo.

5. **Should unused exports be removed or kept for potential future external use?** Many exports in `skill-commands.ts` are public API surface but have zero external consumers. Removing them simplifies the module but could break downstream code.
