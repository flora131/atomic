# Workflow Registration Flow

**Date:** 2026-02-25
**Scope:** Custom workflow discovery, loading, registration, command creation, config files, CLI entry point.

---

## 1. Custom Workflow Discovery

### `discoverWorkflowFiles()` (`src/ui/commands/workflow-commands.ts:343-372`)

This function scans two filesystem paths for `.ts` files:

**Search paths** are defined in the `CUSTOM_WORKFLOW_SEARCH_PATHS` constant at line 268-273:

```typescript
export const CUSTOM_WORKFLOW_SEARCH_PATHS = [
    ".atomic/workflows",       // Local project workflows (highest priority)
    "~/.atomic/workflows",     // Global user workflows
];
```

The function iterates over these paths in order (line 349-369). For each path:

1. Calls `expandPath()` (line 281-293) to resolve `~` to `$HOME` and relative paths to `process.cwd()`.
2. Checks if the directory exists via `existsSync()` (line 354).
3. Reads all entries with `fs.readdirSync()` (line 356).
4. Filters for files ending in `.ts` (line 358).
5. Tags each discovered file with a `source` label: index `0` is `"local"`, all others are `"global"` (line 352).

**Return type:** An array of `{ path: string; source: "local" | "global" }` objects (line 343-346).

### `loadWorkflowsFromDisk()` (`src/ui/commands/workflow-commands.ts:401-471`)

This async function calls `discoverWorkflowFiles()` at line 402, then dynamically imports each `.ts` file and extracts workflow metadata.

**Per-file processing** (line 406-467):

1. `await import(path)` at line 409 performs a dynamic ESM import of the workflow file.
2. The workflow name is extracted from `module.name`; if absent, falls back to the filename without extension (line 412-414).
3. **Deduplication by name:** If a workflow name (lowercased) has already been loaded, it is skipped (line 417-419). Since local paths are discovered before global paths, local workflows take priority.
4. Metadata fields are extracted from the module's exports (line 426-436):
   - `name` (string)
   - `description` (string, defaults to `"Custom workflow: ${name}"`)
   - `aliases` (string array, optional)
   - `defaultConfig` (Record, optional)
   - `version` (string, optional)
   - `minSDKVersion` (string, optional)
   - `stateVersion` (number, optional)
   - `migrateState` (function, optional -- checked via `typeof` at line 421-424)
   - `source` (`"local"` or `"global"`, from the discovery step)
5. If `minSDKVersion` is present, it is validated as semver via `parseSemver()` (line 438-452). If it is newer than the current SDK `VERSION`, a warning is printed to console.
6. Results are stored in the module-level `loadedWorkflows` variable (line 469).

### What a custom workflow file needs to export

A `.ts` file placed in `.atomic/workflows/` or `~/.atomic/workflows/` is dynamically imported. It should export any of these named exports:

| Export | Type | Required | Default |
|---|---|---|---|
| `name` | `string` | No | Filename without `.ts` |
| `description` | `string` | No | `"Custom workflow: ${name}"` |
| `aliases` | `string[]` | No | `undefined` |
| `defaultConfig` | `Record<string, unknown>` | No | `undefined` |
| `version` | `string` (semver) | No | `undefined` |
| `minSDKVersion` | `string` (semver) | No | `undefined` |
| `stateVersion` | `number` | No | `undefined` |
| `migrateState` | `(oldState: unknown, fromVersion: number) => BaseState` | No | `undefined` |

The test file at `src/ui/commands/workflow-commands.test.ts:91-99` demonstrates a minimal workflow file:

```typescript
export const name = "versioned-discovery";
export const description = "Local versioned workflow";
export const version = "3.0.0";
export const minSDKVersion = "...";
export const stateVersion = 7;
```

---

## 2. Workflow Registration Flow (Startup to Command Registration)

### Step 1: CLI entry point (`src/cli.ts`)

The main function at line 273-298 calls `program.parseAsync()` at line 281. When the `chat` subcommand is invoked (or defaulted to, since it is marked `isDefault: true` at line 95), the action handler at line 127 eventually calls `chatCommand()` at line 163.

### Step 2: Chat command (`src/commands/chat.ts`)

`chatCommand()` at line 196 creates an SDK client at line 243, starts it at line 251, builds a `ChatUIConfig` at line 267-284, and calls `startChatUI(client, chatConfig)` at line 287.

### Step 3: Start Chat UI (`src/ui/index.ts`)

`startChatUI()` is defined at line 306. Before rendering the React tree, at line 2022 it calls:

```typescript
await initializeCommandsAsync();
```

### Step 4: Initialize commands (`src/ui/commands/index.ts:87-107`)

`initializeCommandsAsync()` performs the full registration sequence:

