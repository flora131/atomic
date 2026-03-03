---
date: 2026-03-03 17:59:22 UTC
researcher: GitHub Copilot CLI
git_commit: 97e196026d4c8681b4f14bf895be225ba7463799
branch: main
repository: atomic
topic: "How to incorporate Azure DevOps SCM integration following the existing Git and Sapling patterns"
tags: [research, codebase, scm, azure-devops, init, skills, config]
status: complete
last_updated: 2026-03-03
last_updated_by: GitHub Copilot CLI
---

# Research: Azure DevOps SCM Integration

## Research Question

How are Git (GitHub) and Sapling (Phabricator) SCM integrations implemented in Atomic, and what would be needed to add an equivalent Azure DevOps SCM integration following the same patterns?

## Summary

Atomic uses a **prefix-based, template-directory SCM system** where selecting an SCM type during `atomic init` copies only the relevant skill files (prefixed `gh-` for GitHub, `sl-` for Sapling) into the project's agent folders, and removes the others. Azure DevOps was explicitly anticipated as the third SCM type (`// Future: | 'azure-devops'` in `src/config.ts:90`). Adding it requires: (1) one config entry in `src/config.ts`, (2) one new prefix `az-` in `src/utils/atomic-global-config.ts`, (3) an update to `assets/settings.schema.json`, and (4) new skill files `az-commit/` and `az-create-pr/` under each agent's skills folder. Since Azure DevOps uses standard `git` for version control, `az-commit` can largely mirror `gh-commit`; only `az-create-pr` needs distinct content using `az repos pr create`.

---

## Detailed Findings

### 1. SCM Architecture Overview

The SCM system has three layers:

| Layer | File | Role |
|-------|------|------|
| Type system | `src/config.ts:89-158` | `SourceControlType` union type + `SCM_CONFIG` registry |
| Init flow | `src/commands/init.ts:53-419` | Prompts user, copies prefix-matched skills, reconciles variants |
| Skill files | `.claude/skills/{prefix}-*/`, `.opencode/skills/{prefix}-*/`, `.github/skills/{prefix}-*/` | Agent-discoverable markdown skill definitions |

The key invariant: **agents discover available SCM commands purely by what directories exist on disk** — no central registry at runtime.

---

### 2. Current Type Definitions (`src/config.ts`)

#### `SourceControlType` (line 89)
```typescript
export type SourceControlType = "github" | "sapling";
// Future: | 'azure-devops'   ← explicitly commented in source
```

#### `SCM_KEYS` array (line 93)
```typescript
const SCM_KEYS = ["github", "sapling"] as const;
```
Used by `getScmKeys()` (line 142) to drive the init selection prompt — adding a value here automatically makes it appear in `atomic init`.

#### `ScmConfig` interface (lines 95–112)
```typescript
export interface ScmConfig {
  name: string;           // Internal identifier
  displayName: string;    // Shown in init prompt (e.g. "GitHub / Git")
  cliTool: string;        // Primary VCS binary: "git" or "sl"
  reviewTool: string;     // PR/diff tool: "gh", "jf submit", etc.
  reviewSystem: string;   // "github", "phabricator"
  detectDir: string;      // Directory marker: ".git", ".sl"
  reviewCommandFile: string; // skill file name for PR creation
  requiredConfigFiles?: string[]; // e.g. [".arcconfig"] for Sapling
}
```

#### Current `SCM_CONFIG` entries (lines 114–134)

| Field | GitHub | Sapling |
|-------|--------|---------|
| `displayName` | "GitHub / Git" | "Sapling + Phabricator" |
| `cliTool` | `git` | `sl` |
| `reviewTool` | `gh` | `jf submit` |
| `reviewSystem` | `github` | `phabricator` |
| `detectDir` | `.git` | `.sl` |
| `reviewCommandFile` | `create-gh-pr.md` | `submit-diff.md` |
| `requiredConfigFiles` | _(none)_ | `[".arcconfig", "~/.arcrc"]` |

