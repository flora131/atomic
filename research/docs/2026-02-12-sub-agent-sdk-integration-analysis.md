---
date: 2026-02-12 09:17:57 UTC
researcher: opencode
git_commit: 337a7015da85d3d813930fbe7b8032fa2e12a996
branch: lavaman131/hotfix/tool-ui
repository: atomic
topic: "Sub-agent SDK Integration Analysis: Built-in Commands and Custom Sub-agent Hookup Verification"
tags: [research, codebase, sub-agents, sdk-integration, claude-sdk, opencode-sdk, copilot-sdk, built-in-commands, skills]
status: complete
last_updated: 2026-02-12
last_updated_by: opencode
last_updated_note: "Added skill-to-sub-agent requirements analysis and debugger DeepWiki verification"
---

# Research

## Research Question

Use parallel sub-agents to research the codebase and make sure that each built-in command can invoke the custom sub-agents properly. For example, Claude Agents SDK has a programmatic definition for sub-agents that can be defined and used with the main agent. Make sure the equivalent is done for all of the coding agent SDKs. Reference the SDKs as described in @src/AGENTS.md. Right now I am noticing that sub-agents are not being correctly hooked up with the built-in commands. This will require you to analyze each built-in command and understand the built-in sub-agents that are required for it. Be very thorough.

## Summary

This research analyzed how built-in commands invoke sub-agents across the three coding agent SDKs (Claude Agent SDK, OpenCode SDK, Copilot SDK). The investigation revealed that **Atomic uses its own independent sub-agent spawning mechanism (`SubagentSessionManager`)** rather than leveraging each SDK's native sub-agent APIs. This creates a disconnect where:

1. **Claude SDK**: The `options.agents` parameter for programmatic sub-agent definitions is NOT being passed to the SDK
2. **OpenCode SDK**: The native agent mode system (`mode: "subagent"`) is not being utilized for built-in agents
3. **Copilot SDK**: Custom agents are loaded from disk but built-in agent definitions are not registered via `customAgents` config

The built-in commands DO work by creating independent sessions, but they do not integrate with the SDKs' native sub-agent orchestration systems.

## Detailed Findings

### Architecture Overview

The sub-agent system consists of three layers:

```
User Types Command (/codebase-analyzer)
           |
           v
    agent-commands.ts
    createAgentCommand()
           |
           v
    CommandContext.spawnSubagent()
           |
           v
    SubagentSessionManager.spawn()
           |
           v
    SDK Client.createSession({ systemPrompt, model, tools })
           |
           v
    Independent SDK Session (NOT native sub-agent)
```

### Component 1: Built-in Agent Definitions

**File**: `src/ui/commands/agent-commands.ts:237-1156`

Seven built-in agents are defined in the `BUILTIN_AGENTS` array:

| Agent Name                   | Tools                                            | Model | Purpose                          |
| ---------------------------- | ------------------------------------------------ | ----- | -------------------------------- |
| `codebase-analyzer`          | Glob, Grep, NotebookRead, Read, LS, Bash         | opus  | Analyzes implementation details  |
| `codebase-locator`           | Glob, Grep, NotebookRead, Read, LS, Bash         | opus  | Locates files/directories        |
| `codebase-pattern-finder`    | Glob, Grep, NotebookRead, Read, LS, Bash         | opus  | Finds similar implementations    |
| `codebase-online-researcher` | Glob, Grep, Read, WebFetch, WebSearch, MCP tools | opus  | Web research with DeepWiki       |
| `codebase-research-analyzer` | Read, Grep, Glob, LS, Bash                       | opus  | Extracts insights from research/ |
| `codebase-research-locator`  | Read, Grep, Glob, LS, Bash                       | opus  | Discovers research/ documents    |
| `debugger`                   | All tools                                        | opus  | Debugs errors and test failures  |

**Agent Definition Interface** (`src/ui/commands/agent-commands.ts:175-225`):

