---
date: 2026-02-25 06:25:00 PST
researcher: codebase-analyzer
git_commit: $(git rev-parse --verify HEAD 2>/dev/null || echo "no-commits")
branch: main
repository: playwright-cli
topic: "Skills Directory Structure Analysis"
tags: [research, skills, architecture, configuration, atomic-cli]
status: complete
last_updated: 2026-02-25
last_updated_by: codebase-analyzer
---

# Skills Directory Structure Analysis

## Research Question

Document the skills directory structure across all three agent configurations in the Atomic CLI project, including:
1. `.github/skills/` - All skills, their structure, and SKILL.md contents
2. `.claude/skills/` - All skills, their structure, and SKILL.md contents
3. `.opencode/skills/` - All skills, their structure, and SKILL.md contents
4. How skills are referenced in `package.json`
5. How skills are deployed via `install.sh`
6. The `~/.atomic` directory structure

## Summary

The Atomic CLI project maintains a consistent skills structure across three agent platform configurations: GitHub Copilot (`.github/skills/`), Claude Code (`.claude/skills/`), and OpenCode (`.opencode/skills/`). The project includes 11 standardized skills that provide specialized capabilities for code development, documentation, and repository management. Skills are deployed globally to `~/.atomic` during installation, with SCM-specific skills (gh-*, sl-*) excluded from global configuration as they are project-scoped.

## Directory Structure Overview

All three agent configurations maintain identical directory structures:

```
.github/skills/          # GitHub Copilot skills
.claude/skills/          # Claude Code skills  
.opencode/skills/        # OpenCode AI skills
├── create-spec/
│   └── SKILL.md
├── explain-code/
│   └── SKILL.md
├── frontend-design/
│   └── SKILL.md
├── gh-commit/
│   └── SKILL.md
├── gh-create-pr/
│   └── SKILL.md
├── init/
│   └── SKILL.md
├── prompt-engineer/
│   ├── SKILL.md
│   └── references/
│       ├── advanced_patterns.md (271 lines)
│       ├── core_prompting.md (137 lines)
│       └── quality_improvement.md (193 lines)
├── research-codebase/
│   └── SKILL.md
├── sl-commit/
│   └── SKILL.md
├── sl-submit-diff/
│   └── SKILL.md
└── testing-anti-patterns/
    └── SKILL.md
```

## Skill Pattern: SKILL.md Structure

All skills follow a consistent YAML frontmatter + markdown content pattern:

```markdown
---
name: skill-name
description: Brief description of what the skill does
[optional-fields]
---

# Skill Content

Instructions and documentation...
```

### Core Frontmatter Fields

- **name**: Skill identifier (kebab-case)
- **description**: Single-line description of skill purpose

### Optional Frontmatter Fields (Claude-specific)

The `.claude/skills/research-codebase/SKILL.md` file includes additional frontmatter fields not present in other configurations:

```yaml
aliases: [research]
argument-hint: "<research-question>"
required-arguments: [research-question]
```

This is the **only difference** found between the three configurations.

## Complete Skills Catalog

### 1. create-spec
**Location**: All three directories  
**File**: `SKILL.md` (12,627 bytes)

**Purpose**: Create detailed execution plans (technical design documents/RFCs) for implementing features or refactors by leveraging existing research in the `research/` directory.

**Key Features**:
- Uses `codebase-research-locator` and `codebase-research-analyzer` agents
- Generates comprehensive specs in `specs/` directory
- Follows RFC/TDD template structure with sections:
  - Executive Summary
  - Context and Motivation
  - Goals and Non-Goals
  - Proposed Solution (High-Level Design)
  - Detailed Design
  - Alternatives Considered
  - Cross-Cutting Concerns
  - Migration, Rollout, and Testing
  - Open Questions / Unresolved Issues
- Includes Mermaid diagram templates
- Walks through open questions with user using ask tool
- Does NOT implement, only creates spec

**Configuration**: None required

---

### 2. explain-code
**Location**: All three directories  
**File**: `SKILL.md` (7,339 bytes)

**Purpose**: Explain code functionality in detail with systematic analysis approach.

