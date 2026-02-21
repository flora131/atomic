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
import {
    buildSpecToTasksPrompt,
    buildBootstrappedTaskContext,
    buildContinuePrompt,
    buildReviewPrompt,
    parseReviewResult,
    buildFixSpecFromReview,
} from "../../graph/nodes/ralph.ts";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum number of iterations for the main implementation loop to prevent infinite loops */
const MAX_RALPH_ITERATIONS = 100;
/** Maximum number of review-fix cycles to prevent infinite loops */
const MAX_REVIEW_ITERATIONS = 1;

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
    /** Source: built-in, global (~/.atomic/workflows), or local (.atomic/workflows) */
    source?: "builtin" | "global" | "local";
    /** Hint text showing expected arguments (e.g., "PROMPT [--yolo]") */
    argumentHint?: string;
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
            "[ralph] saveTasksToActiveSession: no session directory found",
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
        console.error("[ralph] Failed to write tasks.json:", error);
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
let loadedWorkflows: WorkflowMetadata[] = [];

/**
 * Load workflow definitions from .ts files on disk.
 *
 * Workflows are expected to export:
 * - `name`: Workflow name (optional, defaults to filename)
 * - `description`: Human-readable description (optional)
 * - `aliases`: Alternative names (optional)
 *
 * Example workflow file (.atomic/workflows/my-workflow.ts):
 * ```typescript
 * export const name = "my-workflow";
 * export const description = "My custom workflow";
 * export const aliases = ["mw"];
 * ```
 *
 * @returns Array of loaded workflow metadata (local workflows override global)
 */
