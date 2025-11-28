---
date: 2025-11-26 01:42:40 PST
researcher: Claude Code
git_commit: 512fbcd9d1ea84ae62687a78ca9ed6791e2f2269
branch: flora131/feature/experimental-add-coding-agents
repository: agent-instructions
topic: "Universal Subagents MCP Server - Adding automatic subagent support for additional coding agents"
tags: [research, mcp, subagents, cursor, codex, kiro, cline, agent-setup]
status: complete
last_updated: 2025-11-26
last_updated_by: Claude Code
---

# Research: Universal Subagents MCP Server Implementation

## Research Question
Research the existing codebase architecture for agent configuration files (e.g., .codex, .cline) to understand the current patterns for supporting multiple coding agents. Document how setup files are structured, where they're stored, and how they integrate with the system. This will inform the implementation of a Universal Subagents MCP Server that adds automatic subagent support for Cursor, Codex, Kiro, and Cline CLIs.

## Summary

The agent-instructions codebase follows a **per-agent config directory pattern** where each coding agent has its own configuration directory (e.g., `~/.codex`, `~/.cursor`, `~/.cline`, `~/.kiro`). The `agent-setup` branch contains a generic `.agent/` directory with 130+ specialized subagent definitions that get copied to the appropriate agent's config directory during setup.

The existing architecture supports:
1. **Agent configuration files** in markdown with YAML frontmatter (name, description, tools, model)
2. **Skills system** with separate repositories cloned to `~/.{agent}/skills/`
3. **MCP server integration** via `.mcp.json` files and agent-specific MCP references
4. **Automated setup** via `SETUP.md` instructions that agents execute

## Detailed Findings

### Current Repository Structure

```
agent-instructions/
├── .claude/                    # Claude Code specific config
│   ├── agents/                 # 12 subagent definitions (.md files)
│   ├── commands/               # Slash commands (.md files)
│   ├── skills/                 # Skills with SKILL.md files
│   └── settings.local.json     # Permissions config
├── .copilot/                   # GitHub Copilot config
│   └── agents/                 # 12 subagent definitions (.agent.md files)
├── .mcp.json                   # Root MCP server config
├── .vscode/
│   └── mcp.json               # VSCode MCP config
├── CLAUDE.md                   # Claude-specific instructions
├── AGENTS.md                   # Generic agent instructions template
└── README.md                   # Setup documentation
```

### Agent Setup Branch (agent-setup)

The `agent-setup` branch is the source for generic agent configurations:

```
agent-setup branch:
├── .agent/
│   └── agents/                 # 130+ generic subagent definitions
│       ├── debugger.md
│       ├── code-reviewer.md
│       ├── security-auditor.md
│       └── ... (114+ more agents)
├── scripts/
│   ├── list-skills.sh         # Bash script to list available skills
│   └── list-skills.ps1        # PowerShell equivalent
├── SETUP.md                    # 1309 lines of automated setup instructions
└── METAPROMPT.md
```

### Agent Configuration File Format

**Claude Code format** ([.claude/agents/debugger.md](.claude/agents/debugger.md)):
```yaml
---
name: debugger
description: Debugging specialist for errors, test failures...
tools: Bash, Edit, Glob, Grep, NotebookEdit, NotebookRead, Read, TodoWrite, Write, mcp__deepwiki__ask_question, mcp__playwright__*
model: opus
---
[Agent instructions content]
```

**GitHub Copilot format** ([.copilot/agents/Debugger.agent.md](.copilot/agents/Debugger.agent.md)):
```yaml
---
name: Debugger
model: 'GPT-5.1-Codex (Preview)'
description: Debugging specialist...
tools: ['launch/runTests', 'edit', 'read', 'search', 'shell', 'todo', 'deepwiki/ask_question', 'playwright']
---
[Agent instructions content]
```

**Generic format** (agent-setup branch):
```yaml
---
name: debugger
description: Expert debugger specializing in complex issue diagnosis...
tools: Read, Grep, Glob, Bash
---
[Agent instructions content]
```

### MCP Server Configuration Patterns

