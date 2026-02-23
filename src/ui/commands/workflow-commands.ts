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
import { readFile, rename, unlink } from "fs/promises";
import { join } from "path";
import type {
    CommandDefinition,
    CommandContext,
    CommandResult,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";
import type { TodoItem } from "../../sdk/tools/todo-write.ts";
import type {
    AgentMessage,
    CodingAgentClient,
    Session,
    SessionConfig,
} from "../../sdk/types.ts";

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
    createExecutor,
    createRalphState,
    getClientProvider,
    setClientProvider,
    type AgentNodeAgentType,
} from "../../graph/index.ts";
import { createRalphWorkflow } from "../../graph/workflows/ralph.ts";
import {
    getSubagentBridge,
    setSubagentBridge,
    type SubagentGraphBridge,
    type SubagentResult,
    type SubagentSpawnOptions,
} from "../../graph/subagent-bridge.ts";

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

export interface PhaseEvent {
    type:
        | "tool_call"
        | "tool_result"
        | "text"
        | "agent_spawn"
        | "agent_complete"
        | "error"
        | "progress";
    timestamp: string;
    content: string;
    metadata?: Record<string, unknown>;
}

export interface PhaseData {
    nodeId: string;
    phaseName: string;
    phaseIcon: string;
    message: string;
    events: PhaseEvent[];
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    status: "running" | "completed" | "error";
}

export class PhaseEventAccumulator {
    private events: PhaseEvent[] = [];
    private readonly startTime: number;
    private firstEventTimestampMs?: number;

    constructor(public readonly nodeId: string, startTimeMs = Date.now()) {
        this.startTime = startTimeMs;
    }

    private pushEvent(
        type: PhaseEvent["type"],
        content: string,
        metadata?: Record<string, unknown>,
    ): void {
        this.addEvent({
            type,
            timestamp: new Date().toISOString(),
            content,
            metadata,
        });
    }

    addEvent(event: PhaseEvent): void {
        this.events.push(event);
        if (this.firstEventTimestampMs != null) return;
        const timestampMs = Date.parse(event.timestamp);
        if (!Number.isNaN(timestampMs)) {
            this.firstEventTimestampMs = timestampMs;
        }
    }

    addToolCall(toolName: string, input: string): void {
        this.pushEvent("tool_call", `${toolName}: ${input}`);
    }

    addToolResult(result: string): void {
        this.pushEvent("tool_result", result);
    }

    addText(text: string): void {
        this.pushEvent("text", text);
    }

    addAgentSpawn(name: string, task: string): void {
        this.pushEvent("agent_spawn", `Spawned ${name}: ${task}`);
    }

    addAgentComplete(name: string, durationMs: number): void {
        this.pushEvent("agent_complete", `${name} completed`, { durationMs });
    }

    addError(error: string): void {
        this.pushEvent("error", error);
    }

    addProgress(content: string, metadata?: Record<string, unknown>): void {
        this.pushEvent("progress", content, metadata);
    }

    getEvents(): PhaseEvent[] {
        return [...this.events];
    }

    private getStartTimestampMs(): number {
        if (this.firstEventTimestampMs == null) return this.startTime;
        return Math.min(this.startTime, this.firstEventTimestampMs);
    }

    getStartedAt(): string {
        return new Date(this.getStartTimestampMs()).toISOString();
    }

