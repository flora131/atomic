# Atomic CLI - Complete Module Documentation

This document provides a comprehensive overview of every file in the `src/` directory, documenting:
1. Each file's purpose
2. Key exported functions/classes/types
3. Test coverage status
4. Testable logic for untested modules

---

## Top-Level Files

### `cli.ts` (280 lines)
**Purpose:** Main CLI entry point using Commander.js for argument parsing

**Key Exports:**
- `createProgram()` - Creates and configures the Commander program
- `program` - The main program instance
- `spawnTelemetryUpload()` - Spawns detached background process for telemetry upload
- `main()` - Main async entry point

**Commands Configured:**
- `init` - Interactive agent setup (default command)
- `chat` - Start interactive chat with agent
- `config set` - Set configuration values
- `update` - Self-update binary installations
- `uninstall` - Remove binary installation
- `upload-telemetry` - Hidden internal command

**Tests:** ❌ None
**Testable Logic:**
- `createProgram()` - Returns configured Commander instance (test command registration, options, help text)
- `spawnTelemetryUpload()` - Environment variable checks, process spawning (can be tested with mocks)
- Command validation logic (agent choices, theme validation)
- Error output formatting and colored output

---

### `config.ts` (159 lines)
**Purpose:** Agent and SCM (Source Control Management) configuration definitions

**Key Exports:**
- `AgentConfig` interface - Configuration structure for agents
- `AGENT_CONFIG` - Record of claude/opencode/copilot configurations
- `AgentKey` type - Union type for valid agent keys
- `ScmConfig` interface - Source control configuration structure
- `SCM_CONFIG` - Record of github/sapling-phabricator configurations
- `SourceControlType` type - Union type for valid SCM types
- Helper functions: `isValidAgent()`, `getAgentConfig()`, `getAgentKeys()`, `isValidScm()`, `getScmConfig()`, `getScmKeys()`

**Tests:** ❌ None
**Testable Logic:**
- Type guards (`isValidAgent()`, `isValidScm()`) - Test with valid/invalid inputs
- Getter functions (`getAgentConfig()`, `getScmConfig()`) - Verify correct config retrieval
- Configuration completeness - Verify all agents have required fields
- SCM_SPECIFIC_COMMANDS array correctness

---

### `version.ts` (7 lines)
**Purpose:** Version management from package.json

**Key Exports:**
- `VERSION` - String containing the package version

**Tests:** ❌ None
**Testable Logic:**
- Version string format validation (semver compliance)
- Version export correctness

---

## `commands/` Directory

### `chat.ts` (241 lines)
**Purpose:** Chat command implementation for interactive agent sessions

**Key Exports:**
- `chatCommand()` - Main async function to start chat UI
- `createClientForAgentType()` - Factory function for agent clients
- `getAgentDisplayName()` - Map agent type to display name
- `getTheme()` - Convert theme name to Theme object
- `isSlashCommand()`, `parseSlashCommand()`, `handleThemeCommand()` - Slash command utilities
- `ChatCommandOptions` interface

**Tests:** ❌ None
**Testable Logic:**
- `createClientForAgentType()` - Verify correct client instantiation for each agent type
- `getAgentDisplayName()` - Test mapping correctness
- `parseSlashCommand()` - Test command parsing with various inputs
- `handleThemeCommand()` - Test theme switching logic
- `isSlashCommand()` - Test with valid/invalid slash command formats

---

### `config.ts` (commands) (73 lines)
**Purpose:** Config command implementation for managing CLI settings

**Key Exports:**
- `configCommand()` - Main async function for config management

**Subcommands:**
- `set telemetry <true|false>` - Enable/disable telemetry

**Tests:** ❌ None
**Testable Logic:**
- Input validation (subcommand, key, value checking)
- Error messages for invalid inputs
- Telemetry state updates (can mock `setTelemetryEnabled()`)

---

### `init.ts` (458 lines)
**Purpose:** Interactive setup flow for atomic CLI

**Key Exports:**
- `initCommand()` - Main async function for init flow
- `reconcileScmVariants()` - Exported function to reconcile SCM-specific files
- `getCommandsSubfolder()` - Helper for agent-specific folder names
- `InitOptions` interface

**Key Logic:**
- Agent selection prompt
- SCM selection prompt
- Directory confirmation
- Telemetry consent handling
- Template file copying with preservation logic
- SCM variant reconciliation (remove opposite SCM files)
- Atomic config persistence

**Tests:** ✅ `init.test.ts` (111 lines)

**Test Coverage:**
- `reconcileScmVariants()` - Tests Sapling variant removal, GitHub variant removal, directory-based skills handling
- Edge cases: Missing source/target directories, user-custom files preservation

**Untested Logic:**
- Full `initCommand()` flow (prompts, file copying, error handling)
- `copyDirPreserving()` internal function
- Preserved file logic (empty file detection, force flag handling)
- Merge file logic (.mcp.json merging)
- WSL installation check

---

### `uninstall.ts` (217 lines)
**Purpose:** Remove binary installations

**Key Exports:**
- `uninstallCommand()` - Main async function for uninstallation
- `getPathCleanupInstructions()` - Generate shell-specific PATH cleanup instructions
- `UninstallOptions` interface