**Root `.mcp.json`**:
```json
{
  "mcpServers": {
    "deepwiki": {
      "type": "http",
      "url": "https://mcp.deepwiki.com/mcp"
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

**VSCode format** ([.vscode/mcp.json](.vscode/mcp.json)):
```json
{
  "servers": {
    "deepwiki": { ... },
    "playwright": { ... }
  }
}
```

**Copilot agent with MCP** ([.copilot/agents/OnlineSearchResearcher.agent.md](.copilot/agents/OnlineSearchResearcher.agent.md:6)):
```yaml
mcp-servers:
  deepwiki:
    type: http
    url: "https://mcp.deepwiki.com/mcp"
    tools: ["ask_question"]
```

### Setup Flow Pattern

From `agent-setup:SETUP.md`, the setup process:

1. **Agent self-identifies** (Codex, Cursor, Windsurf, Kiro, Cline, GitHub Copilot)
2. **Maps to config directory** (`~/.codex`, `~/.cursor`, etc.)
3. **Clones agent-setup branch** to temp directory
4. **Copies `.agent/agents/`** to `~/{config}/agents/`
5. **Clones skills repos** (superpowers, anthropic-skills) to `~/{config}/skills/`
6. **Installs list-skills script** for skill discovery

### Target Config Directory Structure

```
~/.{agent}/                     # .codex, .cursor, .kiro, .cline
├── agents/                     # Subagent definitions
│   ├── debugger.md
│   ├── code-reviewer.md
│   └── ...
├── skills/                     # Skills repositories
│   ├── superpowers/
│   └── anthropic-skills/
└── [agent-specific configs]
```

## Architecture Documentation

### Key Architectural Patterns

1. **Config Directory Isolation**: Each agent has its own isolated config directory
2. **Generic Agent Definitions**: The `.agent/` folder contains CLI-agnostic definitions
3. **Frontmatter Metadata**: YAML frontmatter specifies name, description, tools, model
4. **Skills as Repos**: Skills are cloned Git repos with SKILL.md files
5. **MCP Integration**: MCP servers defined at project level (`.mcp.json`) or per-agent

### Existing CLI Config Directories

Per `agent-setup:SETUP.md`:
- **Codex**: `~/.codex`
- **Cursor**: `~/.cursor`
- **Windsurf**: `~/.windsurf`
- **Kiro**: `~/.kiro`
- **Cline**: `~/.cline`
- **GitHub Copilot**: `~/.github`

## Implementation Thoughts for Universal Subagents MCP Server

### Recommendation: Extend Existing Pattern

The proposed Universal Subagents MCP Server should **extend** the existing pattern rather than replace it:

1. **Agent definitions stay where they are** (`~/.{agent}/agents/`)
2. **MCP server reads from agent config directories**
3. **MCP server provides `delegate` tool** to spawn CLI subagents

### Proposed Directory Structure

```
~/.{agent}/
├── agents/                     # Existing agent definitions (unchanged)
│   ├── reviewer.md
│   ├── debugger.md
│   └── ...
├── skills/                     # Existing skills (unchanged)
├── cli-config.json            # NEW: CLI-specific permissions (Cursor)
├── config.toml                # NEW: Codex profile config
└── settings.json              # NEW: Cline auto-approval settings
```

### MCP Server Location Options

**Option A: Per-project `.mcp.json` (Recommended)**
```json
{
  "mcpServers": {
    "subagents": {
      "command": "node",
      "args": ["/path/to/universal-subagents/index.js"],
      "env": { "AGENT_CLI": "cursor" }
    }
  }
}
```

**Option B: Global MCP config**
- Claude Code: `~/.claude/mcp.json`
- Cursor: Global MCP settings

### Integration with Existing Setup Flow

Modify `SETUP.md` to include:

1. **Install Universal Subagents MCP server** as npm package
2. **Create CLI-specific permission configs**:
   - Cursor: `~/.cursor/cli-config.json`
   - Codex: `~/.codex/config.toml` (add `[profiles.subagent]`)
   - Cline: `~/.cline/settings.json`
   - Kiro: No config needed (uses CLI flags)
3. **Add to project `.mcp.json`**

### Permission Config Templates

These should be added to the `agent-setup` branch:

**Cursor** (`~/.cursor/cli-config.json`):
```json
{
  "permissions": {
    "allow": [
      "Shell(git)", "Shell(npm)", "Shell(node)",
      "Read(**/*)", "Write(src/**)", "Write(tests/**)"
    ],
    "deny": ["Shell(rm)", "Shell(sudo)", "Read(.env*)"]
  }
}
```

**Codex** (`~/.codex/config.toml`):
```toml
[profiles.subagent]
model = "gpt-4.1"
approval_policy = "on-failure"
sandbox_mode = "workspace-write"
```

**Cline** (`~/.cline/settings.json`):
```json
{
  "globalState": {
    "autoApprovalSettings": {
      "enabled": true,
      "actions": { "readFiles": true, "editFiles": true, "executeSafeCommands": true }
    }
  }
}
```

### Agent Definition Reuse

The existing 130+ agent definitions in `agent-setup:.agent/agents/` can be reused directly. The MCP server's `loadAgents()` function should:

1. Read from `~/.{agent}/agents/` (existing location)
2. Parse YAML frontmatter for metadata
3. Use markdown content as persona

This means **no changes to existing agent definitions are needed**.

### Suggested Implementation Steps

1. **Create `universal-subagents/` package** with proposed `index.js`
2. **Add permission config templates** to `agent-setup` branch:
   - `.agent/configs/cursor-cli-config.json`
   - `.agent/configs/codex-config.toml`
   - `.agent/configs/cline-settings.json`
3. **Update `SETUP.md`** to:
   - Install MCP server package
   - Copy permission configs to appropriate directories
   - Add MCP server to project `.mcp.json`
4. **Create example `.mcp.json` templates** for each parent agent (Claude, Cursor, etc.)
5. **Document CLI installation requirements** (cursor-agent, codex, kiro-cli, cline)

### Considerations

1. **CLI Availability**: Not all CLIs may be available
   - `cursor-agent`: May require Cursor installation
   - `codex`: Requires OpenAI Codex CLI
   - `kiro-cli`: New/experimental
   - `cline`: VS Code extension, CLI availability unclear

2. **Windsurf Not Supported**: As noted in the spec, Windsurf has no CLI

3. **Agent Path Resolution**: The MCP server's `getAgentsDir()` correctly maps agent names to config directories

4. **Timeout Handling**: 5-minute default timeout is reasonable for complex subagent tasks

5. **Error Propagation**: CLI errors should include partial output for debugging

## Code References

- [.claude/agents/debugger.md:1-41](.claude/agents/debugger.md#L1-L41) - Claude agent format example
- [.copilot/agents/Debugger.agent.md:1-41](.copilot/agents/Debugger.agent.md#L1-L41) - Copilot agent format example
- [.mcp.json:1-12](.mcp.json#L1-L12) - MCP server configuration
- [README.md:178-184](README.md#L178-L184) - Cline-specific setup instructions
- [README.md:224](README.md#L224) - Agent file guidance (CLAUDE.md vs AGENTS.md)

## Open Questions

1. **CLI Installation**: How should the setup handle missing CLIs?
   - Option: Skip unavailable CLIs with warning
   - Option: Provide installation instructions per CLI

2. **Agent Definition Sync**: Should universal-subagents use its own agent definitions or read from existing `~/.{agent}/agents/`?
   - Recommendation: Read from existing for consistency

3. **MCP Server Distribution**: NPM package vs bundled in agent-setup branch?
   - NPM allows easier updates
   - Bundled ensures version consistency with agent definitions

4. **Cross-Agent Delegation**: Should Claude be able to delegate to Cursor subagents?
   - The spec assumes yes via MCP tools
   - Need to verify CLI permission isolation

5. **Workspace Context**: How is `cwd` passed to subagents effectively?
   - Cursor, Codex, Kiro have workspace flags
   - Ensure consistent behavior across CLIs
