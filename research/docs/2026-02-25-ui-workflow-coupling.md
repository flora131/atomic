# UI-Workflow Coupling: Technical Documentation

**Date:** 2026-02-25
**Scope:** How the UI layer (`src/ui/`) connects to the workflow system, with focus on command registration, dispatch, Ralph-specific code, and agent discovery.

---

## 1. Chat UI Entry Point (`src/ui/chat.tsx`)

### Overview

The chat UI is a React component (`ChatApp`) built on OpenTUI that provides a terminal-based chat interface. It handles slash command parsing, workflow state management, and Ralph-specific task list persistence. The file is large (~6100+ lines) and serves as the central integration point between user input and the command/workflow systems.

### Command Dispatch Flow

#### `executeCommand` (line 3516-4235)

The `executeCommand` callback is the primary mechanism for invoking any registered command from the UI.

1. **Registry lookup** (line 3524-3525): Calls `globalRegistry.get(commandName)` to find a `CommandDefinition` by name or alias. If not found, a system error message is shown (line 3529).

2. **CommandContext construction** (lines 3540-3971): Builds a `CommandContext` object from the current React state, providing commands with access to:
   - `session`: the active SDK session via `getSession?.() ?? null` (line 3557)
   - `state`: a snapshot of `CommandContextState` assembled from `workflowState` fields (lines 3541-3553)
   - `addMessage`: adds a chat message to the UI (line 3559)
   - `setStreaming`: controls the streaming spinner state (line 3560)
   - `sendMessage`: delegates to `sendMessageRef.current` to send visible messages (lines 3561-3565)
   - `sendSilentMessage`: sends to the agent without a user-visible message, creates a streaming placeholder, handles stream generation tracking (lines 3567-3665)
   - `spawnSubagent`: serial sub-agent spawning via `sendSilentMessage` with hidden content (lines 3808-3852)
   - `spawnSubagentParallel`: parallel sub-agent spawning via `SubagentGraphBridge` (lines 3853-3897)
   - `streamAndWait`: returns a `Promise<StreamResult>` resolved when streaming completes or is interrupted (lines 3899-3909)
   - `waitForUserInput`: returns a `Promise<string>` resolved when user types input (lines 3911-3914)
   - `clearContext`: destroys session, clears messages, preserves todo items and ralph session state (lines 3916-3932)
   - `setTodoItems`: normalizes and sorts tasks topologically, updates both ref and state (lines 3934-3937)
   - `setRalphSessionDir`: synchronizes ref and state (lines 3939-3941)
   - `setRalphSessionId`: synchronizes ref and state (lines 3943-3945)
   - `setRalphTaskIds`: updates ref only (lines 3947-3948)
   - `updateWorkflowState`: partial state update (lines 3950-3951)
   - `agentType`, `modelOps`, `getModelDisplayInfo`, MCP toggles (lines 3953-3970)

3. **Delayed spinner** (lines 3973-4013): A 250ms timer shows a loading spinner if the command hasn't completed yet. Uses `flushSync` to force an immediate render.

4. **Command execution** (line 4017): `await Promise.resolve(command.execute(args, context))` -- handles both sync and async commands.

5. **State update application** (lines 4072-4091): If `result.stateUpdate` is present, the workflow state is merged field-by-field via `updateWorkflowState`. The `ralphConfig` field is explicitly handled at line 4085.

#### Input Parsing (lines 5649-5749)

The `handleSubmit` callback processes user input:

1. **Slash command detection** (line 5710): `parseSlashCommand(trimmedValue)` from `src/ui/commands/index.ts` checks if input starts with `/` and splits into name + args.
2. **Ralph panel dismissal** (lines 5712-5720): On Copilot, sending a non-ralph slash command while `ralphSessionDirRef.current` is set clears all ralph state.
3. **Command execution** (line 5726): `void executeCommand(parsed.name, parsed.args, "input")`.
4. **waitForUserInput resolution** (lines 5730-5737): If a workflow is waiting for user input (after Ctrl+C), the user's text resolves the pending promise.
5. **Non-command ralph dismissal** (lines 5740-5748): On Copilot, sending a non-ralph message also clears ralph state.