```typescript
interface AgentDefinition {
  name: string;           // Slash command name
  description: string;    // Human-readable description
  tools?: string[];       // Allowed tools (inherits all if omitted)
  model?: AgentModel;     // "sonnet" | "opus" | "haiku"
  prompt: string;         // System prompt
  source: AgentSource;    // "builtin" | "project" | "user"
  argumentHint?: string;  // Expected arguments hint
}
```

### Component 2: Command Registration

**File**: `src/ui/commands/agent-commands.ts:1502-1542`

```typescript
function createAgentCommand(agent: AgentDefinition): CommandDefinition {
  return {
    name: agent.name,
    description: agent.description,
    category: "agent",
    execute: (args: string, context: CommandContext): CommandResult => {
      context.spawnSubagent({
        name: agent.name,
        systemPrompt: agent.prompt,
        message: agentArgs || "Please proceed...",
        model: agent.model,
        tools: agent.tools,
      });
      return { success: true };
    },
  };
}
```

### Component 3: SubagentSessionManager

**File**: `src/ui/subagent-session-manager.ts`

The `SubagentSessionManager` class manages independent sub-agent sessions:

- Creates sessions via injected `createSession` factory function
- Tracks active sessions in a Map
- Provides concurrency limiting with queuing
- Emits status updates via callback
- Cleans up sessions via `destroy()` in finally block

**Key method** (`src/ui/subagent-session-manager.ts:283-298`):

```typescript
private async executeSpawn(options: SubagentSpawnOptions): Promise<SubagentResult> {
  // 1. Create independent session
  const sessionConfig: SessionConfig = {
    systemPrompt: options.systemPrompt,
    model: options.model,
    tools: options.tools,
  };
  session = await this.createSession(sessionConfig);
  // ...
  // 2. Stream response and track tool uses
  for await (const msg of session.stream(options.task)) { ... }
}
```

### Component 4: SDK Client Implementations

#### Claude Agent SDK (`src/sdk/claude-client.ts`)

**Native Sub-agent Support (from docs)**:
- `options.agents: Record<string, AgentDefinition>` for programmatic definitions
- Hook events: `SubagentStart`, `SubagentStop`
- Agent definition type matches Atomic's interface

**Current Implementation Issue**:

The `buildSdkOptions()` method (`claude-client.ts:224-355`) does NOT pass the `agents` option:

```typescript
private buildSdkOptions(config: SessionConfig, sessionId?: string): Options {
  const options: Options = {
    model: config.model,
    maxTurns: config.maxTurns,
    // ... other options
    // MISSING: agents: { ... } for sub-agent definitions
  };
  // ...
}
```

**Event Mapping** (`claude-client.ts:109-120`):
```typescript
const mapping: Partial<Record<EventType, HookEvent>> = {
  "subagent.start": "SubagentStart",
  "subagent.complete": "SubagentStop",
  // ...
};
```

**Tool Restriction** (`claude-client.ts:336-341`):
```typescript
if (config.tools && config.tools.length > 0) {
  options.tools = config.tools;
}
```

#### OpenCode SDK (`src/sdk/opencode-client.ts`)

**Native Sub-agent Support**:
- Agent modes: `build | plan | general | explore`
- `mode: "subagent"` config option
- TaskTool for sub-agent invocation
- Agent definitions via `opencode.json` or `.opencode/agents/` markdown

**Current Implementation**:

The client creates sessions with `agent` mode parameter (`opencode-client.ts:826-833`):

```typescript
const result = await client.sdkClient.session.prompt({
  sessionID: sessionId,
  agent: agentMode,  // "build" by default
  model: client.activePromptModel,
  parts: [{ type: "text", text: message }],
});
```

**Event Mapping** (`opencode-client.ts:505-520`):
```typescript
if (part?.type === "agent") {
  this.emitEvent("subagent.start", partSessionId, {
    subagentId: (part?.id as string) ?? "",
    subagentType: (part?.name as string) ?? "",
  });
}
if (part?.type === "step-finish") {
  this.emitEvent("subagent.complete", partSessionId, {
    subagentId: (part?.id as string) ?? "",
    success: reason !== "error",
  });
}
```