**Key Features**:
- 16-step analysis process from context to debugging
- DeepWiki MCP tool integration for external library documentation
- WebFetch/WebSearch for additional context
- Language-specific considerations for JS/TS, Python, Java, C#, Go, Rust
- Covers:
  - Code Context Analysis
  - High-Level Overview
  - Code Structure Breakdown
  - Line-by-Line Analysis
  - Algorithm and Logic Explanation
  - Data Structures and Types
  - Framework and Library Usage
  - Error Handling and Edge Cases
  - Performance Considerations
  - Security Implications
  - Testing and Debugging
  - Dependencies and Integrations
  - Common Patterns and Idioms
  - Potential Improvements
  - Related Code and Context
  - Debugging and Troubleshooting

**Configuration**: Uses MCP tools when available

---

### 3. frontend-design
**Location**: All three directories  
**File**: `SKILL.md` (3,957 bytes)

**Purpose**: Create distinctive, production-grade frontend interfaces with high design quality.

**Key Features**:
- Emphasizes avoiding generic "AI slop" aesthetics
- Focuses on bold, intentional design choices
- Guidelines for:
  - Typography: Distinctive fonts (avoid Arial, Inter)
  - Color & Theme: Cohesive CSS variables, dominant colors with sharp accents
  - Motion: CSS animations, Motion library for React, scroll-triggering
  - Spatial Composition: Asymmetry, overlap, diagonal flow, grid-breaking
  - Backgrounds & Visual Details: Gradient meshes, noise textures, geometric patterns
- Matches implementation complexity to aesthetic vision
- Encourages varied designs (light/dark themes, different aesthetics)

**Configuration**: Supports HTML/CSS/JS, React, Vue frameworks

---

### 4. gh-commit
**Location**: All three directories  
**File**: `SKILL.md` (13,675 bytes)

**Purpose**: Create well-formatted commits following Conventional Commits 1.0.0 specification.

**Key Features**:
- Includes complete Conventional Commits specification
- Automatic staging if no files staged
- Pre-commit checks (defined in `.pre-commit-config.yaml`)
- AI authorship attribution via Git trailers
- Multi-commit detection and suggestions
- Commit message structure:
  ```
  <type>[optional scope]: <description>
  
  [optional body]
  
  [optional footer(s)]
  ```
- Supported types: feat, fix, build, chore, ci, docs, style, refactor, perf, test
- Breaking change indicators (`!` or `BREAKING CHANGE:` footer)

**Configuration**: 
- Reads git status and diff
- Uses pre-commit hooks
- Adds `Assistant-model: Claude Code` trailer

---

### 5. gh-create-pr
**Location**: All three directories  
**File**: `SKILL.md` (399 bytes)

**Purpose**: Commit unstaged changes, push changes, and submit a pull request.

**Key Features**:
- Creates logical commits for unstaged changes
- Pushes branch to remote
- Creates pull request with proper name and description

**Configuration**: Uses GitHub CLI (gh)

---

### 6. init
**Location**: All three directories  
**File**: `SKILL.md` (4,075 bytes)

**Purpose**: Generate `CLAUDE.md` and `AGENTS.md` files by exploring the codebase.

**Key Features**:
- Uses `codebase-analyzer`, `codebase-locator`, `codebase-pattern-finder` sub-agents
- Explores project metadata:
  - Manifest files (package.json, Cargo.toml, go.mod, pyproject.toml, etc.)
  - Directory structure
  - Config files (eslintrc, tsconfig.json, biome.json, oxlint.json, prettier, CI configs)
  - README.md
  - Environment files
  - Package manager identification
- Generates populated template with:
  - Project name and overview
  - Project structure table
  - Quick reference commands
  - Environment setup
  - Progressive disclosure docs table
  - Universal rules
  - Code quality tools
- Writes identical content to both `CLAUDE.md` and `AGENTS.md`
- Target: Under 100 lines (ideally under 60)

**Configuration**: None required

---

### 7. prompt-engineer
**Location**: All three directories  
**Files**: 
- `SKILL.md` (8,360 bytes)
- `references/advanced_patterns.md` (271 lines)
- `references/core_prompting.md` (137 lines)
- `references/quality_improvement.md` (193 lines)

**Purpose**: Create, improve, or optimize prompts using Anthropic best practices.

**Key Features**:
- 7-step workflow:
  1. Understand Requirements
  2. Identify Applicable Techniques
  3. Load Relevant References
  4. Design the Prompt
  5. Add Quality Controls
  6. Optimize and Test
  7. Iterate Based on Results
- Core techniques:
  - Be clear and direct
  - System prompts
  - XML tags for structure