#### Initial Prompt Handling (lines 5599-5641)

The `useEffect` at line 5601 handles auto-submission of initial prompts:

1. Slash commands are routed through `parseSlashCommand` and `executeCommand` (lines 5609-5613).
2. `@agent` mentions are detected and dispatched via `executeCommand` (lines 5617-5627).
3. Regular messages go to `sendMessage` (line 5638).

### Ralph-Specific Code in the UI Layer

The chat UI contains extensive Ralph-specific state management:

#### State Variables (lines 1841-1849)

```typescript
const [ralphSessionDir, setRalphSessionDir] = useState<string | null>(null);
const ralphSessionDirRef = useRef<string | null>(null);
const [ralphSessionId, setRalphSessionId] = useState<string | null>(null);
const ralphSessionIdRef = useRef<string | null>(null);
const ralphTaskIdsRef = useRef<Set<string>>(new Set());
```

Both state and refs are maintained because refs are needed for synchronous access inside stream callbacks, while state triggers React re-renders.

#### `isRalphTaskUpdate` Guard (lines 2104-2108)

```typescript
const isRalphTaskUpdate = useCallback((
  todos: ..., previousTodos?: ...
): boolean => {
  return hasRalphTaskIdOverlap(todos, ralphTaskIdsRef.current, previousTodos);
}, []);
```

This helper calls `hasRalphTaskIdOverlap` from `src/ui/utils/ralph-task-state.ts:52` to determine if incoming `TodoWrite` payloads originate from the Ralph workflow (share task IDs with the planning phase). This guards against sub-agent TodoWrite calls overwriting Ralph's task state.

#### TodoWrite Filtering During Ralph Workflows

In the tool completion handlers (lines 2328-2346, 2450-2468):

- `taskStreamPinned` is set to `Boolean(ralphSessionIdRef.current)` (lines 2328, 2450).
- `shouldApplyTodoState` gates whether TodoWrite updates are applied to the in-memory task state: only true when either no ralph workflow is active or the update is a ralph update (lines 2333, 2455).
- TodoWrite calls are never persisted to `tasks.json` during an active ralph workflow (lines 2339-2346, 2461-2468). The ralph workflow command handler (`workflow-commands.ts`) is the sole owner of `tasks.json`.

#### Auto-Approve During Workflow (lines 2762-2766, 2831-2837)

When `workflowState.workflowActive` is true:
- Permission requests are auto-approved with the first option value (line 2764).
- `AskUserQuestion` events are auto-responded with the first option label (line 2833).

#### Workflow Cleanup on End (lines 2720-2728)

When `workflowState.workflowActive` transitions to false while `ralphSessionDir` is still set:
1. `syncTerminalTaskStateFromSession` reads final `tasks.json` from disk (line 2699-2718).
2. Tasks are reconciled with in-memory state via `preferTerminalTaskItems` (line 2709).
3. Ralph state is cleared: `setRalphSessionDir(null)`, `setRalphSessionId(null)` (lines 2723-2726).

#### Ctrl+C / Workflow Cancellation (lines 4480-4528, 4590-4614)

During streaming:
- Single Ctrl+C resolves the `streamCompletionResolver` with `wasInterrupted: true` (line 4498).
- Double Ctrl+C during workflow: resolves with `wasCancelled: true` (line 4496) and calls `updateWorkflowState({ workflowActive: false, ... })` (line 4506).
- When textarea is empty and not streaming, double Ctrl+C terminates the workflow (line 4602-4608); outside workflow, it exits the app (line 4611).

#### Task List Panel in MessageBubble (lines 1534-1540, 1577-1583)

The `TaskListPanel` component is rendered when `isLast && ralphSessionDir && showTodoPanel`:
- In user messages: below the message content (line 1535).
- In assistant messages: below `MessageBubbleParts` (line 1578).

When `ralphSessionDir` is set, inline task rendering is disabled (`inlineTasksEnabled={!ralphSessionDir}` at line 5906), favoring the persistent panel.

#### Visual Workflow Indicators (lines 6016, 6104-6131)

