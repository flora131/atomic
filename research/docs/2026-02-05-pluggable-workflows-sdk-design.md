---
date: 2026-02-05 01:34:54 UTC
researcher: Claude Opus 4.5
git_commit: 676408d949ed82b9a4ec5bcc676ac4a24b622073
branch: lavaman131/feature/tui
repository: atomic
topic: "Pluggable Workflows SDK Design for atomic/workflows"
tags: [research, sdk, workflows, commands, skills, agents, cli-hints, ralph, providers]
status: complete
last_updated: 2026-02-05
last_updated_by: Claude Opus 4.5
---

# Pluggable Workflows SDK Design Research

## Research Question

Design a pluggable SDK (`atomic/workflows`) that:
1. Parses commands, sub-agents, and skills from `.opencode`, `.claude`, and `.github` configs
2. Allows referencing these entities by name in workflow graph nodes
3. Generalizes the Ralph loop to repeat arbitrary nodes until criteria or tasks.json completion
4. Adds CLI hints for slash commands with argument suggestions
5. Supports all providers: Copilot, OpenCode, Claude

## Summary

This research documents the current Atomic codebase architecture and synthesizes findings from OpenCode SDK, GitHub Copilot SDK, and Claude Agent SDK to design a pluggable workflow SDK. The key design goals are:

1. **Unified entity registry** that normalizes commands/skills/agents from all three provider formats
2. **Name-based node references** allowing workflows to reference `agent:debugger` or `skill:commit` by name
3. **Generalized task loop** replacing `feature-list.json` with `tasks.json` for any repeatable workflow
4. **CLI hints system** with greyed-out argument hints that appear/disappear based on user typing
5. **Provider-agnostic execution** where the same workflow definition runs against any backend

---

## Table of Contents