- Advanced techniques:
  - Chain of thought
  - Multishot prompting
  - Prompt chaining
  - Long context handling (100K+ tokens)
  - Extended thinking
- Quality techniques:
  - Hallucination reduction
  - Consistency improvement
  - Jailbreak mitigation
- Technique selection matrix
- Progressive disclosure approach

**Configuration**: References three comprehensive markdown files

---

### 8. research-codebase
**Location**: All three directories  
**File**: `SKILL.md` (11,206 bytes)

**Purpose**: Document codebase as-is with research directory for historical context.

**Key Features**:
- Comprehensive research workflow:
  1. Read directly mentioned files first (FULL read, no limit/offset)
  2. Analyze and decompose research question
  3. Spawn parallel sub-agent tasks
  4. Wait for all sub-agents to complete
  5. Generate research document
  6. Add GitHub permalinks (if applicable)
  7. Present findings
  8. Handle follow-up questions
- Specialized sub-agents:
  - `codebase-locator`: Find WHERE files/components live
  - `codebase-analyzer`: Understand HOW code works (no critique)
  - `codebase-pattern-finder`: Find existing patterns (no evaluation)
  - `codebase-research-locator`: Discover research documents
  - `codebase-research-analyzer`: Extract insights from documents
  - `codebase-online-researcher`: External documentation/resources
- Research directory structure:
  ```
  research/
  ├── tickets/YYYY-MM-DD-XXXX-description.md
  ├── docs/YYYY-MM-DD-topic.md
  ├── notes/YYYY-MM-DD-meeting.md
  ```
- Document format with YAML frontmatter:
  - date, researcher, git_commit, branch, repository
  - topic, tags, status, last_updated, last_updated_by
- **Critical**: Documentarian role, NOT evaluator (document what IS, not what SHOULD BE)
- Only generates artifacts in `research/` directory

**Configuration**: 
- Uses MCP tools (DeepWiki, WebFetch/WebSearch)
- Generates GitHub permalinks when on main/pushed commits

**Claude-specific frontmatter** (`.claude/skills/research-codebase/SKILL.md` only):
```yaml
aliases: [research]
argument-hint: "<research-question>"
required-arguments: [research-question]
```

---

### 9. sl-commit
**Location**: All three directories  
**File**: `SKILL.md` (2,091 bytes)

**Purpose**: Create well-formatted commits using Sapling SCM with Conventional Commits format.

**Key Features**:
- Similar to gh-commit but for Sapling SCM
- No staging area (commits all pending changes directly)
- Amend with auto-restack: `sl amend` automatically rebases descendants
- Stacked Diffs: Each commit becomes separate Phabricator diff
- Key commands:
  - `sl status` - Check repository state
  - `sl diff` - View pending changes
  - `sl add <files>` - Add untracked files
  - `sl commit -m "<message>"` - Create commit
  - `sl commit -A` - Add untracked and commit
  - `sl amend` - Amend current commit
  - `sl amend --to COMMIT` - Amend changes to specific commit in stack
- **Windows Note**: Use full path to `sl.exe` to avoid PowerShell alias conflict

**Configuration**: Uses Sapling SCM

---

### 10. sl-submit-diff
**Location**: All three directories  
**File**: `SKILL.md` (1,959 bytes)

**Purpose**: Submit commits as Phabricator diffs for code review using Sapling.

**Key Features**:
- Workflow:
  1. If uncommitted changes, run `/commit` first
  2. Submit with `jf submit --draft` (DRAFT mode)
  3. Each commit in stack becomes separate Phabricator diff (D12345)
  4. Commit messages updated with `Differential Revision:` link
- Commands:
  - `sl status` - Check for uncommitted changes
  - `jf submit --draft` - Submit to Phabricator in DRAFT mode
  - `sl diff --since-last-submit` - View changes since last submission
- Diff status values:
  - Needs Review
  - Accepted
  - Needs Revision
  - Committed
  - Abandoned
- Stacked diffs with dependency relationships
- **Windows Note**: Use full path to `sl.exe`

**Configuration**: Uses Sapling SCM and `jf` (Meta tooling)

---

### 11. testing-anti-patterns
**Location**: All three directories  
**File**: `SKILL.md` (5,102 bytes)

**Purpose**: Identify and prevent testing anti-patterns when writing tests.

