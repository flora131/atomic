# OpenCode Agent Integration - Implementation Analysis

## Overview

The `.opencode` directory implements a comprehensive OpenCode agent integration system for the Atomic codebase. The architecture comprises four main subsystems: a plugin system with SDK integration, agent definitions using YAML frontmatter, a command system for slash commands, and a JSON configuration layer. The implementation relies on `@opencode-ai/plugin` version 1.1.47 as its primary SDK dependency.

---

## 1. Plugin System Architecture

### 1.1 SDK Dependency

**File**: `.opencode/package.json:1-5`

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "1.1.47"
  }
}
```

The plugin system uses the `@opencode-ai/plugin` package as its sole dependency at version 1.1.47.

### 1.2 Plugin Interface

**File**: `.opencode/plugin/ralph.ts:1`, `.opencode/plugin/telemetry.ts:1`

Both plugins import the `Plugin` type from the SDK:

```typescript
import type { Plugin } from "@opencode-ai/plugin"
```

The `Plugin` type defines an async factory function pattern that receives a context object and returns a plugin handler object.

### 1.3 Plugin Factory Signature

**File**: `.opencode/plugin/ralph.ts:253`

```typescript
export const RalphPlugin: Plugin = async ({ directory, client, $ }) => {
```

**File**: `.opencode/plugin/telemetry.ts:350`

```typescript
export const TelemetryPlugin: Plugin = async () => {
```

The Plugin factory function receives:
- `directory`: Working directory path (string)
- `client`: OpenCode SDK client for API calls
- `$`: Shell execution utility (not used in current implementation)

### 1.4 Event Handlers

Both plugins implement an `event` handler for lifecycle events.

**File**: `.opencode/plugin/ralph.ts:260-410`

```typescript
event: async ({ event }) => {
  if (event.type !== "session.status") return
  if (event.properties.status?.type !== "idle") return
  // ...
}
```

**File**: `.opencode/plugin/telemetry.ts:385-412`

```typescript
event: async ({ event }) => {
  if (event.type === "session.created") {
    sessionCommands = []
    return
  }
  if (event.type === "session.status") {
    // ...
  }
  if (event.type === "session.deleted") {
    // ...
  }
}
```

Event types observed in use:
- `session.status` - With `status.type` of `"idle"`, `"busy"`, or `"retry"`
- `session.created` - New session initialized
- `session.deleted` - Session removed

### 1.5 Command Hooks

The telemetry plugin implements command execution hooks.

**File**: `.opencode/plugin/telemetry.ts:357-363`

```typescript
"command.execute.before": async (input) => {
  const commandName = normalizeCommandName(input.command)
  if (commandName) {
    sessionCommands.push(commandName)
  }
},
```

**File**: `.opencode/plugin/telemetry.ts:370-379`

```typescript
"chat.message": async (_input, output) => {
  for (const part of output.parts) {
    if (part.type === "text" && typeof part.text === "string") {
      const commands = extractCommands(part.text)
      if (commands.length > 0) {
        sessionCommands.push(...commands)
      }
    }
  }
},
```

Hook types available:
- `command.execute.before` - Intercepts commands before expansion
- `chat.message` - Processes message content (receives `input` and `output` parameters)

### 1.6 SDK Client API Usage

**File**: `.opencode/plugin/ralph.ts:273-276`

```typescript
const response = await client.session.messages({
  path: { id: event.properties.sessionID },
})
```

**File**: `.opencode/plugin/ralph.ts:293-299`

```typescript
await client.app.log({
  body: {
    service: "ralph-plugin",
    level: "info",
    message: `Ralph loop completed: detected <promise>${state.completionPromise}</promise>`,
  },
})
```

**File**: `.opencode/plugin/ralph.ts:379-381`

```typescript
await client.session.summarize({
  path: { id: event.properties.sessionID },
})
```

**File**: `.opencode/plugin/ralph.ts:404-408`

```typescript
await client.session.prompt({
  path: { id: event.properties.sessionID },
  body: {
    parts: [{ type: "text", text: continuationPrompt }],
  },
})
```

SDK client methods observed:
- `client.session.messages()` - Retrieve session messages
- `client.session.summarize()` - Compact/summarize session context
- `client.session.prompt()` - Send new prompt to session
- `client.app.log()` - Log messages with service, level, and message

### 1.7 Ralph Plugin State Management

**File**: `.opencode/plugin/ralph.ts:18-26`

```typescript
interface RalphState {
  active: boolean
  iteration: number
  maxIterations: number
  completionPromise: string | null
  featureListPath: string
  startedAt: string
  prompt: string
}
```

**File**: `.opencode/plugin/ralph.ts:28-33`

```typescript
interface Feature {
  category: string
  description: string
  steps: string[]
  passes: boolean
}
```

State file location defined at `.opencode/plugin/ralph.ts:36`:
```typescript
const STATE_FILE = ".opencode/ralph-loop.local.md"
```

State persistence uses YAML frontmatter format, parsed at `.opencode/plugin/ralph.ts:127-176` and written at `.opencode/plugin/ralph.ts:178-197`.

---

## 2. Agent Definitions

### 2.1 YAML Frontmatter Schema

All agent files use YAML frontmatter with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Human-readable purpose of the agent |
| `mode` | string | Either `"primary"` or `"subagent"` |
| `model` | string | Model identifier (e.g., `"anthropic/claude-opus-4-5"`) |
| `tools` | object | Map of tool names to boolean enabled flags |

### 2.2 Primary Agent

**File**: `.opencode/agents/ralph.md:1-13`

```yaml
---
description: Implements a single loop of the Ralph loop.
mode: primary
model: anthropic/claude-opus-4-5
tools:
  write: true
  edit: true
  bash: true
  todowrite: true
  question: false
  lsp: true
  skill: true
---
```

This is the only agent with `mode: primary`. It enables `skill` access for using the testing-anti-patterns skill during Ralph loops.

### 2.3 Sub-Agent Definitions

#### Debugger Agent

**File**: `.opencode/agents/debugger.md:1-13`

```yaml
---
description: Debugging specialist for errors, test failures, and unexpected behavior.
mode: subagent
model: anthropic/claude-opus-4-5-high
tools:
  write: true
  edit: true
  bash: true
  webfetch: true
  todowrite: true
  deepwiki: true
  lsp: true
---
```

Uses higher-capability model (`-high` suffix) and enables web tools (`webfetch`, `deepwiki`) and LSP support.

#### Codebase Analyzer

**File**: `.opencode/agents/codebase-analyzer.md:1-9`

```yaml
---
description: Analyzes codebase implementation details.
mode: subagent
model: anthropic/claude-opus-4-5
tools:
  write: true
  edit: true
  bash: true
---
```

Core tools only, focused on documentation of implementation details.

#### Codebase Locator

**File**: `.opencode/agents/codebase-locator.md:1-9`

```yaml
---
description: Locates files, directories, and components relevant to a feature or task.
mode: subagent
model: anthropic/claude-opus-4-5
tools:
  write: true
  edit: true
  bash: true
---
```

Similar tool set to analyzer, focused on file discovery.

#### Codebase Online Researcher

**File**: `.opencode/agents/codebase-online-researcher.md:1-12`

```yaml
---
description: Information discovery on the web.
mode: subagent
model: anthropic/claude-opus-4-5
tools:
  write: true
  edit: true
  bash: true
  webfetch: true
  todowrite: true
  deepwiki: true
---
```

Enables external research tools (`webfetch`, `deepwiki`) for documentation lookup.

#### Codebase Pattern Finder

**File**: `.opencode/agents/codebase-pattern-finder.md:1-9`

```yaml
---
description: Finding similar implementations, usage examples, or existing patterns.
mode: subagent
model: anthropic/claude-opus-4-5
tools:
  write: true
  edit: true
  bash: true
---
```

Core tools only, returns code examples with file:line references.

#### Codebase Research Analyzer

**File**: `.opencode/agents/codebase-research-analyzer.md:1-9`

```yaml
---
description: Research equivalent of codebase-analyzer.
mode: subagent
model: anthropic/claude-opus-4-5
tools:
  write: true
  edit: true
  bash: true
---
```

Extracts insights from research documents.

#### Codebase Research Locator

**File**: `.opencode/agents/codebase-research-locator.md:1-9`

```yaml
---
description: Discovers relevant documents in research/ directory.
mode: subagent
model: anthropic/claude-opus-4-5
tools:
  write: true
  edit: true
  bash: true
---
```

Locates documents in the research/ directory structure.

### 2.4 Tool Availability Matrix

| Agent | write | edit | bash | webfetch | todowrite | deepwiki | lsp | skill | question |
|-------|-------|------|------|----------|-----------|----------|-----|-------|----------|
| ralph | yes | yes | yes | - | yes | - | yes | yes | no |
| debugger | yes | yes | yes | yes | yes | yes | yes | - | - |
| codebase-analyzer | yes | yes | yes | - | - | - | - | - | - |
| codebase-locator | yes | yes | yes | - | - | - | - | - | - |
| codebase-online-researcher | yes | yes | yes | yes | yes | yes | - | - | - |
| codebase-pattern-finder | yes | yes | yes | - | - | - | - | - | - |
| codebase-research-analyzer | yes | yes | yes | - | - | - | - | - | - |
| codebase-research-locator | yes | yes | yes | - | - | - | - | - | - |

---

## 3. Command System

### 3.1 Command File Schema

Commands are defined in `.opencode/command/*.md` files using YAML frontmatter.

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Purpose of the command |
| `agent` | string | Agent identifier to execute command |
| `model` | string | Optional model override |

### 3.2 Standard Commands

#### /commit

**File**: `.opencode/command/commit.md:1-5`

```yaml
---
description: Create well-formatted commits with conventional commit format.
agent: build
model: anthropic/claude-opus-4-5
---
```

#### /create-feature-list

**File**: `.opencode/command/create-feature-list.md:1-5`

```yaml
---
description: Create a detailed `research/feature-list.json` and `research/progress.txt`.
agent: build
model: anthropic/claude-opus-4-5
---
```

#### /create-gh-pr

**File**: `.opencode/command/create-gh-pr.md:1-5`

```yaml
---
description: Commit unstaged changes, push changes, submit a pull request.
agent: build
model: anthropic/claude-opus-4-5
---
```

#### /create-spec

**File**: `.opencode/command/create-spec.md:1-5`

```yaml
---
description: Create a detailed execution plan for implementing features or refactors.
agent: build
model: anthropic/claude-opus-4-5-high
---
```

Uses higher-capability model for spec generation.

#### /explain-code

**File**: `.opencode/command/explain-code.md:1-5`

```yaml
---
description: Explain code functionality in detail.
agent: build
model: anthropic/claude-opus-4-5
---
```

#### /implement-feature

**File**: `.opencode/command/implement-feature.md:1-5`

```yaml
---
description: Implement a SINGLE feature from `research/feature-list.json`.
agent: build
model: anthropic/claude-opus-4-5
---
```

#### /research-codebase

**File**: `.opencode/command/research-codebase.md:1-5`

```yaml
---
description: Document codebase as-is with research directory for historical context.
agent: build
model: anthropic/claude-opus-4-5-high
---
```

Uses higher-capability model for research tasks.

### 3.3 Command Template Variables

Commands use `$ARGUMENTS` placeholder for user input.

**File**: `.opencode/command/explain-code.md:17`

```markdown
Follow this systematic approach to explain code: **$ARGUMENTS**
```

**File**: `.opencode/command/research-codebase.md:11`

```markdown
The user's research question/request is: **$ARGUMENTS**
```

### 3.4 Ralph Loop Commands (in opencode.json)

**File**: `.opencode/opencode.json:5-19`

Ralph commands are defined inline in the configuration, not as separate files:

```json
"command": {
  "ralph:ralph-help": {
    "template": "...",
    "description": "Explain the Ralph Wiggum technique and available commands",
    "agent": "ralph"
  },
  "ralph:ralph-loop": {
    "template": "...",
    "description": "Start a Ralph Wiggum loop for iterative development",
    "agent": "ralph"
  },
  "ralph:cancel-ralph": {
    "template": "...",
    "description": "Cancel the active Ralph Wiggum loop",
    "agent": "ralph"
  }
}
```

Ralph commands use the `ralph` agent instead of `build`.

---

## 4. Configuration

### 4.1 Configuration File Schema

**File**: `.opencode/opencode.json:1-97`

Top-level schema structure:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [...],
  "command": {...},
  "mcp": {...},
  "permission": {...},
  "provider": {...}
}
```

### 4.2 Plugin Registration

**File**: `.opencode/opencode.json:3`

```json
"plugin": ["./plugin/telemetry.ts"]
```

Only the telemetry plugin is registered. The Ralph plugin is not registered in opencode.json (possibly loaded via different mechanism or the configuration shown is partial).

### 4.3 MCP (Model Context Protocol) Configuration

**File**: `.opencode/opencode.json:21-27`

```json
"mcp": {
  "deepwiki": {
    "type": "remote",
    "url": "https://mcp.deepwiki.com/mcp",
    "enabled": true
  }
}
```

Configures the DeepWiki MCP server as a remote service.

### 4.4 Permission Configuration

**File**: `.opencode/opencode.json:28-34`

```json
"permission": {
  "edit": "allow",
  "bash": "allow",
  "webfetch": "allow",
  "doom_loop": "allow",
  "external_directory": "allow"
}
```

All permissions set to `"allow"` mode.

### 4.5 Provider Configuration

**File**: `.opencode/opencode.json:35-96`

Three providers configured with custom model definitions:

#### GitHub Copilot Provider

**File**: `.opencode/opencode.json:36-62`

```json
"github-copilot": {
  "models": {
    "gpt-5.2-codex-high": {
      "id": "gpt-5.2-codex",
      "options": { "reasoningEffort": "high" }
    },
    "gpt-5.2-codex-xhigh": {
      "id": "gpt-5.2-codex",
      "options": { "reasoningEffort": "xhigh" }
    },
    "claude-opus-4.5-high": {
      "id": "claude-opus-4.5",
      "options": {
        "thinking": { "type": "enabled", "budgetTokens": 32000 },
        "output_config": { "effort": "high" }
      }
    }
  }
}
```

#### OpenAI Provider

**File**: `.opencode/opencode.json:64-78`

```json
"openai": {
  "models": {
    "gpt-5.2-codex-high": {
      "id": "gpt-5.2-codex",
      "options": { "reasoningEffort": "high" }
    },
    "gpt-5.2-codex-xhigh": {
      "id": "gpt-5.2-codex",
      "options": { "reasoningEffort": "xhigh" }
    }
  }
}
```

#### Anthropic Provider

**File**: `.opencode/opencode.json:80-95`

```json
"anthropic": {
  "models": {
    "claude-opus-4-5-high": {
      "id": "claude-opus-4-5",
      "options": {
        "thinking": { "type": "enabled", "budgetTokens": 32000 },
        "output_config": { "effort": "high" }
      }
    }
  }
}
```

---

## 5. Skills System

### 5.1 Skill File Structure

**Directory**: `.opencode/skills/<skill-name>/SKILL.md`

Skills use YAML frontmatter with fields:
- `name`: Skill identifier
- `description`: When to use the skill

### 5.2 Available Skills

#### testing-anti-patterns

**File**: `.opencode/skills/testing-anti-patterns/SKILL.md:1-4`

```yaml
---
name: testing-anti-patterns
description: Use when writing or changing tests, adding mocks, or tempted to add test-only methods to production code
---
```

Provides guidance on testing best practices (302 lines of content).

#### prompt-engineer

**File**: `.opencode/skills/prompt-engineer/SKILL.md:1-4`

```yaml
---
name: prompt-engineer
description: Use this skill when creating, improving, or optimizing prompts for Claude.
---
```

Includes references subdirectory:
- `.opencode/skills/prompt-engineer/references/core_prompting.md`
- `.opencode/skills/prompt-engineer/references/advanced_patterns.md`
- `.opencode/skills/prompt-engineer/references/quality_improvement.md`

---

## 6. Integration Patterns

### 6.1 Ralph Loop Flow

1. User invokes `/ralph:ralph-loop` command
2. Command creates state file at `.opencode/ralph-loop.local.md` (`.opencode/plugin/ralph.ts:36`)
3. Ralph plugin's event handler monitors `session.status` events (`:260-262`)
4. When session becomes idle and loop is active:
   - Checks completion promise against last message (`:270-313`)
   - Checks max iterations limit (`:317-327`)
   - Checks feature list completion (`:329-345`)
   - Compacts context via `client.session.summarize()` (`:378-397`)
   - Continues loop via `client.session.prompt()` (`:404-409`)

### 6.2 Telemetry Flow

1. Telemetry plugin tracks commands via `command.execute.before` hook (`:357-363`)
2. Fallback detection in `chat.message` hook (`:370-379`)
3. Commands accumulated in `sessionCommands` array (`:348`)
4. On `session.status` idle or `session.deleted`:
   - Writes event to telemetry file (`:396, 407`)
   - Spawns background upload process (`:297-343`)

### 6.3 Command-to-Agent Routing

Commands specify their target agent in frontmatter:
- `agent: build` - Uses default build agent
- `agent: ralph` - Uses the Ralph primary agent

### 6.4 Sub-Agent Delegation Pattern

The command system references sub-agents by name in markdown content:

**File**: `.opencode/command/research-codebase.md:35-48`

```markdown
**For codebase research:**
- Use the **codebase-locator** agent to find WHERE files and components live
- Use the **codebase-analyzer** agent to understand HOW specific code works
- Use the **codebase-pattern-finder** agent to find examples of existing patterns
```

Sub-agents are invoked via the Task tool from within command execution.

---

## 7. File Structure Summary

```
.opencode/
├── opencode.json          # Main configuration
├── package.json           # SDK dependency
├── .gitignore             # Ignores node_modules, package.json, bun.lock
├── plugin/
│   ├── ralph.ts           # Ralph Wiggum loop plugin (412 lines)
│   └── telemetry.ts       # Telemetry tracking plugin (416 lines)
├── agents/
│   ├── ralph.md           # Primary agent for Ralph loops
│   ├── debugger.md        # Debug specialist sub-agent
│   ├── codebase-analyzer.md
│   ├── codebase-locator.md
│   ├── codebase-online-researcher.md
│   ├── codebase-pattern-finder.md
│   ├── codebase-research-analyzer.md
│   └── codebase-research-locator.md
├── command/
│   ├── commit.md
│   ├── create-feature-list.md
│   ├── create-gh-pr.md
│   ├── create-spec.md
│   ├── explain-code.md
│   ├── implement-feature.md
│   └── research-codebase.md
├── skills/
│   ├── testing-anti-patterns/
│   │   └── SKILL.md
│   └── prompt-engineer/
│       ├── SKILL.md
│       └── references/
│           ├── core_prompting.md
│           ├── advanced_patterns.md
│           └── quality_improvement.md
└── node_modules/
    └── zod/               # Validation library (transitive dependency)
```

---

## 8. Key Constants and Defaults

### Ralph Plugin Defaults

**File**: `.opencode/plugin/ralph.ts:35-39`

```typescript
const STATE_FILE = ".opencode/ralph-loop.local.md"
const DEFAULT_MAX_ITERATIONS = 0
const DEFAULT_COMPLETION_PROMISE = null
const DEFAULT_FEATURE_LIST_PATH = "research/feature-list.json"
```

### Telemetry Constants

**File**: `.opencode/plugin/telemetry.ts:77-88`

```typescript
const ATOMIC_COMMANDS = [
  "/research-codebase",
  "/create-spec",
  "/create-feature-list",
  "/implement-feature",
  "/commit",
  "/create-gh-pr",
  "/explain-code",
  "/ralph:ralph-loop",
  "/ralph:cancel-ralph",
  "/ralph:ralph-help",
] as const
```

---

## 9. Data Flow Diagrams

### 9.1 Plugin Event Flow

```
┌─────────────────┐    ┌────────────────────────────────────────────┐
│ OpenCode        │    │ Plugin System                              │
│ Session         │    ├────────────────────────────────────────────┤
│                 │    │                                            │
│ session.created ├───►│ TelemetryPlugin.event()                    │
│                 │    │   → Reset sessionCommands                  │
│                 │    │                                            │
│ command.execute ├───►│ TelemetryPlugin["command.execute.before"]  │
│                 │    │   → Accumulate command                     │
│                 │    │                                            │
│ chat.message    ├───►│ TelemetryPlugin["chat.message"]            │
│                 │    │   → Extract commands from text             │
│                 │    │                                            │
│ session.status  ├───►│ RalphPlugin.event()                        │
│ (idle)          │    │   → Check completion conditions            │
│                 │    │   → Continue loop or stop                  │
│                 │    │                                            │
│ session.status  ├───►│ TelemetryPlugin.event()                    │
│ (idle)          │    │   → Write telemetry event                  │
│                 │    │   → Spawn upload process                   │
│                 │    │                                            │
│ session.deleted ├───►│ TelemetryPlugin.event()                    │
│                 │    │   → Final telemetry flush                  │
└─────────────────┘    └────────────────────────────────────────────┘
```

### 9.2 Ralph Loop State Machine

```
┌──────────────────┐
│ User invokes     │
│ /ralph:ralph-loop│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Create state file│
│ iteration: 1     │
│ active: true     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────────────────────────┐
│ Execute prompt   │     │ Completion Conditions                │
│ in session       ◄─────┤ 1. completion_promise detected       │
└────────┬─────────┘     │ 2. max_iterations reached            │
         │               │ 3. all features passing (infinite)   │
         │               │ 4. /ralph:cancel-ralph invoked       │
         ▼               └──────────────────────────────────────┘
┌──────────────────┐               │
│ session.status   │               │
│ becomes idle     │               │
└────────┬─────────┘               │
         │                         │
         ▼                         ▼
┌──────────────────┐     ┌──────────────────┐
│ Check completion │ YES │ Delete state file│
│ conditions       ├────►│ Exit loop        │
└────────┬─────────┘     └──────────────────┘
         │ NO
         ▼
┌──────────────────┐
│ Increment iter   │
│ Summarize context│
│ Re-inject prompt │
└────────┬─────────┘
         │
         └─────────►(back to Execute prompt)
```

---

## 10. Cross-References

### Model References

| Model Identifier | Used In |
|-----------------|---------|
| `anthropic/claude-opus-4-5` | ralph.md, codebase-*.md, commit.md, create-feature-list.md, create-gh-pr.md, explain-code.md, implement-feature.md |
| `anthropic/claude-opus-4-5-high` | debugger.md, create-spec.md, research-codebase.md |

### Tool Usage Across Agents

| Tool | Used By |
|------|---------|
| `write` | All agents |
| `edit` | All agents |
| `bash` | All agents |
| `webfetch` | debugger, codebase-online-researcher |
| `deepwiki` | debugger, codebase-online-researcher |
| `todowrite` | ralph, debugger, codebase-online-researcher |
| `lsp` | ralph, debugger |
| `skill` | ralph only |
| `question` | ralph (disabled) |

---

*Document generated: 2026-01-31*
*Repository: atomic*
*Analysis scope: .opencode directory implementation*
