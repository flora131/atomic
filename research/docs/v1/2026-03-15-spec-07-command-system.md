---
date: 2026-03-15 18:32:54 UTC
researcher: Claude Opus 4.6
git_commit: d3f22e2b5bf791dcc57580e001ac279c85390fce
branch: lavaman131/feature/code-cleanup
repository: code-cleanup
topic: "Spec 07: Command System - CLI commands, TUI slash commands, command registry"
tags: [spec, commands, cli, tui, slash-commands, registry, v2]
status: complete
last_updated: 2026-03-15
last_updated_by: Claude Opus 4.6
parent: 2026-03-15-atomic-v2-rebuild-spec-index.md
---

# Spec 07: Command System

## Current State

### Overview (4,925 lines)

```
commands/
├── cli/                            # CLI-mode commands (non-TUI)
│   ├── chat.ts                     # CLI chat mode
│   ├── chat/
│   │   ├── client.ts               # CLI chat client
│   │   ├── slash-commands.ts        # CLI slash commands
│   │   ├── auto-init.ts            # Auto-initialization
│   │   └── discovery-debug.ts      # Discovery debugging
│   ├── config.ts                   # Config management command
│   ├── init.ts                     # Init command
│   │   └── init/
│   │       ├── index.ts
│   │       ├── onboarding.ts
│   │       └── scm.ts
│   ├── update.ts                   # Update command
│   └── uninstall.ts                # Uninstall command
├── tui/                            # TUI-mode slash commands
│   ├── index.ts                    # Registration entry
│   ├── registry.ts                 # TUI command registry
│   ├── builtin-commands.ts         # /help, /clear, /exit, /model, etc.
│   ├── agent-commands.ts           # /claude, /opencode, /copilot
│   ├── skill-commands.ts           # /skill loading
│   ├── workflow-commands.ts        # /ralph, /workflow
│   ├── definition-integrity.ts     # Command definition validation
│   └── workflow-commands/
│       ├── tasks-watcher.ts        # Task status watching
│       ├── workflow-files.ts       # Workflow file loading
│       └── session.ts              # Workflow session management
├── core/                           # Shared command infrastructure
│   ├── types.ts                    # Command types
│   └── registry.ts                 # Core command registry
└── catalog/                        # Agent/skill discovery catalog
    ├── agents.ts                   # Agent catalog entry
    ├── agents/
    │   ├── discovery.ts            # Agent discovery
    │   ├── discovery-paths.ts      # Agent binary paths
    │   ├── index.ts
    │   ├── types.ts
    │   └── registration.ts
    ├── skills.ts                   # Skill catalog entry
    ├── skills/
    │   ├── discovery.ts            # Skill discovery
    │   ├── discovery-paths.ts      # Skill paths
    │   ├── index.ts
    │   ├── types.ts
    │   └── registration.ts
    └── shared/
        └── discovery-paths.ts      # Shared path utilities
```

### Command Architecture

**CLI Commands**: Commander.js-based (`commander` + `@commander-js/extra-typings`). Entry at `cli.ts` registers subcommands: `chat`, `init`, `config`, `update`, `uninstall`.

**TUI Slash Commands**: User types `/command` in the chat input. Registered through `CommandDefinition`:

```typescript
interface CommandDefinition {
  name: string;
  description: string;
  category: CommandCategory;  // "builtin" | "workflow" | "skill" | "agent" | "file" | "folder"
  execute: (args: string, context: CommandContext) => CommandResult | Promise<CommandResult>;
  aliases?: string[];
  hidden?: boolean;
  argumentHint?: string;
}
```

**CommandContext** (from `types/command.ts`): 34 properties/methods. Each command receives the full context regardless of what it needs.

**CommandResult**: Contains success, message, and various side-effect flags (`clearMessages`, `destroySession`, `shouldExit`, `showModelSelector`, `themeChange`, `compactionSummary`, `skillLoaded`, `showMcpOverlay`, etc.).

### Issues Documented

1. **God Context**: Every command gets `CommandContext` with 34 members. A simple `/help` command receives session management, workflow state, MCP operations, model operations, and streaming functions it will never use.

2. **Side-Effect Flags**: `CommandResult` uses boolean flags to request side effects (`showModelSelector`, `showMcpOverlay`, `themeChange`, etc.). This couples commands to specific UI behaviors.

3. **Duplicate Registration**: TUI commands are registered through `commands/tui/registry.ts` AND `commands/core/registry.ts`. Agent discovery exists in both `commands/catalog/agents/` and `services/agent-discovery/`.

4. **Mixed Concerns**: `commands/tui/workflow-commands/` contains business logic (task watching, session management, workflow file loading) that belongs in the service layer.