1. **Line 91:** `registerBuiltinCommands()` -- registers built-in slash commands (help, theme, clear, compact).
2. **Line 94:** `await loadWorkflowsFromDisk()` -- discovers and imports custom `.ts` workflow files from `.atomic/workflows/` and `~/.atomic/workflows/`. Populates the module-level `loadedWorkflows` array.
3. **Line 95:** `registerWorkflowCommands()` -- creates `CommandDefinition` objects for all workflows and registers them with the global registry.
4. **Line 99:** `await discoverAndRegisterDiskSkills()` -- loads skills from disk.
5. **Line 103:** `await registerAgentCommands()` -- loads agent commands from disk.

Returns the count of newly registered commands (line 106).

### Step 5: Register workflow commands (`src/ui/commands/workflow-commands.ts:899-907`)

`registerWorkflowCommands()` calls `getWorkflowCommands()` at line 900, which in turn calls `getAllWorkflows()` at line 873 and maps each `WorkflowMetadata` through `createWorkflowCommand()`.

`getAllWorkflows()` (line 477-506) merges dynamically loaded workflows with built-in definitions:
1. First adds all dynamically loaded workflows from `loadedWorkflows` (line 482-494), tracking names and aliases.
2. Then adds built-in workflows from `BUILTIN_WORKFLOW_DEFINITIONS` (line 497-503) only if their name has not already been seen. This means disk-loaded workflows override built-ins.

For each command returned by `getWorkflowCommands()`, `registerWorkflowCommands()` checks `globalRegistry.has(command.name)` at line 903 and only registers if not already present. This makes the function idempotent.

### Built-in workflow definitions (`src/ui/commands/workflow-commands.ts:520-531`)

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

There is exactly one built-in workflow: `ralph` (alias `loop`).

### Command registry (`src/ui/commands/registry.ts`)

`CommandRegistry` at line 303 stores commands in a `Map<string, CommandDefinition>` (line 305) and aliases in a `Map<string, string>` (line 308). Registration at line 316-340 checks for name/alias conflicts and throws on collision. The global singleton `globalRegistry` is exported at line 534.

---

## 3. The Gap for Non-Ralph Workflows: `createWorkflowCommand()` Generic Handler

### Dispatch logic (`src/ui/commands/workflow-commands.ts:543-595`)

`createWorkflowCommand()` checks `metadata.name === "ralph"` at line 545. If true, it delegates to `createRalphCommand()` (line 546-547). For all other workflow names, it returns a generic `CommandDefinition` (line 549-594).

### What the generic handler does (lines 555-593)

The `execute` function is **synchronous** (returns `CommandResult` directly, not a Promise):

1. **Active workflow check** (line 557-562): If `context.state.workflowActive` is already true, returns failure with message indicating a workflow is already active.

2. **Prompt extraction** (line 565): Trims `args` to get the initial prompt. If empty, returns failure with usage message (line 567-572).

3. **System message** (line 575-578): Calls `context.addMessage("system", ...)` with a message indicating the workflow is starting, including the workflow name and prompt.

4. **State update** (line 581-592): Returns a `CommandResult` with `success: true` and a `stateUpdate` object:
   ```typescript
   {
       workflowActive: true,
       workflowType: metadata.name,
       initialPrompt,
       pendingApproval: false,
       specApproved: undefined,
       feedback: null,
   }
   ```

The generic handler does **not**:
- Create a workflow session
- Build or execute a graph
- Spawn sub-agents
- Call `streamAndWait()` or `streamGraph()`
- Set `context.setStreaming(true)`

### What happens after the generic handler returns

When `ChatApp` receives a `CommandResult` with a `stateUpdate`, the handler at `src/ui/chat.tsx:4073-4086` applies each field from `result.stateUpdate` to the `workflowState` via `updateWorkflowState()`.

This triggers the React effect at `src/ui/chat.tsx:2534-2689`:

```typescript
// Auto-start workflow when workflowActive becomes true with an initialPrompt.
// This handles non-context-clear workflow starts (e.g., generic workflow commands).
```

The effect checks (line 2540-2543):
- `workflowState.workflowActive` is true
- `workflowState.initialPrompt` is non-null
- The prompt has not already been started (deduplication via `workflowStartedRef`)
- Not currently streaming

When all conditions are met, after a 100ms delay (line 2547), it sends `workflowState.initialPrompt` through the normal `onStreamMessage` handler (line 2566). This passes the prompt to the underlying SDK agent as a regular chat message. The agent receives the prompt and responds via the standard streaming path -- there is no graph execution, no structured task decomposition, and no sub-agent orchestration.

In other words: **the generic handler turns the prompt into a single standard agent message**, relying entirely on the agent's own capabilities to handle the workflow task.

---

## 4. Config Files

### `.atomic/settings.json` (`src/utils/atomic-config.ts`)

**Schema** (`AtomicConfig` interface, line 23-32):

```typescript
export interface AtomicConfig {
  version?: number;
  agent?: AgentKey;         // "claude" | "opencode" | "copilot"
  scm?: SourceControlType;  // "github" | "sapling"
  lastUpdated?: string;
}
```