**Key Features**:
- Core principle: Test what code does, not what mocks do
- The Iron Laws:
  1. NEVER test mock behavior
  2. NEVER add test-only methods to production classes
  3. NEVER mock without understanding dependencies
- Anti-patterns covered:
  1. Testing Mock Behavior
  2. Test-Only Methods in Production
  3. Mocking Without Understanding
  4. Incomplete Mocks
  5. Integration Tests as Afterthought
- Gate functions for each anti-pattern
- Quick reference table
- Emphasizes strict TDD to prevent anti-patterns

**Configuration**: None required

---

## Package.json Files Field

**Location**: `package.json:22-31`

The `files` field specifies which directories are included in the npm package:

```json
"files": [
  "src",
  "assets/settings.schema.json",
  ".claude",
  ".opencode",
  ".mcp.json",
  ".github/skills",
  ".github/agents",
  ".github/mcp-config.json"
]
```

**Key observations**:
- Skills are explicitly included via `.github/skills`
- Agent configurations included via `.github/agents`
- `.claude` and `.opencode` directories included in their entirety
- `.github/workflows` and `.github/dependabot.yml` are NOT included (excluded from package)

---

## Install.sh Deployment Strategy

**Location**: `install.sh:144-165`, `install.sh:233-234`

### sync_global_agent_configs Function

```bash
sync_global_agent_configs() {
    local source_root="$1"

    mkdir -p "$ATOMIC_HOME/.claude" "$ATOMIC_HOME/.opencode" "$ATOMIC_HOME/.copilot"

    cp -R "$source_root/.claude/." "$ATOMIC_HOME/.claude/"
    cp -R "$source_root/.opencode/." "$ATOMIC_HOME/.opencode/"
    cp -R "$source_root/.github/." "$ATOMIC_HOME/.copilot/"

    if [[ -f "$source_root/.mcp.json" ]]; then
        cp "$source_root/.mcp.json" "$ATOMIC_HOME/.mcp.json"
    fi

    # Remove SCM-managed skills from global config; these are project-scoped.
    rm -rf "$ATOMIC_HOME/.claude/skills/gh-"* "$ATOMIC_HOME/.claude/skills/sl-"* 2>/dev/null || true
    rm -rf "$ATOMIC_HOME/.opencode/skills/gh-"* "$ATOMIC_HOME/.opencode/skills/sl-"* 2>/dev/null || true
    rm -rf "$ATOMIC_HOME/.copilot/skills/gh-"* "$ATOMIC_HOME/.copilot/skills/sl-"* 2>/dev/null || true

    # Keep Copilot global config focused on skills/agents/instructions/MCP.
    rm -rf "$ATOMIC_HOME/.copilot/workflows" 2>/dev/null || true
    rm -f "$ATOMIC_HOME/.copilot/dependabot.yml" 2>/dev/null || true
}
```

### Deployment Flow

1. **Installation locations**:
   - `$BIN_DIR` (default: `$HOME/.local/bin`) - Binary
   - `$DATA_DIR` (default: `$HOME/.local/share/atomic`) - Config files
   - `$ATOMIC_HOME` (hardcoded: `$HOME/.atomic`) - Global agent configs

2. **Configuration sync**:
   - Downloads `atomic-config.tar.gz` from GitHub releases
   - Extracts to `$DATA_DIR`
   - Calls `sync_global_agent_configs "$DATA_DIR"`

3. **Directory mappings**:
   - `.claude/` → `~/.atomic/.claude/`
   - `.opencode/` → `~/.atomic/.opencode/`
   - `.github/` → `~/.atomic/.copilot/`
   - `.mcp.json` → `~/.atomic/.mcp.json`

4. **Exclusions**:
   - SCM skills: `gh-commit`, `gh-create-pr`, `sl-commit`, `sl-submit-diff`
   - GitHub-specific: `workflows/`, `dependabot.yml`

**Rationale**: SCM skills are project-scoped and configured per-project via `atomic init`, not globally.

---

## ~/.atomic Directory Structure

**Actual structure** (from system inspection):