**Key Logic:**
- Installation type detection (npm/source installations not supported)
- Dry-run mode
- Binary and data directory removal
- Windows rename strategy (running executable can't be deleted)
- Unix self-deletion
- PATH cleanup instructions

**Tests:** ❌ None
**Testable Logic:**
- `getPathCleanupInstructions()` - Verify correct instructions for Windows/Unix
- Installation type validation
- File existence checks
- Dry-run output verification
- Error handling for permissions

---

### `update.ts` (299 lines)
**Purpose:** Self-update for binary installations

**Key Exports:**
- `updateCommand()` - Main async function for updates
- `isNewerVersion()` - Semver comparison function
- `extractConfig()` - Extract config archive to data directory
- Helper functions: `replaceBinaryUnix()`, `replaceBinaryWindows()`

**Key Logic:**
- Check for latest release via GitHub API
- Version comparison
- Download binary and config archive with progress
- Checksum verification
- Binary replacement (platform-specific)
- Config extraction and installation
- Post-install verification

**Tests:** ❌ None
**Testable Logic:**
- `isNewerVersion()` - Test semver comparison with various version pairs (1.2.3 vs 1.2.4, 2.0.0 vs 1.9.9, etc.)
- `extractConfig()` - Test archive extraction (can use mock filesystem)
- Platform detection and binary replacement strategy selection
- Error handling for network failures, checksum mismatches

---

## `config/` Directory

### `index.ts` (10 lines)
**Purpose:** Re-export barrel for config module

**Key Exports:**
- Re-exports from `copilot-manual.ts`

**Tests:** ❌ None

---

### `copilot-manual.ts` (178 lines)
**Purpose:** Copilot agent configuration loading from markdown files

**Key Exports:**
- `CopilotAgent` interface
- `FsOps` interface - Dependency injection for filesystem operations
- `loadAgentsFromDir()` - Load agents from directory
- `loadCopilotAgents()` - Load all agents with priority (local > global)
- `loadCopilotInstructions()` - Load copilot-instructions.md

**Tests:** ❌ None
**Testable Logic:**
- `loadAgentsFromDir()` - Test with mock filesystem (valid/invalid markdown, missing frontmatter)
- `loadCopilotAgents()` - Test priority resolution (local overrides global)
- `loadCopilotInstructions()` - Test fallback from local to global
- Frontmatter parsing (name, description, tools extraction)
- Error handling (unreadable files, invalid frontmatter)

---

## `graph/` Directory

### `index.ts` (304 lines)
**Purpose:** Central export hub for graph execution engine

**Key Exports:**
- All types from `types.ts`
- All types and functions from `annotation.ts`
- All types and functions from `builder.ts`
- All types and functions from `nodes.ts`
- All types and functions from `compiled.ts`
- All types and functions from `checkpointer.ts`
- Error classes from `errors.ts`
- Registry functions from `subagent-registry.ts`
- Bridge class from `subagent-bridge.ts`

**Tests:** ❌ None (re-export only)

---

### `types.ts` (678 lines)
**Purpose:** Core type definitions for graph execution engine

**Key Types:**
- `NodeId`, `NodeType`, `NodeDefinition`, `NodeExecuteFn`
- `BaseState`, `ContextWindowUsage`
- `Signal`, `SignalData`
- `ExecutionError`, `RetryConfig`, `DebugReport`
- `NodeResult`, `ExecutionContext`
- `ProgressEvent`, `GraphConfig`, `Checkpointer`
- `EdgeCondition`, `Edge`
- `CompiledGraph`
- `ExecutionStatus`, `ExecutionSnapshot`
- `ModelSpec`, `WorkflowToolContext`

**Key Constants:**
- `DEFAULT_RETRY_CONFIG`, `DEFAULT_GRAPH_CONFIG`
- `BACKGROUND_COMPACTION_THRESHOLD`, `BUFFER_EXHAUSTION_THRESHOLD`

**Type Guards:**
- `isNodeType()`, `isSignal()`, `isExecutionStatus()`, `isBaseState()`, `isNodeResult()`, `isDebugReport()`

**Tests:** ❌ None
**Testable Logic:**
- Type guard functions - Test with valid/invalid inputs
- Default configurations - Verify values match specifications
- Threshold constants - Verify reasonable values

---

### `annotation.ts` (partial view)
**Purpose:** State annotation system for type-safe state management

**Key Exports:**
- `Reducer<T>` type - Function for merging state values
- `Annotation<T>` interface - Field definition with default and reducer
- `AnnotationRoot` type - Schema combining multiple annotations
- `Reducers` object - Built-in reducers (replace, concat, merge, mergeById)
- `annotation()` - Factory for creating annotations
- `initializeState()`, `applyStateUpdate()` - State management functions
- State-specific annotations: `AtomicStateAnnotation`, `RalphStateAnnotation`
- Type guards: `isFeature()`, `isAtomicWorkflowState()`, `isRalphWorkflowState()`

**Tests:** ❌ None
**Testable Logic:**
- Built-in reducers (`Reducers.replace`, `concat`, `merge`, `mergeById`) - Test merge behavior
- `initializeState()` - Test state initialization with defaults
- `applyStateUpdate()` - Test reducer application and immutability
- Type guards - Test with valid/invalid state objects

---

### `builder.ts` (partial view)
**Purpose:** Fluent API for building graph-based workflows

**Key Exports:**
- `GraphBuilder<TState>` class - Main builder with fluent API
- `graph()` - Factory function
- Helper factories: `createNode()`, `createDecisionNode()`, `createWaitNode()`
- `LoopConfig`, `ParallelConfig` interfaces

**Key Methods:**
- `.then()` - Linear node chaining
- `.if()/.else()/.endif()` - Conditional branching
- `.parallel()` - Parallel execution
- `.loop()` - Loop constructs
- `.wait()` - Human-in-the-loop
- `.catch()` - Error handling
- `.compile()` - Generate CompiledGraph

**Tests:** ❌ None
**Testable Logic:**
- Node chaining - Build simple graph and verify edge creation
- Conditional branching - Test if/else/endif edge generation
- Loop configuration - Verify maxIterations enforcement
- Parallel node creation - Test branch handling
- Graph compilation - Verify startNode, endNodes detection
- Error detection (missing startNode, disconnected nodes)

---

### `checkpointer.ts` (partial view)
**Purpose:** Checkpoint implementations for state persistence

**Key Exports:**
- `MemorySaver<TState>` - In-memory checkpointer
- `FileSaver<TState>` - File-based checkpointer
- `ResearchDirSaver<TState>` - Research directory with YAML frontmatter
- `SessionDirSaver<TState>` - Session directory checkpointer
- `createCheckpointer()` - Factory function
- `CheckpointerType`, `CreateCheckpointerOptions` types

**Tests:** ❌ None
**Testable Logic:**
- `MemorySaver` - Test save/load/list/delete operations
- `FileSaver` - Test file creation, JSON persistence
- State cloning (structuredClone verification)
- Checkpoint listing and label-based retrieval
- Error handling for missing files

---

### `compiled.ts`
**Purpose:** Graph execution engine with BFS traversal

**Key Exports:**
- `GraphExecutor<TState>` class - Main execution orchestrator
- `executeGraph()`, `streamGraph()` - Public APIs
- `initializeExecutionState()`, `mergeState()` - State utilities
- `StepResult`, `ExecutionResult`, `ExecutionOptions` types

**Key Logic:**
- BFS-style traversal with queue
- State immutability with annotation reducers
- Exponential backoff retry
- Checkpoint management
- Signal processing (pause/resume)
- Loop detection
- Telemetry integration

**Tests:** ❌ None
**Testable Logic:**
- State merging with reducers - Test with different annotation types
- Retry logic - Test max attempts, backoff calculation
- Edge following - Test conditional edge evaluation
- Loop detection - Test with cyclic graphs
- Signal emission and handling
- Checkpoint auto-save behavior

---

### `errors.ts`
**Purpose:** Custom error classes for graph execution

**Key Exports:**
- `SchemaValidationError` - Zod validation errors
- `NodeExecutionError` - Runtime execution errors
- `ErrorFeedback` interface

**Tests:** ❌ None
**Testable Logic:**
- Error construction - Verify message formatting
- Error serialization - Test error data extraction
- ErrorFeedback structure validation

---

### `nodes.ts` (53.8 KB)
**Purpose:** Node factory functions for graph workflows

**Key Exports:**
- Node factories: `agentNode()`, `toolNode()`, `decisionNode()`, `waitNode()`, `askUserNode()`, `parallelNode()`, `subgraphNode()`, `contextMonitorNode()`, `customToolNode()`, `subagentNode()`, `parallelSubagentNode()`, `clearContextNode()`
- Context monitoring: `checkContextUsage()`, `compactContext()`, `isContextThresholdExceeded()`
- Client provider: `setClientProvider()`, `getClientProvider()`
- Workflow resolver: `setWorkflowResolver()`, `getWorkflowResolver()`
- Configuration interfaces for each node type

**Tests:** ❌ None
**Testable Logic:**
- Node creation - Verify NodeDefinition structure for each factory
- Tool argument validation - Test Zod schema validation
- Output mapping - Test state update generation
- Decision routing - Test route selection
- Parallel execution - Test Promise.allSettled behavior
- Context usage calculation - Test with various token counts
- Threshold detection - Test boundary conditions

---

### `nodes/ralph.ts`
**Purpose:** Prompt utilities for /ralph workflow

**Key Exports:**
- `buildSpecToTasksPrompt()` - Generate task decomposition prompt
- `buildTaskListPreamble()` - Format task list preamble

**Tests:** ❌ None
**Testable Logic:**
- Prompt generation - Verify prompt contains required elements
- Task list formatting - Test with various task structures
- Dependency tracking (blockedBy field) - Verify correct formatting

---

### `subagent-bridge.ts`
**Purpose:** Sub-agent execution bridge for workflows

**Key Exports:**
- `SubagentGraphBridge` class
- `spawn()`, `spawnParallel()` methods
- `SubagentResult`, `SubagentSpawnOptions` interfaces
- Singleton accessors: `setSubagentBridge()`, `getSubagentBridge()`

**Tests:** ❌ None
**Testable Logic:**
- Sub-agent spawning - Test session creation and message sending
- Result persistence - Verify output file creation
- Parallel spawning - Test Promise.allSettled behavior
- Duration measurement - Verify timing accuracy
- Tool invocation counting - Test tool use tracking

---

### `subagent-registry.ts`
**Purpose:** Registry for discovered sub-agents

**Key Exports:**
- `SubagentTypeRegistry` class
- `SubagentEntry` interface
- Singleton accessors: `getSubagentRegistry()`, `setSubagentRegistry()`
- `populateSubagentRegistry()` - Discovery function

**Tests:** ❌ None
**Testable Logic:**
- Registry operations - Test register/get/has/getAll/clear
- Agent discovery - Test with mock filesystem
- Priority resolution - Local agents override global
- Name normalization - Case handling

---

## `models/` Directory

### `index.ts` (8 lines)
**Purpose:** Re-export barrel for models module

**Tests:** ❌ None

---

### `model-operations.ts`
**Purpose:** Unified model operations interface

**Key Exports:**
- `UnifiedModelOperations` class
- `ModelOperations` interface
- `SetModelResult` interface
- `CLAUDE_ALIASES` - Model alias mappings

**Methods:**
- `listModels()` - Get available models for agent
- `setModel()` - Set active model with validation
- `getCurrentModel()`, `getPendingModel()` - Get model state
- `resolveModel()` - Resolve aliases

**Tests:** ❌ None
**Testable Logic:**
- Model listing - Test with mock SDK clients
- Model validation - Test with valid/invalid model IDs
- Alias resolution - Test Claude aliases
- Agent-specific behavior - Test Copilot session requirement

---

### `model-transform.ts`
**Purpose:** Model format transformations

**Key Exports:**
- `Model` interface - Unified model format
- Transform functions: `fromClaudeModelInfo()`, `fromCopilotModelInfo()`, `fromOpenCodeModel()`, `fromOpenCodeProvider()`
- `OpenCodeModel` interface

**Tests:** ❌ None
**Testable Logic:**
- Claude transformation - Test with sample ModelInfo
- Copilot transformation - Test with sample ModelInfo
- OpenCode transformation - Test with sample model data
- Metadata extraction - Verify capabilities, limits, costs
- Error handling - Missing required fields

---

## `sdk/` Directory

### `index.ts` (119 lines)
**Purpose:** Central export hub for SDK

**Key Exports:**
- All types from `types.ts`
- Client implementations: `ClaudeAgentClient`, `OpenCodeClient`, `CopilotClient`
- Base utilities: `EventEmitter`, `createAgentEvent`, `stripProviderPrefix`
- Tool types and utilities

**Tests:** ❌ None

---

### `types.ts`
**Purpose:** Unified SDK interface definitions

**Key Types:**
- `CodingAgentClient` - Main client interface
- `Session` - Agent session interface
- `AgentMessage`, `AgentEvent` - Communication types
- `SessionConfig`, `PermissionMode`, `OpenCodeAgentMode` - Configuration
- `ToolDefinition`, `ToolContext` - Tool system
- `EventType` + `EventDataMap` - Event types

**Tests:** ❌ None
**Testable Logic:**
- Type validation - Create sample objects matching interfaces
- Event type completeness - Verify all event types covered

---

### `base-client.ts`
**Purpose:** Shared SDK utilities

**Key Exports:**
- `EventEmitter` class - Event handling system
- `createAgentEvent()` - Event factory
- `requireRunning()` - State validation
- `ClientState` interface

**Tests:** ❌ None
**Testable Logic:**
- `EventEmitter` - Test on/emit/removeAllListeners
- `createAgentEvent()` - Verify event structure
- `requireRunning()` - Test with running/stopped states

---

### `claude-client.ts` (40.5 KB)
**Purpose:** Claude Agent SDK implementation

**Key Exports:**
- `ClaudeAgentClient` class
- `createClaudeAgentClient()` factory
- `ClaudeHookConfig` interface

**Key Logic:**
- Session lifecycle via SDK's query()
- Hook event mapping to unified EventType
- MCP server integration
- Permission handling
- Session resumption

**Tests:** ❌ None
**Testable Logic:**
- Client lifecycle - Test start/stop
- Event mapping - Verify HookEvent → AgentEvent transformation
- Tool registration - Test MCP server creation
- Permission callback - Test canUseTool logic
- Session creation - Test config propagation

---

### `opencode-client.ts` (54.8 KB)
**Purpose:** OpenCode SDK implementation

**Key Exports:**
- `OpenCodeClient` class
- `createOpenCodeClient()` factory
- `OpenCodeClientOptions` interface

**Key Logic:**
- SSE stream handling
- Agent mode support (build, plan, general, explore)
- MCP bridge generation
- Health checks and auto-start
- Question.asked HITL events

**Tests:** ✅ `opencode-client.mcp-snapshot.test.ts` (115 lines)

**Test Coverage:**
- `buildOpenCodeMcpSnapshot()` - Tests snapshot building from status/tools/resources
- Partial snapshot handling - One source succeeds
- Null snapshot - All sources fail
- Auth status mapping
- Tool deduplication
- Resource association

**Untested Logic:**
- Full client lifecycle (start, session creation, stop)
- SSE stream parsing
- Agent mode switching
- Health check logic
- MCP bridge script generation

---

### `copilot-client.ts` (38.3 KB)
**Purpose:** Copilot SDK implementation

**Key Exports:**
- `CopilotClient` class
- `createCopilotClient()` factory
- `CopilotPermissionHandler`, `CopilotConnectionMode`, `CopilotClientOptions`

**Key Logic:**
- Connection modes (stdio, port, cliUrl)
- SessionEvent mapping
- Custom agent loading from .github/agents/
- Permission handling
- Context compaction tracking

**Tests:** ❌ None
**Testable Logic:**
- Client lifecycle
- Connection mode selection
- Agent loading from disk
- Event mapping
- Permission handler execution

---

### `init.ts`
**Purpose:** SDK initialization helpers

**Key Exports:**
- `initClaudeOptions()` - Claude settings sources + permissions
- `initOpenCodeConfigOverrides()` - OpenCode permission rules
- `initCopilotSessionOptions()` - Copilot auto-approval

**Tests:** ❌ None
**Testable Logic:**
- Options generation - Verify structure for each SDK
- Permission defaults - Test approval/denial rules

---

### `sdk/tools/` Directory

#### `index.ts` (11 lines)
**Purpose:** Re-export barrel for tools module

**Tests:** ❌ None

---

#### `discovery.ts`
**Purpose:** Custom tool discovery and loading

**Key Exports:**
- `discoverToolFiles()` - Scan directories for tool files
- `loadToolsFromDisk()` - Import and convert tools
- `registerCustomTools()` - Register with SDK clients
- `getDiscoveredCustomTools()` - Get loaded tools
- `ToolSource`, `DiscoveredToolFile` types

**Tests:** ❌ None
**Testable Logic:**
- File discovery - Test with mock filesystem
- Tool import - Test with sample tool modules
- Zod to JSON Schema conversion
- Deduplication (local overrides global)
- Validation wrapper execution
- Output truncation

---

#### `opencode-mcp-bridge.ts`
**Purpose:** MCP server generation for OpenCode

**Key Exports:**
- `createToolMcpServerScript()` - Generate MCP server script
- `cleanupMcpBridgeScripts()` - Cleanup temp files

**Tests:** ❌ None
**Testable Logic:**
- Script generation - Verify valid JavaScript output
- Tool serialization - Test with various tool shapes
- MCP protocol implementation - Verify initialize/tools/list/tools/call methods
- Cleanup - Test file removal

---

#### `plugin.ts`
**Purpose:** Type-safe tool definition helper

**Key Exports:**
- `tool()` function - Identity function for IDE support
- `ToolInput<T>` interface

**Tests:** ❌ None
**Testable Logic:**
- Type inference - Verify TypeScript types are correct
- Schema access - `tool.schema` returns Zod instance

---

#### `registry.ts`
**Purpose:** Tool registry singleton

**Key Exports:**
- `ToolRegistry` class - Register/get/getAll/clear operations
- `ToolEntry` interface
- Singleton accessors

**Tests:** ❌ None
**Testable Logic:**
- Registry operations - Test register/get/has/getAll/clear
- Entry storage - Verify metadata persistence
- Lookup by name - Test case sensitivity

---

#### `schema-utils.ts`
**Purpose:** Zod to JSON Schema conversion

**Key Exports:**
- `zodToJsonSchema()` - Convert Zod to JSON Schema
- `JsonSchema` interface

**Tests:** ❌ None
**Testable Logic:**
- Schema conversion - Test with various Zod types (string, number, object, array, optional, etc.)
- Error handling - Invalid Zod schemas

---

#### `todo-write.ts`
**Purpose:** TodoWrite tool implementation

**Key Exports:**
- `createTodoWriteTool()` - Factory function
- `TodoItem` interface

**Tests:** ❌ None
**Testable Logic:**
- Tool creation - Verify ToolDefinition structure
- Todo state management - Test add/update/list operations
- Summary generation - Verify counts (done/in progress/pending)

---

#### `truncate.ts`
**Purpose:** Tool output truncation

**Key Exports:**
- `truncateToolOutput()` - Truncate at 2000 lines or 50KB

**Tests:** ❌ None
**Testable Logic:**
- Line truncation - Test with > 2000 lines
- Size truncation - Test with > 50KB
- Notice formatting - Verify truncation message

---

## `telemetry/` Directory

### `index.ts` (45 lines)
**Purpose:** Public API for telemetry module

**Key Exports:**
- All types from `types.ts`
- Core functions: `isTelemetryEnabled`, `setTelemetryEnabled`, `getTelemetryFilePath`
- Tracking functions: `trackAtomicCommand`, `trackAgentSession`, `createTuiTelemetrySessionTracker`
- Consent: `handleTelemetryConsent`
- Upload: `handleTelemetryUpload`, `filterStaleEvents`

**Tests:** ❌ None

---

### `types.ts`
**Purpose:** Telemetry event schema

**Key Types:**
- `TelemetryState` - Persistent state
- `AtomicCommandType`, `AgentType` - Command/agent enums
- `TelemetryEvent` - Discriminated union of all event types
- Event types: `AtomicCommandEvent`, `CliCommandEvent`, `AgentSessionEvent`, `TuiSessionStartEvent`, `TuiSessionEndEvent`, `TuiMessageSubmitEvent`, `TuiCommandExecutionEvent`, `TuiToolLifecycleEvent`, `TuiInterruptEvent`

**Tests:** ❌ None
**Testable Logic:**
- Type guards for discriminated unions
- Event structure validation

---

### `constants.ts`
**Purpose:** Tracked command registry

**Key Exports:**
- `ATOMIC_COMMANDS` array - All tracked slash commands
- `AtomicCommand` type

**Tests:** ❌ None
**Testable Logic:**
- Command completeness - Verify all workflow/skill commands included

---

### `telemetry.ts`
**Purpose:** Core telemetry state management

**Key Exports:**
- `generateAnonymousId()` - UUID generation
- `getTelemetryFilePath()` - Config file path
- `getOrCreateTelemetryState()` - Lazy init with monthly rotation
- `isTelemetryEnabled()`, `isTelemetryEnabledSync()` - Priority-based checks
- `setTelemetryEnabled()` - Enable/disable with consent tracking

**Tests:** ❌ None
**Testable Logic:**
- UUID generation - Verify format
- Monthly rotation - Test timestamp comparison
- Priority logic - CI > env > config
- File I/O - Test with mock filesystem

---

### `telemetry-cli.ts`
**Purpose:** CLI command tracking

**Key Exports:**
- `trackAtomicCommand()` - Log command execution
- `createBaseEvent()` - Event factory

**Tests:** ❌ None
**Testable Logic:**
- Event structure - Verify fields
- File append - Test with mock filesystem

---

### `telemetry-consent.ts`
**Purpose:** First-run consent flow

**Key Exports:**
- `isFirstRun()` - Detect first-time setup
- `promptTelemetryConsent()` - Interactive prompt
- `handleTelemetryConsent()` - Full flow orchestration

**Tests:** ❌ None
**Testable Logic:**
- First-run detection - Test with/without existing state
- Consent persistence - Verify state updates
- Prompt only shown once - Test repeat calls

---

### `telemetry-errors.ts`
**Purpose:** Error handling

**Key Exports:**
- `handleTelemetryError()` - Silent-by-default error logging

**Tests:** ❌ None
**Testable Logic:**
- Debug mode logging - Test with ATOMIC_TELEMETRY_DEBUG=1
- Silent failure - Verify no throws

---

### `telemetry-file-io.ts`
**Purpose:** JSONL file operations

**Key Exports:**
- `getEventsFilePath()` - Events file path
- `appendEvent()` - Atomic append-only writes

**Tests:** ❌ None
**Testable Logic:**
- File path generation - Verify format
- JSONL append - Test line format
- Atomic writes - Test concurrent appends (requires OS-level testing)

---

### `telemetry-session.ts`
**Purpose:** Agent session tracking

**Key Exports:**
- `extractCommandsFromTranscript()` - Parse JSONL transcript
- `createSessionEvent()` - Factory for AgentSessionEvent
- `trackAgentSession()` - Log session

**Tests:** ❌ None
**Testable Logic:**
- Command extraction - Test with sample transcripts (various formats)
- Skip non-user messages - Verify filtering
- Session event creation - Verify structure

---

### `telemetry-tui.ts`
**Purpose:** Chat UI tracking

**Key Exports:**
- `TuiTelemetrySessionTracker` class
- Methods: `trackMessageSubmit()`, `trackCommandExecution()`, `trackToolStart()`, `trackToolComplete()`, `trackInterrupt()`, `end()`
- `createTuiTelemetrySessionTracker()` - Factory function

**Tests:** ❌ None
**Testable Logic:**
- Session tracking - Test lifecycle (start, events, end)
- Event counting - Verify message/tool counts
- Duration calculation - Test timing
- Event emission - Verify event structure

---

### `telemetry-upload.ts`
**Purpose:** Event upload to Azure App Insights

**Key Exports:**
- `readEventsFromJSONL()` - Parse local buffer
- `filterStaleEvents()` - Remove events > 30 days
- `splitIntoBatches()` - 100-event batches
- `handleTelemetryUpload()` - Main upload flow
- `emitEventsToAppInsights()` - OpenTelemetry emission

**Tests:** ❌ None
**Testable Logic:**
- JSONL parsing - Test with various line formats
- Stale event filtering - Test with old/new timestamps
- Batch splitting - Test with various event counts
- File claiming - Test atomic lock acquisition
- Cleanup on success - Verify file deletion

---

### `graph-integration.ts`
**Purpose:** Workflow telemetry tracking

**Key Exports:**
- `trackWorkflowExecution()` - Create tracker with sampling
- `WorkflowTracker` interface - Methods for workflow lifecycle
- `WorkflowTelemetryEvent` type

**Tests:** ❌ None
**Testable Logic:**
- Sampling logic - Test with various sample rates
- No-op when disabled - Verify no-op implementation
- Event emission - Test with mock telemetry

---

## `ui/` Directory

### `index.ts`
**Purpose:** Chat UI entry point

**Key Exports:**
- `startChatUI()` - Main function to start TUI
- `ChatUIConfig` - Configuration interface
- `buildCapabilitiesSystemPrompt()` - System prompt builder

**Tests:** ❌ None
**Testable Logic:**
- System prompt generation - Verify includes commands/skills/agents
- Theme configuration - Test theme application
- Error boundary - Test error handling
- Telemetry session tracking - Verify tracking calls

---

### `types.ts`
**Purpose:** Shared UI types

**Key Types:**
- `FooterState` - Footer status bar state
- `EnhancedMessageMeta` - Message metadata
- `VerboseProps`, `TimestampProps`, etc. - Component props

**Tests:** ❌ None

---

### `ui/commands/` Directory

#### `index.ts`
**Purpose:** Command system entry point

**Key Exports:**
- `initializeCommands()`, `initializeCommandsAsync()` - Registration functions
- `parseSlashCommand()`, `isSlashCommand()`, `getCommandPrefix()` - Utilities
- `ParsedSlashCommand` type

**Tests:** ❌ None
**Testable Logic:**
- Command parsing - Test with various slash command formats
- Command/args splitting - Test edge cases (empty args, special chars)
- Prefix extraction - Test command prefix detection

---

#### `registry.ts`
**Purpose:** Command registry

**Key Exports:**
- `CommandRegistry` class - Register/lookup/search/execute
- `globalRegistry` singleton
- `CommandDefinition`, `CommandContext`, `CommandResult` interfaces

**Tests:** ❌ None
**Testable Logic:**
- Registration - Test command/alias registration
- Lookup - Test by name and alias
- Search - Test prefix matching for autocomplete
- Priority sorting - Verify workflow > skill > agent > builtin
- Conflict detection - Test duplicate names/aliases

---

#### `builtin-commands.ts`
**Purpose:** Core slash commands

**Key Commands:**
- `/help` - List all commands
- `/theme` - Toggle theme
- `/clear` - Clear messages
- `/compact` - Compress context
- `/exit`, `/quit` - Exit app
- `/model` - Switch/list models
- `/mcp` - View/toggle MCP servers
- `/context` - Display context usage

**Tests:** ❌ None
**Testable Logic:**
- Help command - Verify output format, grouping
- Theme command - Test toggle logic
- Model command - Test listing, switching, validation
- MCP command - Test toggle application
- Context command - Test usage calculation and display

---

#### `workflow-commands.ts` (62.8 KB)
**Purpose:** Workflow command registration

**Key Exports:**
- `registerWorkflowCommands()` - Register workflow commands
- `loadWorkflowsFromDisk()` - Discover workflows
- `WORKFLOW_DEFINITIONS` - Built-in workflows (/ralph)

**Tests:** ❌ None
**Testable Logic:**
- Workflow discovery - Test with mock filesystem
- Metadata parsing - Test workflow definition parsing
- Resume functionality - Test session ID handling
- Task decomposition - Test spec parsing
- Workflow state persistence

---

#### `skill-commands.ts` (30.1 KB)
**Purpose:** Skill command registration

**Key Exports:**
- `registerSkillCommands()` - Register skills
- `discoverAndRegisterDiskSkills()` - Discover from disk
- `BUILTIN_SKILLS` - Embedded skills

**Built-in Skills:**
- `/research-codebase`
- `/create-spec`
- `/explain-code`
- `/debug-error`
- `/refactor-code`
- `/write-tests`
- `/improve-docs`

**Tests:** ❌ None
**Testable Logic:**
- Skill discovery - Test with mock filesystem
- Metadata parsing - Test frontmatter extraction
- Priority resolution - Local > global > builtin
- Argument expansion - Test $ARGUMENTS placeholder
- Required argument validation

---

#### `agent-commands.ts`
**Purpose:** Agent command registration

**Key Exports:**
- `registerAgentCommands()` - Register agents
- `discoverAgentInfos()` - Discover agents from disk

**Tests:** ❌ None
**Testable Logic:**
- Agent discovery - Test with mock filesystem
- Frontmatter parsing - Test name/description extraction
- Priority resolution - Project > user
- Path expansion - Test tilde expansion

---

### `ui/components/index.ts`
**Purpose:** Component exports

**Key Components:**
- `Autocomplete`, `UserQuestionDialog`, `ToolResult`, `SkillLoadIndicator`, `QueueIndicator`, `TimestampDisplay`, `AnimatedBlinkIndicator`, `ParallelAgentsTree`, `ModelSelectorDialog`, `ContextInfoDisplay`, `AppErrorBoundary`, `FooterStatus`

**Tests:** ❌ None (components best tested with integration tests)

---

### `ui/constants/` Directory

#### `icons.ts`
**Purpose:** Unicode icon definitions

**Key Exports:**
- `STATUS` - Status indicators
- `TREE` - Tree drawing chars
- `CONNECTOR` - Connector chars
- `ARROW` - Arrow indicators
- `SPINNER_FRAMES` - Braille spinner
- `PROGRESS`, `CHECKBOX`, `SCROLLBAR`, `SEPARATOR`, `MISC`

**Tests:** ❌ None

---

#### `spinner-verbs.ts`
**Purpose:** Dynamic spinner verbs

**Key Exports:**
- `SPINNER_VERBS` - Action verbs array
- `COMPLETION_VERBS` - Past-tense verbs
- `getRandomVerb()`, `getRandomCompletionVerb()` - Random selectors

**Tests:** ❌ None
**Testable Logic:**
- Random selection - Test distribution
- Verb completeness - Verify arrays not empty

---

### `ui/hooks/` Directory

#### `use-streaming-state.ts`
**Purpose:** Streaming state management hook

**Key Exports:**
- `useStreamingState()` hook
- `StreamingState`, `ToolExecutionState` types
- Helper functions: `createInitialStreamingState()`, `createToolExecution()`, `getActiveToolExecutions()`

**Tests:** ❌ None
**Testable Logic:**
- State initialization - Verify default state
- Tool execution tracking - Test lifecycle (pending → running → completed/error)
- Question queueing - Test add/remove operations
- State updates - Verify immutability

---

#### `use-verbose-mode.ts`
**Purpose:** Verbose mode toggle hook

**Key Exports:**
- `useVerboseMode()` hook

**Tests:** ❌ None
**Testable Logic:**
- Toggle behavior - Test on/off switching
- Initial state - Verify default

---

#### `use-message-queue.ts`
**Purpose:** Message queue management hook

**Key Exports:**
- `useMessageQueue()` hook
- `QueuedMessage` type
- Constants: `MAX_QUEUE_SIZE`, `QUEUE_SIZE_WARNING_THRESHOLD`

**Tests:** ❌ None
**Testable Logic:**
- Enqueue/dequeue - Test FIFO behavior
- Size limits - Test max size enforcement
- Reordering - Test moveUp/moveDown
- Edit operation - Test message modification

---

### `ui/tools/registry.ts`
**Purpose:** Tool-specific renderers

**Key Exports:**
- `TOOL_RENDERERS` - Registry of tool renderers
- Specific renderers: `readToolRenderer`, `editToolRenderer`, `bashToolRenderer`, etc.
- Helper functions: `getToolRenderer()`, `parseMcpToolName()`

**Tests:** ❌ None
**Testable Logic:**
- Renderer lookup - Test by tool name
- Default renderer - Test fallback
- Parameter extraction - Test with various tool formats
- Output parsing - Test JSON/plain text parsing
- Language detection - Test from file extensions

---

### `ui/utils/` Directory

#### `format.ts`
**Purpose:** Formatting utilities

**Key Exports:**
- `formatDuration()` - ms to readable format
- `formatTimestamp()` - ISO to 12-hour time
- `truncateText()` - Ellipsis truncation

**Tests:** ❌ None
**Testable Logic:**
- Duration formatting - Test various durations (ms, seconds, minutes)
- Timestamp formatting - Test various ISO timestamps
- Text truncation - Test with various lengths

---

#### `mcp-output.ts`
**Purpose:** MCP server display utilities

**Key Exports:**
- `buildMcpSnapshotView()` - Build MCP display
- `applyMcpServerToggles()` - Apply toggle overrides
- `getActiveMcpServers()` - Filter active servers

**Tests:** ✅ `mcp-output.test.ts` (138 lines)

**Test Coverage:**
- Toggle override application - Verify enabled state changes
- Active server filtering - Test with toggle map
- Snapshot building - Test sorting, masking, tool normalization
- Sensitive value masking - Headers, env vars
- Tool name normalization - Claude MCP prefix removal
- Wildcard tools - Test ['*'] handling
- Runtime tools override config tools
- Config tools whitelist filters runtime tools

**Untested Logic:**
- Transport format display
- Status indicators

---

#### `transcript-formatter.ts`
**Purpose:** Transcript line formatting

**Key Exports:**
- `formatTranscript()` - Main formatting function
- `TranscriptLine`, `FormatTranscriptOptions` types

**Tests:** ✅ `transcript-formatter.hitl.test.ts` (37 lines)

**Test Coverage:**
- HITL response rendering - Verify canonical text instead of raw JSON

**Untested Logic:**
- Full transcript formatting (user prompts, thinking traces, tool calls, agent trees, completion summaries)
- File read formatting
- Timestamp/model display
- Footer generation

---

#### `conversation-history-buffer.ts`
**Purpose:** Conversation history persistence

**Key Exports:**
- `appendToHistoryBuffer()` - Append messages
- `replaceHistoryBuffer()` - Replace entire buffer
- `readHistoryBuffer()` - Read persisted history
- `clearHistoryBuffer()` - Clear buffer
- `appendCompactionSummary()` - Add compaction marker

**Tests:** ❌ None
**Testable Logic:**
- File operations - Test with mock filesystem
- Message merging - Test with existing history
- Compaction markers - Test insertion
- Error handling - File I/O failures

---

#### `hitl-response.ts`
**Purpose:** Human-in-the-loop response utilities

**Key Exports:**
- `formatHitlDisplayText()` - Format response for display
- `normalizeHitlAnswer()` - Normalize user answer
- `getHitlResponseRecord()` - Extract response from tool call

**Tests:** ✅ `hitl-response.test.ts` (73 lines)

**Test Coverage:**
- `normalizeHitlAnswer()` - Empty answers, declined responses, chat-about-this responses
- `getHitlResponseRecord()` - Legacy output shape, structured hitlResponse field

**Untested Logic:**
- `formatHitlDisplayText()` complete coverage for all response modes

---

#### `navigation.ts`
**Purpose:** List navigation utilities

**Key Exports:**
- `navigateUp()`, `navigateDown()` - Wrap-around navigation

**Tests:** ❌ None
**Testable Logic:**
- Wrap-around behavior - Test boundary conditions
- Empty list handling
- Single item list

---

## `utils/` Directory

### `atomic-config.ts`
**Purpose:** Project config persistence

**Key Exports:**
- `AtomicConfig` interface
- `readAtomicConfig()`, `saveAtomicConfig()`, `getSelectedScm()`

**Tests:** ❌ None
**Testable Logic:**
- Config read/write - Test with mock filesystem
- Merge behavior - Verify existing config preservation
- SCM getter - Test with various config states

---

### `cleanup.ts`
**Purpose:** Windows leftover file cleanup

**Key Exports:**
- `cleanupWindowsLeftoverFiles()` - Main cleanup
- `cleanupLeftoverFilesAt()`, `tryRemoveFile()` - Helpers

**Tests:** ❌ None
**Testable Logic:**
- File cleanup - Test with mock filesystem
- Locked file handling - Verify silent failure
- Platform detection - Verify no-op on non-Windows

---

### `colors.ts`
**Purpose:** ANSI color codes

**Key Exports:**
- `COLORS` object - Color codes

**Tests:** ❌ None
**Testable Logic:**
- NO_COLOR respect - Test with env var set
- Color code format - Verify ANSI codes

---

### `config-path.ts`
**Purpose:** Config path resolution

**Key Exports:**
- `detectInstallationType()` - Identify install type
- `getConfigRoot()` - Get config directory
- `getBinaryDataDir()`, `getBinaryPath()`, `getBinaryInstallDir()` - Binary paths
- `configDataDirExists()` - Validate directory

**Tests:** ❌ None
**Testable Logic:**
- Installation type detection - Test with various env vars
- Path resolution - Test for each install type
- Platform-specific paths - Windows vs Unix
- Error messages - Missing data directory

---

### `copy.ts`
**Purpose:** Directory and file copying

**Key Exports:**
- `copyDir()` - Recursive copy with exclusions
- `copyFile()` - Single file copy
- `normalizePath()`, `isPathSafe()` - Path utilities
- `pathExists()`, `isDirectory()`, `isFileEmpty()` - File utilities

**Tests:** ❌ None
**Testable Logic:**
- Recursive copying - Test with mock filesystem
- Exclusion patterns - Test with various exclusions
- Path safety - Test with traversal attempts
- Empty file detection - Test with whitespace-only files

---

### `detect.ts`
**Purpose:** Platform and command detection

**Key Exports:**
- `isWindows()`, `isMacOS()`, `isLinux()` - Platform checks
- `isCommandInstalled()`, `getCommandPath()` - Command detection
- `getScriptExtension()` - Platform script extensions
- `isWslInstalled()` - WSL detection
- `supportsColor()`, `supportsTrueColor()`, `supports256Color()` - Color support

**Tests:** ❌ None
**Testable Logic:**
- Platform detection - Test with various process.platform values
- Command existence - Test with mock command paths
- Color support - Test with various COLORTERM values
- WSL detection - Test with mock filesystem

---

### `download.ts`
**Purpose:** GitHub release and file downloads

**Key Exports:**
- `getLatestRelease()`, `getReleaseByVersion()` - Fetch releases
- `downloadFile()` - Download with progress
- `verifyChecksum()`, `parseChecksums()` - SHA256 verification
- `getBinaryFilename()`, `getConfigArchiveFilename()` - Platform names
- `ChecksumMismatchError` - Custom error

**Tests:** ❌ None
**Testable Logic:**
- Release fetching - Test with mock GitHub API
- Download with progress - Test progress callbacks
- Checksum verification - Test with known checksums
- Filename generation - Test for each platform
- Rate limit handling

---

### `file-lock.ts`
**Purpose:** File-based locking

**Key Exports:**
- `acquireLock()`, `tryAcquireLock()` - Lock acquisition
- `releaseLock()` - Lock release
- `withLock()` - Transactional access
- `cleanupStaleLocks()` - Remove dead locks

**Tests:** ❌ None
**Testable Logic:**
- Lock acquisition/release - Test lifecycle
- Timeout behavior - Test retry logic
- Stale lock cleanup - Test with dead PID
- Concurrent access - Test with multiple processes (integration test)

---

### `markdown.ts`
**Purpose:** Markdown frontmatter parsing

**Key Exports:**
- `parseMarkdownFrontmatter()` - Extract frontmatter + body

**Tests:** ❌ None
**Testable Logic:**
- YAML parsing - Test with various frontmatter formats
- Body extraction - Test with/without frontmatter
- Array/object parsing in frontmatter
- Missing frontmatter - Test fallback

---

### `mcp-config.ts`
**Purpose:** MCP config discovery

**Key Exports:**
- `parseClaudeMcpConfig()` - Parse .mcp.json
- `parseCopilotMcpConfig()` - Parse mcp-config.json
- `parseOpenCodeMcpConfig()` - Parse opencode.json
- `discoverMcpConfigs()` - Unified discovery

**Tests:** ❌ None
**Testable Logic:**
- Config parsing - Test with sample configs for each format
- Discovery - Test with mock filesystem
- Merging - Test user + project configs
- Built-in defaults - Verify deepwiki included

---

### `merge.ts`
**Purpose:** JSON file merging

**Key Exports:**
- `mergeJsonFile()` - Deep merge mcpServers

**Tests:** ❌ None
**Testable Logic:**
- Deep merge - Test with nested objects
- Key preservation - Non-mcpServers keys preserved
- File I/O - Test with mock filesystem

---

### `settings.ts`
**Purpose:** User preference persistence

**Key Exports:**
- `getModelPreference()`, `saveModelPreference()` - Model selection
- `getReasoningEffortPreference()`, `saveReasoningEffortPreference()` - Reasoning level
- `clearReasoningEffortPreference()` - Clear preference

**Tests:** ❌ None
**Testable Logic:**
- Preference read/write - Test with mock filesystem
- Agent-specific settings - Test isolation
- Local > global priority - Test override behavior
- Clear operation - Verify removal

---

### `utils/banner/` Directory

#### `constants.ts`
**Purpose:** Pre-computed banner artwork

**Key Exports:**
- `LOGO_TRUE_COLOR`, `LOGO` - Banner variants
- `LOGO_MIN_COLS`, `LOGO_MIN_ROWS` - Size requirements

**Tests:** ❌ None

---

#### `banner.ts`
**Purpose:** Banner display

**Key Exports:**
- `displayBanner()` - Display with size/color checks

**Tests:** ❌ None
**Testable Logic:**
- Terminal size check - Test with various dimensions
- Color support detection - Test fallback to 256-color

---

#### `index.ts`
**Purpose:** Re-export

**Tests:** ❌ None

---

## `workflows/` Directory

### `index.ts` (8 lines)
**Purpose:** Re-export barrel

**Tests:** ❌ None

---

### `session.ts`
**Purpose:** Workflow session management

**Key Exports:**
- `WorkflowSession` interface
- `WORKFLOW_SESSIONS_DIR` constant
- `generateWorkflowSessionId()`, `getWorkflowSessionDir()`, `initWorkflowSession()`, `saveWorkflowSession()`, `saveSubagentOutput()`

**Tests:** ❌ None
**Testable Logic:**
- Session ID generation - Verify UUID format
- Directory creation - Test with mock filesystem
- Session persistence - Test save/load
- Sub-agent output storage - Test file creation

---

## Test Coverage Summary

### ✅ **Files WITH Tests (5 files):**

1. **`src/commands/init.test.ts`** (111 lines)
   - **Covers:** `reconcileScmVariants()` function
   - **Tests:** Sapling variant removal, GitHub variant removal, directory-based skills, missing directories

2. **`src/ui/utils/hitl-response.test.ts`** (73 lines)
   - **Covers:** `normalizeHitlAnswer()`, `getHitlResponseRecord()`
   - **Tests:** Empty answers, declined responses, chat-about-this responses, legacy output shape, structured response field

3. **`src/ui/utils/transcript-formatter.hitl.test.ts`** (37 lines)
   - **Covers:** `formatTranscript()` HITL rendering
   - **Tests:** Canonical HITL text rendering (not raw JSON)

4. **`src/ui/utils/mcp-output.test.ts`** (138 lines)
   - **Covers:** `applyMcpServerToggles()`, `buildMcpSnapshotView()`, `getActiveMcpServers()`
   - **Tests:** Toggle overrides, active filtering, snapshot building, sensitive masking, tool normalization, wildcard tools, runtime override, whitelist filtering

5. **`src/sdk/opencode-client.mcp-snapshot.test.ts`** (115 lines)
   - **Covers:** `buildOpenCodeMcpSnapshot()` internal method
   - **Tests:** Snapshot building from status/tools/resources, partial snapshots, null snapshots, auth status mapping, tool deduplication, resource association

### ❌ **Files WITHOUT Tests (96+ files):**

**All other files in:**
- `src/` (cli.ts, config.ts, version.ts)
- `src/commands/` (chat.ts, config.ts, uninstall.ts, update.ts - except init.test.ts)
- `src/config/` (index.ts, copilot-manual.ts)
- `src/graph/` (all 12 files - types, annotation, builder, compiled, checkpointer, errors, nodes, nodes/ralph, subagent-bridge, subagent-registry, index)
- `src/models/` (all 3 files)
- `src/sdk/` (10 files - types, base-client, claude-client, copilot-client, init, index)
- `src/sdk/tools/` (8 files)
- `src/telemetry/` (all 12 files)
- `src/ui/` (2 files - index, types)
- `src/ui/commands/` (5 files)
- `src/ui/components/` (1 file - index)
- `src/ui/constants/` (2 files)
- `src/ui/hooks/` (3 files)
- `src/ui/tools/` (1 file)
- `src/ui/utils/` (2 untested - conversation-history-buffer, navigation)
- `src/utils/` (all 16 files)
- `src/workflows/` (2 files)

---

## Testable Logic in Untested Modules

### **High-Priority Testable Functions** (Pure functions, data transformations):

1. **`src/commands/update.ts`**
   - `isNewerVersion()` - Semver comparison (pure function)

2. **`src/graph/annotation.ts`**
   - `Reducers.replace()`, `concat()`, `merge()`, `mergeById()` - State merge logic
   - `initializeState()`, `applyStateUpdate()` - State management

3. **`src/graph/types.ts`**
   - Type guards: `isNodeType()`, `isSignal()`, `isExecutionStatus()`, `isBaseState()`, `isNodeResult()`, `isDebugReport()`

4. **`src/models/model-transform.ts`**
   - Transform functions: `fromClaudeModelInfo()`, `fromCopilotModelInfo()`, `fromOpenCodeModel()`

5. **`src/sdk/base-client.ts`**
   - `EventEmitter` class - Event handling
   - `createAgentEvent()` - Event factory

6. **`src/sdk/tools/schema-utils.ts`**
   - `zodToJsonSchema()` - Zod to JSON Schema conversion

7. **`src/sdk/tools/truncate.ts`**
   - `truncateToolOutput()` - Line/size truncation

8. **`src/telemetry/telemetry.ts`**
   - `isTelemetryEnabled()` - Priority logic (CI > env > config)
   - `generateAnonymousId()` - UUID generation

9. **`src/telemetry/telemetry-upload.ts`**
   - `filterStaleEvents()` - Date filtering
   - `splitIntoBatches()` - Batching logic

10. **`src/ui/commands/index.ts`**
    - `parseSlashCommand()` - Command parsing

11. **`src/ui/utils/format.ts`**
    - `formatDuration()`, `formatTimestamp()`, `truncateText()` - Formatting utilities

12. **`src/ui/utils/navigation.ts`**
    - `navigateUp()`, `navigateDown()` - Wrap-around navigation

13. **`src/utils/markdown.ts`**
    - `parseMarkdownFrontmatter()` - YAML parsing

14. **`src/workflows/session.ts`**
    - `generateWorkflowSessionId()` - UUID generation

### **Medium-Priority Testable Functions** (State machines, parsers):

1. **`src/graph/builder.ts`**
   - Node chaining, conditional branching, loop configuration
   - Graph compilation (startNode, endNodes detection)

2. **`src/graph/compiled.ts`**
   - State merging with reducers
   - Retry logic (max attempts, backoff)
   - Edge condition evaluation

3. **`src/graph/checkpointer.ts`**
   - `MemorySaver` operations (save, load, list, delete)

4. **`src/ui/commands/registry.ts`**
   - Registration, lookup, search, priority sorting

5. **`src/ui/hooks/use-message-queue.ts`**
   - Queue operations (enqueue, dequeue, reorder)

6. **`src/ui/tools/registry.ts`**
   - Tool renderer lookup, parameter extraction

7. **`src/utils/copy.ts`**
   - Path safety checks (`isPathSafe()`)

8. **`src/utils/file-lock.ts`**
   - Lock lifecycle (acquire, release, stale cleanup)

### **Low-Priority Testable Functions** (Integration-heavy, I/O-heavy):

- File system operations (most `utils/` functions)
- Network operations (`utils/download.ts`)
- Process spawning (`cli.ts`)
- SDK client lifecycle (all `sdk/*-client.ts` files)

---

## Recommendations for Test Coverage

### **Phase 1: Pure Functions** (Low-hanging fruit)
- Type guards in `graph/types.ts`
- Reducers in `graph/annotation.ts`
- Formatting utilities in `ui/utils/format.ts`
- Navigation in `ui/utils/navigation.ts`
- Version comparison in `commands/update.ts`
- Command parsing in `ui/commands/index.ts`

### **Phase 2: Data Transformations**
- Model transforms in `models/model-transform.ts`
- Schema conversion in `sdk/tools/schema-utils.ts`
- Truncation in `sdk/tools/truncate.ts`
- Markdown parsing in `utils/markdown.ts`
- Telemetry filtering in `telemetry/telemetry-upload.ts`

### **Phase 3: State Management**
- State initialization/updates in `graph/annotation.ts`
- Checkpointer operations in `graph/checkpointer.ts`
- Event emitter in `sdk/base-client.ts`
- Message queue in `ui/hooks/use-message-queue.ts`

### **Phase 4: Complex Logic**
- Graph builder in `graph/builder.ts`
- Graph executor in `graph/compiled.ts`
- Command registry in `ui/commands/registry.ts`
- Tool registry in `ui/tools/registry.ts`

### **Phase 5: Integration Tests**
- Full `initCommand()` flow
- SDK client lifecycle tests
- File locking under concurrency
- Workflow session management

---

## Statistics

- **Total TypeScript files:** ~101 files
- **Files with tests:** 5 (5%)
- **Files without tests:** 96 (95%)
- **Test files:** 5
- **Total test lines:** ~474 lines

**Test Coverage by Module:**
- `commands/`: 1/5 files (20%)
- `config/`: 0/2 files (0%)
- `graph/`: 0/12 files (0%)
- `models/`: 0/3 files (0%)
- `sdk/`: 1/19 files (5%)
- `telemetry/`: 0/12 files (0%)
- `ui/`: 3/38 files (8%)
- `utils/`: 0/16 files (0%)
- `workflows/`: 0/2 files (0%)

**Most Testable (Pure Functions):**
1. `graph/types.ts` - Type guards
2. `graph/annotation.ts` - Reducers
3. `ui/utils/format.ts` - Formatters
4. `commands/update.ts` - Version comparison
5. `sdk/tools/schema-utils.ts` - Schema conversion

**Least Testable (I/O-heavy):**
1. SDK client implementations (claude, opencode, copilot)
2. File system operations in `utils/`
3. Telemetry upload (network operations)
4. CLI entry point with process spawning

---

## Conclusion

This documentation covers all 101+ files in the `src/` directory. The codebase has minimal test coverage (5%), with the majority of testable logic untested. The most impactful tests to add would be for pure functions (type guards, reducers, formatters) and data transformations (model transforms, schema conversion), as these are critical to correctness and easy to test without complex mocking.
