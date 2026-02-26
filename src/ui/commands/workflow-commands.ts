/**
 * Workflow Commands for Chat UI
 *
 * Registers workflow commands as slash commands invocable from the TUI.
 * The /ralph command implements a 3-step looping workflow:
 *   Step 1: Task list decomposition from user prompt
 *   Step 2: Agent dispatches worker sub-agents in a loop until all tasks complete
 *   Step 3: Review & Fix - code review and optional re-invocation with fix-spec
 *
 * Session state is persisted to tasks.json in the workflow session directory.
 */

import { existsSync, watch, type FSWatcher } from "fs";
import { readFile, rename, unlink, writeFile } from "fs/promises";
import { join } from "path";
import type {
    CommandDefinition,
    CommandContext,
    CommandResult,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";
import type { TodoItem } from "../../sdk/tools/todo-write.ts";

import {
    normalizeTodoItem,
    normalizeTodoItems,
    type NormalizedTodoItem,
} from "../utils/task-status.ts";
import {
    initWorkflowSession,
    getWorkflowSessionDir,
    type WorkflowSession,
} from "../../workflows/session.ts";
import type { BaseState, NodeDefinition, Edge } from "../../workflows/graph/types.ts";
import { VERSION } from "../../version.ts";
import { executeWorkflow } from "../../workflows/executor.ts";
import { createRalphWorkflow } from "../../workflows/ralph/graph.ts";
import { ralphWorkflowDefinition } from "../../workflows/ralph/definition.ts";

// ============================================================================
// RALPH COMMAND PARSING
// ============================================================================

/**
 * Parsed arguments for the /ralph command.
 */
export interface RalphCommandArgs {
    prompt: string;
}

export function parseRalphArgs(args: string): RalphCommandArgs {
    const trimmed = args.trim();

    if (!trimmed) {
        throw new Error(
            'Usage: /ralph "<prompt-or-spec-path>"\n' +
                "A prompt argument is required.",
        );
    }

    return { prompt: trimmed };
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * State migration function exported by custom workflows.
 */
export type WorkflowStateMigrator = (
    oldState: unknown,
    fromVersion: number,
) => BaseState;

/**
 * Metadata for a workflow command definition.
 */
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
    /** Optional state migrator for loading persisted state from older versions */
    migrateState?: WorkflowStateMigrator;
    /** Source: built-in, global (~/.atomic/workflows), or local (.atomic/workflows) */
    source?: "builtin" | "global" | "local";
    /** Hint text showing expected arguments (e.g., "PROMPT [--yolo]") */
    argumentHint?: string;
}

/**
 * Standard task interface for workflow task list UI.
 * All task-list-capable workflows must use this shape.
 */
export interface WorkflowTask {
    /** Unique task identifier */
    id: string;
    /** Human-readable task title */
    title: string;
    /** Task status */
    status: "pending" | "in_progress" | "completed" | "failed" | "blocked";
    /** Optional task dependencies (IDs of tasks that must complete first) */
    blockedBy?: string[];
    /** Optional error message if status is "failed" */
    error?: string;
}

/**
 * Declarative graph configuration exported by custom workflows.
 * The framework compiles this into a CompiledGraph.
 */
export interface WorkflowGraphConfig<TState extends BaseState = BaseState> {
    /** Node definitions for the graph */
    nodes: NodeDefinition<TState>[];
    /** Edge definitions connecting nodes */
    edges: Edge<TState>[];
    /** The starting node ID */
    startNode: string;
    /** Maximum iterations for loops (default: 100) */
    maxIterations?: number;
}

/**
 * Parameters passed to a workflow's createState() factory function.
 */
export interface WorkflowStateParams {
    /** The user's prompt text */
    prompt: string;
    /** UUID session ID for this execution */
    sessionId: string;
    /** Session directory path */
    sessionDir: string;
    /** Maximum iterations (from workflow config or global default) */
    maxIterations: number;
}

/**
 * Extended workflow definition that includes execution logic.
 * Backward-compatible with WorkflowMetadata (all new fields optional).
 * Fully declarative — capabilities are inferred from the graph definition.
 */
export interface WorkflowDefinition extends WorkflowMetadata {
    /**
     * Declarative graph configuration for this workflow.
     * The framework validates and compiles this into a CompiledGraph.
     * If absent, the workflow falls back to the generic chat handler.
     */
    graphConfig?: WorkflowGraphConfig;

    /**
     * Factory function to create the initial state for graph execution.
     * Receives the user's prompt and session context.
     */
    createState?: (params: WorkflowStateParams) => BaseState;

    /**
     * Map of node IDs to human-readable progress descriptions.
     * Replaces the hardcoded getNodePhaseDescription().
     * Nodes not in this map are silently skipped in UI progress.
     * Example: { "planner": "🧠 Planning tasks...", "worker": "⚡ Implementing..." }
     */
    nodeDescriptions?: Record<string, string>;
}

// ============================================================================
// WORKFLOW SESSION MANAGEMENT
// ============================================================================

/** Active workflow sessions (keyed by sessionId) */
const activeSessions = new Map<string, WorkflowSession>();

/**
 * Get the current active session (most recent if multiple).
 */
export function getActiveSession(): WorkflowSession | undefined {
    const sessions = Array.from(activeSessions.values());
    return sessions.sort(
        (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
}

/**
 * Register an active workflow session for tracking.
 */
export function registerActiveSession(session: WorkflowSession): void {
    activeSessions.set(session.sessionId, session);
}

/**
 * Complete and remove a session.
 */
export function completeSession(sessionId: string): void {
    activeSessions.delete(sessionId);
}

/**
 * Atomically write a file using a temp file and rename in the same directory.
 * This ensures that readers never see a partially written file.
 *
 * @param targetPath - The final file path to write to
 * @param content - The content to write (string or buffer)
 * @throws Error if write or rename fails
 *
 * @internal
 */
async function atomicWrite(
    targetPath: string,
    content: string | Buffer,
): Promise<void> {
    // Create temp file in same directory as target for atomic rename
    const dir = targetPath.substring(0, targetPath.lastIndexOf("/"));
    const tempPath = join(dir, `.tasks-${crypto.randomUUID()}.tmp`);

    try {
        // Write to temp file
        await Bun.write(tempPath, content);

        // Atomically replace target with temp file
        await rename(tempPath, targetPath);
    } catch (error) {
        // Clean up temp file if it exists
        try {
            await unlink(tempPath);
        } catch {
            // Ignore cleanup errors
        }
        throw error;
    }
}

/**
 * Save tasks to a workflow session directory as tasks.json.
 * Used to persist the task list between context clears.
 *
 * @param tasks - The task items to save
 * @param sessionId - The workflow session ID (used to locate the session directory)
 */
export async function saveTasksToActiveSession(
    tasks: Array<{
        id?: string;
        content: string;
        status: string;
        activeForm: string;
        blockedBy?: string[];
    }>,
    sessionId?: string,
): Promise<void> {
    // Resolve session directory: prefer explicit sessionId, fall back to active session
    let sessionDir: string | undefined;
    if (sessionId) {
        sessionDir = getWorkflowSessionDir(sessionId);
    } else {
        const session = getActiveSession();
        sessionDir = session?.sessionDir;
    }
    if (!sessionDir) {
        console.error(
            "[workflow] saveTasksToActiveSession: no session directory found",
        );
        return;
    }
    const tasksPath = join(sessionDir, "tasks.json");
    try {
        const content = JSON.stringify(
            tasks.map((task) => normalizeTodoItem(task)),
            null,
            2,
        );
        await atomicWrite(tasksPath, content);
    } catch (error) {
        console.error("[workflow] Failed to write tasks.json:", error);
    }
}

/** Read current task state from tasks.json on disk */
async function readTasksFromDisk(
    sessionDir: string,
): Promise<NormalizedTodoItem[]> {
    const tasksPath = join(sessionDir, "tasks.json");
    try {
        const content = await readFile(tasksPath, "utf-8");
        return normalizeTodoItems(JSON.parse(content));
    } catch {
        return [];
    }
}

// ============================================================================
// WORKFLOW DIRECTORY LOADING
// ============================================================================

/**
 * Paths to search for custom workflow definitions.
 * Local workflows (.atomic/workflows) override global (~/.atomic/workflows).
 *
 * The first path is for project-local workflows (highest priority).
 * The second path is for user-global workflows (lower priority).
 *
 * @example
 * // Project-local workflows
 * .atomic/workflows/my-workflow.ts
 *
 * // User-global workflows
 * ~/.atomic/workflows/my-workflow.ts
 */
export const CUSTOM_WORKFLOW_SEARCH_PATHS = [
    // Local project workflows (highest priority)
    ".atomic/workflows",
    // Global user workflows
    "~/.atomic/workflows",
];

/**
 * Expand a path that may contain ~ to the user's home directory.
 *
 * @param path - Path that may start with ~
 * @returns Expanded absolute path
 */
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

const SEMVER_PATTERN =
    /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseSemver(version: string): [number, number, number] | null {
    const normalized = version.trim();

    if (!SEMVER_PATTERN.test(normalized)) {
        return null;
    }

    const coreVersion =
        normalized.replace(/^v/i, "").split(/[+-]/, 1)[0] ?? "0.0.0";
    const [major = "0", minor = "0", patch = "0"] = coreVersion.split(".");

    return [
        Number.parseInt(major, 10),
        Number.parseInt(minor, 10),
        Number.parseInt(patch, 10),
    ];
}

function isWorkflowMinSdkNewerThanCurrent(
    minSdkVersion: string,
    currentSdkVersion: string,
): boolean {
    const minVersion = parseSemver(minSdkVersion);
    const currentVersion = parseSemver(currentSdkVersion);

    if (!minVersion || !currentVersion) {
        return false;
    }

    const [minMajor, minMinor, minPatch] = minVersion;
    const [curMajor, curMinor, curPatch] = currentVersion;

    if (minMajor !== curMajor) return minMajor > curMajor;
    if (minMinor !== curMinor) return minMinor > curMinor;
    return minPatch > curPatch;
}

/**
 * Discover workflow files from disk.
 * Returns paths to .ts files that define workflows.
 *
 * Searches CUSTOM_WORKFLOW_SEARCH_PATHS in order:
 * 1. .atomic/workflows (project-local, highest priority)
 * 2. ~/.atomic/workflows (user-global, lower priority)
 */
export function discoverWorkflowFiles(): {
    path: string;
    source: "local" | "global";
}[] {
    const discovered: { path: string; source: "local" | "global" }[] = [];

    for (let i = 0; i < CUSTOM_WORKFLOW_SEARCH_PATHS.length; i++) {
        const rawPath = CUSTOM_WORKFLOW_SEARCH_PATHS[i]!;
        const searchPath = expandPath(rawPath);
        const source = i === 0 ? "local" : "global";

        if (existsSync(searchPath)) {
            try {
                const files = require("fs").readdirSync(searchPath) as string[];
                for (const file of files) {
                    if (file.endsWith(".ts")) {
                        discovered.push({
                            path: join(searchPath, file),
                            source,
                        });
                    }
                }
            } catch {
                // Skip directories we can't read
            }
        }
    }

    return discovered;
}

/**
 * Dynamically loaded workflows from disk.
 * Populated by loadWorkflowsFromDisk().
 */
let loadedWorkflows: WorkflowDefinition[] = [];

/**
 * Load workflow definitions from .ts files on disk.
 *
 * Workflows are expected to export:
 * - `name`: Workflow name (optional, defaults to filename)
 * - `description`: Human-readable description (optional)
 * - `aliases`: Alternative names (optional)
 * - `version`: Workflow version (optional)
 * - `minSDKVersion`: Minimum required SDK version (optional)
 * - `stateVersion`: Workflow state schema version (optional)
 * - `migrateState(oldState, fromVersion)`: State migration handler (optional)
 * - `graphConfig`: Declarative graph configuration (optional)
 * - `createState`: Factory function to create initial state (optional)
 * - `nodeDescriptions`: Map of node IDs to progress descriptions (optional)
 *
 * Example workflow file (.atomic/workflows/my-workflow.ts):
 * ```typescript
 * export const name = "my-workflow";
 * export const description = "My custom workflow";
 * export const aliases = ["mw"];
 * ```
 *
 * @returns Array of loaded workflow definitions (local workflows override global)
 */
export async function loadWorkflowsFromDisk(): Promise<WorkflowDefinition[]> {
    const discovered = discoverWorkflowFiles();
    const loaded: WorkflowDefinition[] = [];
    const loadedNames = new Set<string>();

    for (const { path, source } of discovered) {
        try {
            // Dynamic import of the workflow file
            const module = await import(path);

            // Extract workflow name from module or filename
            const filename =
                path.split("/").pop()?.replace(".ts", "") ?? "unknown";
            const name = module.name ?? filename;

            // Skip if already loaded (local takes priority over global)
            if (loadedNames.has(name.toLowerCase())) {
                continue;
            }

            const migrateState =
                typeof module.migrateState === "function"
                    ? (module.migrateState as WorkflowStateMigrator)
                    : undefined;

            // Extract new WorkflowDefinition fields (optional)
            const graphConfig = module.graphConfig as WorkflowGraphConfig | undefined;
            const createState = module.createState as ((params: WorkflowStateParams) => BaseState) | undefined;
            const nodeDescriptions = module.nodeDescriptions as Record<string, string> | undefined;

            // Validate graph config (Task #33)
            if (graphConfig) {
                const nodeIds = new Set(graphConfig.nodes.map(n => n.id));
                
                if (!nodeIds.has(graphConfig.startNode)) {
                    console.warn(`[workflow:${name}] startNode "${graphConfig.startNode}" not found in nodes`);
                }
                
                for (const edge of graphConfig.edges) {
                    if (!nodeIds.has(edge.from)) {
                        console.warn(`[workflow:${name}] edge from "${edge.from}" references unknown node`);
                    }
                    if (!nodeIds.has(edge.to)) {
                        console.warn(`[workflow:${name}] edge to "${edge.to}" references unknown node`);
                    }
                }
                
                // Check for orphan nodes (nodes with no edges to/from them, except startNode)
                const nodesWithEdges = new Set<string>();
                for (const edge of graphConfig.edges) {
                    nodesWithEdges.add(edge.from);
                    nodesWithEdges.add(edge.to);
                }
                
                for (const node of graphConfig.nodes) {
                    if (node.id !== graphConfig.startNode && !nodesWithEdges.has(node.id)) {
                        console.warn(`[workflow:${name}] node "${node.id}" is orphaned (no edges to/from it)`);
                    }
                }
            }

            const definition: WorkflowDefinition = {
                name,
                description: module.description ?? `Custom workflow: ${name}`,
                aliases: module.aliases,
                defaultConfig: module.defaultConfig,
                version: module.version,
                minSDKVersion: module.minSDKVersion,
                stateVersion: module.stateVersion,
                migrateState,
                source,
                graphConfig,
                createState,
                nodeDescriptions,
            };

            if (typeof definition.minSDKVersion === "string") {
                if (!parseSemver(definition.minSDKVersion)) {
                    console.warn(
                        `Workflow "${definition.name}" has invalid minSDKVersion "${definition.minSDKVersion}". Expected semver format like "1.2.3".`,
                    );
                } else if (
                    isWorkflowMinSdkNewerThanCurrent(
                        definition.minSDKVersion,
                        VERSION,
                    )
                ) {
                    console.warn(
                        `Workflow "${definition.name}" requires SDK ${definition.minSDKVersion}, but current SDK is ${VERSION}.`,
                    );
                }
            }

            loaded.push(definition);
            loadedNames.add(name.toLowerCase());

            // Also track aliases
            if (definition.aliases) {
                for (const alias of definition.aliases) {
                    loadedNames.add(alias.toLowerCase());
                }
            }
        } catch (error) {
            console.warn(`Failed to load workflow from ${path}:`, error);
        }
    }

    loadedWorkflows = loaded;
    return loaded;
}

/**
 * Get all workflows including built-in and dynamically loaded.
 * Local workflows override global, both override built-in.
 */
export function getAllWorkflows(): WorkflowMetadata[] {
    const allWorkflows: WorkflowMetadata[] = [];
    const seenNames = new Set<string>();

    // First, add dynamically loaded workflows (local > global)
    for (const workflow of loadedWorkflows) {
        const lowerName = workflow.name.toLowerCase();
        if (!seenNames.has(lowerName)) {
            allWorkflows.push(workflow);
            seenNames.add(lowerName);
            // Also track aliases
            if (workflow.aliases) {
                for (const alias of workflow.aliases) {
                    seenNames.add(alias.toLowerCase());
                }
            }
        }
    }

    // Then add built-in workflows (lowest priority)
    for (const workflow of BUILTIN_WORKFLOW_DEFINITIONS) {
        const lowerName = workflow.name.toLowerCase();
        if (!seenNames.has(lowerName)) {
            allWorkflows.push(workflow);
            seenNames.add(lowerName);
        }
    }

    return allWorkflows;
}

// ============================================================================
// WORKFLOW DEFINITIONS
// ============================================================================

/**
 * Built-in workflow definitions.
 * These can be overridden by local or global workflows with the same name.
 */
const BUILTIN_WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
    ralphWorkflowDefinition,
];

// ============================================================================
// COMMAND FACTORY
// ============================================================================

/**
 * Create a command definition for a workflow.
 * Handles both graph-based workflows (via executeWorkflow) and chat-based workflows.
 *
 * @param metadata - Workflow metadata (may be a full WorkflowDefinition)
 * @returns Command definition for the workflow
 */
function createWorkflowCommand(metadata: WorkflowMetadata): CommandDefinition {
    const definition = metadata as WorkflowDefinition;
    const hasExecutionLogic = definition.createState || definition.graphConfig;

    if (hasExecutionLogic) {
        // Graph-based workflow — use executeWorkflow() for full lifecycle
        return {
            name: metadata.name,
            description: metadata.description,
            category: "workflow",
            aliases: metadata.aliases,
            argumentHint: metadata.argumentHint,
            execute: async (
                args: string,
                context: CommandContext,
            ): Promise<CommandResult> => {
                if (context.state.workflowActive) {
                    return {
                        success: false,
                        message: `A workflow is already active (${context.state.workflowType}).`,
                    };
                }

                let parsed: RalphCommandArgs;
                try {
                    parsed = parseRalphArgs(args);
                } catch (e) {
                    return {
                        success: false,
                        message: e instanceof Error ? e.message : String(e),
                    };
                }

                // Ralph uses builder pattern (createRalphWorkflow) instead of declarative graphConfig
                const compiledGraph = definition.name === "ralph"
                    ? createRalphWorkflow() as unknown as import("../../workflows/graph/types.ts").CompiledGraph<BaseState>
                    : undefined;

                return executeWorkflow(definition, parsed.prompt, context, {
                    compiledGraph,
                    saveTasksToSession: saveTasksToActiveSession,
                });
            },
        };
    }

    // Chat-based workflow — simple state update, no graph execution
    return {
        name: metadata.name,
        description: metadata.description,
        category: "workflow",
        aliases: metadata.aliases,
        argumentHint: metadata.argumentHint,
        execute: (args: string, context: CommandContext): CommandResult => {
            if (context.state.workflowActive) {
                return {
                    success: false,
                    message: `A workflow is already active (${context.state.workflowType}). Check research/progress.txt for progress.`,
                };
            }

            const initialPrompt = args.trim() || null;

            if (!initialPrompt) {
                return {
                    success: false,
                    message: `Please provide a prompt for the ${metadata.name} workflow.\nUsage: /${metadata.name} <your task description>`,
                };
            }

            context.addMessage(
                "system",
                `Starting **${metadata.name}** workflow...\n\nPrompt: "${initialPrompt}"`,
            );

            return {
                success: true,
                message: `Workflow **${metadata.name}** initialized. Researching codebase...`,
                stateUpdate: {
                    workflowActive: true,
                    workflowType: metadata.name,
                    initialPrompt,
                    pendingApproval: false,
                    specApproved: undefined,
                    feedback: null,
                },
            };
        },
    };
}

// ============================================================================
// FILE WATCHER
// ============================================================================

export function watchTasksJson(
    sessionDir: string,
    onUpdate: (items: NormalizedTodoItem[]) => void,
    deps?: {
        watchImpl?: (
            filename: string,
            listener:
                | ((
                      eventType: string,
                      filename: string | Buffer | null,
                  ) => void)
                | ((
                      eventType: string,
                      filename: string | Buffer | null,
                  ) => Promise<void>),
        ) => FSWatcher;
        readFileImpl?: (
            path: string,
            encoding: BufferEncoding,
        ) => Promise<string>;
    },
): () => void {
    const tasksPath = join(sessionDir, "tasks.json");
    const watchImpl = deps?.watchImpl ?? watch;
    const readFileImpl = deps?.readFileImpl ?? readFile;
    let disposed = false;
    let latestReadToken = 0;

    const isTasksJsonEvent = (filename: string | Buffer | null): boolean => {
        if (filename == null) return true;
        const normalized =
            typeof filename === "string"
                ? filename
                : filename.toString("utf-8");
        return normalized === "tasks.json";
    };

    const refresh = async (): Promise<void> => {
        const readToken = ++latestReadToken;
        try {
            const content = await readFileImpl(tasksPath, "utf-8");
            const tasks = normalizeTodoItems(JSON.parse(content));
            if (disposed || readToken !== latestReadToken) return;
            onUpdate(tasks);
        } catch {
            // File may not exist yet or be mid-write; ignore
        }
    };

    // Watch the directory instead of the file so we catch file creation
    // even if tasks.json doesn't exist yet at mount time (BUG-7 fix)
    const watcher = watchImpl(sessionDir, async (_eventType, filename) => {
        if (!isTasksJsonEvent(filename)) return;
        await refresh();
    });

    // Catch up immediately after watcher starts to close mount race window.
    void refresh();

    return () => {
        disposed = true;
        watcher.close();
    };
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Get workflow commands from all definitions (built-in + loaded from disk).
 * This function returns a fresh array each time, reflecting any dynamically loaded workflows.
 */
export function getWorkflowCommands(): CommandDefinition[] {
    return getAllWorkflows().map(createWorkflowCommand);
}

/**
 * Workflow commands created from built-in definitions.
 * For dynamically loaded workflows, use getWorkflowCommands().
 */
export const workflowCommands: CommandDefinition[] =
    BUILTIN_WORKFLOW_DEFINITIONS.map(createWorkflowCommand);

/**
 * Register all workflow commands with the global registry.
 * Includes both built-in and dynamically loaded workflows.
 *
 * Call this function during application initialization.
 * For best results, call loadWorkflowsFromDisk() first to discover custom workflows.
 *
 * @example
 * ```typescript
 * import { loadWorkflowsFromDisk, registerWorkflowCommands } from "./workflow-commands";
 *
 * // In app initialization
 * await loadWorkflowsFromDisk();
 * registerWorkflowCommands();
 * ```
 */
export function registerWorkflowCommands(): void {
    const commands = getWorkflowCommands();
    for (const command of commands) {
        // Skip if already registered (idempotent)
        if (!globalRegistry.has(command.name)) {
            globalRegistry.register(command);
        }
    }
}

/**
 * Get a workflow by name.
 * Searches all workflows (built-in + loaded from disk).
 *
 * @param name - Workflow name
 * @returns WorkflowMetadata if found, undefined otherwise
 */
export function getWorkflowMetadata(
    name: string,
): WorkflowMetadata | undefined {
    const lowerName = name.toLowerCase();
    return getAllWorkflows().find(
        (w) =>
            w.name.toLowerCase() === lowerName ||
            w.aliases?.some((a) => a.toLowerCase() === lowerName),
    );
}