- Input border color changes to `themeColors.accent` when `workflowState.workflowActive` (line 6016).
- A footer bar shows "workflow" label with interrupt/enqueue/exit hints (lines 6104-6131).

#### `WorkflowChatState` Interface (lines 848-891)

Contains a `ralphConfig` field (lines 886-890):
```typescript
ralphConfig?: {
  userPrompt: string | null;
  sessionId?: string;
};
```

This is set by the `/ralph` command handler and merged into `workflowState` via the `stateUpdate.ralphConfig` path at line 4085.

### SubagentGraphBridge Initialization (lines 3033-3077)

When `createSubagentSession` is available:
1. A lightweight `CodingAgentClient` wrapper is created (lines 3042-3063) using the current `agentType`.
2. `WorkflowSDK.init()` is called (line 3065) from `src/workflows/graph/sdk.ts`.
3. The `SubagentGraphBridge` is obtained via `sdk.getSubagentBridge()` (line 3070) and stored in `subagentBridgeRef`.
4. This bridge is consumed by `spawnSubagentParallel` in the `CommandContext` (line 3854).

---

## 2. UI Index / App Initialization (`src/ui/index.ts`)

### Overview

`src/ui/index.ts` exports `startChatUI()`, the primary entry point for launching the terminal chat interface. It orchestrates command registration, renderer creation, session management, and event wiring.

### Command Initialization (line 2022)

```typescript
await initializeCommandsAsync();
```

This is called inside `startChatUI` before rendering the React tree. The function (from `src/ui/commands/index.ts:87`) registers commands in this order:

1. `registerBuiltinCommands()` -- help, theme, clear, compact, etc. (line 91)
2. `await loadWorkflowsFromDisk()` -- discovers `.ts` files from `.atomic/workflows/` and `~/.atomic/workflows/` (line 94)
3. `registerWorkflowCommands()` -- converts `WorkflowMetadata` into `CommandDefinition` objects and registers them in `globalRegistry` (line 95)
4. `await discoverAndRegisterDiskSkills()` -- skills from `.claude/skills/`, `.github/skills/`, etc. (line 99)
5. `await registerAgentCommands()` -- agents from `.claude/agents/`, `.opencode/agents/`, `.github/agents/`, etc. (line 103)

### Capabilities System Prompt (lines 2024-2035)

After command initialization, `buildCapabilitiesSystemPrompt()` (line 2027, defined at line 52-96) iterates over `globalRegistry.all()` and builds a text section for each command category: builtins, skills, agents, and workflows. This text is appended to the session's `systemPrompt` so the LLM knows about available capabilities.

Workflow commands are included in the prompt at lines 89-93:
```typescript
const workflows = allCommands.filter((c) => c.category === "workflow");
```

### ChatUIConfig (lines 105-130)

The `workflowEnabled` boolean (line 129) is passed through from CLI args to the `startChatUI` function. It is used only for telemetry tracking (line 375), not for conditional workflow registration.

### Renderer and React Setup (lines 2042-2056)

The `createCliRenderer` and `createRoot` calls set up the OpenTUI environment. The `ChatApp` component is rendered with handler callbacks for tool events, permission requests, parallel agents, etc. Command execution happens entirely within the React component tree via `executeCommand`.

---

## 3. Command Registry (`src/ui/commands/registry.ts`)

### Overview

The registry is a `CommandRegistry` class (line 303) backed by two maps: `commands` (name -> definition) and `aliases` (alias -> primary name). A global singleton `globalRegistry` is exported at line 534.

### `CommandContext` Interface (lines 75-168)

The `CommandContext` interface is the bridge between the UI and command handlers. It references workflow/Ralph-specific features:

| Field | Line | Description |
|---|---|---|
| `setRalphSessionDir` | 135 | Sets the Ralph workflow session directory for the persistent task list panel |
| `setRalphSessionId` | 139 | Sets the Ralph workflow session ID for the persistent task list panel |
| `setRalphTaskIds` | 145 | Sets known Ralph task IDs from the planning phase; guards TodoWrite persistence |
| `updateWorkflowState` | 155 | Updates workflow state (workflowActive, workflowType, etc.) |
| `streamAndWait` | 122 | Returns `Promise<StreamResult>` for multi-step workflow coordination |
| `waitForUserInput` | 151 | Yields control to user after stream interruption |
| `clearContext` | 127 | Destroys session and clears messages, preserving todoItems |
| `spawnSubagent` | 101 | Serial sub-agent spawning |
| `spawnSubagentParallel` | 110 | Parallel sub-agent spawning via `SubagentGraphBridge` |