---

### 3. SCM Prefix Mapping (`src/commands/init.ts:53–64`)

```typescript
const SCM_PREFIX_BY_TYPE: Record<SourceControlType, "gh-" | "sl-"> = {
  github: "gh-",
  sapling: "sl-",
};

function isManagedScmEntry(name: string): boolean {
  return name.startsWith("gh-") || name.startsWith("sl-");
}
```

`MANAGED_SCM_SKILL_PREFIXES` in `src/utils/atomic-global-config.ts:10`:
```typescript
export const MANAGED_SCM_SKILL_PREFIXES = ["gh-", "sl-"] as const;
```
Used by `isManagedScmSkillName()` (line 71) to distinguish Atomic-managed SCM skills from user-defined custom skills during reconciliation.

---

### 4. Init Flow SCM Steps (`src/commands/init.ts`)

1. **Interactive selection** (lines 295–313): Calls `getScmKeys()` → builds prompt options using `SCM_CONFIG[key].displayName` and hint `"Uses {cliTool} + {reviewSystem}"`.
2. **Auto-confirm default** (lines 290–293): Defaults to `"github"` in CI/non-interactive mode.
3. **Pre-selected bypass** (lines 282–289): Accepts `--scm` CLI flag via `preSelectedScm` option.
4. **Sapling `.arcconfig` check** (lines 316–326): Warns if `.arcconfig` is missing (pattern for ADO org config).
5. **Skill sync** (lines 400–410): Calls `syncProjectScmSkills()` — copies only dirs starting with selected prefix.
6. **Variant reconciliation** (lines 413–419): Calls `reconcileScmVariants()` — removes managed dirs NOT matching selected prefix, preserving user custom skills.
7. **Config save** (lines 436–439): Writes `{ scm: scmType }` to `.atomic/settings.json`.

#### `syncProjectScmSkills` (lines 166–190)
Reads source skills dir, filters to dirs starting with `selectedPrefix`, copies each with `copyDirPreserving()`.

#### `reconcileScmVariants` (lines 79–113)
For each existing managed dir in target that does NOT start with `selectedPrefix` → `rm -rf`. Non-managed dirs (user custom skills) are untouched.

---

### 5. Existing Skill Files — Structure & CLI Commands

#### `gh-commit` (`.claude/skills/gh-commit/SKILL.md`)
- **Frontmatter**: `name: gh-commit`, `description: Create well-formatted commits with conventional commit format.`
- **State queries**: `git status --porcelain`, `git branch --show-current`, `git diff --cached --stat`, `git log --oneline -5`
- **Commit flow**: auto-stages with `git add` if nothing staged → analyzes diff → commits with `git commit --message "..." --trailer "Assistant-model: Claude Code"`
- **Spec**: Embeds full Conventional Commits 1.0.0 specification

#### `gh-create-pr` (`.claude/skills/gh-create-pr/SKILL.md`)
- **Frontmatter**: `name: gh-create-pr`, `description: Commit unstaged changes, push changes, submit a pull request.`
- **State queries**: adds `git rev-parse --abbrev-ref origin/HEAD` (default branch), `gh pr view --json number,title,body`
- **PR flow**: stage+commit unstaged → `git push -u origin <branch>` → analyze `git diff origin/<default>...HEAD` → `gh pr create --title "..." --body "..."` (or `gh pr edit <id>` if PR exists)
- **Conditional**: if on default branch → create feature branch first; if PR exists → edit instead of create

#### `sl-commit` (`.claude/skills/sl-commit/SKILL.md`)
- **Key difference from gh-commit**: No staging area (`sl commit` commits all pending changes directly)
- **Commands**: `sl status`, `sl diff`, `sl add <files>`, `sl commit -m "<message>"`, `sl amend`
- **Windows note**: Full path `'C:\Program Files\Sapling\sl.exe'` to avoid PowerShell `sl` alias conflict