**Resolution order** (documented at line 4-8, implemented at line 85-91):
1. Local: `{projectDir}/.atomic/settings.json` (higher priority)
2. Global: `~/.atomic/settings.json` (lower priority)

`readAtomicConfig()` at line 85 reads both files, parses them with `pickAtomicConfig()` (line 53-68), and merges them with `mergeConfigs()` (line 70-80) where local fields override global fields.

`saveAtomicConfig()` at line 96 writes to the local path only, always setting `version: 1` and updating `lastUpdated`. It also injects a `$schema` URL from `SETTINGS_SCHEMA_URL` (line 116).

### `src/config.ts` -- Agent Configuration

Defines the `AGENT_CONFIG` record (line 29-70) mapping agent keys (`"claude"`, `"opencode"`, `"copilot"`) to `AgentConfig` objects. Each contains:
- `name`, `cmd`, `additional_flags` -- for spawning the agent CLI
- `folder` -- config directory (`.claude`, `.opencode`, `.github`)
- `install_url`, `exclude`, `additional_files`, `preserve_files`, `merge_files` -- for the `init` command's config copy logic

Also defines `SCM_CONFIG` (line 114-134) for source control management configurations.

**This file contains no workflow-related configuration.**

### `src/utils/settings.ts` (referenced by `src/commands/chat.ts:17`)

Provides `getModelPreference()` and `getReasoningEffortPreference()` which read from `.atomic/settings.json` (local then global). These are used by `chatCommand()` to determine model settings.

### `.atomic/workflows/` directories

There are no `.atomic/workflows/` directories in the project tree itself (glob returned no results). These directories are searched dynamically at runtime by `discoverWorkflowFiles()` for user-authored custom workflows.

### Workflow session directories

Workflow sessions are stored at `~/.atomic/workflows/sessions/{sessionId}/` as defined in `src/workflows/session.ts:32-37`:

```typescript
export const WORKFLOW_SESSIONS_DIR = join(homedir(), ".atomic", "workflows", "sessions");
```

Each session gets a `session.json`, `tasks.json`, and subdirectories `checkpoints/`, `agents/`, and `logs/` (created at line 59-62).

---

## 5. CLI Entry Point (`src/cli.ts`)

### Program creation (`createProgram()`, line 42-222)

Uses Commander.js (`@commander-js/extra-typings`). Defines these commands:
- `init` (line 75-91)
- `chat` (line 94-173, **default command** via `isDefault: true`)
- `config set` (line 176-188)
- `update` (line 191-196)
- `uninstall` (line 199-212)
- `upload-telemetry` (hidden, line 216-220)

### `main()` (line 273-298)

1. Calls `cleanupWindowsLeftoverFiles()` (line 276).
2. Calls `program.parseAsync()` (line 281) which dispatches to the matched command action.
3. Spawns telemetry upload (line 284).

### How workflows get loaded

Workflows are **not** loaded at the CLI level. The CLI entry point delegates to `chatCommand()` which delegates to `startChatUI()` which calls `initializeCommandsAsync()`. The workflow loading happens entirely within the TUI initialization, not during CLI argument parsing.

The flow is:
```
src/cli.ts:main()
  -> program.parseAsync()
    -> chat command action (line 127)
      -> chatCommand() in src/commands/chat.ts:196
        -> startChatUI() in src/ui/index.ts:306
          -> initializeCommandsAsync() in src/ui/commands/index.ts:87
            -> loadWorkflowsFromDisk() (line 94)
            -> registerWorkflowCommands() (line 95)
```

---

## Summary Data Flow

```
CLI (src/cli.ts:281)
  |
  v
chatCommand (src/commands/chat.ts:196)
  |
  v
startChatUI (src/ui/index.ts:306)
  |
  v
initializeCommandsAsync (src/ui/commands/index.ts:87)
  |
  +-- registerBuiltinCommands() .................. line 91
  +-- loadWorkflowsFromDisk() .................... line 94
  |     +-- discoverWorkflowFiles() .............. workflow-commands.ts:343
  |     |     reads .atomic/workflows/*.ts
  |     |     reads ~/.atomic/workflows/*.ts
  |     +-- import(path) for each file ........... workflow-commands.ts:409
  |     +-- populates module-level loadedWorkflows
  |
  +-- registerWorkflowCommands() ................. line 95
  |     +-- getWorkflowCommands() ................ workflow-commands.ts:872
  |     |     +-- getAllWorkflows() ............... workflow-commands.ts:477
  |     |     |     merges loadedWorkflows + BUILTIN_WORKFLOW_DEFINITIONS
  |     |     +-- .map(createWorkflowCommand) .... workflow-commands.ts:543
  |     |           if name === "ralph" -> createRalphCommand()
  |     |           else -> generic handler (state-only, no graph)
  |     +-- globalRegistry.register(command) ..... workflow-commands.ts:904
  |
  +-- discoverAndRegisterDiskSkills() ............ line 99
  +-- registerAgentCommands() .................... line 103
```