### `CommandContextState` Interface (lines 185-215)

Contains workflow execution state fields:

| Field | Line | Description |
|---|---|---|
| `workflowActive` | 191 | Whether a workflow is currently active |
| `workflowType` | 193 | Current workflow type string |
| `initialPrompt` | 195 | Initial prompt that started the workflow |
| `currentNode` | 197 | Current node in the workflow graph |
| `iteration` | 199 | Current iteration number (1-based) |
| `maxIterations` | 201 | Maximum allowed iterations |
| `featureProgress` | 203 | Feature completion progress |
| `pendingApproval` | 205 | Whether spec approval is pending |
| `specApproved` | 207 | Whether spec was approved |
| `feedback` | 209 | Feedback from spec rejection |
| `ralphConfig` | 211-214 | Ralph-specific config with `userPrompt` and `sessionId` |

### `CommandResult` Interface (lines 220-251)

Key workflow-relevant fields:

| Field | Line | Description |
|---|---|---|
| `stateUpdate` | 227 | Partial `CommandContextState` to merge into workflow state |
| `clearMessages` | 228 | If true, clear all chat messages |
| `destroySession` | 230 | If true, destroy the current session |

### `CommandCategory` Type (line 256)

```typescript
export type CommandCategory = "builtin" | "workflow" | "skill" | "agent" | "file" | "folder";
```

### Sort Priority (lines 475-484)

Commands are sorted with workflow commands having the highest priority (0), followed by skill (1), agent (2), builtin (3), folder (4), file (5).

---

## 4. Workflow Commands (`src/ui/commands/workflow-commands.ts`)

### Overview

This file defines the workflow command system: built-in workflow definitions, custom workflow loading from disk, and the Ralph-specific command handler. The `/ralph` command is the only built-in workflow, implementing an autonomous implementation loop with planning, worker dispatch, review, and fix phases.

### `WorkflowMetadata` Interface (lines 110-131)

```typescript
export interface WorkflowMetadata {
  name: string;
  description: string;
  aliases?: string[];
  defaultConfig?: Record<string, unknown>;
  version?: string;
  minSDKVersion?: string;
  stateVersion?: number;
  migrateState?: WorkflowStateMigrator;
  source?: "builtin" | "global" | "local";
  argumentHint?: string;
}
```

The `source` field indicates where a workflow was discovered: `"builtin"` (hardcoded), `"global"` (`~/.atomic/workflows/`), or `"local"` (`.atomic/workflows/`).

### Built-In Workflow Definitions (lines 520-531)

A single built-in workflow is defined:

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

The `"loop"` alias allows `/loop` to invoke the same command as `/ralph`.

### `createWorkflowCommand()` Dispatch (lines 543-595)

```typescript
function createWorkflowCommand(metadata: WorkflowMetadata): CommandDefinition {
  if (metadata.name === "ralph") {
    return createRalphCommand(metadata);
  }
  // Generic path...
}
```

**Routing logic:** The function checks `metadata.name === "ralph"` at line 545. If true, it delegates to `createRalphCommand()`. Otherwise, it returns a generic workflow `CommandDefinition`.

#### Generic Path (lines 549-594)

For non-Ralph workflows, the generic path:

1. Checks `context.state.workflowActive` -- if another workflow is active, returns failure (lines 557-561).
2. Requires a non-empty prompt (lines 565-570).
3. Adds a system message indicating workflow start (lines 575-578).
4. Returns a `stateUpdate` setting `workflowActive: true`, `workflowType`, and `initialPrompt` (lines 583-591).

This `stateUpdate` triggers the auto-start `useEffect` in `chat.tsx` (lines 2538-2689) which begins streaming the initial prompt.

