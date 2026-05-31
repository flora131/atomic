---
date: 2026-02-25 06:30:00 UTC
researcher: Copilot CLI
git_commit: 75fce77392e544b51014d7632a2d0d7286725ac3
branch: lavaman131/feature/playwright-cli
repository: atomic
topic: "Playwright CLI Integration — Bundling, Installation, and Prompt Migration"
tags: [research, playwright-cli, installation, skills, web-fetch, web-search, bundling, postinstall]
status: complete
last_updated: 2026-02-25
last_updated_by: Copilot CLI
---

# Playwright CLI Integration Research

## Research Question

How to integrate Playwright CLI as a bundled skill in Atomic CLI, covering:
1. Install/postinstall script modifications to deploy Playwright CLI as a global skill to `~/.atomic/<agent_name>/skills/`
2. Prompt/agent config updates to replace web_fetch/WebSearch/WebFetch with Playwright CLI skill references
3. Bundling strategy for distributing Playwright CLI with Atomic
4. Playwright CLI capabilities as a web search/fetch replacement

---

## Summary

Playwright CLI (`@playwright/cli`) is a **token-efficient browser automation CLI designed specifically for coding agents**. It provides a superset of current WebFetch/WebSearch capabilities (full browser automation, JS rendering, session persistence, data extraction). Integration requires: (1) adding `@playwright/cli` as a dependency and installing it during postinstall to `~/.atomic/<agent>/skills/playwright-cli/`, (2) updating 15 files across 3 agent platforms that reference web search/fetch tools, and (3) creating a SKILL.md definition for the new playwright-cli skill that matches the existing skill pattern.

---

## Detailed Findings

### 1. Current Web Search/Fetch Tool Landscape

**15 files** currently reference web search/fetch tools across the codebase:

#### Agent Configs (7 files)

| File | Tool Names | Purpose |
|------|-----------|---------|
| `.claude/agents/codebase-online-researcher.md` (L4) | `WebFetch, WebSearch` | Primary web research agent |
| `.claude/agents/debugger.md` (L4) | `WebFetch, WebSearch` | Fallback for debugging context |
| `.claude/agents/reviewer.md` (L4) | `WebFetch, WebSearch` | Code review context |
| `.github/agents/codebase-online-researcher.md` (L4) | `"web"` | Primary web research (GitHub variant) |
| `.github/agents/debugger.md` (L4-13) | `"web"` | Debugging fallback (GitHub variant) |
| `.opencode/agents/codebase-online-researcher.md` (L8) | `webfetch: true` | Primary web research (OpenCode variant) |
| `.opencode/agents/debugger.md` (L8) | `webfetch: true` | Debugging fallback (OpenCode variant) |

#### Skill Configs (6 files)

| File | Reference Type | Context |
|------|---------------|---------|
| `.claude/skills/research-codebase/SKILL.md` (L53-56) | Instruction text | Tells agents to use WebFetch/WebSearch and include links |
| `.claude/skills/explain-code/SKILL.md` (L12) | Available tool | Fallback after DeepWiki |
| `.github/skills/research-codebase/SKILL.md` (L53-56) | Instruction text | Same as Claude variant |
| `.github/skills/explain-code/SKILL.md` (L12) | Available tool | Same as Claude variant |
| `.opencode/skills/research-codebase/SKILL.md` (L53-56) | Instruction text | Same, uses webfetch terminology |
| `.opencode/skills/explain-code/SKILL.md` (L12) | Available tool | Same as Claude variant |

#### Source Code (1 file)

| File | Reference | Context |
|------|-----------|---------|
| `src/sdk/clients/claude.ts` (L284-285) | `"WebFetch", "WebSearch"` | `BUILTIN_ALLOWED_TOOLS` array in `ClaudeAgentClient` |

#### Configuration (1 file)

| File | Reference | Context |
|------|-----------|---------|
| `.opencode/opencode.json` (L17) | `"webfetch": "allow"` | Global permission for OpenCode agents |

#### Platform-Specific Tool Naming

- **Claude**: `WebFetch, WebSearch` (two separate capitalized tools)
- **GitHub/Copilot**: `"web"` (single abstracted tool name in JSON array)
- **OpenCode**: `webfetch` (single lowercase tool, boolean flag + permission)

---

### 2. Installation Infrastructure Analysis