```
~/.atomic/
├── .claude/
│   ├── agents/
│   │   ├── codebase-analyzer.md
│   │   ├── codebase-locator.md
│   │   ├── codebase-online-researcher.md
│   │   ├── codebase-pattern-finder.md
│   │   ├── codebase-research-analyzer.md
│   │   ├── codebase-research-locator.md
│   │   ├── debugger.md
│   │   ├── reviewer.md
│   │   └── worker.md
│   ├── skills/
│   │   ├── create-spec/
│   │   ├── explain-code/
│   │   ├── frontend-design/
│   │   ├── init/
│   │   ├── prompt-engineer/
│   │   ├── research-codebase/
│   │   └── testing-anti-patterns/
│   └── settings.json
├── .opencode/
│   ├── agents/
│   │   ├── codebase-analyzer.md
│   │   ├── codebase-locator.md
│   │   ├── codebase-online-researcher.md
│   │   ├── codebase-pattern-finder.md
│   │   ├── codebase-research-analyzer.md
│   │   ├── codebase-research-locator.md
│   │   ├── debugger.md
│   │   ├── reviewer.md
│   │   └── worker.md
│   ├── skills/
│   │   ├── create-spec/
│   │   ├── explain-code/
│   │   ├── frontend-design/
│   │   ├── init/
│   │   ├── prompt-engineer/
│   │   ├── research-codebase/
│   │   └── testing-anti-patterns/
│   ├── node_modules/
│   ├── bun.lock
│   ├── .gitignore
│   ├── opencode.json
│   └── package.json
├── .copilot/
│   ├── agents/
│   │   ├── codebase-analyzer.md
│   │   ├── codebase-locator.md
│   │   ├── codebase-online-researcher.md
│   │   ├── codebase-pattern-finder.md
│   │   ├── codebase-research-analyzer.md
│   │   ├── codebase-research-locator.md
│   │   ├── debugger.md
│   │   ├── reviewer.md
│   │   └── worker.md
│   ├── skills/
│   │   ├── create-spec/
│   │   ├── explain-code/
│   │   ├── frontend-design/
│   │   ├── init/
│   │   ├── prompt-engineer/
│   │   ├── research-codebase/
│   │   └── testing-anti-patterns/
│   └── mcp-config.json
├── .mcp.json
├── settings.json
├── .command_history
├── cache/
├── .tmp/
│   └── opencode-config-merged/
│       └── skills/
└── workflows/
    └── sessions/
```

**Key observations**:
- Skills are identical across all three agent platforms (minus SCM skills)
- Agents are identical across all three platforms
- Each platform has its own configuration file:
  - `.claude/settings.json`
  - `.opencode/opencode.json`
  - `.copilot/mcp-config.json`
- Global `.mcp.json` at root
- OpenCode has additional npm dependency management (`node_modules/`, `bun.lock`, `package.json`)
- Temporary merged config in `.tmp/opencode-config-merged/`

---

## Architectural Patterns

### 1. Multi-Platform Consistency Pattern

**Pattern**: Maintain identical skill implementations across multiple agent platforms.

**Implementation**:
- Three parallel directory structures (`.github/skills/`, `.claude/skills/`, `.opencode/skills/`)
- Identical SKILL.md files (with one exception for Claude-specific frontmatter)
- Single source deployment to three targets

**Benefits**:
- Skills are platform-agnostic
- Unified development experience
- Easier maintenance (update once, sync to all)

### 2. Global vs. Project-Scoped Skills Pattern

**Pattern**: Separate skills into global (development workflow) and project-scoped (SCM integration).

**Implementation**:
- Global skills: Deployed to `~/.atomic` during installation
- Project-scoped skills: SCM skills (`gh-*`, `sl-*`) excluded from global config
- Project-scoped skills: Configured per-project via `atomic init`

**Rationale**:
- SCM choice varies by project
- Avoids conflicts between Git and Sapling workflows
- Cleaner global configuration

### 3. Skill Definition Pattern

**Pattern**: YAML frontmatter + Markdown content with consistent structure.

**Structure**:
```markdown
---
name: skill-name
description: Brief description
[optional-platform-specific-fields]
---

# Skill Title

Instructions and content...
```

**Benefits**:
- Machine-readable metadata (frontmatter)
- Human-readable documentation (markdown)
- Extensible (optional fields for platform-specific features)

### 4. Sub-Agent Orchestration Pattern

**Pattern**: Skills orchestrate specialized sub-agents for complex workflows.

**Implementation** (`research-codebase`, `create-spec`):
- Main skill acts as coordinator
- Spawns parallel sub-agent tasks
- Waits for completion
- Synthesizes results