#### Ralph-Specific Path: `createRalphCommand()` (lines 597-793)

The Ralph command handler is an `async` execute function that runs the entire workflow graph inline:

1. **Guard** (line 608): Checks `context.state.workflowActive`.
2. **Argument parsing** (lines 615-623): `parseRalphArgs(args)` at line 82 validates that a non-empty prompt is provided.
3. **Session initialization** (lines 631-635):
   - `sessionId = crypto.randomUUID()` (line 631)
   - `sessionDir = getWorkflowSessionDir(sessionId)` from `src/workflows/session.ts` (line 632)
   - `initWorkflowSession("ralph", sessionId)` is called fire-and-forget (line 633)
4. **State update** (lines 637-641): Sets `workflowActive: true`, `workflowType: metadata.name`, and `ralphConfig: { sessionId, userPrompt }`.
5. **Initial state creation** (lines 654-658): `createRalphState(sessionId, {...})` from `src/workflows/ralph/state.ts`.
6. **Bridge adapter** (lines 661-676): Wraps `context.spawnSubagentParallel!()` in a bridge object with `spawn()` and `spawnParallel()` methods.
7. **Subagent registry** (lines 679-687): Creates a `SubagentTypeRegistry` from `src/workflows/graph/subagent-registry.ts`, populated with `discoverAgentInfos()` from `src/ui/commands/agent-commands.ts:259`.
8. **Graph compilation** (lines 690-695): `createRalphWorkflow()` from `src/workflows/ralph/graph.ts` produces a compiled graph. The bridge and registry are injected into `compiled.config.runtime`.
9. **Graph execution** (lines 702-741): `streamGraph(compiled, { initialState })` from `src/workflows/graph/compiled.ts` yields steps. For each step:
   - Node phase descriptions are shown via `getNodePhaseDescription()` (line 57-69).
   - Tasks are persisted via `saveTasksToActiveSession()` (line 719).
   - `context.setTodoItems()` updates the UI (line 723).
   - On the first step with tasks, `context.setRalphSessionDir()`, `context.setRalphSessionId()`, and `context.setRalphTaskIds()` are called (lines 727-738).
10. **Completion** (lines 744-759): Sets `workflowActive: false`.
11. **Error handling** (lines 760-790): Catches "Workflow cancelled" for silent exit; other errors return failure with `workflowActive: false`.

### Custom Workflow Discovery: `loadWorkflowsFromDisk()` (lines 401-471)

1. **Discovery** (line 402): Calls `discoverWorkflowFiles()` (line 343-372) which searches:
   - `.atomic/workflows` (local, index 0 -> `"local"` source)
   - `~/.atomic/workflows` (global, index 1 -> `"global"` source)
   
   Both are defined in `CUSTOM_WORKFLOW_SEARCH_PATHS` at line 268-273.

2. **Path expansion** (line 281-293): `expandPath()` resolves `~` to `$HOME` and relative paths to `process.cwd()`.

3. **File filtering** (lines 357-358): Only `.ts` files are discovered.

4. **Dynamic import** (line 409): Each discovered `.ts` file is imported via `await import(path)`.

5. **Metadata extraction** (lines 412-436): Reads `module.name` (falls back to filename), `module.description`, `module.aliases`, `module.defaultConfig`, `module.version`, `module.minSDKVersion`, `module.stateVersion`, `module.migrateState`.

6. **Version validation** (lines 438-453): If `minSDKVersion` is specified, it is checked against the current `VERSION` via `isWorkflowMinSdkNewerThanCurrent()` (line 316-333).

7. **Priority** (lines 417-419): Names are tracked in `loadedNames`; local workflows take priority over global ones (first-discovered wins).

### Workflow Composition: `getAllWorkflows()` (lines 477-506)

Returns a merged list:
1. Dynamically loaded workflows first (local > global).
2. Built-in workflows last (lowest priority).

Names are deduplicated; first occurrence wins.

### Registration: `registerWorkflowCommands()` (lines 899-907)

Calls `getWorkflowCommands()` (line 872-874) which maps `getAllWorkflows()` through `createWorkflowCommand()`, then registers each with `globalRegistry` (idempotent via `has()` check).