#### Install Scripts

**`install.sh`** (Unix/macOS):
- Downloads binary + `atomic-config.tar.gz` from GitHub releases
- Extracts config to `~/.local/share/atomic/`
- Calls `sync_global_agent_configs()` (L144-165) which:
  - Copies `.claude/`, `.opencode/`, `.github/` to `~/.atomic/.claude/`, `~/.atomic/.opencode/`, `~/.atomic/.copilot/`
  - Copies `.mcp.json` to `~/.atomic/.mcp.json`
  - Removes SCM skills (`gh-*`, `sl-*`) from global config
  - Removes `workflows/` and `dependabot.yml` from Copilot config

**`install.ps1`** (Windows):
- Downloads binary + `atomic-config.zip` from GitHub releases
- Mirrors bash installer with `Sync-GlobalAgentConfigs` (L20-51)
- Same exclusion patterns for SCM skills

**Extension point for Playwright CLI**: After config extraction and before sync (install.sh L226, install.ps1 L172), add Playwright CLI installation step.

#### Postinstall Script

**`src/scripts/postinstall.ts`**:
```typescript
import { hasAtomicGlobalAgentConfigs, syncAtomicGlobalAgentConfigs } from "../utils/atomic-global-config";
import { getConfigRoot } from "../utils/config-path";

async function main() {
  await syncAtomicGlobalAgentConfigs(getConfigRoot());
  await verifyAtomicGlobalConfigSync();
}
```

**`src/utils/atomic-global-config.ts`** key functions:
- `syncAtomicGlobalAgentConfigs(sourceRoot)` — Main sync function (L128-151)
- Builds exclusion list merging agent excludes + SCM skill excludes (L141-145)
- `pruneManagedScmSkills()` — Removes stale SCM skills (L78-88)
- Double protection: excludes during copy AND prunes after

**`src/utils/config-path.ts`**:
- `getConfigRoot()` — Detects installation type via `import.meta.dir`:
  - `$bunfs` → compiled binary → `~/.local/share/atomic`
  - `node_modules` → npm/bun install → package root
  - Otherwise → source dev mode → repo root

---

### 3. Skills Directory Structure

All three platforms use identical skill structure:

```
.<agent>/skills/<skill-name>/
├── SKILL.md          # Main skill definition (YAML frontmatter + markdown)
└── [reference files]  # Optional supporting files
```

**11 skills** currently exist (identical across all 3 platforms):
- `create-spec`, `explain-code`, `frontend-design`, `gh-commit`, `gh-create-pr`, `init`, `prompt-engineer`, `research-codebase`, `sl-commit`, `sl-submit-diff`, `testing-anti-patterns`

**Package.json `files` field** (L22-31) includes:
- `.github/skills` — Bundled with npm package
- `.github/agents` — Bundled with npm package

**SCM skills** (`gh-*`, `sl-*`) are excluded from global sync and deployed per-project via `atomic init`.

---

### 4. Playwright CLI Capabilities

#### Overview
- **Package**: `@playwright/cli` (npm)
- **Source**: Located in Playwright monorepo at `packages/playwright/src/mcp/terminal/`
- **Purpose**: Token-efficient browser automation for coding agents
- **Runtime**: Requires Node.js (no standalone binary)
- **Dependencies**: `playwright` + `minimist`

#### Key Capabilities as WebFetch/WebSearch Replacement

| Capability | WebFetch/WebSearch | Playwright CLI |
|-----------|-------------------|----------------|
| Fetch web pages | ✅ Basic HTTP | ✅ Full browser (JS rendering) |
| Search the web | ✅ Built-in | ✅ Via browser automation |
| Handle dynamic content | ❌ | ✅ Full JS execution |
| Session persistence | ❌ | ✅ Persistent sessions |
| Authentication | ❌ | ✅ Cookie/storage management |
| Screenshots | ❌ | ✅ Built-in |
| PDF export | ❌ | ✅ Built-in |
| Multi-page navigation | Limited | ✅ Tab management |
| Element interaction | ❌ | ✅ Click, fill, type, etc. |
| Data extraction | Basic text | ✅ run-code, eval, snapshots |

#### Installation Methods

```bash
# Global install
npm install -g @playwright/cli@latest

# Local install
npm install @playwright/cli
npx playwright-cli --help

# Install browsers (required)
npx playwright install chromium
```