**Issue**: Built-in agent definitions are not registered with OpenCode's native agent system.

#### Copilot SDK (`src/sdk/copilot-client.ts`)

**Native Sub-agent Support**:
- `customAgents: SdkCustomAgentConfig[]` in session config
- Custom agents loaded from `.github/agents/` directory
- Event types: `subagent.started`, `subagent.completed`, `subagent.failed`

**Current Implementation** (`copilot-client.ts:712-719`):

```typescript
const loadedAgents = await loadCopilotAgents(projectRoot);
const customAgents: SdkCustomAgentConfig[] = loadedAgents.map((agent) => ({
  name: agent.name,
  description: agent.description,
  tools: agent.tools ?? null,
  prompt: agent.systemPrompt,
}));
```

**Session Config** (`copilot-client.ts:761-806`):
```typescript
const sdkConfig: SdkSessionConfig = {
  // ...
  customAgents: customAgents.length > 0 ? customAgents : undefined,
  // ...
};
```

**Event Mapping** (`copilot-client.ts:131-148`):
```typescript
const mapping: Partial<Record<SdkSessionEventType, EventType>> = {
  "subagent.started": "subagent.start",
  "subagent.completed": "subagent.complete",
  "subagent.failed": "subagent.complete",
  // ...
};
```

**Issue**: Only disk-discovered agents are loaded; built-in `BUILTIN_AGENTS` are not included in `customAgents`.

### Component 5: Graph Bridge System

**File**: `src/graph/subagent-bridge.ts:27-61`

The `SubagentGraphBridge` connects graph workflows to `SubagentSessionManager`:

```typescript
export class SubagentGraphBridge {
  private sessionManager: SubagentSessionManager;
  
  async spawn(options: SubagentSpawnOptions): Promise<SubagentResult>;
  async spawnParallel(agents: SubagentSpawnOptions[]): Promise<SubagentResult[]>;
}
```

### Component 6: Sub-agent Registry

**File**: `src/graph/subagent-registry.ts:28-50`

The `SubagentTypeRegistry` provides name-based agent lookup:

```typescript
export class SubagentTypeRegistry {
  private agents = new Map<string, SubagentEntry>();
  
  register(entry: SubagentEntry): void;
  get(name: string): SubagentEntry | undefined;
  getAll(): SubagentEntry[];
}
```

## Code References

| File                                 | Lines     | Description                                       |
| ------------------------------------ | --------- | ------------------------------------------------- |
| `src/ui/commands/agent-commands.ts`  | 237-1156  | `BUILTIN_AGENTS` array with 7 built-in agents     |
| `src/ui/commands/agent-commands.ts`  | 175-225   | `AgentDefinition` interface                       |
| `src/ui/commands/agent-commands.ts`  | 1091-1156 | `debugger` agent with DeepWiki MCP tool           |
| `src/ui/commands/agent-commands.ts`  | 1502-1542 | `createAgentCommand()` function                   |
| `src/ui/commands/skill-commands.ts`  | 74-278    | `/research-codebase` skill prompt                 |
| `src/ui/commands/skill-commands.ts`  | 280-400   | `/create-spec` skill prompt                       |
| `src/ui/commands/skill-commands.ts`  | 1196      | `sendSilentMessage()` for skill execution         |
| `src/ui/subagent-session-manager.ts` | 23-54     | `SubagentSpawnOptions` and `SubagentResult` types |
| `src/ui/subagent-session-manager.ts` | 283-298   | `executeSpawn()` creates independent session      |
| `src/sdk/claude-client.ts`           | 224-355   | `buildSdkOptions()` - missing `agents` option     |
| `src/sdk/claude-client.ts`           | 109-120   | Event type mapping including sub-agent hooks      |
| `src/sdk/opencode-client.ts`         | 505-520   | SSE event mapping for agent parts                 |
| `src/sdk/opencode-client.ts`         | 826-833   | Session prompt with `agent` mode                  |
| `src/sdk/copilot-client.ts`          | 712-719   | Custom agent loading from disk                    |
| `src/sdk/copilot-client.ts`          | 761-806   | Session config with `customAgents`                |
| `src/sdk/copilot-client.ts`          | 131-148   | SDK event type mapping                            |
| `src/graph/subagent-bridge.ts`       | 27-61     | `SubagentGraphBridge` class                       |
| `src/graph/subagent-registry.ts`     | 28-50     | `SubagentTypeRegistry` class                      |