---

## V2 Spec: Command System

### Design Principle: Commands Are Thin Dispatchers

Commands parse input, call services, and return a result. No business logic in commands.

### 1. Tiered Context (from Spec 00)

Commands declare their required context level:

```typescript
// services/commands/types.ts

type ContextLevel = "read" | "message" | "workflow" | "full";

interface CommandDefinition<T extends ContextLevel = ContextLevel> {
  name: string;
  description: string;
  category: "builtin" | "workflow" | "skill" | "agent";
  contextLevel: T;
  execute: (args: string, context: ContextForLevel<T>) => Promise<CommandResult>;
  aliases?: string[];
  hidden?: boolean;
  argumentHint?: string;
}

type ContextForLevel<T extends ContextLevel> =
  T extends "read" ? ReadContext :
  T extends "message" ? MessageContext :
  T extends "workflow" ? WorkflowContext :
  T extends "full" ? FullContext :
  never;
```

**Examples**:
- `/help` → `contextLevel: "read"` (only needs session state and agent type)
- `/clear` → `contextLevel: "message"` (needs to clear messages)
- `/ralph` → `contextLevel: "workflow"` (needs workflow execution)
- `/model` → `contextLevel: "full"` (needs model operations)

### 2. Command Result

Replace side-effect flags with discriminated actions:

```typescript
// services/commands/types.ts

interface CommandResult {
  success: boolean;
  message?: string;
  /** Optional actions for the UI to perform */
  actions?: CommandAction[];
}

type CommandAction =
  | { type: "clear-messages" }
  | { type: "destroy-session" }
  | { type: "exit" }
  | { type: "show-dialog"; dialog: "model-selector" | "mcp-overlay" }
  | { type: "set-theme"; theme: "dark" | "light" | "toggle" }
  | { type: "load-skill"; skillName: string }
  | { type: "start-workflow"; workflowName: string; args: string };
```

**Key improvement**: Actions are explicit, typed, and extensible. No more boolean flag combinations.

### 3. Command Registry

```typescript
// services/commands/registry.ts

class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();

  register(command: CommandDefinition): void {
    this.commands.set(`/${command.name}`, command);
    command.aliases?.forEach(a => this.commands.set(`/${a}`, command));
  }

  resolve(input: string): { command: CommandDefinition; args: string } | null {
    const [name, ...rest] = input.trim().split(/\s+/);
    const command = this.commands.get(name);
    return command ? { command, args: rest.join(" ") } : null;
  }

  list(category?: string): CommandDefinition[] {
    const unique = [...new Set(this.commands.values())];
    return category ? unique.filter(c => c.category === category) : unique;
  }
}
```

### 4. Built-in Commands

```typescript
// services/commands/builtins.ts

const helpCommand: CommandDefinition<"read"> = {
  name: "help",
  description: "Show available commands",
  category: "builtin",
  contextLevel: "read",
  async execute(args, ctx) {
    // List all registered commands
    return { success: true, message: formatHelpText(commandRegistry.list()) };
  },
};

const clearCommand: CommandDefinition<"message"> = {
  name: "clear",
  description: "Clear chat history",
  category: "builtin",
  contextLevel: "message",
  async execute(args, ctx) {
    return { success: true, actions: [{ type: "clear-messages" }] };
  },
};

const modelCommand: CommandDefinition<"full"> = {
  name: "model",
  description: "Switch model",
  category: "builtin",
  contextLevel: "full",
  async execute(args, ctx) {
    if (!args) {
      return { success: true, actions: [{ type: "show-dialog", dialog: "model-selector" }] };
    }
    await ctx.modelOps.setModel(args);
    return { success: true, message: `Switched to ${args}` };
  },
};

const ralphCommand: CommandDefinition<"workflow"> = {
  name: "ralph",
  description: "Start autonomous implementation workflow",
  category: "workflow",
  contextLevel: "workflow",
  aliases: ["loop"],
  argumentHint: '"<prompt-or-spec-path>"',
  async execute(args, ctx) {
    return {
      success: true,
      actions: [{ type: "start-workflow", workflowName: "ralph", args }],
    };
  },
};
```

### 5. Agent Commands (Dynamic)

Agent switch commands (`/claude`, `/opencode`, `/copilot`) are generated from discovered agents:

```typescript
// services/commands/agent-commands.ts

function registerAgentCommands(registry: CommandRegistry, agents: DiscoveredAgent[]): void {
  for (const agent of agents) {
    registry.register({
      name: agent.type,
      description: `Switch to ${agent.type} agent`,
      category: "agent",
      contextLevel: "full",
      async execute(args, ctx) {
        return {
          success: true,
          actions: [{ type: "destroy-session" }],
          message: `Switched to ${agent.type}`,
        };
      },
    });
  }
}
```