#### AI Agent Skill Installation

```bash
# Install skill documentation for agents
playwright-cli install --skills
```

This generates a `skills/playwright-cli/SKILL.md` within `.claude/skills/` directory.

#### MCP Integration Note

Playwright CLI is an **alternative to MCP**, not an MCP implementation. A separate `microsoft/playwright-mcp` project exists for full MCP integration. The CLI is optimized for token-efficient, high-throughput coding agents.

---

### 5. Global Config Sync Mechanism

**Two-tier config architecture**:
1. **Global configs** (`~/.atomic/`) — Baseline agents/skills shared across all projects
2. **Project configs** (`.claude/`, `.opencode/`, `.github/`) — Project-specific customizations

**Sync flow**:
```
Config Root (source) → sync → ~/.atomic/.claude/
                             → ~/.atomic/.opencode/
                             → ~/.atomic/.copilot/
                             → ~/.atomic/.mcp.json
```

**Exclusion rules during sync**:
- SCM skills (`gh-*`, `sl-*`) → Always excluded from global
- `workflows/` → Removed from Copilot global
- `dependabot.yml` → Removed from Copilot global

**Installation type detection** (`config-path.ts`):
- Binary: `import.meta.dir` contains `$bunfs` → uses `~/.local/share/atomic`
- npm/bun: `import.meta.dir` contains `node_modules` → uses package root
- Source: otherwise → uses repo root

---

## Code References

- `install.sh:144-165` — `sync_global_agent_configs()` bash function
- `install.ps1:20-51` — `Sync-GlobalAgentConfigs` PowerShell function
- `src/scripts/postinstall.ts:1-25` — Postinstall entry point
- `src/utils/atomic-global-config.ts:128-151` — Core `syncAtomicGlobalAgentConfigs()` function
- `src/utils/atomic-global-config.ts:78-88` — `pruneManagedScmSkills()` function
- `src/utils/config-path.ts` — `getConfigRoot()` installation type detection
- `src/sdk/clients/claude.ts:270-288` — `BUILTIN_ALLOWED_TOOLS` with WebFetch/WebSearch
- `.opencode/opencode.json:17` — `webfetch: "allow"` permission
- `package.json:40` — `postinstall` script definition
- `package.json:22-31` — `files` field (bundled config directories)

---

## Architecture Documentation

### Proposed Integration Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Installation Flow                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────┐                                          │
│  │ bun install /  │                                          │
│  │ install.sh /   │                                          │
│  │ install.ps1    │                                          │
│  └───────┬────────┘                                          │
│          │                                                    │
│          ▼                                                    │
│  ┌────────────────┐    ┌─────────────────────────────────┐   │
│  │ postinstall.ts │───▶│ 1. syncAtomicGlobalAgentConfigs │   │
│  │                │    │ 2. Install @playwright/cli      │   │
│  │                │    │ 3. Install Playwright browsers   │   │
│  │                │    │ 4. Copy SKILL.md to all agents   │   │
│  └────────────────┘    └─────────────────────────────────┘   │
│                                     │                         │
│                                     ▼                         │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              ~/.atomic/ (Global Store)                │    │
│  ├──────────────────────────────────────────────────────┤    │
│  │ .claude/skills/playwright-cli/SKILL.md               │    │
│  │ .opencode/skills/playwright-cli/SKILL.md             │    │
│  │ .copilot/skills/playwright-cli/SKILL.md              │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### Files Requiring Modification

#### High Priority (Agent Configs — Tool Lists)

1. `.claude/agents/codebase-online-researcher.md` — Replace `WebFetch, WebSearch` with playwright-cli skill reference
2. `.claude/agents/debugger.md` — Replace `WebFetch, WebSearch` with playwright-cli skill reference
3. `.claude/agents/reviewer.md` — Replace `WebFetch, WebSearch` with playwright-cli skill reference
4. `.github/agents/codebase-online-researcher.md` — Replace `"web"` with playwright-cli reference
5. `.github/agents/debugger.md` — Replace `"web"` with playwright-cli reference
6. `.opencode/agents/codebase-online-researcher.md` — Replace `webfetch: true` with playwright-cli reference
7. `.opencode/agents/debugger.md` — Replace `webfetch: true` with playwright-cli reference