## Architecture Documentation

### Sub-agent Execution Flow

1. **Command Registration** (`agent-commands.ts`):
   - `registerAgentCommands()` combines `BUILTIN_AGENTS` with discovered agents
   - Each agent is wrapped by `createAgentCommand()` 
   - Commands are registered in `globalRegistry`

2. **Command Execution** (`chat.tsx`):
   - User types `/codebase-analyzer <args>`
   - Command handler calls `context.spawnSubagent(options)`
   - `spawnSubagent` creates `ParallelAgent` UI state
   - Calls `SubagentSessionManager.spawn()`

3. **Session Creation** (`subagent-session-manager.ts`):
   - Creates `SessionConfig` with `systemPrompt`, `model`, `tools`
   - Calls injected `createSession` factory
   - Creates INDEPENDENT session (not SDK native sub-agent)

4. **Event Propagation**:
   - SDK clients emit unified events (`subagent.start`, `subagent.complete`)
   - UI updates via event handlers
   - Results piped back to parent chat

### SDK Native Sub-agent APIs (Not Currently Used)

#### Claude Agent SDK
```typescript
// Native API (from docs)
query({
  prompt: "message",
  options: {
    agents: {
      "codebase-analyzer": {
        description: "Analyzes code",
        tools: ["Glob", "Grep", "Read"],
        prompt: "You are a code analyzer...",
        model: "opus"
      }
    }
  }
})
```

#### OpenCode SDK
```typescript
// Agent definitions in opencode.json
{
  "agent": {
    "codebase-analyzer": {
      "description": "Analyzes code",
      "mode": "subagent",
      "model": "anthropic/claude-opus-4",
      "prompt": "You are a code analyzer...",
      "permission": { "edit": "deny" }
    }
  }
}
```

#### Copilot SDK
```typescript
// Already implemented for disk agents
const sdkConfig: SdkSessionConfig = {
  customAgents: [
    { name, description, tools, prompt }
  ]
};
```

## Historical Context (from research/)

No prior research documents found in the research/ directory related to sub-agent SDK integration.

## Comparison Matrix

| Aspect                    | Claude SDK          | OpenCode SDK           | Copilot SDK           |
| ------------------------- | ------------------- | ---------------------- | --------------------- |
| **Native Agent API**      | `options.agents`    | `opencode.json` agents | `customAgents` config |
| **Built-ins Registered?** | NO                  | NO                     | NO (disk only)        |
| **Event Mapping**         | YES (hooks)         | YES (SSE)              | YES (events)          |
| **Tool Restriction**      | YES                 | via permission         | YES                   |
| **Sub-agent Spawning**    | Independent session | Independent session    | Independent session   |

## Identified Issues

### Issue 1: Claude SDK - Missing `agents` Option

**Location**: `src/sdk/claude-client.ts:224-355`

The `buildSdkOptions()` method does not pass the `agents` option to the SDK. This means:
- Claude SDK's native sub-agent orchestration is bypassed
- Sub-agents run as completely independent sessions
- The SDK cannot optimize context sharing between parent and sub-agent

### Issue 2: OpenCode SDK - No Native Agent Registration

**Location**: `src/sdk/opencode-client.ts`

Built-in agents are not registered with OpenCode's native agent system:
- No `opencode.json` generation for built-in agents
- No utilization of `mode: "subagent"` configuration
- Sub-agents don't benefit from OpenCode's agent-aware context management