**Sub-agents**:
- `codebase-locator` - Find WHERE
- `codebase-analyzer` - Understand HOW
- `codebase-pattern-finder` - Find patterns
- `codebase-research-locator` - Discover documents
- `codebase-research-analyzer` - Extract insights
- `codebase-online-researcher` - External resources

**Benefits**:
- Separation of concerns
- Parallel execution
- Specialized expertise per agent
- Reduced context usage

### 5. Documentation-Only Role Pattern

**Pattern**: Sub-agents strictly document without evaluation.

**Implementation**:
- "Documentarian, not critic" principle
- "Document what IS, not what SHOULD BE"
- No recommendations or improvements
- No bug identification

**Enforcement** (`research-codebase/SKILL.md`):
```markdown
- **CRITICAL**: You and all sub-agents are documentarians, not evaluators
- **REMEMBER**: Document what IS, not what SHOULD BE
- **NO RECOMMENDATIONS**: Only describe the current state of the codebase
```

**Benefits**:
- Objective, factual documentation
- Avoids premature optimization
- Separates analysis from prescription

### 6. Progressive Disclosure Pattern

**Pattern**: Load reference materials on-demand based on task complexity.

**Implementation** (`prompt-engineer`):
- Three reference files (601 total lines)
- Load only relevant references per workflow step
- Technique selection matrix guides choice

**Benefits**:
- Efficient context usage
- Avoids overwhelming with unnecessary information
- Scales from simple to complex tasks

### 7. Conventional Commits Pattern

**Pattern**: Standardize commit messages using Conventional Commits 1.0.0 specification.

**Implementation** (`gh-commit`, `sl-commit`):
- Pre-commit checks
- Automatic staging
- Multi-commit detection
- AI authorship attribution
- Breaking change indicators

**Benefits**:
- Automated changelog generation
- Semantic versioning automation
- Clear commit history
- Teammate/stakeholder communication

---

## Key Differences Between Configurations

### Content Differences

**Only one difference found**:

`.claude/skills/research-codebase/SKILL.md` includes additional frontmatter fields:
```yaml
aliases: [research]
argument-hint: "<research-question>"
required-arguments: [research-question]
```

These fields are NOT present in `.github/skills/research-codebase/SKILL.md` or `.opencode/skills/research-codebase/SKILL.md`.

**Interpretation**: Claude Code supports skill aliases and argument hints, while GitHub Copilot and OpenCode may not have this feature yet.

### Directory Differences

**None**. All three configurations have identical directory structures and file names.

---

## SCM-Specific Skills

### GitHub Skills (gh-*)
1. **gh-commit** - Git commit with Conventional Commits
2. **gh-create-pr** - Create GitHub pull request

### Sapling Skills (sl-*)
1. **sl-commit** - Sapling commit with Conventional Commits
2. **sl-submit-diff** - Submit Phabricator diffs

**Deployment Strategy**:
- Included in project repository (`.github/skills/`, `.claude/skills/`, `.opencode/skills/`)
- Included in npm package (`package.json:28`)
- **Excluded from global config** (`~/.atomic`) via `install.sh:158-160`
- Configured per-project via `atomic init`

**Rationale**: Projects use either Git or Sapling, not both. Excluding from global config prevents conflicts.

---

## Agent Configurations

All three platforms share identical agent configurations:

**Location**: `.github/agents/`, `.claude/agents/`, `.opencode/agents/`

**Agents** (9 total):
1. **codebase-analyzer.md** - Analyze implementation details
2. **codebase-locator.md** - Locate files/directories/components
3. **codebase-online-researcher.md** - Research external documentation
4. **codebase-pattern-finder.md** - Find similar implementations/patterns
5. **codebase-research-analyzer.md** - Analyze research documents
6. **codebase-research-locator.md** - Discover research documents
7. **debugger.md** - Debug errors and failures
8. **reviewer.md** - Review code changes
9. **worker.md** - Implement single task from list

**Deployment**: Copied to `~/.atomic/.claude/agents/`, `~/.atomic/.opencode/agents/`, `~/.atomic/.copilot/agents/`

---

## Configuration Files

### Per-Platform Configuration

1. **Claude Code**: `.claude/settings.json`, `~/.atomic/.claude/settings.json`
2. **OpenCode**: `.opencode/opencode.json`, `~/.atomic/.opencode/opencode.json`
3. **GitHub Copilot**: `.github/mcp-config.json`, `~/.atomic/.copilot/mcp-config.json`