#### `sl-submit-diff` (`.claude/skills/sl-submit-diff/SKILL.md`)
- **Equivalent to**: `gh-create-pr` but for Phabricator
- **Commands**: `sl status`, `jf submit --draft`, `sl diff --since-last-submit`
- **Workflow**: Each commit → separate Phabricator diff (D12345); linked with dependency relationships

---

### 6. Settings Schema (`assets/settings.schema.json:20–24`)
```json
"scm": {
  "type": "string",
  "enum": ["github", "sapling"],
  "description": "Selected source control management system."
}
```
Must be updated to add `"azure-devops"` to the enum.

---

### 7. Skill Discovery by Agents

Skills are discovered at **runtime by directory presence** — no registration needed:
- Claude: scans `.claude/skills/` for directories with `SKILL.md`
- OpenCode: scans `.opencode/skills/`
- Copilot: scans `.github/skills/`

All three agent folders must have matching skill directories. The `.github/skills/` folder currently only has GitHub skills (not `sl-commit`/`sl-submit-diff`) — **Copilot must receive full SKILL.md content** for any non-native SCM type (it has no built-in Azure DevOps support).

---

### 8. Azure DevOps CLI Tooling (from `research/docs/2026-03-03-azure-devops-cli-tooling.md`)

#### Primary Tool: `az repos` (Azure CLI DevOps extension)

```bash
# Installation
az extension add --name azure-devops

# Authentication (choose one)
export AZURE_DEVOPS_EXT_PAT=<pat-token>   # PAT-based
az login                                    # Interactive

# Configure defaults
az devops configure --defaults \
  organization=https://dev.azure.com/your-org \
  project=your-project
```

#### Key PR Commands

```bash
# Create PR
az repos pr create \
  --title "feat: my feature" \
  --description "## Summary\n..." \
  --source-branch feature/my-branch \
  --target-branch main \
  --draft

# View existing PR for current branch
az repos pr list --source-branch $(git branch --show-current) --status active

# Update existing PR
az repos pr update --id <PR_ID> --title "new title" --description "new body"

# Set PR to auto-complete
az repos pr update --id <PR_ID> --auto-complete true
```

#### Comparison: GitHub vs Azure DevOps PR creation

| Operation | GitHub CLI | Azure DevOps CLI |
|-----------|-----------|-----------------|
| Create PR | `gh pr create --title "..." --body "..."` | `az repos pr create --title "..." --description "..." --source-branch X --target-branch Y` |
| Check existing PR | `gh pr view --json number,title,body` | `az repos pr list --source-branch X --status active` |
| Update PR | `gh pr edit <id> --title "..." --body "..."` | `az repos pr update --id <id> --title "..." --description "..."` |
| Open in browser | `gh pr view --web` | `az repos pr show --id <id> --open` |
| Auth check | `gh auth status` | `az account show` |

**Key difference**: `az repos pr create` requires **explicit `--source-branch` and `--target-branch`** (unlike `gh pr create` which auto-detects from current branch).

#### Azure DevOps MCP Server (for AI agent workflows)
- Package: `@azure-devops/mcp` (v2.4.0, Jan 2026)
- GitHub: https://github.com/microsoft/azure-devops-mcp
- Official Microsoft MCP server designed specifically for AI/LLM agents
- Alternative to `az repos` CLI for programmatic ADO access

---

### 9. Historical Context from Research

From `research/docs/2026-02-10-source-control-type-selection.md`:
- Azure DevOps explicitly documented as the intended **third SCM type** ("future extensibility only" in v1 spec)
- The spec notes: `// Future: | 'azure-devops'` — this comment exists in the live code at `src/config.ts:90`
- The template-directory pattern was chosen specifically for clean extensibility
- No core init logic changes needed to add a new SCM — only new config entry + skill files
- Windows detection via `isWindows()` from `src/utils/detect.ts` is available but **not needed for ADO** (no CLI alias conflicts)
- Platform variant naming convention: append `-windows` suffix if platform-specific variant needed

---

## Architecture Documentation

### SCM Integration Architecture