### Issue 3: Copilot SDK - Built-ins Not in `customAgents`

**Location**: `src/sdk/copilot-client.ts:712-719`

Only disk-discovered agents are loaded:
```typescript
const loadedAgents = await loadCopilotAgents(projectRoot);
// BUILTIN_AGENTS are NOT included here
```

### Issue 4: Independent Session Architecture

The current `SubagentSessionManager` architecture creates fully independent sessions rather than leveraging SDK-native sub-agent mechanisms. This means:
- No context inheritance from parent session
- No SDK-optimized sub-agent orchestration
- Events are mapped but not from native sub-agent lifecycle

### Issue 5: Skills Cannot Invoke Sub-agents via SDK Native Task Tool

**Location**: `src/ui/commands/skill-commands.ts`

Skills like `/research-codebase` and `/create-spec` use `sendSilentMessage()` to send prompts that instruct the main agent to use the Task tool with specific `subagent_type` values. However, these sub-agent names are NOT registered with SDK-native APIs:

**Affected Skills**:

| Skill                | Required Sub-agents                                                                                                                                         | Status         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `/research-codebase` | `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `codebase-research-locator`, `codebase-research-analyzer`, `codebase-online-researcher` | NOT registered |
| `/create-spec`       | `codebase-research-locator`, `codebase-research-analyzer`                                                                                                   | NOT registered |

**Impact**: When the main agent tries to use the Task tool with these `subagent_type` values, the SDK cannot find them because they're not in:
- Claude SDK's `options.agents`
- OpenCode SDK's agent configuration
- Copilot SDK's `customAgents` array

### Verified Working: Debugger Agent DeepWiki Access

**Location**: `src/ui/commands/agent-commands.ts:1108`

The `debugger` agent correctly includes `mcp__deepwiki__ask_question` in its tool list, enabling DeepWiki documentation lookup for external libraries.

### Component 7: Skills and Sub-agent Invocation

**File**: `src/ui/commands/skill-commands.ts`

Skills are different from agent commands. While agent commands (like `/codebase-analyzer`) use `context.spawnSubagent()` to create independent sessions, skills use `context.sendSilentMessage()` to send prompts to the main session.

**Key Code** (`skill-commands.ts:1196`):
```typescript
context.sendSilentMessage(expandedPrompt);
```

The skill prompts embed instructions telling the main agent to use the Task tool with specific `subagent_type` values. This relies on the SDK's native Task tool to invoke sub-agents by name.

### Skill-to-Sub-agent Requirements

#### `/research-codebase` Skill

**File**: `src/ui/commands/skill-commands.ts:74-278`

This skill should have access to the following sub-agents via the Task tool:

| Sub-agent                    | Purpose                                 | Expected `subagent_type`       |
| ---------------------------- | --------------------------------------- | ------------------------------ |
| `codebase-locator`           | Find WHERE files and components live    | `"codebase-locator"`           |
| `codebase-analyzer`          | Understand HOW specific code works      | `"codebase-analyzer"`          |
| `codebase-pattern-finder`    | Find examples of existing patterns      | `"codebase-pattern-finder"`    |
| `codebase-research-locator`  | Discover documents in research/         | `"codebase-research-locator"`  |
| `codebase-research-analyzer` | Extract insights from research docs     | `"codebase-research-analyzer"` |
| `codebase-online-researcher` | External documentation via DeepWiki/Web | `"codebase-online-researcher"` |

**Current Status**: The skill prompt references these agents correctly (lines 107-127), but they are NOT registered with SDK-native APIs.

#### `/create-spec` Skill

**File**: `src/ui/commands/skill-commands.ts:280-400`

This skill should have access to:

| Sub-agent                    | Purpose                           | Expected `subagent_type`       |
| ---------------------------- | --------------------------------- | ------------------------------ |
| `codebase-research-locator`  | Find relevant research documents  | `"codebase-research-locator"`  |
| `codebase-research-analyzer` | Analyze research document content | `"codebase-research-analyzer"` |

**Current Status**: The skill prompt mentions these agents (line 286), but they are NOT registered with SDK-native APIs.

### Debugger Agent Tool Access

**File**: `src/ui/commands/agent-commands.ts:1091-1156`

The `debugger` agent has access to the DeepWiki MCP `ask_question` tool:

```typescript
tools: [
  "Bash",
  "Task",
  "AskUserQuestion",
  "Edit",
  "Glob",
  "Grep",
  // ...
  "mcp__deepwiki__ask_question",  // <-- DeepWiki access
  "WebFetch",
  "WebSearch",
],
```

**Status**: ✅ WORKING - The debugger agent correctly includes `mcp__deepwiki__ask_question` in its tool list.

### Skill vs Agent Command Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SKILL EXECUTION PATH                          │
│ /research-codebase                                               │
│         │                                                        │
│         v                                                        │
│ skill-commands.ts                                                │
│ context.sendSilentMessage(skillPrompt)                           │
│         │                                                        │
│         v                                                        │
│ Main Session (receives prompt with Task tool instructions)       │
│         │                                                        │
│         v                                                        │
│ Task tool invoked with subagent_type="codebase-analyzer"         │
│         │                                                        │
│         v                                                        │
│ SDK looks up subagent_type in registered agents                  │
│         │                                                        │
│         X <-- ISSUE: Built-in agents NOT registered with SDK     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   AGENT COMMAND EXECUTION PATH                   │
│ /codebase-analyzer                                               │
│         │                                                        │
│         v                                                        │
│ agent-commands.ts                                                │
│ context.spawnSubagent({ name, systemPrompt, model, tools })      │
│         │                                                        │
│         v                                                        │
│ SubagentSessionManager.spawn()                                   │
│         │                                                        │
│         v                                                        │
│ SDK Client.createSession({ systemPrompt, model, tools })         │
│         │                                                        │
│         v                                                        │
│ Independent session created (WORKS but not SDK-native)           │
└─────────────────────────────────────────────────────────────────┘
```