### Session Management (lines 137-248)

- `activeSessions` map (line 138): Tracks active `WorkflowSession` objects keyed by session ID.
- `saveTasksToActiveSession()` (lines 200-235): Atomically writes `tasks.json` to the session directory using `atomicWrite()` (line 168).
- `watchTasksJson()` (lines 799-862): File watcher for `tasks.json` changes, used by the `TaskListPanel` component.

---

## 5. Agent Commands (`src/ui/commands/agent-commands.ts`)

### Overview

Agent commands are discovered from config directories and registered as `@`-prefixed mention targets and `/`-prefixed slash commands. They are lightweight wrappers that delegate actual execution to the underlying SDK's native sub-agent dispatch.

### Discovery Paths (lines 34-52)

**Project-local** (highest priority):
- `.claude/agents`
- `.opencode/agents`
- `.github/agents`

**User-global** (lower priority):
- `~/.claude/agents`
- `~/.opencode/agents`
- `~/.copilot/agents`
- `~/.atomic/.claude/agents`
- `~/.atomic/.opencode/agents`
- `~/.atomic/.copilot/agents`

### `AgentInfo` Interface (lines 81-90)

```typescript
export interface AgentInfo {
  name: string;
  description: string;
  source: AgentSource;  // "project" | "user"
  filePath: string;
}
```

### Discovery: `discoverAgentInfos()` (lines 259-278)

1. `discoverAgentFiles()` (line 179-197) scans all paths, returning `DiscoveredAgentFile` objects.
2. For each file, `parseAgentInfoLight()` (line 206-225) reads the `.md` file, parses YAML frontmatter via `parseMarkdownFrontmatter()` from `src/utils/markdown.ts`, and extracts `name` and `description`.
3. Deduplication uses `shouldAgentOverride()` (lines 238-248): project agents (priority 2) override user agents (priority 1).

### Command Creation: `createAgentCommand()` (lines 305-331)

The execute handler branches on `context.agentType`:

- **OpenCode** (lines 315-319): Calls `context.sendSilentMessage(task, { agent: agent.name, isAgentOnlyStream: true })`. The `agent` option triggers OpenCode's `AgentPartInput` dispatch.
- **Claude/Copilot** (lines 321-326): Calls `context.sendSilentMessage(instruction, { isAgentOnlyStream: true })` where `instruction` is a prompt steering the model to use the `Task` tool for sub-agent dispatch.

### Registration: `registerAgentCommands()` (lines 341-358)

Called during `initializeCommandsAsync()`. Iterates discovered agents:
- If a command with the same name already exists as an "agent" category, it is unregistered first (line 349).
- Non-agent commands with the same name are not overridden (line 351).

### Usage by Workflow Commands

`discoverAgentInfos()` is imported and called by `createRalphCommand()` at line 680 to populate the `SubagentTypeRegistry` with available agent types. This allows the Ralph workflow graph to know which sub-agents are available for task dispatch.

---

## 6. Data Flow Summary

### Command Registration Flow

```
startChatUI() [src/ui/index.ts:306]
  -> initializeCommandsAsync() [src/ui/commands/index.ts:87]
      -> registerBuiltinCommands()
      -> loadWorkflowsFromDisk() -> discoverWorkflowFiles() -> dynamic import .ts
      -> registerWorkflowCommands() -> getAllWorkflows() -> createWorkflowCommand() -> globalRegistry.register()
      -> discoverAndRegisterDiskSkills()
      -> registerAgentCommands() -> discoverAgentInfos() -> createAgentCommand() -> globalRegistry.register()
  -> buildCapabilitiesSystemPrompt() [appends to sessionConfig.systemPrompt]
  -> createRoot() + render ChatApp
```

### Slash Command Execution Flow

