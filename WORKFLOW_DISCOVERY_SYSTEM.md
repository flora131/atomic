# Workflow Discovery and Resolver System Documentation

## Table of Contents

1. [Overview](#overview)
2. [Workflow File Format and Discovery](#workflow-file-format-and-discovery)
3. [Workflow Command Registration](#workflow-command-registration)
4. [Builtin Commands](#builtin-commands)
5. [Agent Config Locations](#agent-config-locations)
6. [Subgraph Node Resolution](#subgraph-node-resolution)
7. [Command Execution Flow](#command-execution-flow)
8. [Type Definitions](#type-definitions)

---

## Overview

The workflow discovery and resolver system enables the application to discover, register, and execute workflows from multiple sources:

- **Built-in workflows**: Hardcoded workflow definitions (e.g., `ralph`)
- **Global workflows**: User-level workflows from `~/.atomic/workflows/`
- **Local workflows**: Project-specific workflows from `.atomic/workflows/`
- **Subgraph resolution**: Workflows can be referenced by name in graph nodes via `subgraphNode()`

The system uses a **global resolver pattern** similar to `setClientProvider()` for dependency injection, avoiding circular dependencies between modules.

---

## Workflow File Format and Discovery

### Discovery Paths

Workflows are discovered from TypeScript files (`.ts`) in the following directories (in priority order):

**`src/ui/commands/workflow-commands.ts:234-238`**
```typescript
export const CUSTOM_WORKFLOW_SEARCH_PATHS = [
    // Local project workflows (highest priority)
    ".atomic/workflows",
    // Global user workflows
    "~/.atomic/workflows",
];
```

**Priority Rules**:
1. **Local** `.atomic/workflows/` — Highest priority (project-specific workflows)
2. **Global** `~/.atomic/workflows/` — User-level workflows
3. **Built-in** — Lowest priority (defined in code at `src/ui/commands/workflow-commands.ts:416-424`)

If a local workflow has the same name as a global or built-in workflow, the local workflow takes precedence.

### Workflow File Format

Workflow files are TypeScript modules that export metadata:

**`src/ui/commands/workflow-commands.ts:308-320`**
```typescript
/**
 * Example workflow file (.atomic/workflows/my-workflow.ts):
 * ```typescript
 * export const name = "my-workflow";
 * export const description = "My custom workflow";
 * export const aliases = ["mw"];
 * export const version = "1.0.0";
 * export const minSDKVersion = "0.4.19";
 * export const stateVersion = 1;
 * ```
 */
```

**Required Exports**:
- `name` (string, optional) — Workflow name (defaults to filename without `.ts`)
- `description` (string, optional) — Human-readable description (defaults to `"Custom workflow: {name}"`)
- `aliases` (string[], optional) — Alternative command names
- `defaultConfig` (Record<string, unknown>, optional) — Default configuration
- `version` (string, optional) — Workflow definition version (semver)
- `minSDKVersion` (string, optional) — Minimum SDK version required
- `stateVersion` (number, optional) — Workflow state schema version

### WorkflowMetadata Interface

**`src/ui/commands/workflow-commands.ts:84-97`**
```typescript
export interface WorkflowMetadata {
    /** Command name (without leading slash) */
    name: string;
    /** Human-readable description */
    description: string;
    /** Alternative names for the command */
    aliases?: string[];
    /** Optional default configuration */
    defaultConfig?: Record<string, unknown>;
    /** Workflow definition version (semver) */
    version?: string;
    /** Minimum SDK version required to run this workflow */
    minSDKVersion?: string;
    /** Workflow state schema version for migrations */
    stateVersion?: number;
    /** Source: built-in, global (~/.atomic/workflows), or local (.atomic/workflows) */
    source?: "builtin" | "global" | "local";
    /** Hint text showing expected arguments (e.g., "PROMPT [--yolo]") */
    argumentHint?: string;
}
```

### Discovery Process

**`src/ui/commands/workflow-commands.ts:269-298`**

The `discoverWorkflowFiles()` function:
1. Expands paths (converts `~` to home directory at line 247-259)
2. Scans each directory for `.ts` files
3. Returns an array of `{ path, source }` objects
4. Source is `"local"` for `.atomic/workflows/`, `"global"` for `~/.atomic/workflows/`

**`src/ui/commands/workflow-commands.ts:323-367`**

The `loadWorkflowsFromDisk()` function:
1. Calls `discoverWorkflowFiles()` to get all workflow file paths (line 324)
2. Dynamically imports each `.ts` file (line 331)
3. Extracts metadata from module exports (lines 333-349)
4. Skips workflows with duplicate names (local overrides global, line 339-341)
5. Stores results in `loadedWorkflows` module-level variable (line 365)

**Path Expansion**:
```typescript
function expandPath(path: string): string {
    if (path.startsWith("~/")) {
        return join(process.env.HOME || "", path.slice(2));
    }
    if (path.startsWith("~")) {
        return join(process.env.HOME || "", path.slice(1));
    }
    // For relative paths, resolve from cwd
    if (!path.startsWith("/")) {
        return join(process.cwd(), path);
    }
    return path;
}
```

---

## Workflow Command Registration

### Built-in Workflow Definitions

**`src/ui/commands/workflow-commands.ts:416-424`**
```typescript
const BUILTIN_WORKFLOW_DEFINITIONS: WorkflowMetadata[] = [
    {
        name: "ralph",
        description: "Start autonomous implementation workflow",
        aliases: ["loop"],
        version: "1.0.0",
        minSDKVersion: VERSION,
        stateVersion: 1,
        argumentHint: '"<prompt-or-spec-path>"',
        source: "builtin",
    },
];
```

The `ralph` workflow is the only built-in workflow definition. It's registered as a slash command `/ralph` with alias `/loop`.

### getAllWorkflows()

**`src/ui/commands/workflow-commands.ts:373-402`**

Combines all workflows with proper priority resolution:
1. Adds dynamically loaded workflows first (local > global)
2. Adds built-in workflows last (lowest priority)
3. Uses case-insensitive name deduplication via `Set<string>`
4. Also tracks aliases to prevent conflicts

### registerWorkflowCommands()

**`src/ui/commands/workflow-commands.ts:1078-1086`**

Called during application initialization to register all workflows:
```typescript
export function registerWorkflowCommands(): void {
    const commands = getWorkflowCommands();
    for (const command of commands) {
        // Skip if already registered (idempotent)
        if (!globalRegistry.has(command.name)) {
            globalRegistry.register(command);
        }
    }
}
```

**Initialization Order** (typically in `src/ui/chat.tsx` or `src/commands/chat.ts`):
```typescript
await loadWorkflowsFromDisk();  // Discover custom workflows
registerWorkflowCommands();      // Register all workflows as commands
```

### Command Factory

**`src/ui/commands/workflow-commands.ts:436-488`**

The `createWorkflowCommand()` factory creates `CommandDefinition` objects:

- For `ralph`, delegates to `createRalphCommand()` (line 438-439)
- For other workflows, creates a generic workflow command (lines 442-488)

**Generic Workflow Command Handler** (lines 448-487):
1. Checks if workflow already active (lines 450-455)
2. Validates prompt argument (lines 458-465)
3. Adds system message indicating workflow start (lines 468-471)
4. Returns success with state updates (lines 474-486)

### Ralph Command Handler

**`src/ui/commands/workflow-commands.ts:582-1051`**

The `createRalphCommand()` function creates a specialized handler for the `/ralph` workflow:

**Parsing** (lines 600-619):
- Uses `parseRalphArgs()` to extract prompt from command arguments (line 602)
- Validates required prompt argument (lines 64-74)

**Execution Flow** (lines 620-1047):
1. **Step 1: Task Decomposition** (lines 620-681)
   - Streams user prompt to decompose into task list (line 637-648)
   - Parses JSON task array from response (line 652)
   - Saves tasks to `~/.atomic/workflows/{sessionId}/tasks.json` (line 654)
   - Seeds TodoWrite state with task items (lines 657-666)
   - Sets Ralph session metadata (lines 669-681)

2. **Step 2: Task Execution Loop** (lines 683-754)
   - Iterates up to `MAX_RALPH_ITERATIONS` (line 690)
   - Identifies ready tasks using `getReadyTasks()` (line 694)
   - Marks tasks as `in_progress` (lines 704-710)
   - Spawns worker sub-agents in parallel (lines 713-723)
   - Updates task status based on results (lines 726-743)
   - Breaks on completion or no actionable tasks (lines 746-753)

3. **Step 3: Review & Fix Phase** (lines 756-950)
   - Re-reads tasks from disk to confirm state (line 758)
   - Spawns `reviewer` sub-agent (lines 783-786)
   - Parses review findings (lines 792-795)
   - Builds fix specification from review (lines 807-812)
   - Re-invokes ralph with fix spec if needed (lines 824-949)
   - Iterates up to `MAX_REVIEW_ITERATIONS` times (line 765)

**Session Management**:
- Active sessions tracked in `activeSessions` Map (line 104)
- `getActiveSession()` returns most recent session (lines 109-115)
- `completeSession()` removes session from tracking (lines 120-122)
- Tasks persisted atomically using temp file + rename (lines 134-164)

---

## Builtin Commands

Builtin (slash) commands are registered separately from workflows.

**`src/ui/commands/builtin-commands.ts:586-594`**
```typescript
export const builtinCommands: CommandDefinition[] = [
    helpCommand,
    themeCommand,
    clearCommand,
    compactCommand,
    exitCommand,
    modelCommand,
    mcpCommand,
];
```

**`src/ui/commands/builtin-commands.ts:609-616`**
```typescript
export function registerBuiltinCommands(): void {
    for (const command of builtinCommands) {
        // Skip if already registered (idempotent)
        if (!globalRegistry.has(command.name)) {
            globalRegistry.register(command);
        }
    }
}
```

### Command Definitions

| Command | Description | File | Lines |
|---------|-------------|------|-------|
| `/help` | Display all available commands | `builtin-commands.ts` | 39-172 |
| `/theme` | Toggle between dark and light theme | `builtin-commands.ts` | 181-211 |
| `/clear` | Clear messages and reset session | `builtin-commands.ts` | 219-231 |
| `/compact` | Compact context to reduce token usage | `builtin-commands.ts` | 239-277 |
| `/exit` | Exit the TUI | `builtin-commands.ts` | 285-297 |
| `/model` | Switch or view current model | `builtin-commands.ts` | 308-429 |
| `/mcp` | Display and manage MCP servers | `builtin-commands.ts` | 493-577 |

### /help Command Categories

**`src/ui/commands/builtin-commands.ts:70-94`**

The `/help` command groups commands by category:
1. **Slash Commands** (`"builtin"`)
2. **Workflows** (`"workflow"`)
3. **Skills** (`"skill"`)
4. **Sub-Agents** (`"agent"`)

Categories are ordered in `categoryOrder` array (lines 70-74) and displayed with labels from `categoryLabels` map (lines 75-79).

---

## Agent Config Locations

Agents (sub-agents invokable via the Task tool or `/agent` commands) are discovered from markdown files in the following directories:

### Discovery Paths

**`src/ui/commands/agent-commands.ts:34-52`**
```typescript
export const AGENT_DISCOVERY_PATHS = [
  ".claude/agents",
  ".opencode/agents",
  ".github/agents",
] as const;

export const GLOBAL_AGENT_PATHS = [
  "~/.claude/agents",
  "~/.opencode/agents",
  "~/.copilot/agents",
  "~/.atomic/.claude/agents",
  "~/.atomic/.opencode/agents",
  "~/.atomic/.copilot/agents",
] as const;
```

**Priority** (highest to lowest):
1. **Project-local** — `.claude/agents/`, `.opencode/agents/`, `.github/agents/`
2. **User-global** — `~/.claude/agents/`, `~/.opencode/agents/`, `~/.copilot/agents/`
3. **Atomic-managed global** — `~/.atomic/.claude/agents/`, `~/.atomic/.opencode/agents/`, `~/.atomic/.copilot/agents/`

### Agent File Format

Agent definitions are `.md` files with optional YAML frontmatter:

**Example** (`.claude/agents/worker.md:1-6`):
```markdown
---
description: Implement a SINGLE task from a task list.
allowed-tools: Bash, Task, Edit, Glob, Grep, NotebookEdit, NotebookRead, Read, Write, Skill
model: opus
memory: project
---

You are tasked with implementing a SINGLE task from the task list.
...
```

**Frontmatter Fields**:
- `name` (string, optional) — Agent name (defaults to filename without `.md`)
- `description` (string, optional) — Human-readable description (defaults to `"Agent: {name}"`)
- `tools` (string[], optional) — Tool names available to agent
- Other fields (e.g., `model`, `memory`, `allowed-tools`) are SDK-specific and passed through

**Body**: The markdown body is used as the agent's system prompt.

### AgentInfo Interface

**`src/ui/commands/agent-commands.ts:81-90`**
```typescript
export interface AgentInfo {
  /** Unique identifier for the agent (from frontmatter or filename) */
  name: string;
  /** Human-readable description of the agent's purpose */
  description: string;
  /** Source of this agent definition (project or user) */
  source: AgentSource;
  /** Full path to the agent's .md file */
  filePath: string;
}
```

### Discovery Process

**`src/ui/commands/agent-commands.ts:179-197`**

The `discoverAgentFiles()` function:
1. Scans `AGENT_DISCOVERY_PATHS` for project-local agents (lines 183-186)
2. Scans `GLOBAL_AGENT_PATHS` for user-global agents (lines 189-194)
3. Expands `~` to home directory using `expandTildePath()` (line 146)
4. Returns array of `DiscoveredAgentFile` objects with `{ path, source, filename }`

**`src/ui/commands/agent-commands.ts:259-278`**

The `discoverAgentInfos()` function:
1. Calls `discoverAgentFiles()` to get file list (line 260)
2. Parses each file using `parseAgentInfoLight()` (line 264)
3. Resolves name conflicts using `shouldAgentOverride()` (lines 267-270)
4. Returns array of `AgentInfo` objects

**Priority Resolution** (`shouldAgentOverride()` at lines 238-248):
- `project` source (priority 2) overrides `user` source (priority 1)

### Frontmatter Parsing

**`src/ui/commands/agent-commands.ts:206-225`**

The `parseAgentInfoLight()` function:
1. Reads file content (line 208)
2. Parses frontmatter using `parseMarkdownFrontmatter()` (line 209)
3. Extracts `name` from frontmatter or uses filename (line 211)
4. Extracts `description` from frontmatter or generates default (lines 212-213)
5. Returns `AgentInfo` object (lines 215-220)

**Note**: Unlike the full `loadAgentsFromDir()` in `config/copilot-manual.ts`, the agent commands module only reads `name` and `description`. SDKs handle tools, model, and prompt natively from their config directories.

### SubagentTypeRegistry

Discovered agents are registered in a global singleton for name-based lookup.

**`src/graph/subagent-registry.ts:28-50`**
```typescript
export class SubagentTypeRegistry {
  private agents = new Map<string, SubagentEntry>();

  register(entry: SubagentEntry): void {
    this.agents.set(entry.name, entry);
  }

  get(name: string): SubagentEntry | undefined {
    return this.agents.get(name);
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  getAll(): SubagentEntry[] {
    return Array.from(this.agents.values());
  }

  clear(): void {
    this.agents.clear();
  }
}
```

**SubagentEntry Interface** (lines 18-22):
```typescript
export interface SubagentEntry {
  name: string;
  info: AgentInfo;
  source: AgentSource;
}
```

**Singleton Accessors** (lines 56-67):
```typescript
let globalSubagentRegistry: SubagentTypeRegistry | null = null;

export function getSubagentRegistry(): SubagentTypeRegistry {
  if (!globalSubagentRegistry) {
    globalSubagentRegistry = new SubagentTypeRegistry();
  }
  return globalSubagentRegistry;
}

export function setSubagentRegistry(registry: SubagentTypeRegistry): void {
  globalSubagentRegistry = registry;
}
```

**Population** (`populateSubagentRegistry()` at lines 79-92):
1. Gets singleton instance (line 80)
2. Calls `discoverAgentInfos()` to find all agents (line 82)
3. Registers each agent by name (lines 83-89)
4. Returns count of registered agents (line 91)

### Agent Command Registration

**`src/ui/commands/agent-commands.ts:341-359`**

The `registerAgentCommands()` function:
1. Calls `discoverAgentInfos()` to get all agents (line 342)
2. Creates `CommandDefinition` via `createAgentCommand()` (line 344)
3. Registers command in global registry (line 351)
4. Skips if command already registered (line 345)
5. Unregisters existing if override needed (line 349)

**Agent Command Execution** (`createAgentCommand()` at lines 305-330):

For **OpenCode SDK** (lines 315-319):
- Sends silent message with `{ agent: agent.name, isAgentOnlyStream: true }`
- SDK constructs `AgentPartInput` prompt parts

For **Claude/Copilot SDK** (lines 321-326):
- Sends instruction: `Use the Task tool to invoke the {agentName} sub-agent for this exact task: {task}`
- Steers model to use Task tool for sub-agent dispatch
- Ensures sub-agent lifecycle events are emitted

---

## Subgraph Node Resolution

Workflows can be nested within other workflows using `subgraphNode()`. The workflow can be specified as a compiled graph or a string name resolved at runtime.

### setWorkflowResolver() / getWorkflowResolver()

**`src/graph/nodes.ts:1110-1129`**

Global workflow resolver for dependency injection:
```typescript
let globalWorkflowResolver: WorkflowResolver | null = null;

/**
 * Set the global workflow resolver for subgraph nodes.
 * This should be called during application initialization.
 */
export function setWorkflowResolver(resolver: WorkflowResolver): void {
  globalWorkflowResolver = resolver;
}

/**
 * Get the current global workflow resolver.
 */
export function getWorkflowResolver(): WorkflowResolver | null {
  return globalWorkflowResolver;
}
```

**Purpose**: Avoids circular dependencies between `nodes.ts` and `workflow-commands.ts`.

### WorkflowResolver Type

**`src/graph/nodes.ts:1104`**
```typescript
export type WorkflowResolver = (name: string) => CompiledSubgraph<BaseState> | null;
```

A function that:
- **Input**: Workflow name (string)
- **Output**: Compiled subgraph or `null` if not found

### CompiledSubgraph<TSubState>

**`src/graph/nodes.ts:1039-1041`**
```typescript
export interface CompiledSubgraph<TSubState extends BaseState = BaseState> {
  execute: (state: TSubState) => Promise<TSubState>;
}
```

A compiled subgraph has a single `execute()` method that:
- **Input**: Initial subgraph state
- **Output**: Promise resolving to final subgraph state

### SubgraphRef<TSubState>

**`src/graph/nodes.ts:1049-1051`**
```typescript
export type SubgraphRef<TSubState extends BaseState = BaseState> =
  | CompiledSubgraph<TSubState>
  | string;
```

A reference to a subgraph can be:
- A **compiled graph** object (direct execution)
- A **string** workflow name (resolved at runtime)

### subgraphNode() Factory

**`src/graph/nodes.ts:1166-1223`**

Creates a node that executes a nested workflow:

**Configuration Interface** (lines 1059-1098):
```typescript
export interface SubgraphNodeConfig<
  TState extends BaseState = BaseState,
  TSubState extends BaseState = BaseState,
> {
  /** Unique identifier for the node */
  id: NodeId;

  /**
   * The subgraph to execute. Can be:
   * - A CompiledGraph instance (direct execution)
   * - A workflow name string (resolved at runtime via resolveWorkflowRef)
   */
  subgraph: SubgraphRef<TSubState>;

  /**
   * Map parent state to subgraph initial state.
   */
  inputMapper?: (state: TState) => TSubState;

  /**
   * Map subgraph final state to parent state update.
   */
  outputMapper?: (subState: TSubState, parentState: TState) => Partial<TState>;

  /** Human-readable name */
  name?: string;

  /** Description */
  description?: string;
}
```

**Execution Flow** (lines 1177-1221):

1. **Resolve subgraph reference** (lines 1178-1200):
   - If `subgraph` is a **string** (line 1181):
     - Get global resolver via `globalWorkflowResolver` (line 1183)
     - Throw error if resolver not set (lines 1184-1188)
     - Call resolver to get compiled graph (line 1191)
     - Throw error if workflow not found (lines 1192-1194)
     - Cast to `CompiledSubgraph<TSubState>` (line 1196)
   - If `subgraph` is already compiled, use directly (lines 1197-1199)

2. **Map input state** (lines 1203-1205):
   - Call `inputMapper` if provided, otherwise cast parent state

3. **Execute subgraph** (line 1208):
   - Call `resolvedSubgraph.execute(subState)`

4. **Map output state** (lines 1211-1218):
   - Call `outputMapper` if provided to merge results into parent state
   - Otherwise store result in `outputs[id]`

5. **Return node result** (line 1220):
   - Returns `{ stateUpdate }` to be applied to parent state

**Example Usage** (from docstring at lines 1147-1164):

```typescript
// Using a compiled graph directly
const analysisNode = subgraphNode<MainState, AnalysisState>({
  id: "deep-analysis",
  subgraph: compiledAnalysisGraph,
  inputMapper: (state) => ({ doc: state.document }),
  outputMapper: (subState, parentState) => ({
    analysisResults: subState.results,
  }),
});

// Using a workflow name string
const researchNode = subgraphNode<MainState, ResearchState>({
  id: "research",
  subgraph: "research-codebase",
  inputMapper: (state) => ({ topic: state.currentTopic }),
});
```

**Error Messages**:
- If resolver not set: `"Cannot resolve workflow \"{name}\": No workflow resolver set. Call setWorkflowResolver() during application initialization."`
- If workflow not found: `"Workflow not found: {name}"`

---

## Command Execution Flow

### CommandRegistry

**`src/ui/commands/registry.ts:282-410`**

The `CommandRegistry` class manages all registered slash commands:

**Methods**:
- `register(command: CommandDefinition)` — Register a command (lines 314-327)
- `unregister(name: string)` — Remove a command (lines 334-341)
- `get(name: string)` — Get command by name or alias (lines 348-359)
- `has(name: string)` — Check if command exists (lines 366-368)
- `search(query: string)` — Find commands matching prefix (lines 375-382)
- `all()` — Get all commands (lines 389-391)
- `clear()` — Remove all commands (lines 398-400)

**Internal State** (lines 285-286):
```typescript
private commands = new Map<string, CommandDefinition>();
private aliases = new Map<string, string>();
```

**Global Instance** (lines 413-414):
```typescript
export const globalRegistry = new CommandRegistry();
```

All command registration functions (builtin, workflows, agents, skills) use this single global instance.

### CommandDefinition Interface

**`src/ui/commands/registry.ts:261-276`**
```typescript
export interface CommandDefinition {
  /** Primary command name (without leading slash) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Command category for grouping */
  category: CommandCategory;
  /** Function to execute the command */
  execute: (args: string, context: CommandContext) => CommandResult | Promise<CommandResult>;
  /** Alternative names for the command */
  aliases?: string[];
  /** Whether to hide from autocomplete list */
  hidden?: boolean;
  /** Hint text showing expected arguments (e.g., "[model]", "PROMPT [--yolo]") */
  argumentHint?: string;
}
```

**Categories** (line 256):
```typescript
export type CommandCategory = "builtin" | "workflow" | "skill" | "agent" | "file" | "folder";
```

### CommandContext Interface

**`src/ui/commands/registry.ts:75-168`**

The execution context passed to command handlers:

**Key Fields**:
- `session: Session | null` — Active SDK session (line 77)
- `state: CommandContextState` — UI state (line 79)
- `agentType?: AgentType` — Current agent type (claude/opencode/copilot) (line 157)
- `modelOps?: ModelOperations` — Model management interface (line 159)

**Message Sending**:
- `sendMessage(content: string)` — Send message normally (line 88)
- `sendSilentMessage(content, options?)` — Send without user message display (line 93)
- `streamAndWait(prompt, options?)` — Send and wait for completion (line 122)

**Sub-agent Spawning**:
- `spawnSubagent(options)` — Spawn single sub-agent serially (line 101)
- `spawnSubagentParallel(agents, abortSignal?)` — Spawn multiple sub-agents concurrently (line 110)

**UI Updates**:
- `addMessage(role, content)` — Add message to chat (line 81)
- `setStreaming(streaming)` — Set streaming state (line 83)
- `setTodoItems(items)` — Update task list (line 131)
- `updateWorkflowState(update)` — Update workflow state (line 155)

**Ralph-Specific**:
- `setRalphSessionDir(dir)` — Set workflow session directory (line 135)
- `setRalphSessionId(id)` — Set workflow session ID (line 139)
- `setRalphTaskIds(ids)` — Set known task IDs for persistence guard (line 145)

**User Interaction**:
- `waitForUserInput()` — Block until user submits a prompt (line 151)
- `clearContext()` — Destroy session and clear messages (line 127)

### CommandResult Interface

**`src/ui/commands/registry.ts:220-251`**

Return value from command execution:

**Core Fields**:
- `success: boolean` — Whether command succeeded (line 222)
- `message?: string` — Optional message to display (line 224)
- `stateUpdate?: Partial<CommandContextState>` — State changes to apply (line 226)

**Session Control**:
- `clearMessages?: boolean` — Clear chat messages (line 228)
- `destroySession?: boolean` — Destroy SDK session (line 230)
- `shouldExit?: boolean` — Exit application (line 232)

**UI Actions**:
- `showModelSelector?: boolean` — Show model picker (line 234)
- `themeChange?: "dark" | "light" | "toggle"` — Theme to switch to (line 236)
- `showMcpOverlay?: boolean` — Show MCP server dialog (line 244)
- `mcpSnapshot?: McpSnapshotView` — MCP server list data (line 248)
- `skillLoaded?: string` — Skill name if loaded (line 240)

**Workflow State**:
- `compactionSummary?: string` — Summary text for Ctrl+O history (line 238)
- `modelDisplayName?: string` — Model name for header update (line 250)

### Execution Flow (Example: /ralph)

1. **User Input**: User types `/ralph "implement login feature"` in TUI
2. **Command Parsing**: TUI extracts command name (`ralph`) and args (`"implement login feature"`)
3. **Command Lookup**: TUI calls `globalRegistry.get("ralph")` to get `CommandDefinition`
4. **Context Construction**: TUI builds `CommandContext` with current session, state, and helpers
5. **Command Execution**: TUI calls `command.execute(args, context)` (async)
6. **Ralph Handler**:
   - Parses args using `parseRalphArgs()` (line 602)
   - Initializes workflow session (line 620)
   - Streams Step 1: Task decomposition (lines 637-648)
   - Saves tasks to disk (line 654)
   - Spawns workers in parallel loop (lines 690-754)
   - Spawns reviewer for completed tasks (lines 783-786)
   - Re-invokes ralph with fix spec if needed (lines 824-949)
7. **Result Handling**: TUI processes `CommandResult`, applying state updates and displaying messages
8. **Session Completion**: TUI calls `completeSession(sessionId)` when workflow finishes

---

## Type Definitions

### Key Types Summary

| Type | File | Lines | Description |
|------|------|-------|-------------|
| `WorkflowMetadata` | `workflow-commands.ts` | 84-97 | Metadata for a workflow command |
| `RalphCommandArgs` | `workflow-commands.ts` | 60-62 | Parsed arguments for /ralph |
| `WorkflowSession` | `workflows/session.ts` | N/A | Active workflow session state |
| `CommandDefinition` | `registry.ts` | 261-276 | Definition of a slash command |
| `CommandContext` | `registry.ts` | 75-168 | Execution context for commands |
| `CommandResult` | `registry.ts` | 220-251 | Return value from command |
| `CommandCategory` | `registry.ts` | 256 | Command grouping category |
| `AgentInfo` | `agent-commands.ts` | 81-90 | Lightweight agent metadata |
| `AgentSource` | `agent-commands.ts` | 63 | Agent definition source (project/user) |
| `DiscoveredAgentFile` | `agent-commands.ts` | 68-75 | Discovered agent file info |
| `SubagentEntry` | `subagent-registry.ts` | 18-22 | Registry entry for an agent |
| `SubagentTypeRegistry` | `subagent-registry.ts` | 28-50 | Name-based agent lookup registry |
| `WorkflowResolver` | `nodes.ts` | 1104 | Workflow name → compiled graph |
| `CompiledSubgraph<TSubState>` | `nodes.ts` | 1039-1041 | Executable subgraph interface |
| `SubgraphRef<TSubState>` | `nodes.ts` | 1049-1051 | Subgraph reference (object or name) |
| `SubgraphNodeConfig<TState, TSubState>` | `nodes.ts` | 1059-1098 | Configuration for subgraph node |
| `AgentNodeAgentType` | `nodes.ts` | 44 | Agent types: "claude" \| "opencode" \| "copilot" |
| `ClientProvider` | `nodes.ts` | 107 | Function returning SDK client |

### State Interfaces

**CommandContextState** (`registry.ts:185-215`):
```typescript
export interface CommandContextState {
  isStreaming: boolean;
  messageCount: number;
  workflowActive?: boolean;
  workflowType?: string | null;
  initialPrompt?: string | null;
  currentNode?: string | null;
  iteration?: number;
  maxIterations?: number;
  featureProgress?: FeatureProgressState | null;
  pendingApproval?: boolean;
  specApproved?: boolean;
  feedback?: string | null;
  ralphConfig?: {
    userPrompt: string | null;
    sessionId?: string;
  };
}
```

**FeatureProgressState** (`registry.ts:173-180`):
```typescript
export interface FeatureProgressState {
  completed: number;
  total: number;
  currentFeature?: string;
}
```

---

## Implementation Notes

### Dependency Injection Pattern

The system uses **global setters** for dependency injection to avoid circular dependencies:

- `setClientProvider(provider)` — Inject SDK client factory for agent nodes
- `setWorkflowResolver(resolver)` — Inject workflow resolver for subgraph nodes
- `setSubagentRegistry(registry)` — Inject sub-agent registry (though typically used via `getSubagentRegistry()`)

This pattern is used instead of passing dependencies through constructor parameters, making it easier to decouple modules.

### Module-Level State

Several modules use module-level variables for singleton state:

- `loadedWorkflows` in `workflow-commands.ts` (line 304) — Dynamically loaded workflows
- `activeSessions` in `workflow-commands.ts` (line 104) — Active workflow sessions
- `globalClientProvider` in `nodes.ts` (line 113) — Agent client provider
- `globalWorkflowResolver` in `nodes.ts` (line 1110) — Workflow resolver
- `globalSubagentRegistry` in `subagent-registry.ts` (line 56) — Sub-agent registry
- `globalRegistry` in `registry.ts` (line 413) — Command registry

This approach simplifies initialization and avoids passing dependencies through long call chains.

### Atomic File Writes

The `atomicWrite()` helper in `workflow-commands.ts` (lines 134-164) ensures task persistence integrity:

1. Writes to temp file in same directory (line 140)
2. Atomically renames temp to target (line 147)
3. Cleans up temp file on error (lines 149-156)

This guarantees that readers (e.g., file watchers) never see partially written data.

### Priority Resolution

Both workflows and agents use **priority-based override semantics**:

- **Workflows**: local > global > builtin
- **Agents**: project > user

The discovery functions scan in order and use `Map` or `Set` to deduplicate by name, with later entries overriding earlier ones.

### Error Handling

The workflow discovery and registration system is designed to be resilient:

- Discovery failures log warnings but don't crash (e.g., `workflow-commands.ts:360-362`)
- Agent parsing failures skip the file silently (e.g., `agent-commands.ts:221-224`)
- Missing directories return empty arrays (e.g., `agent-commands.ts:148-150`)
- Duplicate registrations are idempotent via `has()` checks

This ensures that malformed or missing config files don't break the application.

---

## Initialization Checklist

To properly initialize the workflow discovery and resolver system:

1. **Register builtin commands**:
   ```typescript
   import { registerBuiltinCommands } from "./ui/commands/builtin-commands";
   registerBuiltinCommands();
   ```

2. **Load and register workflows**:
   ```typescript
   import { loadWorkflowsFromDisk, registerWorkflowCommands } from "./ui/commands/workflow-commands";
   await loadWorkflowsFromDisk();
   registerWorkflowCommands();
   ```

3. **Register agent commands**:
   ```typescript
   import { registerAgentCommands } from "./ui/commands/agent-commands";
   await registerAgentCommands();
   ```

4. **Populate sub-agent registry**:
   ```typescript
   import { populateSubagentRegistry } from "./graph/subagent-registry";
   await populateSubagentRegistry();
   ```

5. **Set workflow resolver** (if using subgraph nodes):
   ```typescript
   import { setWorkflowResolver } from "./graph/nodes";
   import { getWorkflowMetadata } from "./ui/commands/workflow-commands";
   
   setWorkflowResolver((name) => {
     const metadata = getWorkflowMetadata(name);
     if (!metadata) return null;
     // Return compiled graph for this workflow
     return compileWorkflow(metadata);
   });
   ```

6. **Set client provider** (for agent nodes):
   ```typescript
   import { setClientProvider } from "./graph/nodes";
   
   setClientProvider((agentType) => {
     // Return appropriate SDK client
     return sdkClients[agentType] ?? null;
   });
   ```

---

## References

- **Workflow Commands**: `src/ui/commands/workflow-commands.ts`
- **Builtin Commands**: `src/ui/commands/builtin-commands.ts`
- **Agent Commands**: `src/ui/commands/agent-commands.ts`
- **Command Registry**: `src/ui/commands/registry.ts`
- **Graph Nodes**: `src/graph/nodes.ts`
- **Sub-agent Registry**: `src/graph/subagent-registry.ts`
- **Copilot Config**: `src/config/copilot-manual.ts`
- **Workflow Session**: `src/workflows/session.ts`

---

*This documentation describes the implementation as it exists at the time of writing. No evaluation, recommendations, or architectural critiques are included — this is purely descriptive technical documentation.*