#### Medium Priority (Skill Configs — Instruction Text)

8. `.claude/skills/research-codebase/SKILL.md` — Update WebFetch/WebSearch references to playwright-cli
9. `.claude/skills/explain-code/SKILL.md` — Update WebFetch/WebSearch references to playwright-cli
10. `.github/skills/research-codebase/SKILL.md` — Update WebFetch/WebSearch references
11. `.github/skills/explain-code/SKILL.md` — Update WebFetch/WebSearch references
12. `.opencode/skills/research-codebase/SKILL.md` — Update webfetch references
13. `.opencode/skills/explain-code/SKILL.md` — Update webfetch references

#### Source Code Changes

14. `src/sdk/clients/claude.ts` — Remove `"WebFetch"` and `"WebSearch"` from `BUILTIN_ALLOWED_TOOLS`
15. `.opencode/opencode.json` — Remove `"webfetch": "allow"` permission

#### Installation/Bundling Changes

16. `package.json` — Add `@playwright/cli` to dependencies; update postinstall script
17. `src/scripts/postinstall.ts` — Add Playwright CLI installation + browser install + SKILL.md deployment
18. `install.sh` — Add Playwright CLI installation step after config sync
19. `install.ps1` — Add Playwright CLI installation step after config sync

#### New Files

20. `.claude/skills/playwright-cli/SKILL.md` — New skill definition
21. `.opencode/skills/playwright-cli/SKILL.md` — New skill definition
22. `.github/skills/playwright-cli/SKILL.md` — New skill definition

---

## Historical Context (from research/)

No prior research documents exist for Playwright CLI integration. This is a new initiative.

Related research documents:
- `research/docs/2026-02-17-legacy-code-removal-skills-migration.md` — Previous skills migration patterns
- `research/docs/2026-02-08-skill-loading-from-configs-and-ui.md` — How skills are loaded from configs
- `research/docs/2026-02-14-frontend-design-builtin-skill-integration.md` — Previous skill integration work
- `research/docs/2026-01-21-binary-distribution-installers.md` — Original installer design

---

## Related Research

Sub-agent research documents generated during this investigation:
- [`research/docs/2026-02-25-web-search-fetch-references.md`](./2026-02-25-web-search-fetch-references.md) — Complete catalog of all 15 files referencing web search/fetch
- [`research/docs/2026-02-25-skills-directory-structure.md`](./2026-02-25-skills-directory-structure.md) — Skills directory analysis across all platforms
- [`research/docs/2026-02-25-install-postinstall-analysis.md`](./2026-02-25-install-postinstall-analysis.md) — Installation infrastructure analysis
- [`research/docs/2026-02-25-global-config-sync-mechanism.md`](./2026-02-25-global-config-sync-mechanism.md) — Global config sync mechanism deep dive
- [`research/docs/2026-02-25-playwright-cli-capabilities.md`](./2026-02-25-playwright-cli-capabilities.md) — Playwright CLI capabilities and DeepWiki research

---

## Open Questions

1. **Browser installation size**: Chromium alone is ~200-400MB. Should the postinstall download browsers automatically, or defer to first-use? A deferred approach would keep installation fast.

2. **Node.js dependency**: Playwright CLI requires Node.js runtime. Since Atomic uses Bun, confirm that `bun install @playwright/cli` works and `bunx playwright-cli` is a viable execution path, or if `npx` is needed.

3. **SKILL.md content**: Should we use the SKILL.md generated by `playwright-cli install --skills`, or craft a custom one that specifically focuses on web fetching/searching use cases (as a replacement for WebFetch/WebSearch)?

4. **MCP vs CLI approach**: Should the integration use Playwright CLI directly (token-efficient, command-based) or Playwright MCP server (`microsoft/playwright-mcp`) for richer integration? The CLI approach aligns better with current tool patterns.

5. **Scope of WebFetch/WebSearch removal**: The `reviewer.md` agent has web tools in its tool list but doesn't explicitly document their usage. Should it retain some form of web access, or should Playwright CLI fully replace it?

6. **Binary installer Playwright bundling**: For the binary distribution (install.sh/install.ps1), should Playwright CLI be pre-bundled in the release tarball, or downloaded during installation? Pre-bundling increases artifact size; downloading requires npm/Node.js on the target system.