```
User types "/ralph build a snake game" and presses Enter
  -> handleSubmit() [chat.tsx:5649]
      -> parseSlashCommand() [commands/index.ts:148] -> { name: "ralph", args: "build a snake game" }
      -> addMessage("user", ...) [chat.tsx:5724]
      -> executeCommand("ralph", "build a snake game", "input") [chat.tsx:3516]
          -> globalRegistry.get("ralph") [chat.tsx:3525]
          -> Build CommandContext [chat.tsx:3556-3971]
          -> command.execute(args, context) [chat.tsx:4017]
              -> createRalphCommand().execute [workflow-commands.ts:604]
                  -> parseRalphArgs(args) [workflow-commands.ts:82]
                  -> context.updateWorkflowState({ workflowActive: true, ... })
                  -> context.setStreaming(true)
                  -> createRalphState() -> createRalphWorkflow() -> streamGraph()
                  -> For each step: context.setTodoItems(), saveTasksToActiveSession()
                  -> On first tasks: context.setRalphSessionDir(), setRalphSessionId(), setRalphTaskIds()
                  -> On completion: return { stateUpdate: { workflowActive: false } }
          -> Apply result.stateUpdate to workflowState [chat.tsx:4072-4091]
```

### Ralph State Lifecycle

```
/ralph invocation:
  1. createRalphCommand sets workflowActive=true, ralphConfig={sessionId, userPrompt}
  2. context.setRalphSessionDir/Id/TaskIds called once first tasks arrive
  3. TaskListPanel renders when ralphSessionDir is set
  4. TodoWrite filtering guards prevent sub-agent overwrites
  5. Permission requests auto-approved during workflowActive
  6. On completion: workflowActive=false returned via stateUpdate
  7. useEffect detects !workflowActive && ralphSessionDir -> syncTerminalTaskStateFromSession()
  8. Ralph state cleared: ralphSessionDir=null, ralphSessionId=null
```

---

## 7. Key Coupling Points

### UI -> Workflow Layer

| Coupling Point | UI File:Line | Workflow File:Line |
|---|---|---|
| `createRalphWorkflow()` import | `workflow-commands.ts:36` | `workflows/ralph/graph.ts` |
| `createRalphState()` import | `workflow-commands.ts:37` | `workflows/ralph/state.ts` |
| `streamGraph()` import | `workflow-commands.ts:38` | `workflows/graph/compiled.ts` |
| `SubagentTypeRegistry` import | `workflow-commands.ts:43` | `workflows/graph/subagent-registry.ts` |
| `SubagentGraphBridge` import | `chat.tsx:39` | `workflows/graph/subagent-bridge.ts` |
| `WorkflowSDK` import | `chat.tsx:42` | `workflows/graph/sdk.ts` |
| `initWorkflowSession` import | `workflow-commands.ts:31` | `workflows/session.ts` |
| `getWorkflowSessionDir` import | `workflow-commands.ts:31` | `workflows/session.ts` |
| `BaseState` type import | `workflow-commands.ts:34` | `workflows/graph/types.ts` |

### Workflow -> UI Layer (via CommandContext)

The workflow graph has no direct imports from the UI layer. All communication flows through the `CommandContext` interface:

- Task updates: `context.setTodoItems()`, `context.setRalphSessionDir()`, `context.setRalphSessionId()`, `context.setRalphTaskIds()`
- Status messages: `context.addMessage()`
- Sub-agent dispatch: `context.spawnSubagentParallel()`
- Streaming control: `context.setStreaming()`
- State propagation: `context.updateWorkflowState()`, `result.stateUpdate`

### Ralph-Specific Fields in Shared Interfaces

The following Ralph-specific fields exist in the shared command registry types:

- `CommandContext.setRalphSessionDir` (registry.ts:135)
- `CommandContext.setRalphSessionId` (registry.ts:139)
- `CommandContext.setRalphTaskIds` (registry.ts:145)
- `CommandContextState.ralphConfig` (registry.ts:211-214)
- `WorkflowChatState.ralphConfig` (chat.tsx:886-890)

### Agent Discovery Cross-Usage

`discoverAgentInfos()` from `agent-commands.ts:259` is used in two contexts:
1. **UI registration** (agent-commands.ts:342): Registers agent commands in `globalRegistry` for slash command and `@mention` access.
2. **Workflow sub-agent registry** (workflow-commands.ts:680-687): Populates the `SubagentTypeRegistry` for the Ralph workflow graph to know which sub-agents are available.