### 6. CLI Commands

CLI commands remain Commander.js-based but share the command definitions:

```typescript
// cli.ts

const program = new Command("atomic");

program
  .command("chat")
  .description("Start interactive chat")
  .option("-a, --agent <type>", "Agent to use")
  .action(async (options) => {
    const ctx = await startApp(process.cwd());
    if (options.agent) ctx.config.provider = options.agent;
    // Launch TUI or CLI chat mode
  });

program
  .command("init")
  .description("Initialize Atomic in the current project")
  .action(async () => {
    await runInit(process.cwd());
  });
```

### 7. Skill Loading

Skills are slash commands loaded from config files:

```typescript
// services/commands/skill-loader.ts

async function loadSkills(cwd: string): Promise<CommandDefinition[]> {
  const skillPaths = await discoverSkillPaths(cwd);
  return Promise.all(
    skillPaths.map(async (path) => {
      const skill = await import(path);
      return {
        name: skill.name,
        description: skill.description,
        category: "skill" as const,
        contextLevel: "message" as const,
        execute: skill.execute,
      };
    }),
  );
}
```

### 8. Module Structure

```
commands/
├── cli/
│   ├── chat.ts              # CLI chat mode
│   ├── init.ts              # Init command
│   ├── config.ts            # Config command
│   └── update.ts            # Update/uninstall commands
services/commands/
├── types.ts                 # CommandDefinition, CommandResult, CommandAction
├── registry.ts              # CommandRegistry
├── builtins.ts              # /help, /clear, /exit, /model, /theme, /verbose
├── agent-commands.ts        # Dynamic agent switch commands
├── skill-loader.ts          # Load skills as commands
└── executor.ts              # Execute command with proper context
```

**Target**: ~10 files, ~800 lines (down from 4,925 lines across deeply nested directories).

### 9. Command Execution

```typescript
// services/commands/executor.ts

async function executeCommand(
  input: string,
  registry: CommandRegistry,
  appContext: AppContext,
): Promise<CommandResult> {
  const resolved = registry.resolve(input);
  if (!resolved) {
    return { success: false, message: `Unknown command: ${input.split(" ")[0]}` };
  }

  const context = buildContext(resolved.command.contextLevel, appContext);
  return resolved.command.execute(resolved.args, context);
}

function buildContext(level: ContextLevel, app: AppContext): ContextForLevel<typeof level> {
  switch (level) {
    case "read":
      return { session: app.store.getState().session, state: { isStreaming: false, messageCount: 0 }, agentType: app.config.provider };
    case "message":
      return { ...buildContext("read", app), sendMessage: app.sendMessage, streamAndWait: app.streamAndWait };
    case "workflow":
      return { ...buildContext("message", app), eventBus: app.bus, spawnSubagent: app.spawnSubagent, updateTaskList: app.updateTaskList, waitForUserInput: app.waitForUserInput };
    case "full":
      return { ...buildContext("workflow", app), modelOps: app.modelOps, mcpOps: app.mcpOps, clearContext: app.clearContext };
  }
}
```

## Code References (Current)

- `src/types/command.ts:60-94` - CommandContext (34 members)
- `src/types/command.ts:96-112` - CommandResult (12 side-effect flags)
- `src/types/command.ts:116-124` - CommandDefinition
- `src/commands/core/registry.ts` - Core command registry
- `src/commands/tui/registry.ts` - TUI command registry
- `src/commands/tui/builtin-commands.ts` - Built-in commands
- `src/commands/tui/agent-commands.ts` - Agent switch commands
- `src/commands/tui/skill-commands.ts` - Skill commands
- `src/commands/tui/workflow-commands.ts` - Workflow commands
- `src/commands/tui/workflow-commands/tasks-watcher.ts` - Task watching
- `src/commands/tui/workflow-commands/session.ts` - Workflow sessions
- `src/commands/catalog/agents/` - Agent discovery catalog
- `src/commands/catalog/skills/` - Skill discovery catalog

## Related Research

- `research/docs/2026-02-03-command-migration-notes.md`
- `research/docs/2026-02-08-command-required-args-validation.md`
- `research/docs/2026-01-25-commander-cli-audit.md`
- `research/docs/2026-01-25-commander-js-migration.md`
- `research/docs/2026-02-17-legacy-code-removal-skills-migration.md`
- `research/docs/2026-02-08-skill-loading-from-configs-and-ui.md`
- `research/docs/2026-02-25-skills-directory-structure.md`