    getDurationMs(nowMs = Date.now()): number {
        return Math.max(0, nowMs - this.getStartTimestampMs());
    }
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
export function parseTasks(content: string): NormalizedTodoItem[] {
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
    if (!Array.isArray(parsed) || parsed.length === 0) {
        return [];
    }

    const idPattern = /^#\d+$/;
    const statuses = new Set(["pending", "in_progress", "completed"]);
    const seenIds = new Set<string>();

    for (const entry of parsed) {
        if (typeof entry !== "object" || entry === null) {
            return [];
        }
        const task = entry as Record<string, unknown>;

        if (typeof task.id !== "string" || !idPattern.test(task.id)) {
            return [];
        }
        if (seenIds.has(task.id)) {
            return [];
        }
        seenIds.add(task.id);

        if (
            typeof task.content !== "string" ||
            task.content.trim().length === 0
        ) {
            return [];
        }

        if (
            typeof task.activeForm !== "string" ||
            task.activeForm.trim().length === 0
        ) {
            return [];
        }

        if (typeof task.status !== "string" || !statuses.has(task.status)) {
            return [];
        }

        if (task.blockedBy !== undefined) {
            if (!Array.isArray(task.blockedBy)) {
                return [];
            }

            const hasInvalidBlockedBy = task.blockedBy.some(
                (blockedId) =>
                    typeof blockedId !== "string" || !idPattern.test(blockedId),
            );
            if (hasInvalidBlockedBy) {
                return [];
            }
        }
    }

    return normalizeTodoItems(parsed);
}

function createRalphCommand(metadata: WorkflowMetadata): CommandDefinition {
    const toAgentNodeType = (
        agentType?: CommandContext["agentType"],
    ): AgentNodeAgentType => {
        if (agentType === "claude") return "claude";
        if (agentType === "opencode") return "opencode";
        if (agentType === "copilot") return "copilot";
        return "claude";
    };

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

            const sessionId = crypto.randomUUID();
            const sessionDir = getWorkflowSessionDir(sessionId);
            const initializedSession = await initWorkflowSession("ralph", sessionId);
            activeSessions.set(initializedSession.sessionId, initializedSession);

            context.setRalphSessionDir(sessionDir);
            context.setRalphSessionId(sessionId);

            context.updateWorkflowState({
                workflowActive: true,
                workflowType: metadata.name,
                ralphConfig: { sessionId, userPrompt: parsed.prompt },
            });

            const compiled = createRalphWorkflow({
                agentType: toAgentNodeType(context.agentType),
            });
            const executor = createExecutor(compiled);

            const previousClientProvider = getClientProvider();
            const previousBridge = getSubagentBridge();
            const pendingPhaseEvents: PhaseEvent[] = [];
            const stringifyEventPayload = (value: unknown): string => {
                if (typeof value === "string") return value;
                if (value == null) return "";
                return Bun.inspect(value);
            };
            const pushPendingPhaseEvent = (
                type: PhaseEvent["type"],
                content: string,
                metadata?: Record<string, unknown>,
            ): void => {
                pendingPhaseEvents.push({
                    type,
                    timestamp: new Date().toISOString(),
                    content,
                    metadata,
                });
            };
            const takePendingPhaseEvents = (): PhaseEvent[] => {
                if (pendingPhaseEvents.length === 0) return [];
                return pendingPhaseEvents.splice(0, pendingPhaseEvents.length);
            };
            const captureAgentMessage = (message: AgentMessage): void => {
                if (message.type === "text" && typeof message.content === "string") {
                    pushPendingPhaseEvent("text", message.content);
                    return;
                }
                if (message.type === "tool_use") {
                    const metadata = message.metadata ?? {};
                    const payload = (
                        typeof message.content === "object" && message.content !== null
                            ? message.content
                            : {}
                    ) as Record<string, unknown>;
                    const toolName = typeof metadata.toolName === "string"
                        ? metadata.toolName
                        : typeof payload.name === "string"
                            ? payload.name
                            : "tool";
                    const toolInput = metadata.toolInput ?? payload.input;
                    pushPendingPhaseEvent(
                        "tool_call",
                        `${toolName}: ${stringifyEventPayload(toolInput)}`,
                    );
                    return;
                }
                if (message.type === "tool_result") {
                    pushPendingPhaseEvent("tool_result", stringifyEventPayload(message.content));
                }
            };
            const wrapSession = (session: Session): Session => {
                const getMcpSnapshot = session.getMcpSnapshot?.bind(session);
                const abort = session.abort?.bind(session);
                return {
                    id: session.id,
                    send: async (message: string) => {
                        const result = await session.send(message);
                        captureAgentMessage(result);
                        return result;
                    },
                    stream: async function* (
                        message: string,
                        options?: { agent?: string },
                    ): AsyncIterable<AgentMessage> {
                        for await (const chunk of session.stream(message, options)) {
                            captureAgentMessage(chunk);
                            yield chunk;
                        }
                    },
                    summarize: async () => session.summarize(),
                    getContextUsage: async () => session.getContextUsage(),
                    getSystemToolsTokens: () => session.getSystemToolsTokens(),
                    getMcpSnapshot: getMcpSnapshot
                        ? async () => getMcpSnapshot()
                        : undefined,
                    destroy: async () => session.destroy(),
                    abort: abort ? async () => abort() : undefined,
                };
            };
            const wrapClient = (client: CodingAgentClient): CodingAgentClient => {
                const setActiveSessionModel = client.setActiveSessionModel?.bind(client);
                return {
                    agentType: client.agentType,
                    createSession: async (config?: SessionConfig) =>
                        wrapSession(await client.createSession(config)),
                    resumeSession: async (sessionId: string) => {
                        const resumed = await client.resumeSession(sessionId);
                        return resumed ? wrapSession(resumed) : null;
                    },
                    on: (eventType, handler) => client.on(eventType, handler),
                    registerTool: (tool) => client.registerTool(tool),
                    start: async () => client.start(),
                    stop: async () => client.stop(),
                    getModelDisplayInfo: async (modelHint?: string) =>
                        client.getModelDisplayInfo(modelHint),
                    setActiveSessionModel: setActiveSessionModel
                        ? async (model: string, options?: { reasoningEffort?: string }) =>
                            setActiveSessionModel(model, options)
                        : undefined,
                    getSystemToolsTokens: () => client.getSystemToolsTokens(),
                };
            };

            const fallbackClientProvider = (): CodingAgentClient => ({
                agentType: "claude",
                createSession: async () => ({
                    id: `ralph-fallback-${crypto.randomUUID()}`,
                    send: async (message: string) => ({
                        type: "text",
                        content: (await context.streamAndWait(message, { hideContent: true })).content,
                    }),
                    stream: async function* (message: string): AsyncIterable<AgentMessage> {
                        const streamResult = await context.streamAndWait(message, {
                            hideContent: true,
                        });

                        if (streamResult.wasCancelled) {
                            throw new Error("Workflow cancelled");
                        }

                        if (streamResult.wasInterrupted) {
                            const userPrompt = await context.waitForUserInput();
                            const resumed = await context.streamAndWait(userPrompt, {
                                hideContent: true,
                            });
                            if (resumed.wasCancelled) {
                                throw new Error("Workflow cancelled");
                            }
                            yield { type: "text", content: resumed.content };
                            return;
                        }

                        yield { type: "text", content: streamResult.content };
                    },
                    summarize: async () => {},
                    getContextUsage: async () => ({
                        inputTokens: 0,
                        outputTokens: 0,
                        maxTokens: 200000,
                        usagePercentage: 0,
                    }),
                    getSystemToolsTokens: () => 0,
                    destroy: async () => {},
                }),
                resumeSession: async () => null,
                on: () => () => {},
                registerTool: () => {},
                start: async () => {},
                stop: async () => {},
                getModelDisplayInfo: async () => ({
                    model: "fallback",
                    tier: "fallback",
                }),
                getSystemToolsTokens: () => 0,
            });

            const fallbackBridge = {
                spawn: async (options: SubagentSpawnOptions): Promise<SubagentResult> => {
                    const startedAt = Date.now();
                    const result = await context.spawnSubagent({
                        name: options.agentName,
                        message: options.task,
                    });

                    return {
                        agentId: options.agentId,
                        success: result.success,
                        output: result.output ?? "",
                        error: result.error,
                        toolUses: 0,
                        durationMs: Date.now() - startedAt,
                    };
                },
                spawnParallel: async (
                    agents: SubagentSpawnOptions[],
                ): Promise<SubagentResult[]> => {
                    const settled = await Promise.allSettled(
                        agents.map(async (agent) => {
                            const startedAt = Date.now();
                            const result = await context.spawnSubagent({
                                name: agent.agentName,
                                message: agent.task,
                            });
                            return {
                                agentId: agent.agentId,
                                success: result.success,
                                output: result.output ?? "",
                                error: result.error,
                                toolUses: 0,
                                durationMs: Date.now() - startedAt,
                            };
                        }),
                    );

                    return settled.map((outcome, i) => {
                        if (outcome.status === "fulfilled") {
                            return outcome.value;
                        }
                        const agent = agents[i];
                        return {
                            agentId: agent?.agentId ?? `unknown-${i}`,
                            success: false,
                            output: "",
                            error: outcome.reason instanceof Error
                                ? outcome.reason.message
                                : String(outcome.reason ?? "Unknown error"),
                            toolUses: 0,
                            durationMs: 0,
                        };
                    });
                },
            };

            const resolvedAgentType = toAgentNodeType(context.agentType);
            const baseClientProvider = (() => {
                if (!previousClientProvider) {
                    return fallbackClientProvider;
                }
                try {
                    if (previousClientProvider(resolvedAgentType) != null) {
                        return previousClientProvider;
                    }
                } catch {
                    // Fall through to local fallback provider.
                }
                return fallbackClientProvider;
            })();

            const baseBridge = previousBridge ?? fallbackBridge;

            setClientProvider((agentType) => {
                const client = baseClientProvider(agentType);
                return client ? wrapClient(client) : null;
            });

            setSubagentBridge({
                setSessionDir: (dir: string) => {
                    if ("setSessionDir" in baseBridge && typeof baseBridge.setSessionDir === "function") {
                        baseBridge.setSessionDir(dir);
                    }
                },
                spawn: async (options: SubagentSpawnOptions): Promise<SubagentResult> => {
                    pushPendingPhaseEvent("agent_spawn", `Spawned ${options.agentName}: ${options.task}`);
                    const startedAt = Date.now();
                    const result = await baseBridge.spawn(options);
                    const durationMs = result.durationMs > 0
                        ? result.durationMs
                        : Date.now() - startedAt;
                    if (result.success) {
                        pushPendingPhaseEvent("agent_complete", `${options.agentName} completed`, {
                            durationMs,
                            agentId: result.agentId,
                        });
                    } else {
                        pushPendingPhaseEvent(
                            "error",
                            `${options.agentName} failed: ${result.error ?? "Unknown error"}`,
                            { agentId: result.agentId },
                        );
                    }
                    return result;
                },
                spawnParallel: async (
                    agents: SubagentSpawnOptions[],
                ): Promise<SubagentResult[]> => {
                    for (const agent of agents) {
                        pushPendingPhaseEvent(
                            "agent_spawn",
                            `Spawned ${agent.agentName}: ${agent.task}`,
                        );
                    }

                    const results = await baseBridge.spawnParallel(agents);
                    for (let i = 0; i < results.length; i += 1) {
                        const result = results[i];
                        const agent = agents[i];
                        if (!result || !agent) continue;
                        if (result.success) {
                            pushPendingPhaseEvent(
                                "agent_complete",
                                `${agent.agentName} completed`,
                                {
                                    durationMs: result.durationMs,
                                    agentId: result.agentId,
                                },
                            );
                        } else {
                            pushPendingPhaseEvent(
                                "error",
                                `${agent.agentName} failed: ${result.error ?? "Unknown error"}`,
                                { agentId: result.agentId },
                            );
                        }
                    }
                    return results;
                },
            } as unknown as SubagentGraphBridge);

            const abortController = new AbortController();
            context.onCancel?.(() => {
                abortController.abort();
            });

            const initialState = createRalphState(undefined, {
                ralphSessionId: sessionId,
                ralphSessionDir: sessionDir,
                userPrompt: parsed.prompt,
                yoloPrompt: parsed.prompt,
                tasks: [],
                taskIds: new Set<string>(),
                reviewResult: null,
                fixSpec: "",
                reviewIteration: 0,
                iteration: 0,
                shouldContinue: true,
            });

            const phases: PhaseData[] = [];
            try {
                for await (const step of executor.stream({
                    initialState,
                    abortSignal: abortController.signal,
                    workflowName: "ralph",
                })) {
                    const phaseCompletedAtMs = Date.now();
                    const stepStartedAtMs = Date.parse(step.startedAt ?? "");
                    const tasks = step.state.tasks ?? [];
                    if (tasks.length > 0) {
                        context.setTodoItems(tasks as TodoItem[]);
                        context.setRalphTaskIds(
                            new Set(
                                tasks
                                    .map((task) => task.id)
                                    .filter(
                                        (id): id is string =>
                                            typeof id === "string" &&
                                            id.length > 0,
                                    ),
                            ),
                        );
                    }

                    const phaseAccumulator = new PhaseEventAccumulator(
                        step.nodeId,
                        Number.isNaN(stepStartedAtMs)
                            ? undefined
                            : stepStartedAtMs,
                    );
                    for (const event of takePendingPhaseEvents()) {
                        phaseAccumulator.addEvent(event);
                    }

                    if (step.error?.error) {
                        phaseAccumulator.addError(
                            step.error.error instanceof Error
                                ? step.error.error.message
                                : String(step.error.error),
                        );
                    }

                    const phaseSummary = step.phaseMessage;
                    const fallbackStartedAtMs = Date.parse(
                        phaseAccumulator.getStartedAt(),
                    );
                    const startedAtMs = Number.isNaN(stepStartedAtMs)
                        ? (Number.isNaN(fallbackStartedAtMs)
                            ? phaseCompletedAtMs
                            : fallbackStartedAtMs)
                        : stepStartedAtMs;
                    const completedAtMs = Math.max(
                        phaseCompletedAtMs,
                        startedAtMs,
                    );
                    const completedAt = new Date(completedAtMs).toISOString();
                    phases.push({
                        nodeId: step.nodeId,
                        phaseName: step.phaseName ?? step.nodeId,
                        phaseIcon: step.phaseIcon ?? "",
                        message:
                            phaseSummary ??
                            `[${step.phaseName ?? step.nodeId}] Completed.`,
                        events: phaseAccumulator.getEvents(),
                        startedAt: new Date(startedAtMs).toISOString(),
                        completedAt,
                        durationMs: completedAtMs - startedAtMs,
                        status: step.status === "failed" ? "error" : "completed",
                    });

                    if (step.status === "completed") {
                        completeSession(sessionId);
                        return {
                            success: true,
                            workflowPhases: phases,
                            stateUpdate: {
                                workflowActive: false,
                                workflowType: null,
                                initialPrompt: null,
                            },
                        };
                    }

                    if (step.status === "paused") {
                        completeSession(sessionId);
                        return {
                            success: false,
                            message:
                                "Workflow paused for human input, but resume is not yet supported.",
                            workflowPhases: phases,
                            stateUpdate: {
                                workflowActive: false,
                                workflowType: null,
                                initialPrompt: null,
                            },
                        };
                    }

                    if (step.status === "failed") {
                        completeSession(sessionId);
                        return {
                            success: false,
                            message: `Workflow failed: ${
                                step.error?.error instanceof Error
                                    ? step.error.error.message
                                    : String(step.error?.error ?? "Unknown error")
                            }`,
                            workflowPhases: phases,
                            stateUpdate: {
                                workflowActive: false,
                                workflowType: null,
                                initialPrompt: null,
                            },
                        };
                    }

                    if (step.status === "cancelled") {
                        completeSession(sessionId);
                        return {
                            success: true,
                            workflowPhases: phases,
                            stateUpdate: {
                                workflowActive: false,
                                workflowType: null,
                                initialPrompt: null,
                            },
                        };
                    }
                }

                completeSession(sessionId);
                return {
                    success: true,
                    workflowPhases: phases,
                    stateUpdate: {
                        workflowActive: false,
                        workflowType: null,
                        initialPrompt: null,
                    },
                };
            } catch (error) {
                completeSession(sessionId);
                return {
                    success: false,
                    message: `Workflow failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    workflowPhases: phases,
                    stateUpdate: {
                        workflowActive: false,
                        workflowType: null,
                        initialPrompt: null,
                    },
                };
            } finally {
                setClientProvider(previousClientProvider ?? (() => null));
                setSubagentBridge(previousBridge);
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