### Global Configuration

- **MCP Configuration**: `.mcp.json`, `~/.atomic/.mcp.json`
- **Atomic Settings**: `~/.atomic/settings.json`

---

## Installation Flow

**Install.sh execution flow**:

1. **Detect platform**: `detect_platform()` (Linux, macOS, Windows)
2. **Get version**: Latest from GitHub API or user-specified
3. **Download assets**:
   - Binary: `atomic-{platform}` (Linux-x64, Darwin-arm64, etc.)
   - Config: `atomic-config.tar.gz`
   - Checksums: `checksums.txt`
4. **Verify checksums**: SHA-256 verification
5. **Install binary**: `$BIN_DIR/atomic` (default: `~/.local/bin/atomic`)
6. **Extract config**: `$DATA_DIR` (default: `~/.local/share/atomic`)
7. **Sync global configs**: `sync_global_agent_configs "$DATA_DIR"`
   - Copy `.claude/` → `~/.atomic/.claude/`
   - Copy `.opencode/` → `~/.atomic/.opencode/`
   - Copy `.github/` → `~/.atomic/.copilot/`
   - Copy `.mcp.json` → `~/.atomic/.mcp.json`
   - **Remove SCM skills**: `rm -rf $ATOMIC_HOME/.*/skills/{gh-,sl-}*`
   - **Remove GitHub-specific**: `rm -rf $ATOMIC_HOME/.copilot/workflows`, `rm -f $ATOMIC_HOME/.copilot/dependabot.yml`
8. **Update PATH**: Add `$BIN_DIR` to shell config (bash, zsh, fish)

---

## Related Research

- Research directory structure: `research/docs/`, `research/tickets/`, `research/notes/`
- Naming convention: `YYYY-MM-DD-[XXXX-]description.md`
- YAML frontmatter pattern for metadata
- GitHub permalinks for persistent references

---

## Open Questions

None. All areas of the skills directory structure have been documented.

---

## References

### Code References

- `package.json:22-31` - Files field with skills inclusion
- `install.sh:144-165` - sync_global_agent_configs function
- `install.sh:233-234` - Function invocation during installation
- `.github/skills/` - GitHub Copilot skills directory
- `.claude/skills/` - Claude Code skills directory
- `.opencode/skills/` - OpenCode AI skills directory
- `~/.atomic/.claude/skills/` - Global Claude skills
- `~/.atomic/.opencode/skills/` - Global OpenCode skills
- `~/.atomic/.copilot/skills/` - Global Copilot skills

### Skill Files (All in three locations)

1. `create-spec/SKILL.md` (12,627 bytes)
2. `explain-code/SKILL.md` (7,339 bytes)
3. `frontend-design/SKILL.md` (3,957 bytes)
4. `gh-commit/SKILL.md` (13,675 bytes)
5. `gh-create-pr/SKILL.md` (399 bytes)
6. `init/SKILL.md` (4,075 bytes)
7. `prompt-engineer/SKILL.md` (8,360 bytes)
   - `prompt-engineer/references/advanced_patterns.md` (271 lines)
   - `prompt-engineer/references/core_prompting.md` (137 lines)
   - `prompt-engineer/references/quality_improvement.md` (193 lines)
8. `research-codebase/SKILL.md` (11,206 bytes)
9. `sl-commit/SKILL.md` (2,091 bytes)
10. `sl-submit-diff/SKILL.md` (1,959 bytes)
11. `testing-anti-patterns/SKILL.md` (5,102 bytes)

### Configuration References

- `.claude/settings.json` - Claude Code configuration
- `.opencode/opencode.json` - OpenCode configuration
- `.github/mcp-config.json` - GitHub Copilot MCP configuration
- `.mcp.json` - Global MCP configuration

---

## Conclusion

The Atomic CLI project demonstrates a sophisticated multi-platform skills architecture that maintains consistency across GitHub Copilot, Claude Code, and OpenCode AI. The skills provide comprehensive capabilities for code development, documentation, research, and repository management. The separation of global and project-scoped skills, combined with the documentarian-focused sub-agent pattern, creates a powerful and maintainable system for agent-assisted software development.

The nearly-identical implementation across platforms (with only one Claude-specific frontmatter difference) suggests a design philosophy of platform-agnostic skills that can be deployed universally, with platform-specific features layered on top through optional frontmatter fields.