export async function loadWorkflowsFromDisk(): Promise<WorkflowMetadata[]> {
    const discovered = discoverWorkflowFiles();
    const loaded: WorkflowMetadata[] = [];
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

            const metadata: WorkflowMetadata = {
                name,
                description: module.description ?? `Custom workflow: ${name}`,
                aliases: module.aliases,
                defaultConfig: module.defaultConfig,
                source,
            };

            loaded.push(metadata);
            loadedNames.add(name.toLowerCase());

            // Also track aliases
            if (metadata.aliases) {
                for (const alias of metadata.aliases) {
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
 *
 * The ralph workflow is a two-step workflow:
 *   1. decompose — Task list decomposition from user prompt
 *   2. implement — Main agent manually dispatches worker sub-agents
 */
const BUILTIN_WORKFLOW_DEFINITIONS: WorkflowMetadata[] = [
    {
        name: "ralph",
        description: "Start autonomous implementation workflow",
        aliases: ["loop"],
        argumentHint: '"<prompt-or-spec-path>"',
        source: "builtin",
    },
];

// ============================================================================
// COMMAND FACTORY
// ============================================================================

/**
 * Create a command definition for a workflow.
 *
 * @param metadata - Workflow metadata
 * @returns Command definition for the workflow
 */
function createWorkflowCommand(metadata: WorkflowMetadata): CommandDefinition {
    // Use specialized handler for ralph workflow
    if (metadata.name === "ralph") {
        return createRalphCommand(metadata);
    }

    return {
        name: metadata.name,
        description: metadata.description,
        category: "workflow",
        aliases: metadata.aliases,
        argumentHint: metadata.argumentHint,
        execute: (args: string, context: CommandContext): CommandResult => {
            // Check if already in a workflow
            if (context.state.workflowActive) {
                return {
                    success: false,
                    message: `A workflow is already active (${context.state.workflowType}). Check research/progress.txt for progress.`,
                };
            }

            // Extract the prompt from args
            const initialPrompt = args.trim() || null;

            if (!initialPrompt) {
                return {
                    success: false,
                    message: `Please provide a prompt for the ${metadata.name} workflow.\nUsage: /${metadata.name} <your task description>`,
                };
            }

            // Add a system message indicating workflow start
            context.addMessage(
                "system",
                `Starting **${metadata.name}** workflow...\n\nPrompt: "${initialPrompt}"`,
            );

            // Return success with state updates
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

/**
 * Parse a JSON task list from streaming content.
 * Handles both raw JSON arrays and content with markdown fences or extra text.
 */
function parseTasks(content: string): NormalizedTodoItem[] {
    const trimmed = content.trim();
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        const match = trimmed.match(/\[[\s\S]*\]/);
        if (match) {
            try {
                parsed = JSON.parse(match[0]);
            } catch {
                /* ignore */
            }
        }
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    return normalizeTodoItems(parsed);
}

function hasActionableTasks(tasks: NormalizedTodoItem[]): boolean {
    const normalizeTaskId = (id: string): string => {
        const trimmed = id.trim().toLowerCase();
        return trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
    };

    const completedIds = new Set(
        tasks
            .filter((task) => task.status === "completed")
            .map((task) => task.id)
            .filter((id): id is string => Boolean(id))
            .map((id) => normalizeTaskId(id))
            .filter((id): id is string => Boolean(id)),
    );

    return tasks.some((task) => {
        if (task.status === "in_progress") {
            return true;
        }
        if (task.status !== "pending") {
            return false;
        }

        const dependencies = (task.blockedBy ?? [])
            .map((dependency) => normalizeTaskId(dependency))
            .filter((dependency) => dependency.length > 0);

        if (dependencies.length === 0) {
            return true;
        }

        return dependencies.every((dependency) => completedIds.has(dependency));
    });
}

type StreamAndWaitResult = Awaited<ReturnType<CommandContext["streamAndWait"]>>;

async function streamWithInterruptRecovery(
    context: CommandContext,
    initialPrompt: string,
    options?: { hideContent?: boolean },
    onInterrupted?: (
        userPrompt: string,
    ) => { prompt: string; options?: { hideContent?: boolean } },
): Promise<StreamAndWaitResult> {
    let prompt = initialPrompt;
    let streamOptions = options;

    while (true) {
        const result = await context.streamAndWait(prompt, streamOptions);

        if (result.wasCancelled || !result.wasInterrupted) {
            return result;
        }

        const userPrompt = await context.waitForUserInput();

        if (onInterrupted) {
            const next = onInterrupted(userPrompt);
            prompt = next.prompt;
            streamOptions = next.options;
        } else {
            prompt = userPrompt;
            streamOptions = undefined;
        }
    }
}

function createRalphCommand(metadata: WorkflowMetadata): CommandDefinition {
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

            // ── Two-step workflow (async/await) ──────────────────────────────
            // Step 1: Task decomposition via streamAndWait
            // Step 2: Feature implementation via worker sub-agent
            // ────────────────────────────────────────────────────────────────

            // Initialize a workflow session via the SDK
            const sessionId = crypto.randomUUID();
            const sessionDir = getWorkflowSessionDir(sessionId);
            void initWorkflowSession("ralph", sessionId).then((session) => {
                activeSessions.set(session.sessionId, session);
            });

            context.updateWorkflowState({
                workflowActive: true,
                workflowType: metadata.name,
                ralphConfig: { sessionId, userPrompt: parsed.prompt },
            });

            try {
                // Step 1: Task decomposition (blocks until streaming completes)
            // hideContent suppresses raw JSON rendering in the chat — content is still
            // accumulated in StreamResult for parseTasks() and task-state persistence takes over.
            const step1 = await context.streamAndWait(
                buildSpecToTasksPrompt(parsed.prompt),
                { hideContent: true },
            );
            if (step1.wasInterrupted) return {
                success: true,
                stateUpdate: {
                    workflowActive: false,
                    workflowType: null,
                    initialPrompt: null,
                },
            };

            // Parse tasks from step 1 output and save to disk (file watcher handles UI)
            const tasks = parseTasks(step1.content);
            if (tasks.length > 0) {
                await saveTasksToActiveSession(tasks, sessionId);
                // Seed in-memory TodoWrite state so later payloads that omit IDs
                // can be reconciled against the planning-phase task list.
                context.setTodoItems(
                    tasks.map((task) => ({
                        ...task,
                        status:
                            task.status === "error"
                                ? "pending"
                                : task.status,
                    })) as TodoItem[],
                );
                if (step1.wasCancelled)
                    return {
                        success: true,
                        stateUpdate: {
                            workflowActive: false,
                            workflowType: null,
                            initialPrompt: null,
                        },
                    };

                // Parse tasks from step 1 output and save to disk (file watcher handles UI)
                const tasks = parseTasks(step1.content);
                if (tasks.length > 0) {
                    await saveTasksToActiveSession(tasks, sessionId);
                    // Seed in-memory TodoWrite state so later payloads that omit IDs
                    // can be reconciled against the planning-phase task list.
                    context.setTodoItems(
                        tasks.map((task) => ({
                            ...task,
                            status:
                                task.status === "error"
                                    ? "pending"
                                    : task.status,
                        })) as TodoItem[],
                    );
                }

            // Track Ralph session metadata AFTER tasks.json exists on disk
            context.setRalphSessionDir(sessionDir);
            context.setRalphSessionId(sessionId);

            // Register the planning-phase task IDs so the TodoWrite persistence
            // guard can distinguish ralph task updates from sub-agent todo lists.
            const taskIds = new Set(
                tasks
                    .map((t) => t.id)
                    .filter((id): id is string => id != null && id.length > 0),
            );
            context.setRalphTaskIds(taskIds);

            // Step 2: Execute tasks in a loop until all are completed.
            // The agent's context is blank after Step 1 (hideContent suppressed the JSON),
            // so inject the task list and instructions for worker dispatch, then loop
            // until tasks.json shows all items completed.
            if (tasks.length > 0) {
                let iteration = 0;
                let currentTasks: NormalizedTodoItem[] = tasks;

                while (iteration < MAX_RALPH_ITERATIONS) {
                    iteration++;
                    const prompt =
                        iteration === 1
                            ? buildBootstrappedTaskContext(
                                  currentTasks,
                                  sessionId,
                              )
                            : buildContinuePrompt(currentTasks, sessionId);

                    const result = await context.streamAndWait(prompt);
                    if (result.wasInterrupted) {
                        // Yield control to user: wait for their next prompt
                        const userPrompt = await context.waitForUserInput();
                        // Pass user's prompt to model within workflow context
                        const userResult = await context.streamAndWait(userPrompt);
                        if (userResult.wasInterrupted) break;
                    }

                    // Read latest task state from disk after agent response
                    const diskTasks = await readTasksFromDisk(sessionDir);
                    if (diskTasks.length === 0) break;

                    // Check if all tasks are completed
                    const allCompleted = diskTasks.every(
                        (t) => t.status === "completed",
                    );
                    if (allCompleted) break;

                    // Check if remaining tasks are all stuck (including dependency deadlocks)
                    const hasActionable = hasActionableTasks(diskTasks);
                    if (!hasActionable) break;

                    currentTasks = diskTasks;
                }

                // Step 3: Review & Fix phase
                // Re-read tasks from disk to confirm final state
                const finalTasks = await readTasksFromDisk(sessionDir);
                const allTasksCompleted =
                    finalTasks.length > 0 &&
                    finalTasks.every((t) => t.status === "completed");

                if (allTasksCompleted) {
                    for (
                        let reviewIteration = 0;
                        reviewIteration < MAX_REVIEW_ITERATIONS;
                        reviewIteration++
                    ) {
                        // Get current task state for review
                        const reviewTasks = await readTasksFromDisk(sessionDir);
                        const reviewPrompt = buildReviewPrompt(
                            reviewTasks,
                            parsed.prompt,
                        );

                        // Spawn reviewer sub-agent
                        const reviewResult = await context.spawnSubagent({
                            name: "reviewer",
                            message: reviewPrompt,
                        });

                        if (!reviewResult.success || !reviewResult.output)
                            break;

                        // Parse review findings from reviewer output
                        const review = parseReviewResult(reviewResult.output);
                        if (!review) break;

                        // Persist review artifacts to session directory
                        const reviewArtifactPath = join(
                            sessionDir,
                            `review-${reviewIteration}.json`,
                        );
                        await writeFile(
                            reviewArtifactPath,
                            JSON.stringify(review, null, 2),
                        );

                        // Build fix specification from review findings
                        const fixSpec = buildFixSpecFromReview(
                            review,
                            reviewTasks,
                            parsed.prompt,
                        );

                        // If no actionable findings, we're done
                        if (!fixSpec) break;

                        // Persist fix spec to session directory
                        const fixSpecPath = join(
                            sessionDir,
                            `fix-spec-${reviewIteration}.md`,
                        );
                        await writeFile(fixSpecPath, fixSpec);

                        // Re-invoke ralph: decompose fix-spec into tasks (Step 1 again)
                        const fixStep1 = await context.streamAndWait(
                            buildSpecToTasksPrompt(fixSpec),
                            { hideContent: true },
                            (userPrompt) => ({
                                prompt: buildSpecToTasksPrompt(userPrompt),
                                options: { hideContent: true },
                            }),
                        );
                        if (fixStep1.wasCancelled) break;

                        const fixTasks = parseTasks(fixStep1.content);
                        if (fixTasks.length === 0) break;

                        // Save fix tasks and update tracking
                        await saveTasksToActiveSession(fixTasks, sessionId);
                        const fixTaskIds = new Set(
                            fixTasks
                                .map((t) => t.id)
                                .filter(
                                    (id): id is string =>
                                        id != null && id.length > 0,
                                ),
                        );
                        context.setRalphTaskIds(fixTaskIds);

                        // Re-run implementation loop for fix tasks (Step 2 again)
                        let fixIteration = 0;
                        let currentFixTasks: NormalizedTodoItem[] = fixTasks;

                        while (fixIteration < MAX_RALPH_ITERATIONS) {
                            fixIteration++;
                            const prompt =
                                fixIteration === 1
                                    ? buildBootstrappedTaskContext(
                                          currentFixTasks,
                                          sessionId,
                                      )
                                    : buildContinuePrompt(
                                          currentFixTasks,
                                          sessionId,
                                      );

                            const result = await streamWithInterruptRecovery(
                                context,
                                prompt,
                            );
                            if (result.wasCancelled) break;

                            // Read latest task state from disk after agent response
                            const diskTasks =
                                await readTasksFromDisk(sessionDir);
                            if (diskTasks.length === 0) break;

                            // Check if all fix tasks are completed
                            const allFixCompleted = diskTasks.every(
                                (t) => t.status === "completed",
                            );
                            if (allFixCompleted) break;

                            // Check if remaining fix tasks are all stuck (including dependency deadlocks)
                            const hasActionable = hasActionableTasks(diskTasks);
                            if (!hasActionable) break;

                            currentFixTasks = diskTasks;
                        }
                    }
                }
            }

            return {
                success: true,
                message: "Workflow completed successfully.",
                stateUpdate: {
                    workflowActive: false,
                    workflowType: null,
                    initialPrompt: null,
                },
            };
            } catch (error) {
                return {
                    success: false,
                    message: `Workflow failed: ${error instanceof Error ? error.message : String(error)}`,
                    stateUpdate: {
                        workflowActive: false,
                        workflowType: null,
                        initialPrompt: null,
                    },
                };
            }
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
                | ((eventType: string, filename: string | Buffer | null) => void)
                | ((eventType: string, filename: string | Buffer | null) => Promise<void>),
        ) => FSWatcher;
        readFileImpl?: (path: string, encoding: BufferEncoding) => Promise<string>;
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
            typeof filename === "string" ? filename : filename.toString("utf-8");
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
