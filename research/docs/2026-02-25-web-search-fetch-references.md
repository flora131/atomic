---
date: 2026-02-25
topic: "Web Search and Web Fetch Tool References Across Agent/Skill Configurations"
tags: [research, web-fetch, web-search, agents, skills, tools]
status: complete
---

# Web Search and Web Fetch Tool References Analysis

## Overview

This document catalogs ALL references to web_fetch, WebSearch, WebFetch, web search, and web fetch tools across the Atomic CLI project. These tools enable agents and skills to retrieve information from the web for research, documentation lookups, and problem-solving.

## Summary

Web search/fetch capabilities are referenced in:
- **7 agent configuration files** (across 3 platform directories)
- **6 skill configuration files** (across 3 platform directories)
- **1 source code file** (SDK client implementation)
- **1 configuration file** (OpenCode permissions)

The primary use case is to enable the **codebase-online-researcher** agent to fetch external documentation and resources, with secondary usage in **debugger** agent for troubleshooting, **reviewer** agent for context gathering, and **explain-code**/**research-codebase** skills for documentation lookups.

---

## Agent Configuration Files

### 1. `.claude/agents/codebase-online-researcher.md`

**Lines:** 1-122 (entire file)

**Exact References:**
- Line 4: `tools: Glob, Grep, NotebookRead, Read, LS, TodoWrite, ListMcpResourcesTool, ReadMcpResourceTool, mcp__deepwiki__ask_question, WebFetch, WebSearch`
- Line 9: `You are an expert web research specialist focused on finding accurate, relevant information from web sources. Your primary tools are the DeepWiki \`ask_question\` tool and WebFetch/WebSearch tools`
- Line 32: `Use WebFetch and WebSearch tools to retrieve full content from promising search results`

**Agent Name:** codebase-online-researcher

**Purpose:**
This agent is the primary web research specialist. It uses WebFetch and WebSearch to:
- Retrieve full content from web search results
- Fetch documentation from official sources
- Access recent articles and technical blogs
- Pull content from Stack Overflow and technical forums
- Gather external documentation for third-party libraries

**Context:**
The agent follows a tiered approach:
1. First tries DeepWiki `ask_question` tool for repository documentation
2. If insufficient, falls back to WebFetch/WebSearch for broader web research
3. Executes strategic searches with multiple variations
4. Fetches and analyzes content from authoritative sources

**Search Strategy (Lines 24-46):**
- Broad searches to understand landscape
- Refined searches with specific technical terms
- Site-specific searches (e.g., "site:docs.stripe.com webhook signature")
- Prioritizes official documentation and reputable sources
- Notes publication dates for currency

---

### 2. `.claude/agents/debugger.md`

**Lines:** 1-56 (entire file)

**Exact References:**
- Line 4: `tools: Bash, Task, AskUserQuestion, Edit, Glob, Grep, NotebookEdit, NotebookRead, Read, TodoWrite, Write, ListMcpResourcesTool, ReadMcpResourceTool, mcp__deepwiki__ask_question, WebFetch, WebSearch`
- Line 14: `- WebFetch/WebSearch: Retrieve web content for additional context if you don't find sufficient information in DeepWiki`
- Line 45: `- Use WebFetch/WebSearch to gather additional context from web sources if needed`

**Agent Name:** debugger

**Purpose:**
The debugger agent uses WebFetch/WebSearch as a fallback tool for:
- Looking up external library documentation when errors involve third-party dependencies
- Gathering additional context from web sources during debugging
- Finding information about error messages or stack traces
- Researching solutions to unexpected behavior

**Context:**
Web tools are used after DeepWiki in the debugging workflow:
1. Capture error message and stack trace
2. Use DeepWiki to look up external library documentation
3. If DeepWiki is insufficient, use WebFetch/WebSearch for additional context
4. Form and test hypotheses with the gathered information

---

### 3. `.claude/agents/reviewer.md`

**Lines:** 1-96 (entire file)

**Exact References:**
- Line 4: `tools: Bash, Task, Glob, Grep, Read, TodoWrite, mcp__deepwiki__ask_question, WebFetch, WebSearch`

**Agent Name:** reviewer

**Purpose:**
The reviewer agent has access to WebFetch and WebSearch in its tool list, but the configuration does not explicitly document their usage. They are available for:
- Looking up documentation when reviewing code changes
- Verifying best practices or patterns
- Researching security implications or performance considerations

**Context:**
The reviewer focuses on identifying bugs and issues in code changes. Web tools may be used implicitly to research context about libraries, frameworks, or patterns encountered during review.

---

### 4. `.github/agents/codebase-online-researcher.md`

**Lines:** 1-125 (entire file)

**Exact References:**
- Line 4: `tools: ["search", "read", "execute", "web", "deepwiki/ask_question"]`
- Line 12: `You are an expert web research specialist focused on finding accurate, relevant information from web sources. Your primary tools are the DeepWiki \`ask_question\` tool and WebFetch/WebSearch tools`
- Line 35: `Use WebFetch and WebSearch tools to retrieve full content from promising search results`

**Agent Name:** codebase-online-researcher (GitHub platform variant)

**Purpose:**
Identical purpose to `.claude/agents/codebase-online-researcher.md`. This is the GitHub platform-specific configuration using different tool naming conventions:
- Uses `"web"` tool instead of explicit `WebFetch` and `WebSearch`
- Same research workflow and strategies
- Same fallback pattern: DeepWiki first, then web search

**Context:**
The tool list uses abstracted names (`"web"` instead of `WebFetch, WebSearch`), but the description text explicitly mentions "WebFetch/WebSearch tools" at lines 12 and 35, indicating the underlying capabilities are the same.

---

### 5. `.github/agents/debugger.md`

**Lines:** 1-68 (entire file)

**Exact References:**
- Line 4-13: Tools array includes `"web"` and `"deepwiki/ask_question"`
- Line 26: `- WebFetch/WebSearch: Retrieve web content for additional context if you don't find sufficient information in DeepWiki`
- Line 57: `- Use WebFetch/WebSearch to gather additional context from web sources if needed`

**Agent Name:** debugger (GitHub platform variant)

**Purpose:**
Identical to `.claude/agents/debugger.md`. Uses web tools for:
- Looking up external library documentation
- Gathering additional debugging context from web sources
- Finding solutions to errors and failures

**Context:**
Same debugging workflow, with web tools as fallback after DeepWiki.

---

### 6. `.opencode/agents/codebase-online-researcher.md`

**Lines:** 1-126 (entire file)

**Exact References:**
- Line 8: `webfetch: true`
- Line 13: `You are an expert web research specialist focused on finding accurate, relevant information from web sources. Your primary tools are the DeepWiki \`ask_question\` tool and \`webfetch\` tool`
- Line 36: `Use webfetch tool to retrieve full content from promising search results`

**Agent Name:** codebase-online-researcher (OpenCode platform variant)

**Purpose:**
Identical to other platform variants. Uses `webfetch` (lowercase, single tool) for:
- Retrieving full content from promising search results
- Fetching documentation and technical resources
- Accessing web content for research synthesis

**Context:**
OpenCode platform uses a boolean flag `webfetch: true` in the tools section (line 8), and refers to it as a single `webfetch` tool rather than separate WebFetch/WebSearch tools.

---

### 7. `.opencode/agents/debugger.md`

**Lines:** 1-63 (entire file)

**Exact References:**
- Line 8: `webfetch: true`
- Line 19: `- WebFetch (\`webfetch\`): Retrieve web content for additional context if you don't find sufficient information in DeepWiki`
- Line 51: `- Use WebFetch to gather additional context from web sources if needed`

**Agent Name:** debugger (OpenCode platform variant)

**Purpose:**
Identical to other debugger variants. Uses `webfetch` for:
- Retrieving web content for additional debugging context
- Looking up documentation for external libraries

**Context:**
Same as other platforms, with OpenCode's `webfetch: true` boolean configuration style.

---

## Skill Configuration Files

### 8. `.claude/skills/research-codebase/SKILL.md`

**Lines:** 1-210 (entire file)

**Exact References:**
- Line 53-56: Instructions for using codebase-online-researcher agent:
  ```
  - If you perform a web search using the WebFetch/WebSearch tools, instruct the agent 
    to return LINKS with their findings, and please INCLUDE those links in the research document
  ```

**Skill Name:** research-codebase

**Purpose:**
The skill itself doesn't use web tools directly, but instructs users to spawn the **codebase-online-researcher** agent for online research. When that agent uses WebFetch/WebSearch, the skill requires:
- Agent to return links with findings
- Links to be included in the final research document
- Web search results to supplement live codebase findings

**Context:**
Part of the comprehensive research workflow (lines 50-58):
1. Use codebase-locator, codebase-analyzer, and codebase-pattern-finder for codebase research
2. Use codebase-research-locator and codebase-research-analyzer for research directory exploration
3. Use **codebase-online-researcher** for external documentation (which uses WebFetch/WebSearch)
4. Include web search findings and links in the research document

---

### 9. `.claude/skills/explain-code/SKILL.md`

**Lines:** 1-205 (entire file)

**Exact References:**
- Line 12: `- **WebFetch/WebSearch**: Use to retrieve web content for additional context if information is not found in DeepWiki.`

**Skill Name:** explain-code

**Purpose:**
WebFetch/WebSearch tools are available for the explain-code skill to:
- Retrieve web content for additional context when explaining code
- Look up external library documentation (after DeepWiki)
- Find additional information about frameworks, patterns, or APIs

**Context:**
Part of "Available Tools" section (lines 7-12). Positioned as a fallback after DeepWiki:
- Primary: DeepWiki `ask_question` tool for external library documentation
- Fallback: WebFetch/WebSearch for additional context when DeepWiki is insufficient

---

### 10. `.github/skills/research-codebase/SKILL.md`

**Lines:** 1-207 (entire file)

**Exact References:**
- Line 53-56: Identical to `.claude/skills/research-codebase/SKILL.md`:
  ```
  - If you perform a web search using the WebFetch/WebSearch tools, instruct the agent 
    to return LINKS with their findings, and please INCLUDE those links in the research document
  ```

**Skill Name:** research-codebase (GitHub platform variant)

**Purpose:**
Identical to `.claude/skills/research-codebase/SKILL.md`. Instructs spawned codebase-online-researcher agent to use WebFetch/WebSearch and include links in research documents.

---

### 11. `.github/skills/explain-code/SKILL.md`

**Lines:** 1-205 (entire file)

**Exact References:**
- Line 12: `- **WebFetch/WebSearch**: Use to retrieve web content for additional context if information is not found in DeepWiki.`

**Skill Name:** explain-code (GitHub platform variant)

**Purpose:**
Identical to `.claude/skills/explain-code/SKILL.md`. Uses web tools as fallback for retrieving additional context.

---

### 12. `.opencode/skills/research-codebase/SKILL.md`

**Lines:** 1-207 (entire file)

**Exact References:**
- Line 53-56: Similar to other platforms, but uses `webfetch` terminology:
  ```
  - If you perform a web search using the WebFetch/WebSearch tools, instruct the agent 
    to return LINKS with their findings, and please INCLUDE those links in the research document
  ```

**Skill Name:** research-codebase (OpenCode platform variant)

**Purpose:**
Identical to other platform variants. Instructs spawned agents to use web tools and include links.

---

### 13. `.opencode/skills/explain-code/SKILL.md`

**Lines:** 1-205 (entire file)

**Exact References:**
- Line 12: `- **WebFetch/WebSearch**: Use to retrieve web content for additional context if information is not found in DeepWiki.`

**Skill Name:** explain-code (OpenCode platform variant)

**Purpose:**
Identical to other platform variants. Uses web tools as fallback for additional context.

---

## Source Code Files

### 14. `src/sdk/clients/claude.ts`

**Lines:** 270-288

**Exact References:**
- Line 284: `"WebFetch",`
- Line 285: `"WebSearch",`

**Context (Lines 270-288):**
```typescript
export class ClaudeAgentClient implements CodingAgentClient {
    readonly agentType = "claude" as const;
    private static readonly BUILTIN_ALLOWED_TOOLS = [
        "Bash",
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Task",
        "Skill",
        "MultiEdit",
        "TodoRead",
        "TodoWrite",
        "WebFetch",
        "WebSearch",
        "NotebookEdit",
        "NotebookRead",
    ] as const;
```

**Purpose:**
This is the SDK implementation that defines which tools are available for Claude-based agents. `WebFetch` and `WebSearch` are included in the `BUILTIN_ALLOWED_TOOLS` array, making them available as built-in tools for any Claude agent to use.

**Context:**
- Part of the `ClaudeAgentClient` class implementation
- Defines the allowed tools that can be used by agents running on the Claude platform
- WebFetch and WebSearch are positioned alongside other core tools (Bash, Read, Write, Edit, etc.)
- These tools are available by default for all Claude agents unless explicitly excluded in agent configuration

---

## Configuration Files

### 15. `.opencode/opencode.json`

**Lines:** 12-20

**Exact References:**
- Line 17: `"webfetch": "allow",`

**Context (Lines 12-21):**
```json
{
    "deepwiki_ask_question": true
},
"permission": {
    "edit": "allow",
    "bash": "allow",
    "webfetch": "allow",
    "doom_loop": "allow",
    "external_directory": "allow"
}
```

**Purpose:**
This is the OpenCode platform configuration file that defines global permissions for tool usage. The `"webfetch": "allow"` permission grants agents running on the OpenCode platform the ability to use the webfetch tool.

**Context:**
- Part of the permission configuration for the OpenCode platform
- Positioned alongside other permission settings (edit, bash, doom_loop, external_directory)
- This global permission allows any OpenCode agent to use webfetch if they declare it in their tools section
- The permission system provides a security layer, requiring both tool declaration in agent config AND global permission allowance

---

## Cross-Platform Tool Naming Conventions

### Claude Platform (`.claude/`)
- Uses: `WebFetch, WebSearch` (capitalized, two separate tools)
- Tool list format: Comma-separated list in YAML frontmatter

### GitHub Platform (`.github/`)
- Uses: `"web"` (abstracted name for web capabilities)
- References `WebFetch/WebSearch` in documentation text
- Tool list format: JSON array with quoted strings

### OpenCode Platform (`.opencode/`)
- Uses: `webfetch` (lowercase, single tool)
- References `webfetch` and sometimes `WebFetch` in documentation
- Tool list format: Boolean flags (`webfetch: true`)
- Requires global permission: `"webfetch": "allow"` in `opencode.json`

---

## Usage Patterns

### Primary Use Case: External Documentation Research
The **codebase-online-researcher** agent is the primary consumer of web tools:
- Fetches official documentation for third-party libraries
- Searches technical blogs and Stack Overflow
- Retrieves recent articles and best practices
- Gathers comparative information (e.g., "X vs Y")
- Finds code examples and tutorials

### Secondary Use Case: Debugging Context
The **debugger** agent uses web tools as a fallback:
- Looks up error messages and stack traces
- Finds solutions to third-party library issues
- Researches unexpected behavior
- Gathers context when DeepWiki is insufficient

### Tertiary Use Case: Code Review Context
The **reviewer** agent has web tools available but doesn't explicitly document usage:
- May research libraries or patterns during review
- Could verify best practices or security considerations

### Skill Integration
Two skills reference web tools indirectly:
- **research-codebase**: Spawns codebase-online-researcher which uses web tools
- **explain-code**: Has direct access to web tools as fallback after DeepWiki

---

## Architectural Notes

### Tiered Research Pattern
All agents follow a consistent pattern:
1. **First tier**: DeepWiki `ask_question` tool (repository-specific documentation)
2. **Second tier**: WebFetch/WebSearch (broader web search)
3. **Result**: Synthesis of both sources with proper attribution

### Link Preservation
When web tools are used, the system requires:
- Direct links to sources be included in findings
- Proper attribution with publication dates
- Distinction between authoritative and informal sources

### Security and Permissions
- OpenCode platform requires explicit permission: `"webfetch": "allow"`
- Claude and GitHub platforms include tools in builtin allowed list
- Agents must declare tools in their configuration to use them

---

## Summary of Findings

**Total Files with Web Search/Fetch References:** 15

**Breakdown by Type:**
- Agent configs: 7 (3 Claude, 2 GitHub, 2 OpenCode)
- Skill configs: 6 (2 Claude, 2 GitHub, 2 OpenCode)
- Source code: 1 (SDK client)
- Configuration: 1 (OpenCode permissions)

**Primary Agent:** codebase-online-researcher (3 platform variants)

**Primary Purpose:** External documentation research and web content retrieval

**Integration Pattern:** Fallback after DeepWiki tool, with proper link attribution required

**Platform Differences:**
- Claude: `WebFetch, WebSearch` (two tools)
- GitHub: `"web"` (abstracted)
- OpenCode: `webfetch` (single tool, requires permission)

---

## Files Not Containing References

The following directories were searched but contain no web search/fetch references:
- Other agent files (worker.md, codebase-analyzer.md, codebase-locator.md, etc.)
- Other skill files (create-spec, frontend-design, gh-commit, etc.)
- Other source files in `src/` (excluding claude.ts)
