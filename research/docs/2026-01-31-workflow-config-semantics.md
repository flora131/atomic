# Workflow Configuration Semantics Research

**Date:** 2026-01-31
**Status:** Complete
**Purpose:** Research configuration semantics for .claude, .opencode, and .github folders to design a configurable workflow system for Atomic CLI

---

## Executive Summary

This document synthesizes research on configuration file discovery and semantics for three coding agent platforms (Claude Code, OpenCode, GitHub Copilot) to inform the design of Atomic's workflow configuration system at `~/.atomic/workflows` (global) and `.atomic/workflows` (local).

### Key Design Recommendations

1. **Use `env-paths` package** for cross-platform directory resolution
2. **Follow XDG conventions** even on macOS for CLI tool consistency
3. **Implement three-level precedence**: local > user/global > defaults
4. **TypeScript SDK format** for workflow definitions (matches existing Atomic patterns)
5. **Only migrate user customizations** - not built-in coding agent commands

---

## Table of Contents

1. [Claude Code Configuration](#1-claude-code-configuration)
2. [OpenCode Configuration](#2-opencode-configuration)
3. [GitHub Copilot Configuration](#3-github-copilot-configuration)
4. [Cross-Platform Path Conventions](#4-cross-platform-path-conventions)
5. [Configuration Precedence Patterns](#5-configuration-precedence-patterns)
6. [Proposed Atomic Workflow SDK Design](#6-proposed-atomic-workflow-sdk-design)
7. [Migration Strategy](#7-migration-strategy)

---

## 1. Claude Code Configuration

### Local Project Configs (`.claude/` folder)

| File/Directory           | Purpose                               | Schema                                  |
| ------------------------ | ------------------------------------- | --------------------------------------- |
| `settings.json`          | Project settings (shared via git)     | JSON with permissions, env, hooks       |
| `settings.local.json`    | Local overrides (gitignored)          | Same as settings.json                   |
| `CLAUDE.md`              | Project memory (alternative location) | Markdown                                |
| `CLAUDE.local.md`        | Local project memory (gitignored)     | Markdown                                |
| `commands/*.md`          | Slash commands (legacy)               | Markdown with optional YAML frontmatter |
| `skills/<name>/SKILL.md` | Skills                                | YAML frontmatter + Markdown             |
| `agents/<name>.md`       | Custom subagents                      | YAML frontmatter + Markdown             |
| `rules/*.md`             | Modular rules                         | Markdown with optional path filtering   |

**Root-level config files:**

- `CLAUDE.md` - Project memory (primary location)
- `CLAUDE.local.md` - Local memory (gitignored)
- `.mcp.json` - MCP server configurations

### Global User Configs

| Platform      | User Config Directory | System Managed Directory                   |
| ------------- | --------------------- | ------------------------------------------ |
| **macOS**     | `~/.claude/`          | `/Library/Application Support/ClaudeCode/` |
| **Linux/WSL** | `~/.claude/`          | `/etc/claude-code/`                        |
| **Windows**   | `~/.claude/`          | `C:\Program Files\ClaudeCode\`             |

**User config files:**

- `~/.claude/settings.json` - User-wide settings
- `~/.claude/CLAUDE.md` - User-wide memory
- `~/.claude/commands/*.md` - Personal commands
- `~/.claude/skills/<name>/SKILL.md` - Personal skills
- `~/.claude/agents/*.md` - Personal agents
- `~/.claude/rules/*.md` - Personal rules
- `~/.claude.json` - MCP servers (user + per-project local)

### Discovery/Merge Semantics

| Feature         | Merge Behavior        | Priority Order (highest first)                 |
| --------------- | --------------------- | ---------------------------------------------- |
| **CLAUDE.md**   | Additive (all loaded) | Managed > User > Project > Local > Nested      |
| **Settings**    | Override by key       | Managed > CLI > Local > Project > User         |
| **Skills**      | Override by name      | Managed > User > Project > Plugin (namespaced) |
| **Agents**      | Override by name      | Managed > CLI flag > Project > User > Plugin   |
| **MCP servers** | Override by name      | Local > Project > User                         |
| **Hooks**       | Merge (all fire)      | All sources combined, parallel execution       |

### Environment Variables

| Variable                       | Description                          |
| ------------------------------ | ------------------------------------ |
| `ANTHROPIC_API_KEY`            | API key for authentication           |
| `ANTHROPIC_MODEL`              | Override default model               |
| `CLAUDE_CODE_ENABLE_TELEMETRY` | Enable telemetry (1/0)               |
| `CLAUDE_CODE_SHELL`            | Shell to use                         |
| `CLAUDE_CODE_TMPDIR`           | Temp directory                       |
| `MAX_THINKING_TOKENS`          | Max thinking tokens (default: 31999) |

### SKILL.md Schema

```yaml
---
name: my-skill
description: What this skill does
argument-hint: "[filename] [format]"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Grep, Glob
model: sonnet
context: fork
agent: Explore
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./validate.sh"
---
Your skill instructions here...
Use $ARGUMENTS or $0, $1, $2 for arguments.
Use ${CLAUDE_SESSION_ID} for session ID.
Use !`command` for dynamic context injection.
```

---

## 2. OpenCode Configuration

### Configuration File Locations

| Priority    | Location                            | Scope            |
| ----------- | ----------------------------------- | ---------------- |
| 1 (highest) | `OPENCODE_CONFIG_CONTENT` env var   | Inline JSON      |
| 2           | `OPENCODE_CONFIG` env var           | Custom file path |
| 3           | `.opencode/opencode.jsonc`          | Project-local    |
| 4           | `~/.config/opencode/opencode.jsonc` | User-global      |
| 5           | Built-in defaults                   | Fallback         |

### Project Config (`.opencode/` folder)

| File                | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `opencode.jsonc`    | Main configuration (JSONC format with comments)        |
| `agents/*.md`       | Custom agent definitions (Markdown + YAML frontmatter) |
| `commands/*.md`     | Custom commands (Markdown + YAML frontmatter)          |
| `instructions/*.md` | Glob-based instructions                                |

### Global User Config

**Path:** `~/.config/opencode/` (all platforms use XDG-style)

| File             | Purpose                                   |
| ---------------- | ----------------------------------------- |
| `opencode.jsonc` | User preferences, keybinds, default model |
| `agents/*.md`    | Personal agents                           |
| `commands/*.md`  | Personal commands                         |

### Configuration Schema

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  // Models
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-haiku-3-5",
  "default_agent": "coder",

  // Custom agents
  "agent": {
    "architect": {
      "description": "System design and architecture decisions",
      "model": "anthropic/claude-opus-4",
      "temperature": 0.3,
      "mode": "primary",
      "steps": 20,
    },
  },

  // Custom commands
  "command": {
    "pr-review": {
      "description": "Review current PR changes",
      "template": "Review the changes...",
      "agent": "reviewer",
    },
  },

  // MCP servers
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "-y", "@anthropic-ai/mcp-server-fs"],
    },
  },

  // Permissions
  "permission": {
    "edit": "ask",
    "bash": "ask",
    "read": "allow",
  },
}
```

### Environment Variables

| Variable                              | Description                           |
| ------------------------------------- | ------------------------------------- |
| `OPENCODE_CONFIG`                     | Custom config file path               |
| `OPENCODE_CONFIG_DIR`                 | Custom config directory               |
| `OPENCODE_CONFIG_CONTENT`             | Inline JSON config (highest priority) |
| `OPENCODE_DISABLE_PROJECT_CONFIG`     | Disable project config loading        |
| `OPENCODE_DISABLE_CLAUDE_CODE`        | Disable all .claude support           |
| `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` | Disable loading .claude/skills        |

### Merge Behavior

- **Agents**: Project overrides user, later wins for same name
- **Commands**: Project overrides user, later wins for same name
- **MCP Servers**: Merged by name, project > user
- **Permissions**: Deep merged, more restrictive wins
- **Instructions**: All loaded additively

---

## 3. GitHub Copilot Configuration

### Local Project Configs (`.github/` folder)

| File/Directory                           | Purpose                                         |
| ---------------------------------------- | ----------------------------------------------- |
| `.github/copilot-instructions.md`        | Repository-wide instructions                    |
| `.github/instructions/*.instructions.md` | Path-specific instructions with `applyTo` globs |
| `.github/agents/*.agent.md`              | Custom agent profiles                           |
| `.github/skills/*/SKILL.md`              | Agent skills with bundled resources             |
| `.github/hooks/*.json`                   | Copilot hooks for lifecycle events              |

**Also Supported (at repository root):**

- `AGENTS.md` - Open standard for agent instructions (nested in monorepos)
- `CLAUDE.md` - Claude-specific instructions
- `GEMINI.md` - Gemini-specific instructions

### Global User Configs

**Default Location:** `~/.copilot/`

| File                         | Purpose                          |
| ---------------------------- | -------------------------------- |
| `config.json`                | User preferences, default models |
| `mcp-config.json`            | MCP server configurations        |
| `skills/`                    | Personal skills directory        |
| `command-history-state.json` | Command history tracking         |
| `logs/`                      | Debug and activity logs          |

### Priority Order

1. **Personal instructions** (user-level) - highest
2. **Repository instructions** (project-level)
3. **Organization instructions** (enterprise-level) - lowest

> "All sets of relevant instructions are still combined and provided to Copilot."

### Agent Profile Format

```markdown
---
name: security-reviewer
description: Security-focused code reviewer
target: vscode
tools:
  - read
  - search
  - agent
infer: true
mcp-servers:
  github:
    command: npx
    args: ["-y", "@github/mcp-server"]
---

# Security Review Agent

You are a security-focused code reviewer...
```

### Copilot Hooks

| Hook Type             | Trigger               | Can Block |
| --------------------- | --------------------- | --------- |
| `sessionStart`        | Agent session begins  | No        |
| `sessionEnd`          | Session completion    | No        |
| `userPromptSubmitted` | User submits prompt   | Yes       |
| `preToolUse`          | Before tool execution | Yes       |
| `postToolUse`         | After tool completion | No        |
| `errorOccurred`       | Execution errors      | No        |

---

## 4. Cross-Platform Path Conventions

### XDG Base Directory Specification (Linux)

| Variable           | Purpose              | Default              |
| ------------------ | -------------------- | -------------------- |
| `$XDG_CONFIG_HOME` | User-specific config | `$HOME/.config`      |
| `$XDG_DATA_HOME`   | User-specific data   | `$HOME/.local/share` |
| `$XDG_STATE_HOME`  | Logs, history        | `$HOME/.local/state` |
| `$XDG_CACHE_HOME`  | Cache                | `$HOME/.cache`       |

### Platform-Specific Paths

| Purpose | Linux                 | macOS                                | Windows                     |
| ------- | --------------------- | ------------------------------------ | --------------------------- |
| Config  | `~/.config/APP/`      | `~/Library/Application Support/APP/` | `%APPDATA%\APP\`            |
| Data    | `~/.local/share/APP/` | `~/Library/Application Support/APP/` | `%LOCALAPPDATA%\APP\`       |
| Cache   | `~/.cache/APP/`       | `~/Library/Caches/APP/`              | `%LOCALAPPDATA%\APP\Cache\` |
| Logs    | `~/.local/state/APP/` | `~/Library/Logs/APP/`                | `%LOCALAPPDATA%\APP\Log\`   |

### Recommendation for CLI Tools

> "As a general rule, CLI tools on macOS should follow XDG, especially if they do so on other unix-like systems"

Use `~/.config/atomic/` on all Unix-like platforms for consistency.

### Recommended Library: env-paths

```typescript
import envPaths from "env-paths";

const paths = envPaths("atomic", { suffix: "" });
// paths.config → ~/.config/atomic (Linux/macOS)
// paths.config → %APPDATA%\atomic\Config (Windows)
```

---

## 5. Configuration Precedence Patterns

### Standard Precedence Order (Highest to Lowest)

1. **Command-line arguments**
2. **Environment variables** (e.g., `ATOMIC_WORKFLOW_PATH`)
3. **Local/Project config** (`.atomic/workflows/`)
4. **User/Global config** (`~/.atomic/workflows/`)
5. **Built-in defaults**

### Merge Behavior by Feature Type

| Feature           | Strategy         | Rationale                                     |
| ----------------- | ---------------- | --------------------------------------------- |
| **Workflows**     | Override by name | Local workflows replace global with same name |
| **Agent configs** | Deep merge       | Inherit base config, override specific keys   |
| **Permissions**   | Override         | Local permissions replace global              |
| **Environment**   | Shallow merge    | Local env vars added to global                |

---

## 6. Proposed Atomic Workflow SDK Design

### Directory Structure

```
~/.atomic/                      # Global Atomic config
├── workflows/                  # Global workflow definitions
│   ├── my-workflow.ts          # TypeScript workflow
│   └── shared-workflow.ts
├── config.json                 # Global Atomic settings
└── skills/                     # User-defined skills

.atomic/                        # Project-local config
├── workflows/                  # Local workflow definitions (override global)
│   └── project-workflow.ts
├── config.local.json           # Local config overrides
└── skills/                     # Project-specific skills
```

### Workflow Definition Format

```typescript
// ~/.atomic/workflows/code-review.ts
import { defineWorkflow, agentNode, decisionNode } from "@atomic/sdk";

export default defineWorkflow({
  id: "code-review",
  name: "Comprehensive Code Review",
  description: "Multi-stage code review with security and quality checks",

  // Agent configurations
  agents: {
    "security-reviewer": {
      description: "Security-focused code analysis",
      model: "sonnet",
      tools: ["Read", "Grep", "Glob"],
      systemPrompt: "You are a security expert...",
    },
    "quality-reviewer": {
      description: "Code quality analysis",
      model: "haiku",
      tools: ["Read", "Grep"],
    },
  },

  // Workflow steps
  steps: [
    agentNode({
      id: "analyze",
      agent: "quality-reviewer",
      prompt: "Analyze code structure in {{target_path}}",
    }),
    agentNode({
      id: "security",
      agent: "security-reviewer",
      prompt: "Review {{target_path}} for vulnerabilities",
      dependsOn: ["analyze"],
    }),
    decisionNode({
      id: "should-continue",
      condition: (state) => state.securityPassed,
      thenTarget: "create-report",
      elseTarget: "flag-issues",
    }),
  ],
});
```

### Configuration Loading API

```typescript
// src/config/workflow-loader.ts
import envPaths from "env-paths";
import { cosmiconfig } from "cosmiconfig";

export interface WorkflowConfig {
  id: string;
  name: string;
  source: "local" | "global" | "builtin";
  path: string;
}

export async function discoverWorkflows(): Promise<WorkflowConfig[]> {
  const paths = envPaths("atomic", { suffix: "" });
  const workflows: WorkflowConfig[] = [];

  // 1. Load built-in workflows
  workflows.push(...getBuiltinWorkflows());

  // 2. Load global workflows (~/.atomic/workflows/)
  const globalDir = join(paths.config, "workflows");
  if (await pathExists(globalDir)) {
    workflows.push(...(await loadWorkflowsFromDir(globalDir, "global")));
  }

  // 3. Load local workflows (.atomic/workflows/) - override by name
  const localDir = ".atomic/workflows";
  if (await pathExists(localDir)) {
    workflows.push(...(await loadWorkflowsFromDir(localDir, "local")));
  }

  // Local workflows override global with same id
  return dedupeByName(workflows, "local");
}
```

### Environment Variable Overrides

| Variable                  | Description                   |
| ------------------------- | ----------------------------- |
| `ATOMIC_CONFIG_PATH`      | Override config file path     |
| `ATOMIC_WORKFLOWS_DIR`    | Override workflows directory  |
| `ATOMIC_NO_GLOBAL`        | Disable global config loading |
| `ATOMIC_USE_GRAPH_ENGINE` | Enable graph-based execution  |

---

## 7. Migration Strategy

### What to Migrate (User Customizations Only)

| Source               | Migrate             | Skip              |
| -------------------- | ------------------- | ----------------- |
| `.claude/skills/*`   | User-created skills | Built-in skills   |
| `.claude/agents/*`   | User-created agents | Built-in agents   |
| `.claude/commands/*` | User slash commands | Built-in commands |
| `.opencode/agents/*` | Custom agents       | Default agents    |
| `.github/skills/*`   | Project skills      | Built-in skills   |

### Migration Detection

```typescript
// Detect user customizations vs built-ins
function isUserCustomization(path: string): boolean {
  // Check for known built-in markers
  const content = await readFile(path, "utf-8");
  const frontmatter = parseFrontmatter(content);

  // Built-ins typically have these markers:
  if (frontmatter.builtin === true) return false;
  if (frontmatter.source?.startsWith("anthropic/")) return false;
  if (frontmatter.source?.startsWith("github/")) return false;

  return true;
}
```

### Conversion to Atomic Format

```typescript
// Convert Claude skill to Atomic workflow step
function convertClaudeSkill(skillPath: string): WorkflowStep {
  const skill = parseSkillMd(skillPath);

  return agentNode({
    id: skill.name,
    agent: "claude",
    prompt: skill.instructions,
    tools: skill["allowed-tools"]?.split(", ") || [],
    model: skill.model || "inherit",
  });
}

// Convert OpenCode agent to Atomic agent definition
function convertOpenCodeAgent(agentConfig: OpenCodeAgent): AgentDefinition {
  return {
    id: agentConfig.name || "converted-agent",
    description: agentConfig.description,
    model: agentConfig.model || "sonnet",
    tools: agentConfig.tools || [],
    systemPrompt: agentConfig.prompt,
  };
}
```

---

## Sources

### Official Documentation

- [Claude Code Settings](https://code.claude.com/docs/en/settings)
- [Claude Code Memory](https://code.claude.com/docs/en/memory)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [OpenCode Configuration](https://opencode.ai/config.json)
- [GitHub Copilot Custom Instructions](https://docs.github.com/copilot/customizing-copilot)
- [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/latest/)

### Libraries

- [env-paths](https://github.com/sindresorhus/env-paths) - Cross-platform config paths
- [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) - Config file discovery

### Existing Atomic Implementation

- `src/utils/config-path.ts` - Current config path utilities
- `src/config/ralph.ts` - Ralph configuration loader
- `src/workflows/atomic.ts` - Graph-based workflow definition
- `src/graph/index.ts` - Graph engine exports