### Issue 5: Skills Cannot Invoke Sub-agents via SDK Native Task Tool

When a skill's prompt instructs the main agent to use the Task tool with a specific `subagent_type`, the SDK looks up that agent in its registered agents. Since built-in agents are NOT registered with SDK-native APIs:

- **Claude SDK**: The Task tool will fail to find `"codebase-analyzer"` because `options.agents` is not populated
- **OpenCode SDK**: The Task tool will fail to find `"codebase-analyzer"` because no `opencode.json` agent exists
- **Copilot SDK**: The Task tool will only find disk-discovered agents, not built-ins

## Related Research

- `docs/claude-agent-sdk/typescript-sdk.md` - Claude SDK AgentDefinition type
- `docs/copilot-cli/skills.md` - Copilot skill system
- `docs/copilot-cli/usage.md` - Copilot CLI agent commands

## Open Questions

1. Should built-in agents be registered with SDK-native APIs, or is the independent session approach intentional for isolation?

2. For Claude SDK, should `buildSdkOptions()` accept an `agents` parameter and pass it through?

3. For OpenCode SDK, should built-in agents be dynamically registered via the SDK's agent configuration?

4. For Copilot SDK, should `BUILTIN_AGENTS` be merged with `loadedAgents` before passing to `customAgents`?

5. Is there a performance or cost benefit to using SDK-native sub-agent orchestration vs independent sessions?

6. How should skills like `/research-codebase` invoke sub-agents? Should they:
   - Use the current `sendSilentMessage()` approach (relying on main agent's Task tool)
   - Directly call `spawnSubagent()` for each sub-agent
   - Register built-in agents with SDK-native APIs so the Task tool can find them

7. Should the `/research-codebase` skill's sub-agent access list be enforced programmatically, or is the current prompt-based approach sufficient?