1. [Current Architecture](#current-architecture)
2. [Provider Config Formats](#provider-config-formats)
3. [SDK Design: Unified Entity Registry](#sdk-design-unified-entity-registry)
4. [Workflow Graph Node References](#workflow-graph-node-references)
5. [Generalized Task Loop (Ralph → Tasks)](#generalized-task-loop)
6. [CLI Hints System](#cli-hints-system)
7. [External SDK Patterns](#external-sdk-patterns)
8. [Implementation Roadmap](#implementation-roadmap)

---

## Current Architecture

### Graph Execution Engine

**Location**: `src/graph/`

The existing graph engine provides a solid foundation:

| Component | File | Purpose |
|-----------|------|---------|
| Types | `src/graph/types.ts` | NodeType, BaseState, ExecutionContext |
| Builder | `src/graph/builder.ts` | Fluent API: `.start()`, `.then()`, `.loop()`, `.if()` |
| Executor | `src/graph/compiled.ts` | BFS execution with retry, checkpointing |
| Nodes | `src/graph/nodes.ts` | Factory functions: agentNode, toolNode, askUserNode |
| Ralph Nodes | `src/graph/nodes/ralph-nodes.ts` | Ralph-specific: initSession, implementFeature, checkCompletion |

**Node Types Supported** (`src/graph/types.ts:99`):
```typescript
type NodeType = "agent" | "tool" | "decision" | "wait" | "ask_user" | "subgraph" | "parallel";
```

### Command Registry System

**Location**: `src/ui/commands/`

Current registration pattern using singleton registry:

```typescript
// src/ui/commands/registry.ts:196-234
export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();
  private aliases: Map<string, string> = new Map();

  register(command: CommandDefinition): void { /* ... */ }
  get(nameOrAlias: string): CommandDefinition | undefined { /* ... */ }
  search(prefix: string): CommandDefinition[] { /* ... */ }
}

export const globalRegistry = new CommandRegistry();
```

**Command Categories** (`registry.ts:348-354`):
- `workflow` (priority 0) - e.g., `/ralph`
- `skill` (priority 1) - e.g., `/commit`, `/research-codebase`
- `agent` (priority 2) - e.g., `/codebase-analyzer`, `/debugger`
- `builtin` (priority 3) - e.g., `/help`, `/clear`, `/model`
- `custom` (priority 4) - user-defined

### Current Autocomplete

**Location**: `src/ui/components/autocomplete.tsx`

The autocomplete currently:
- Triggers when input starts with `/`
- Filters using `globalRegistry.search(prefix)`
- Shows dropdown with command name and description
- Navigation: Up/Down arrows, Tab to complete, Enter to execute

**Missing**: No argument hints after command name is typed.

---

## Provider Config Formats

### Format Comparison Table

| Feature | Claude (`.claude/`) | OpenCode (`.opencode/`) | Copilot (`.github/`) |
|---------|---------------------|-------------------------|----------------------|
| **Commands** | `commands/*.md` | Inline in `opencode.json` | `skills/*/SKILL.md` |
| **Skills** | `skills/*/SKILL.md` | `skills/*/SKILL.md` | `skills/*/SKILL.md` |
| **Agents** | `agents/*.md` | `agents/*.md` | `agents/*.md` |
| **Name field** | In frontmatter | Derived from filename | In frontmatter |
| **Model format** | Short (`opus`) | Full (`anthropic/claude-opus-4-5`) | Short (`claude-opus-4-5`) |
| **Tools format** | Comma-separated string | Object `{tool: boolean}` | JSON array |
| **Argument hints** | `argument-hint` field | N/A | N/A |

### Claude SKILL.md Format

```yaml
---
name: commit
description: Create conventional commits
argument-hint: [message] | --amend
allowed-tools: Bash(git add:*), Bash(git status:*)
model: opus
---
Instructions here with $ARGUMENTS placeholder...
```

### OpenCode Agent Format

```yaml
---
description: Debugging specialist
mode: subagent
model: anthropic/claude-opus-4-5-high
tools:
  write: true
  edit: true
  bash: true
---
Agent prompt here...
```

### GitHub SKILL.md Format

```yaml
---
name: commit
description: Create conventional commits
---
Instructions here with $ARGUMENTS placeholder...
```

### Normalization Requirements

The SDK must normalize these formats into a unified structure:

```typescript
interface UnifiedEntity {
  type: "command" | "skill" | "agent";
  name: string;                    // Canonical name
  description: string;
  aliases?: string[];
  prompt: string;                  // The instruction content
  tools?: string[];                // Normalized to string array
  model?: "opus" | "sonnet" | "haiku" | "inherit";
  argumentHint?: string;           // For CLI hints
  source: {
    provider: "claude" | "opencode" | "copilot" | "atomic";
    location: "project" | "user" | "builtin";
    path?: string;
  };
}
```

---

## SDK Design: Unified Entity Registry

### Package Structure

```
atomic/
└── workflows/
    ├── index.ts              # Main exports
    ├── registry/
    │   ├── entity-registry.ts    # Unified registry for commands/skills/agents
    │   ├── parsers/
    │   │   ├── claude-parser.ts      # Parse .claude/ directory
    │   │   ├── opencode-parser.ts    # Parse .opencode/ directory
    │   │   ├── copilot-parser.ts     # Parse .github/ directory
    │   │   └── atomic-parser.ts      # Parse .atomic/ directory
    │   └── normalizers/
    │       ├── model-normalizer.ts   # Normalize model strings
    │       └── tools-normalizer.ts   # Normalize tools formats
    ├── graph/
    │   ├── node-resolvers.ts     # Resolve name references to nodes
    │   └── task-loop.ts          # Generalized task iteration
    ├── hints/
    │   └── hint-provider.ts      # CLI hint generation
    └── types.ts                  # Shared types
```

### EntityRegistry API

```typescript
// atomic/workflows/registry/entity-registry.ts

export interface EntityRegistry {
  // Registration
  register(entity: UnifiedEntity): void;
  registerFromProvider(provider: ProviderType, basePath: string): Promise<void>;

  // Lookup by name (case-insensitive, supports aliases)
  getCommand(name: string): UnifiedEntity | undefined;
  getSkill(name: string): UnifiedEntity | undefined;
  getAgent(name: string): UnifiedEntity | undefined;

  // Search for autocomplete
  searchCommands(prefix: string): UnifiedEntity[];
  searchSkills(prefix: string): UnifiedEntity[];
  searchAgents(prefix: string): UnifiedEntity[];

  // Get all entities of a type
  allCommands(): UnifiedEntity[];
  allSkills(): UnifiedEntity[];
  allAgents(): UnifiedEntity[];

  // Get hints for a command/skill
  getArgumentHint(name: string): string | undefined;
}

export function createEntityRegistry(): EntityRegistry {
  const entities = new Map<string, UnifiedEntity>();
  const aliases = new Map<string, string>();

  return {
    register(entity) {
      const key = `${entity.type}:${entity.name.toLowerCase()}`;
      entities.set(key, entity);

      if (entity.aliases) {
        for (const alias of entity.aliases) {
          aliases.set(`${entity.type}:${alias.toLowerCase()}`, key);
        }
      }
    },

    getCommand(name) {
      return this.get("command", name);
    },

    // ... other methods
  };
}

// Global singleton
export const entityRegistry = createEntityRegistry();
```

### Parser Interface

```typescript
// atomic/workflows/registry/parsers/types.ts

export interface ProviderParser {
  /** Provider identifier */
  provider: ProviderType;

  /** Parse commands from provider config */
  parseCommands(basePath: string): Promise<UnifiedEntity[]>;

  /** Parse skills from provider config */
  parseSkills(basePath: string): Promise<UnifiedEntity[]>;

  /** Parse agents from provider config */
  parseAgents(basePath: string): Promise<UnifiedEntity[]>;
}
```

### Claude Parser Example

```typescript
// atomic/workflows/registry/parsers/claude-parser.ts

import { parseMarkdownFrontmatter } from "./utils";
import { normalizeModel } from "../normalizers/model-normalizer";

export const claudeParser: ProviderParser = {
  provider: "claude",

  async parseCommands(basePath: string): Promise<UnifiedEntity[]> {
    const commandsDir = join(basePath, ".claude", "commands");
    if (!existsSync(commandsDir)) return [];

    const files = readdirSync(commandsDir).filter(f => f.endsWith(".md"));
    const entities: UnifiedEntity[] = [];

    for (const file of files) {
      const content = readFileSync(join(commandsDir, file), "utf-8");
      const { frontmatter, body } = parseMarkdownFrontmatter(content);

      entities.push({
        type: "command",
        name: frontmatter.name || basename(file, ".md"),
        description: frontmatter.description || "",
        aliases: frontmatter.aliases,
        prompt: body,
        tools: parseAllowedTools(frontmatter["allowed-tools"]),
        model: normalizeModel(frontmatter.model),
        argumentHint: frontmatter["argument-hint"],
        source: {
          provider: "claude",
          location: "project",
          path: join(commandsDir, file),
        },
      });
    }

    return entities;
  },

  async parseSkills(basePath: string): Promise<UnifiedEntity[]> {
    const skillsDir = join(basePath, ".claude", "skills");
    // Similar implementation...
  },

  async parseAgents(basePath: string): Promise<UnifiedEntity[]> {
    const agentsDir = join(basePath, ".claude", "agents");
    // Similar implementation...
  },
};
```

### Initialization Flow

```typescript
// atomic/workflows/index.ts

export async function initializeWorkflowsSDK(options?: {
  providers?: ProviderType[];
  projectPath?: string;
  userPath?: string;
}): Promise<EntityRegistry> {
  const providers = options?.providers ?? ["claude", "opencode", "copilot", "atomic"];
  const projectPath = options?.projectPath ?? process.cwd();
  const userPath = options?.userPath ?? homedir();

  // Register built-in entities first (lowest priority)
  registerBuiltinEntities(entityRegistry);

  // Parse user-global configs (medium priority)
  for (const provider of providers) {
    const parser = getParser(provider);
    await parser.parseCommands(userPath).then(e => e.forEach(entityRegistry.register));
    await parser.parseSkills(userPath).then(e => e.forEach(entityRegistry.register));
    await parser.parseAgents(userPath).then(e => e.forEach(entityRegistry.register));
  }

  // Parse project-local configs (highest priority - overrides)
  for (const provider of providers) {
    const parser = getParser(provider);
    await parser.parseCommands(projectPath).then(e => e.forEach(entityRegistry.register));
    await parser.parseSkills(projectPath).then(e => e.forEach(entityRegistry.register));
    await parser.parseAgents(projectPath).then(e => e.forEach(entityRegistry.register));
  }

  return entityRegistry;
}
```

---

## Workflow Graph Node References

### Design Goal

Allow workflow definitions to reference commands, skills, and agents by name:

```typescript
// Example workflow using name-based references
const workflow = graph<MyState>()
  .start(skillNode({ skill: "research-codebase" }))
  .then(agentNode({ agent: "codebase-analyzer" }))
  .then(commandNode({ command: "commit" }))
  .end()
  .compile();
```

### Node Resolver

```typescript
// atomic/workflows/graph/node-resolvers.ts

export interface SkillNodeConfig<TState> {
  id?: NodeId;
  skill: string;  // Name reference
  args?: string | ((state: TState) => string);
  model?: ModelSpec;
}

export function skillNode<TState extends BaseState>(
  config: SkillNodeConfig<TState>
): NodeDefinition<TState> {
  return {
    id: config.id ?? `skill-${config.skill}`,
    type: "agent",
    model: config.model,
    execute: async (ctx): Promise<NodeResult<TState>> => {
      // Resolve skill from registry
      const skill = entityRegistry.getSkill(config.skill);
      if (!skill) {
        throw new Error(`Skill not found: ${config.skill}`);
      }

      // Get args
      const args = typeof config.args === "function"
        ? config.args(ctx.state)
        : config.args ?? "";

      // Expand $ARGUMENTS placeholder
      const prompt = skill.prompt.replace(/\$ARGUMENTS/g, args || "[no arguments]");

      // Execute via agent
      const client = getClientProvider()();
      const session = await client.createSession({
        model: config.model ?? skill.model,
        tools: skill.tools,
      });

      try {
        const response = await session.send(prompt);
        return {
          stateUpdate: {
            outputs: {
              ...ctx.state.outputs,
              [config.id ?? `skill-${config.skill}`]: response.content,
            },
          } as Partial<TState>,
        };
      } finally {
        await session.destroy();
      }
    },
  };
}

export function agentNode<TState extends BaseState>(
  config: AgentNodeConfig<TState> | { agent: string; prompt?: string | ((state: TState) => string) }
): NodeDefinition<TState> {
  // If string reference, resolve from registry
  if ("agent" in config && typeof config.agent === "string") {
    const agentDef = entityRegistry.getAgent(config.agent);
    if (!agentDef) {
      throw new Error(`Agent not found: ${config.agent}`);
    }

    return createAgentNodeFromDefinition(agentDef, config);
  }

  // Otherwise use existing agentNode implementation
  return existingAgentNode(config);
}

export function commandNode<TState extends BaseState>(
  config: { id?: NodeId; command: string; args?: string | ((state: TState) => string) }
): NodeDefinition<TState> {
  return {
    id: config.id ?? `command-${config.command}`,
    type: "tool",
    execute: async (ctx): Promise<NodeResult<TState>> => {
      const command = entityRegistry.getCommand(config.command);
      if (!command) {
        throw new Error(`Command not found: ${config.command}`);
      }

      const args = typeof config.args === "function"
        ? config.args(ctx.state)
        : config.args ?? "";

      const prompt = command.prompt.replace(/\$ARGUMENTS/g, args);

      // Execute command prompt
      // ... similar to skillNode
    },
  };
}
```

### Usage in Custom Workflows

```typescript
// .atomic/workflows/code-review.ts

import { graph, skillNode, agentNode, decisionNode } from "atomic/workflows";

export const name = "code-review";
export const description = "Multi-stage code review with quality and security checks";
export const aliases = ["review"];

interface CodeReviewState extends BaseState {
  targetPath: string;
  qualityIssues: string[];
  securityIssues: string[];
  approved: boolean;
}

export default function createWorkflow() {
  return graph<CodeReviewState>()
    .start(skillNode({
      skill: "research-codebase",  // References .claude/skills/research-codebase
      args: (state) => state.targetPath,
    }))
    .then(agentNode({
      agent: "codebase-analyzer",  // References .claude/agents/codebase-analyzer
      prompt: (state) => `Analyze code quality in ${state.targetPath}`,
    }))
    .then(agentNode({
      agent: "debugger",           // References .opencode/agents/debugger
      prompt: (state) => `Check for security issues in ${state.targetPath}`,
    }))
    .then(decisionNode({
      id: "approval-check",
      routes: [
        { condition: (s) => s.qualityIssues.length === 0 && s.securityIssues.length === 0, target: "approved" },
        { condition: () => true, target: "needs-fixes" },
      ],
    }))
    .end()
    .compile();
}
```

---

## Generalized Task Loop

### Rename: feature-list.json → tasks.json

The current Ralph loop uses `research/feature-list.json` for tracking features. Generalizing this to `tasks.json` makes the concept reusable for any iterative workflow.

### Tasks Schema

```typescript
// atomic/workflows/graph/task-loop.ts

export interface Task {
  id: string;
  name: string;
  description?: string;
  status: "pending" | "in_progress" | "passing" | "failing" | "skipped";
  priority?: number;
  dependencies?: string[];  // Task IDs that must complete first
  metadata?: Record<string, unknown>;
}

export interface TasksFile {
  version: "1.0";
  tasks: Task[];
  metadata?: {
    createdAt: string;
    updatedAt: string;
    source?: string;  // e.g., "spec", "manual", "generated"
  };
}

// Example tasks.json
const exampleTasks: TasksFile = {
  version: "1.0",
  tasks: [
    { id: "1", name: "Add user authentication", status: "pending" },
    { id: "2", name: "Create login page", status: "pending", dependencies: ["1"] },
    { id: "3", name: "Add password reset", status: "pending", dependencies: ["1"] },
  ],
  metadata: {
    createdAt: "2026-02-05T00:00:00Z",
    updatedAt: "2026-02-05T00:00:00Z",
    source: "spec",
  },
};
```

### TaskLoop Node

```typescript
// atomic/workflows/graph/task-loop.ts

export interface TaskLoopConfig<TState extends BaseState> {
  id?: NodeId;

  /** Path to tasks.json file */
  tasksPath?: string | ((state: TState) => string);

  /** Node(s) to execute for each task */
  taskNodes: NodeDefinition<TState> | NodeDefinition<TState>[];

  /** Optional node to run before each iteration (e.g., clear context) */
  preIterationNode?: NodeDefinition<TState>;

  /** Completion criteria */
  until?: (state: TState, tasks: Task[]) => boolean;

  /** Maximum iterations (0 = unlimited) */
  maxIterations?: number;

  /** How to select next task */
  taskSelector?: (tasks: Task[]) => Task | undefined;
}

export function taskLoopNode<TState extends TaskLoopState>(
  config: TaskLoopConfig<TState>
): NodeDefinition<TState> {
  const {
    tasksPath = "research/tasks.json",
    taskNodes,
    preIterationNode,
    until = defaultCompletionCheck,
    maxIterations = 100,
    taskSelector = defaultTaskSelector,
  } = config;

  return {
    id: config.id ?? "task-loop",
    type: "tool",
    execute: async (ctx): Promise<NodeResult<TState>> => {
      // Load tasks
      const path = typeof tasksPath === "function" ? tasksPath(ctx.state) : tasksPath;
      const tasks = await loadTasks(path);

      // Check completion
      if (until(ctx.state, tasks)) {
        return { stateUpdate: { shouldContinue: false } as Partial<TState> };
      }

      // Check max iterations
      if (maxIterations > 0 && ctx.state.iteration >= maxIterations) {
        return {
          stateUpdate: {
            shouldContinue: false,
            maxIterationsReached: true,
          } as Partial<TState>,
        };
      }

      // Select next task
      const nextTask = taskSelector(tasks);
      if (!nextTask) {
        return { stateUpdate: { shouldContinue: false, allTasksComplete: true } as Partial<TState> };
      }

      // Update task status
      nextTask.status = "in_progress";
      await saveTasks(path, tasks);

      return {
        stateUpdate: {
          currentTask: nextTask,
          iteration: (ctx.state.iteration ?? 0) + 1,
          shouldContinue: true,
        } as Partial<TState>,
      };
    },
  };
}

// Default completion: all tasks passing or no pending tasks
function defaultCompletionCheck<TState extends TaskLoopState>(
  _state: TState,
  tasks: Task[]
): boolean {
  const pending = tasks.filter(t => t.status === "pending");
  const failing = tasks.filter(t => t.status === "failing");
  return pending.length === 0 && failing.length === 0;
}

// Default selector: first pending task respecting dependencies
function defaultTaskSelector(tasks: Task[]): Task | undefined {
  const completedIds = new Set(
    tasks.filter(t => t.status === "passing").map(t => t.id)
  );

  return tasks.find(t => {
    if (t.status !== "pending") return false;
    if (!t.dependencies) return true;
    return t.dependencies.every(dep => completedIds.has(dep));
  });
}
```

### Usage Example: Generalized Ralph

```typescript
// .atomic/workflows/task-implementer.ts

import { graph, taskLoopNode, clearContextNode, skillNode } from "atomic/workflows";

export const name = "implement-tasks";
export const description = "Iterate through tasks.json and implement each one";
export const aliases = ["tasks", "loop"];

interface TaskImplementerState extends TaskLoopState {
  tasksPath: string;
}

export default function createWorkflow(config?: { tasksPath?: string }) {
  const tasksPath = config?.tasksPath ?? "research/tasks.json";

  return graph<TaskImplementerState>()
    .start(initSessionNode({ tasksPath }))
    .loop(
      [
        clearContextNode({ id: "clear-context" }),
        skillNode({
          skill: "implement-feature",
          args: (state) => JSON.stringify(state.currentTask),
        }),
      ],
      {
        until: (state) => !state.shouldContinue,
        maxIterations: 100,
      }
    )
    .then(completionNode())
    .end()
    .compile();
}
```

### Yolo Mode (Criteria-Based Loop)

```typescript
// For freestyle loops without tasks.json

export function criteriaLoopNode<TState extends BaseState>(
  config: {
    id?: NodeId;
    taskNodes: NodeDefinition<TState>[];
    completionSignal?: string;  // e.g., "COMPLETE"
    maxIterations?: number;
  }
): NodeDefinition<TState> {
  return {
    id: config.id ?? "criteria-loop",
    type: "tool",
    execute: async (ctx): Promise<NodeResult<TState>> => {
      // Check for completion signal in last output
      const lastOutput = getLastAgentOutput(ctx.state);
      if (config.completionSignal && lastOutput?.includes(config.completionSignal)) {
        return { stateUpdate: { shouldContinue: false, criteriaComplete: true } as Partial<TState> };
      }

      // Check max iterations
      if (config.maxIterations && ctx.state.iteration >= config.maxIterations) {
        return { stateUpdate: { shouldContinue: false, maxIterationsReached: true } as Partial<TState> };
      }

      return {
        stateUpdate: {
          iteration: (ctx.state.iteration ?? 0) + 1,
          shouldContinue: true,
        } as Partial<TState>,
      };
    },
  };
}
```

---

## CLI Hints System

### Design Goals

1. **Greyed-out hint text** appears after typing a command name
2. **Hint disappears** when user starts typing arguments
3. **Hint reappears** when user backspaces to command name only
4. **Workflows with inputs** automatically get hints from their argument definitions

### Hint Provider

```typescript
// atomic/workflows/hints/hint-provider.ts

export interface CommandHint {
  command: string;
  hint: string;  // e.g., "[message] | --amend"
  examples?: string[];
}

export function getCommandHint(commandName: string): string | undefined {
  // First check entity registry for argument-hint
  const entity = entityRegistry.getCommand(commandName)
    ?? entityRegistry.getSkill(commandName);

  if (entity?.argumentHint) {
    return entity.argumentHint;
  }

  // Fallback to built-in hints
  return BUILTIN_HINTS[commandName.toLowerCase()];
}

const BUILTIN_HINTS: Record<string, string> = {
  "ralph": "--yolo <prompt> | --resume <session-id> | --max-iterations <n>",
  "commit": "[message] | --amend",
  "research-codebase": "<question or topic>",
  "create-spec": "<feature description>",
  "implement-feature": "[feature-id]",
  "create-gh-pr": "[title]",
  "explain-code": "<file-path> [function-name]",
  "model": "select | refresh | list [provider] | <model-name>",
  "compact": "[focus-instructions]",
  "resume": "[session-id]",
};
```

### Autocomplete Component Enhancement

```typescript
// src/ui/components/autocomplete.tsx (enhanced)

interface AutocompleteProps {
  input: string;
  visible: boolean;
  selectedIndex: number;
  onSelect: (command: CommandDefinition) => void;
  onIndexChange: (index: number) => void;
  maxSuggestions?: number;
}

export function Autocomplete({ input, visible, ... }: AutocompleteProps) {
  const { theme } = useTheme();

  // Parse input to detect command vs arguments
  const { commandName, hasArgs, argsText } = parseCommandInput(input);

  // Get suggestions if still typing command name
  const suggestions = useMemo(() => {
    if (!visible || hasArgs) return [];
    return globalRegistry.search(commandName);
  }, [commandName, visible, hasArgs]);

  // Get hint if command is complete but no args yet
  const hint = useMemo(() => {
    if (!visible || hasArgs) return null;
    if (suggestions.length === 1 && suggestions[0].name === commandName) {
      return getCommandHint(commandName);
    }
    return null;
  }, [commandName, hasArgs, suggestions, visible]);

  if (!visible) return null;

  // Show hint inline with command
  if (hint && suggestions.length <= 1) {
    return (
      <box paddingLeft={2}>
        <text fg={theme.muted}>
          {hint}
        </text>
      </box>
    );
  }

  // Show suggestion dropdown
  if (suggestions.length > 0) {
    return (
      <scrollbox height={Math.min(suggestions.length, maxSuggestions ?? 8)}>
        {suggestions.map((cmd, i) => (
          <SuggestionRow
            key={cmd.name}
            command={cmd}
            isSelected={i === selectedIndex}
            hint={getCommandHint(cmd.name)}
          />
        ))}
      </scrollbox>
    );
  }

  return null;
}

function parseCommandInput(input: string): {
  commandName: string;
  hasArgs: boolean;
  argsText: string;
} {
  if (!input.startsWith("/")) {
    return { commandName: "", hasArgs: false, argsText: "" };
  }

  const withoutSlash = input.slice(1);
  const spaceIndex = withoutSlash.indexOf(" ");

  if (spaceIndex === -1) {
    return { commandName: withoutSlash, hasArgs: false, argsText: "" };
  }

  return {
    commandName: withoutSlash.slice(0, spaceIndex),
    hasArgs: true,
    argsText: withoutSlash.slice(spaceIndex + 1),
  };
}
```

### Enhanced Suggestion Row with Hint

```typescript
function SuggestionRow({
  command,
  isSelected,
  hint,
}: {
  command: CommandDefinition;
  isSelected: boolean;
  hint?: string;
}): React.ReactNode {
  const { theme } = useTheme();
  const fgColor = isSelected ? theme.accent : theme.foreground;
  const hintColor = theme.muted;

  return (
    <box flexDirection="row" width="100%" paddingLeft={2} paddingRight={2}>
      <box width={20}>
        <text fg={fgColor} attributes={isSelected ? 1 : undefined}>
          /{command.name}
        </text>
      </box>
      {hint && (
        <box width={25}>
          <text fg={hintColor}>
            {hint.length > 23 ? hint.slice(0, 20) + "..." : hint}
          </text>
        </box>
      )}
      <box flexGrow={1}>
        <text fg={isSelected ? fgColor : theme.muted}>
          {command.description}
        </text>
      </box>
    </box>
  );
}
```

### Hint Behavior State Machine

```
State: IDLE
  - User types "/" → SHOWING_SUGGESTIONS

State: SHOWING_SUGGESTIONS
  - User types more letters → Filter suggestions
  - User presses Tab → Complete to selected command → SHOWING_HINT
  - User presses Enter → Execute selected command → IDLE
  - User presses Space after valid command → SHOWING_HINT

State: SHOWING_HINT
  - User types any character → TYPING_ARGS (hint disappears)
  - User presses Enter → Execute command → IDLE
  - User presses Escape → IDLE

State: TYPING_ARGS
  - User backspaces to just command → SHOWING_HINT
  - User presses Enter → Execute command with args → IDLE
```

---

## External SDK Patterns

### OpenCode SDK Patterns

**Source**: DeepWiki research on `anomalyco/opencode`

Key patterns to adopt:

1. **Config Merging**: Configs are merged, not replaced. Later sources override earlier.
2. **Agent Modes**: `subagent` vs `primary` distinction for execution context.
3. **Agentic Loop**: Core execution via `SessionPrompt.loop()` with tool calls.
4. **Plugin System**: Hooks for `event`, `tool`, and lifecycle customization.

```typescript
// OpenCode pattern: Plugin with tool registration
export const MyPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "Custom tool",
        args: { foo: tool.schema.string() },
        async execute(args, context) {
          return `Result: ${args.foo}`;
        },
      }),
    },
  };
};
```

### GitHub Copilot SDK Patterns

**Source**: DeepWiki research on `github/copilot-sdk`

Key patterns to adopt:

1. **Session Hooks**: `onPreToolUse`, `onPostToolUse`, `onSessionStart`, `onErrorOccurred`
2. **Custom Tools**: `defineTool()` with Zod schema validation
3. **MCP Integration**: Local subprocess or remote HTTP servers
4. **Skill Directories**: `skillDirectories` config for loading skills

```typescript
// Copilot pattern: Tool definition with Zod
const getWeather = defineTool("get_weather", {
  description: "Get current weather",
  parameters: z.object({
    city: z.string().describe("City name"),
  }),
  handler: async ({ city }) => {
    return { city, temperature: "72°F", condition: "sunny" };
  },
});
```

### Claude Agent SDK Patterns

**Source**: WebFetch research on Claude Agent SDK v2

Key patterns to adopt:

1. **Session-based API**: `createSession()` → `send()`/`stream()` → `destroy()`
2. **Skills vs Commands**: Skills are model-invoked, commands are user-invoked
3. **Hook Events**: 11 hook types for comprehensive lifecycle control
4. **Plugin Namespacing**: `/plugin-name:command` for conflict resolution

```typescript
// Claude pattern: V2 session API
await using session = unstable_v2_createSession({ model: "sonnet" });
await session.send("Hello!");
for await (const msg of session.stream()) {
  if (msg.type === "assistant") console.log(msg.message.content);
}
```

---

## Implementation Roadmap

### Phase 1: Entity Registry (Week 1)

1. **Create `atomic/workflows/` package structure**
2. **Implement parsers for each provider**:
   - Claude parser for `.claude/commands`, `.claude/skills`, `.claude/agents`
   - OpenCode parser for `.opencode/opencode.json`, `.opencode/agents`
   - Copilot parser for `.github/skills`, `.github/agents`
   - Atomic parser for `.atomic/` (native format)
3. **Implement normalizers**:
   - Model normalizer: `anthropic/claude-opus-4-5` → `opus`
   - Tools normalizer: `{bash: true}` → `["bash"]`
4. **Create `EntityRegistry` with lookup by name**
5. **Update command registration to use entity registry**

### Phase 2: Graph Node Resolvers (Week 2)

1. **Create `skillNode()` factory** that resolves by name
2. **Create `agentNode()` overload** that accepts string name
3. **Create `commandNode()` factory** for command execution
4. **Update workflow resolver** to support name-based subgraph references
5. **Add tests for name resolution**

### Phase 3: Generalized Task Loop (Week 2-3)

1. **Define `tasks.json` schema** (rename from `feature-list.json`)
2. **Create `taskLoopNode()` factory**
3. **Create `criteriaLoopNode()` for yolo-style loops**
4. **Migrate Ralph workflow** to use new task loop
5. **Update `/create-feature-list` skill** to output `tasks.json`

### Phase 4: CLI Hints System (Week 3)

1. **Add `argumentHint` field** to `UnifiedEntity` type
2. **Create `HintProvider`** that resolves hints from registry
3. **Enhance `Autocomplete` component** with hint display
4. **Implement hint state machine** (show/hide based on typing)
5. **Add hints to built-in commands**

### Phase 5: Integration & Testing (Week 4)

1. **Integration tests** for cross-provider entity loading
2. **E2E tests** for workflow execution with name-based nodes
3. **Performance testing** for entity registry lookup
4. **Documentation** for SDK usage

---

## Code References

### Current Implementation Files

| File | Purpose |
|------|---------|
| `src/graph/types.ts:99` | NodeType definition |
| `src/graph/builder.ts:456-546` | Loop construction |
| `src/graph/nodes.ts:163-263` | agentNode factory |
| `src/graph/nodes/ralph-nodes.ts:905-1097` | implementFeatureNode |
| `src/ui/commands/registry.ts:196-405` | CommandRegistry class |
| `src/ui/commands/agent-commands.ts:1003-1104` | Frontmatter parsing |
| `src/ui/commands/agent-commands.ts:1117-1142` | Model normalization |
| `src/ui/commands/agent-commands.ts:1153-1169` | Tools normalization |
| `src/ui/components/autocomplete.tsx:146-235` | Autocomplete component |
| `src/workflows/ralph/workflow.ts:185-244` | Ralph workflow creation |
| `src/config/ralph.ts:70-77` | Ralph defaults |

### Related Research Documents

| Document | Topic |
|----------|-------|
| `research/docs/2026-02-03-custom-workflow-file-format.md` | Workflow file format |
| `research/docs/2026-01-31-workflow-config-semantics.md` | Config semantics |
| `research/docs/2026-01-31-claude-agent-sdk-research.md` | Claude SDK |
| `research/docs/2026-01-31-opencode-sdk-research.md` | OpenCode SDK |
| `research/docs/2026-01-31-github-copilot-sdk-research.md` | Copilot SDK |

---

## Open Questions

1. **Hot Reloading**: Should entity registry support hot-reloading when config files change?

2. **Validation**: Should workflow definitions be validated at compile time against entity registry?

3. **Cross-Provider Execution**: When a workflow references a Claude skill but runs on OpenCode, how should tool mappings work?

4. **Hint Localization**: Should hints support i18n for non-English users?

5. **Task Dependencies**: Should `tasks.json` support parallel task execution for independent tasks?