```
atomic init
    │
    ├── prompts: "Select source control" [reads SCM_KEYS → SCM_CONFIG.displayName]
    │
    ├── syncProjectScmSkills()
    │     copies: {agent}/skills/{selectedPrefix}-*/ → project/{agent}/skills/
    │
    ├── reconcileScmVariants()
    │     removes: project/{agent}/skills/{otherPrefix}-*/
    │     keeps: project/{agent}/skills/{userCustom}/
    │
    └── saves: .atomic/settings.json { scm: "github"|"sapling" }

Agent runtime (Claude/OpenCode/Copilot)
    └── scans: .{agent}/skills/ for directories
        └── discovers: /gh-commit, /gh-create-pr  (if github selected)
                    OR /sl-commit, /sl-submit-diff (if sapling selected)
                    OR /az-commit, /az-create-pr   (if azure-devops selected)
```

### Files Touched for Each SCM Type

| SCM | Skill Files (×3 agents each) | Config Changes |
|-----|------------------------------|----------------|
| `github` | `gh-commit/`, `gh-create-pr/` | — (reference implementation) |
| `sapling` | `sl-commit/`, `sl-submit-diff/` | — (reference implementation) |
| `azure-devops` _(to add)_ | `az-commit/`, `az-create-pr/` | `src/config.ts`, `src/commands/init.ts`, `src/utils/atomic-global-config.ts`, `assets/settings.schema.json` |

---

## Code References

- `src/config.ts:89` — `SourceControlType` union type (add `"azure-devops"`)
- `src/config.ts:90` — `// Future: | 'azure-devops'` comment
- `src/config.ts:93` — `SCM_KEYS` array (add `"azure-devops"`)
- `src/config.ts:114-134` — `SCM_CONFIG` object (add entry)
- `src/commands/init.ts:53-60` — `SCM_PREFIX_BY_TYPE` map (add `"azure-devops": "az-"`)
- `src/commands/init.ts:62-64` — `isManagedScmEntry()` (update prefix check)
- `src/commands/init.ts:316-326` — `.arcconfig` warning pattern (model for ADO org config warning)
- `src/utils/atomic-global-config.ts:10` — `MANAGED_SCM_SKILL_PREFIXES` array (add `"az-"`)
- `assets/settings.schema.json:20-24` — `scm` enum (add `"azure-devops"`)
- `.claude/skills/gh-commit/SKILL.md` — reference implementation for `az-commit`
- `.claude/skills/gh-create-pr/SKILL.md` — reference implementation for `az-create-pr`

---

## Open Questions

1. **ADO Organization Config**: Does `az repos pr create` require `az devops configure --defaults` to be set, or can org/project be passed inline? If a config file is needed (like `.arcconfig` for Sapling), should `atomic init` warn or create it?
2. **Auth Check Pattern**: Should `az-create-pr` check `az account show` for auth (like `gh-create-pr` prompts `gh auth login`) before attempting `az repos pr create`?
3. **Draft PRs**: Does `az repos pr create --draft` work the same across all ADO versions/on-prem?
4. **Copilot `.github/skills/`**: The `sl-commit`/`sl-submit-diff` skills are absent from `.github/skills/` (GitHub Copilot only ships `gh-*` skills). Should `az-*` skills be added to `.github/skills/` for Copilot users running on ADO? (Answer: **yes**, per the constraint that Copilot has no native ADO support — full skill content required).
5. **Work Item Linking**: ADO supports `--work-items <id>` in `az repos pr create`. Should this be surfaced in the skill?

---

## Related Research

- `research/docs/2026-03-03-azure-devops-cli-tooling.md` — Full Azure DevOps CLI reference (828 lines, created by online researcher agent)
- `research/docs/2026-02-10-source-control-type-selection.md` — Original SCM type selection design doc
- `research/docs/2026-01-31-github-implementation-analysis.md` — GitHub SCM implementation analysis
- `specs/source-control-type-selection.md` — Comprehensive 97KB spec for the SCM selection system
