/**
 * Workflow Commands for Chat UI
 *
 * Registers workflow commands as slash commands invocable from the TUI.
 * The /ralph command implements a two-step autonomous workflow:
 *   Step 1: Task list decomposition from user prompt
 *   Step 2: Feature implementation via worker sub-agent (worker.md)
 *
 * Session saving/resuming is powered by the workflow SDK session manager.
 */

import { existsSync, watch } from "fs";
import { readFile, rename, unlink } from "fs/promises";
import { join } from "path";
import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";

import type { CompiledGraph, BaseState, NodeDefinition } from "../../graph/types.ts";
import type { AtomicWorkflowState } from "../../graph/annotation.ts";
import { setWorkflowResolver, type CompiledSubgraph } from "../../graph/nodes.ts";
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
import { buildSpecToTasksPrompt, buildWorkerAssignment } from "../../graph/nodes/ralph.ts";
import { getReadyTasks, detectDeadlock } from "../components/task-order.ts";
import type { TaskItem } from "../components/task-list-indicator.tsx";
import { getSubagentBridge, type SubagentResult } from "../../graph/subagent-bridge.ts";
import { normalizeInterruptedTasks } from "../utils/ralph-task-state.ts";

// ============================================================================
// RALPH COMMAND PARSING
// ============================================================================

/**
 * Parsed arguments for the /ralph command.
 */
export type RalphCommandArgs =
  | { kind: "run"; prompt: string }
  | { kind: "resume"; sessionId: string; prompt: string | null };

export function parseRalphArgs(args: string): RalphCommandArgs {
  const trimmed = args.trim();

  // Check for --resume flag
  const resumeMatch = trimmed.match(/--resume\s+(\S+)/);
  if (resumeMatch) {
    const rest = trimmed.replace(resumeMatch[0], "").trim();
    return { kind: "resume", sessionId: resumeMatch[1]!, prompt: rest || null };
  }

  // Prompt is required for new sessions
  if (!trimmed) {
    throw new Error(
      'Usage: /ralph "<prompt-or-spec-path>" or /ralph --resume <uuid> ["<prompt>"]\n' +
      "A prompt argument is required."
    );
  }

  return { kind: "run", prompt: trimmed };
}

/**
 * Validate if a string is a valid UUID v4 format.
 *
 * @param uuid - The string to validate
 * @returns True if the string is a valid UUID v4 format
 *
 * @example
 * isValidUUID("550e8400-e29b-41d4-a716-446655440000") // true
 * isValidUUID("not-a-uuid") // false
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Metadata for a workflow command definition.
 */
export interface WorkflowMetadata<TState extends BaseState = AtomicWorkflowState> {
  /** Command name (without leading slash) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Alternative names for the command */
  aliases?: string[];
  /** Function to create the workflow graph */
  createWorkflow: (config?: Record<string, unknown>) => CompiledGraph<TState>;
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
  return sessions.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
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
async function atomicWrite(targetPath: string, content: string | Buffer): Promise<void> {
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
  tasks: Array<{ id?: string; content: string; status: string; activeForm: string; blockedBy?: string[] }>,
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
    console.error("[ralph] saveTasksToActiveSession: no session directory found");
    return;
  }
  const tasksPath = join(sessionDir, "tasks.json");
  try {
    const content = JSON.stringify(tasks.map((task) => normalizeTodoItem(task)), null, 2);
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

/**
 * Core DAG orchestrator control loop.
 * 
 * Implements the core scheduling logic for parallel task execution:
 * 1. Reads tasks from disk each iteration
 * 2. Exits when all tasks are completed
 * 3. Computes ready tasks from pending + completed dependencies
 * 4. Detects deadlock and emits a system message via context.addMessage with diagnostics
 * 5. Marks selected ready task(s) in_progress and persists EXPLICITLY BEFORE dispatch
 * 6. Dispatches worker(s) using SubagentGraphBridge with progress logging
 * 7. Re-reads tasks after worker result and reconciles status (completed/error/retry)
 * 8. Persists updates atomically through saveTasksToActiveSession
 * 9. Logs dispatch waves, completions, retries, and terminal errors for observability
 * 
 * @param context - Command context for sub-agent dispatch and messaging
 * @param sessionId - The workflow session ID
 * @returns Promise that resolves when all tasks are completed or deadlock occurs
 * 
 * @internal
 */
async function runDAGOrchestrator(
  context: CommandContext,
  sessionId: string,
): Promise<void> {
  const sessionDir = getWorkflowSessionDir(sessionId);
  if (!sessionDir) {
    throw new Error(`Session directory not found for session ${sessionId}`);
  }

  // Resolve bridge at runtime (once, outside loop)
  const bridge = getSubagentBridge();
  if (!bridge) {
    throw new Error(
      "SubagentGraphBridge not initialized. " +
      "Call setSubagentBridge() before running DAG orchestrator."
    );
  }

  // Track in-flight workers: Map<taskId, {promise, agentId}>
  const inFlight = new Map<string, { promise: Promise<{ taskId: string; result: SubagentResult }>; agentId: string }>();

  // Track retry attempts: Map<taskId, attemptCount> (in-memory for current orchestrator run)
  const retryAttempts = new Map<string, number>();
  const MAX_ATTEMPTS = 3;

  while (true) {
    // Step 1: Read tasks from disk
    const tasks = await readTasksFromDisk(sessionDir);
    
    // Step 2: Exit when all tasks are completed and no in-flight workers remain
    const pending = tasks.filter(t => t.status === "pending" || t.status === "in_progress");
    if (pending.length === 0 && inFlight.size === 0) {
      // All tasks completed
      context.addMessage("system", "DAG orchestration complete: all tasks finished.");
      break;
    }

    // Step 3: Reload tasks and compute ready set to incorporate DAG mutations
    const freshTasks = await readTasksFromDisk(sessionDir);
    const freshTasksAsTaskItems: TaskItem[] = freshTasks;
    const dispatchTasks = getReadyTasks(freshTasksAsTaskItems).filter(
      (readyTask): readyTask is TaskItem & { id: string } =>
        typeof readyTask.id === "string" &&
        readyTask.id.length > 0 &&
        !inFlight.has(readyTask.id),
    );

    // Step 4: Dispatch all currently-ready tasks immediately
    if (dispatchTasks.length > 0) {
      // Log dispatch wave with task count and IDs
      const dispatchIds = dispatchTasks.map((task) => task.id);
      context.addMessage(
        "system",
        `Dispatching ${dispatchTasks.length} ready task(s): ${dispatchIds.join(", ")}. In-flight: ${inFlight.size}`
      );
      
      // Mark tasks as in_progress and persist BEFORE dispatch (explicit status persistence)
      const dispatchIdSet = new Set(dispatchIds);
      const updatedTasks = freshTasks.map((task) =>
        task.id && dispatchIdSet.has(task.id) && task.status === "pending"
          ? { ...task, status: "in_progress" as const }
          : task
      );
      
      // Persist in_progress status atomically BEFORE spawning workers
      await saveTasksToActiveSession(updatedTasks, sessionId);
      
      // Reload tasks again after in_progress write to ensure prompt-building uses latest task list
      const latestTasks = await readTasksFromDisk(sessionDir);

      for (const readyTask of dispatchTasks) {
        const taskId = readyTask.id;
        const fullTask = latestTasks.find((task) => task.id === taskId);
        if (!fullTask) {
          continue;
        }

        const agentId = crypto.randomUUID();
        const workerPrompt = buildWorkerAssignment(fullTask, latestTasks);
        const workerPromise = bridge.spawn({
          agentId,
          agentName: "worker",
          task: workerPrompt,
        }).then((result) => ({ taskId, result }));

        inFlight.set(taskId, { promise: workerPromise, agentId });
      }
    }

    // Step 5: If no in-flight workers, check for deadlock
    if (inFlight.size === 0) {
      const deadlockTasks = await readTasksFromDisk(sessionDir);
      const deadlock = detectDeadlock(deadlockTasks as TaskItem[]);
      
      if (deadlock.type !== "none") {
        let deadlockMessage: string;
        
        if (deadlock.type === "cycle") {
          // Enhanced cycle diagnostic with clear explanation
          deadlockMessage = 
            `Deadlock detected: Circular dependency cycle prevents progress.\n` +
            `Cycle: ${deadlock.cycle.join(" -> ")}\n` +
            `Resolution: Remove or break the circular dependency between these tasks.`;
        } else {
          // Enhanced error dependency diagnostic with clear explanation
          deadlockMessage = 
            `Deadlock detected: Task ${deadlock.taskId} cannot proceed due to failed dependencies.\n` +
            `Failed dependencies: ${deadlock.errorDependencies.join(", ")}\n` +
            `Resolution: Fix the errored tasks or remove them from blockedBy dependencies.`;
        }
        
        context.addMessage("system", deadlockMessage);
        break;
      }
      
      // No ready tasks, no in-flight workers, no deadlock -> shouldn't happen
      context.addMessage("system", "DAG orchestration stalled: no ready tasks, no in-flight workers, no deadlock detected.");
      break;
    }

    // Step 6: Wait for any completion via Promise.race
    const completedWorker = await Promise.race(
      Array.from(inFlight.values()).map(w => w.promise)
    );

    // Remove from in-flight
    inFlight.delete(completedWorker.taskId);

    // Step 7: Re-read tasks and reconcile status for the completed task
    const currentTasks = await readTasksFromDisk(sessionDir);
    
    const reconciledTasks = currentTasks.map(t => {
      if (t.id === completedWorker.taskId) {
        if (completedWorker.result.success) {
          // Success: mark as completed and clear retry count
          retryAttempts.delete(completedWorker.taskId);
          return { ...t, status: "completed" as const };
        } else {
          // Failure: implement retry logic
          const currentAttempt = (retryAttempts.get(completedWorker.taskId) || 0) + 1;
          retryAttempts.set(completedWorker.taskId, currentAttempt);
          
          if (currentAttempt < MAX_ATTEMPTS) {
            // Retry: set back to pending for attempts 1-2
            return { ...t, status: "pending" as const };
          } else {
            // Terminal error: max attempts reached
            return { ...t, status: "error" as const };
          }
        }
      }
      return t;
    });

    // Log completion status
    const completedTask = reconciledTasks.find(t => t.id === completedWorker.taskId);
    if (completedTask) {
      if (completedWorker.result.success) {
        context.addMessage("system", `Task ${completedWorker.taskId} completed successfully. Remaining in-flight: ${inFlight.size}`);
      } else {
        const currentAttempt = retryAttempts.get(completedWorker.taskId) || 0;
        if (currentAttempt < MAX_ATTEMPTS) {
          context.addMessage("system", `Task ${completedWorker.taskId} failed (attempt ${currentAttempt}/${MAX_ATTEMPTS}), retrying...`);
        } else {
          context.addMessage("system", `Task ${completedWorker.taskId} failed after ${MAX_ATTEMPTS} attempts, marked as error.`);
        }
      }
    }

    // Step 8: Persist updates atomically
    await saveTasksToActiveSession(reconciledTasks, sessionId);
    
    // Continue loop to dispatch newly ready tasks or wait for more completions
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
export function discoverWorkflowFiles(): { path: string; source: "local" | "global" }[] {
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
            discovered.push({ path: join(searchPath, file), source });
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
let loadedWorkflows: WorkflowMetadata<BaseState>[] = [];

/**
 * Load workflow definitions from .ts files on disk.
 *
 * Workflows are expected to export:
 * - `default`: A function that creates a CompiledGraph (required)
 * - `name`: Workflow name (optional, defaults to filename)
 * - `description`: Human-readable description (optional)
 * - `aliases`: Alternative names (optional)
 *
 * Example workflow file (.atomic/workflows/my-workflow.ts):
 * ```typescript
 * import { graph, agentNode } from "@bastani/atomic/graph";
 *
 * export const name = "my-workflow";
 * export const description = "My custom workflow";
 * export const aliases = ["mw"];
 *
 * export default function createWorkflow(config?: Record<string, unknown>) {
 *   return graph<MyState>()
 *     .start(researchNode)
 *     .then(implementNode)
 *     .end()
 *     .compile();
 * }
 * ```
 *
 * @returns Array of loaded workflow metadata (local workflows override global)
 */
export async function loadWorkflowsFromDisk(): Promise<WorkflowMetadata<BaseState>[]> {
  const discovered = discoverWorkflowFiles();
  const loaded: WorkflowMetadata<BaseState>[] = [];
  const loadedNames = new Set<string>();

  for (const { path, source } of discovered) {
    try {
      // Dynamic import of the workflow file
      const module = await import(path);

      // Extract workflow name from module or filename
      const filename = path.split("/").pop()?.replace(".ts", "") ?? "unknown";
      const name = module.name ?? filename;

      // Skip if already loaded (local takes priority over global)
      if (loadedNames.has(name.toLowerCase())) {
        continue;
      }

      // Validate that default export is a function
      if (typeof module.default !== "function") {
        console.warn(`Workflow file ${path} does not export a default function, skipping`);
        continue;
      }

      const metadata: WorkflowMetadata<BaseState> = {
        name,
        description: module.description ?? `Custom workflow: ${name}`,
        aliases: module.aliases,
        createWorkflow: module.default,
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
export function getAllWorkflows(): WorkflowMetadata<BaseState>[] {
  const allWorkflows: WorkflowMetadata<BaseState>[] = [];
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
// WORKFLOW REGISTRY AND RESOLUTION
// ============================================================================

/**
 * Registry for workflow lookup by name.
 * Maps workflow name (lowercase) to WorkflowMetadata.
 * Built-in workflows are included automatically.
 * Populated during loadWorkflowsFromDisk() or on first access.
 */
let workflowRegistry: Map<string, WorkflowMetadata<BaseState>> = new Map();

/**
 * Flag to track if registry has been initialized.
 */
let registryInitialized = false;

/**
 * Stack to track current workflow resolution chain for circular dependency detection.
 * Used during resolveWorkflowRef() calls.
 */
const resolutionStack: Set<string> = new Set();

/**
 * Initialize the workflow registry from all available workflows.
 * Populates the registry with built-in and dynamically loaded workflows.
 */
function initializeRegistry(): void {
  if (registryInitialized) {
    return;
  }

  workflowRegistry.clear();
  const workflows = getAllWorkflows();

  for (const workflow of workflows) {
    const lowerName = workflow.name.toLowerCase();
    if (!workflowRegistry.has(lowerName)) {
      workflowRegistry.set(lowerName, workflow);
    }

    // Also register aliases
    if (workflow.aliases) {
      for (const alias of workflow.aliases) {
        const lowerAlias = alias.toLowerCase();
        if (!workflowRegistry.has(lowerAlias)) {
          workflowRegistry.set(lowerAlias, workflow);
        }
      }
    }
  }

  registryInitialized = true;
}

/**
 * Get a workflow from the registry by name or alias.
 *
 * @param name - Workflow name or alias (case-insensitive)
 * @returns WorkflowMetadata if found, undefined otherwise
 */
export function getWorkflowFromRegistry(name: string): WorkflowMetadata<BaseState> | undefined {
  initializeRegistry();
  return workflowRegistry.get(name.toLowerCase());
}

/**
 * Resolve a workflow reference by name and create a compiled graph.
 * Used for subgraph composition where workflows reference other workflows by name.
 *
 * Includes circular dependency detection to prevent infinite recursion.
 *
 * @param name - Workflow name or alias to resolve
 * @returns Compiled workflow graph, or null if not found
 * @throws Error if circular dependency is detected
 *
 * @example
 * ```typescript
 * // Create subgraph that references another workflow by name
 * const subgraph = resolveWorkflowRef("research-codebase");
 * if (subgraph) {
 *   // Use subgraph in workflow composition
 * }
 * ```
 */
export function resolveWorkflowRef(name: string): CompiledSubgraph<BaseState> | null {
  const lowerName = name.toLowerCase();

  // Check for circular dependency
  if (resolutionStack.has(lowerName)) {
    const chain = [...resolutionStack, lowerName].join(" -> ");
    throw new Error(`Circular workflow dependency detected: ${chain}`);
  }

  // Add to resolution stack
  resolutionStack.add(lowerName);

  try {
    // Look up workflow in registry
    const metadata = getWorkflowFromRegistry(lowerName);
    if (!metadata) {
      return null;
    }

    // Create workflow with default config
    const config = metadata.defaultConfig ?? {};
    return metadata.createWorkflow(config) as unknown as CompiledSubgraph<BaseState>;
  } finally {
    // Always remove from stack, even if error
    resolutionStack.delete(lowerName);
  }
}

/**
 * Check if a workflow exists in the registry.
 *
 * @param name - Workflow name or alias to check
 * @returns True if workflow exists, false otherwise
 */
export function hasWorkflow(name: string): boolean {
  initializeRegistry();
  return workflowRegistry.has(name.toLowerCase());
}

/**
 * Get all workflow names from the registry.
 *
 * @returns Array of workflow names (primary names, not aliases)
 */
export function getWorkflowNames(): string[] {
  initializeRegistry();
  const names = new Set<string>();
  for (const workflow of workflowRegistry.values()) {
    names.add(workflow.name);
  }
  return Array.from(names);
}

/**
 * Clear and reinitialize the workflow registry.
 * Useful after loading new workflows from disk.
 */
export function refreshWorkflowRegistry(): void {
  registryInitialized = false;
  workflowRegistry.clear();
  initializeRegistry();
}

// ============================================================================
// WORKFLOW DEFINITIONS
// ============================================================================

/**
 * Built-in workflow definitions.
 * These can be overridden by local or global workflows with the same name.
 *
 * The ralph workflow is a two-step sequential graph:
 *   1. decompose — Task list decomposition from user prompt
 *   2. implement — Feature implementation via worker sub-agent
 *
 * The graph definition describes the structure; actual execution is handled
 * by createRalphCommand() which sends prompts via sendSilentMessage + initialPrompt.
 */
const BUILTIN_WORKFLOW_DEFINITIONS: WorkflowMetadata<BaseState>[] = [
  {
    name: "ralph",
    description: "Start autonomous implementation workflow",
    aliases: ["loop"],
    argumentHint: '"<prompt-or-spec-path>" [--resume UUID ["<prompt>"]]',
    createWorkflow: () => {
      const decomposeNode: NodeDefinition<BaseState> = {
        id: "decompose",
        type: "agent",
        name: "Task Decomposition",
        description: "Decompose user prompt into an ordered task list",
        execute: async () => ({ stateUpdate: {} }),
      };
      const implementNode: NodeDefinition<BaseState> = {
        id: "implement",
        type: "agent",
        name: "Feature Implementation",
        description: "Implement features from the task list",
        execute: async () => ({ stateUpdate: {} }),
      };
      const nodes = new Map<string, NodeDefinition<BaseState>>();
      nodes.set("decompose", decomposeNode);
      nodes.set("implement", implementNode);
      return {
        nodes,
        edges: [{ from: "decompose", to: "implement" }],
        startNode: "decompose",
        endNodes: new Set(["implement"]),
      } as unknown as CompiledGraph<BaseState>;
    },
    source: "builtin",
  },
];

/**
 * Exported for backwards compatibility.
 * Use getAllWorkflows() to get all workflows including dynamically loaded ones.
 */
export const WORKFLOW_DEFINITIONS = BUILTIN_WORKFLOW_DEFINITIONS;

// ============================================================================
// COMMAND FACTORY
// ============================================================================

/**
 * Create a command definition for a workflow.
 *
 * @param metadata - Workflow metadata
 * @returns Command definition for the workflow
 */
function createWorkflowCommand(metadata: WorkflowMetadata<BaseState>): CommandDefinition {
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
        `Starting **${metadata.name}** workflow...\n\nPrompt: "${initialPrompt}"`
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

function createRalphCommand(metadata: WorkflowMetadata<BaseState>): CommandDefinition {
  return {
    name: metadata.name,
    description: metadata.description,
    category: "workflow",
    aliases: metadata.aliases,
    argumentHint: metadata.argumentHint,
    execute: async (args: string, context: CommandContext): Promise<CommandResult> => {
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

      // Handle resume
      if (parsed.kind === "resume") {
        if (!parsed.sessionId) {
          return {
            success: false,
            message: `Missing session ID.\nUsage: /ralph --resume <uuid>`,
          };
        }

        if (!isValidUUID(parsed.sessionId)) {
          return {
            success: false,
            message: `Invalid session ID format. Expected a UUID.\nUsage: /ralph --resume <uuid>`,
          };
        }

        const sessionDir = getWorkflowSessionDir(parsed.sessionId);
        if (!existsSync(sessionDir)) {
          return {
            success: false,
            message: `Session not found: ${parsed.sessionId}\nDirectory does not exist: ${sessionDir}`,
          };
        }

        context.addMessage("system", `Resuming session ${parsed.sessionId}`);

        // Load tasks from disk and reset interrupted in_progress tasks to pending
        // before subsequent worker execution.
        const diskTasks = await readTasksFromDisk(sessionDir);
        const currentTasks = normalizeInterruptedTasks(diskTasks);
        await saveTasksToActiveSession(currentTasks, parsed.sessionId);

        // Update TodoPanel summary with loaded tasks (BUG-6 fix)
        context.setTodoItems(currentTasks as TodoItem[]);

        // Activate ralph task list panel
        context.setRalphSessionDir(sessionDir);
        context.setRalphSessionId(parsed.sessionId);

        context.updateWorkflowState({
          workflowActive: true,
          workflowType: metadata.name,
          ralphConfig: {
            resumeSessionId: parsed.sessionId,
            userPrompt: parsed.prompt,
          },
        });

        // Run DAG orchestrator for resumed session
        await runDAGOrchestrator(context, parsed.sessionId);

        return { success: true };
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

      // Step 1: Task decomposition (blocks until streaming completes)
      // hideContent suppresses raw JSON rendering in the chat — content is still
      // accumulated in StreamResult for parseTasks() and the TaskListPanel takes over.
      const step1 = await context.streamAndWait(buildSpecToTasksPrompt(parsed.prompt), { hideContent: true });
      if (step1.wasInterrupted) return { success: true };

      // Parse tasks from step 1 output and save to disk (file watcher handles UI)
      const tasks = parseTasks(step1.content);
      if (tasks.length > 0) {
        await saveTasksToActiveSession(tasks, sessionId);
      }

      // Activate ralph task list panel AFTER tasks.json exists on disk
      context.setRalphSessionDir(sessionDir);
      context.setRalphSessionId(sessionId);

      // Run DAG orchestrator for fresh session
      await runDAGOrchestrator(context, sessionId);

      return { success: true };
    },
  };
}

// ============================================================================
// FILE WATCHER
// ============================================================================

export function watchTasksJson(
  sessionDir: string,
  onUpdate: (items: NormalizedTodoItem[]) => void,
): () => void {
  const tasksPath = join(sessionDir, "tasks.json");

  // Watch the directory instead of the file so we catch file creation
  // even if tasks.json doesn't exist yet at mount time (BUG-7 fix)
  const watcher = watch(sessionDir, async (eventType, filename) => {
    if (filename !== "tasks.json") return;
    try {
      const content = await readFile(tasksPath, "utf-8");
      const tasks = normalizeTodoItems(JSON.parse(content));
      onUpdate(tasks);
    } catch {
      // File may not exist yet or be mid-write; ignore
    }
  });
  return () => watcher.close();
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
export const workflowCommands: CommandDefinition[] = BUILTIN_WORKFLOW_DEFINITIONS.map(
  createWorkflowCommand
);

/**
 * Initialize the workflow resolver for subgraph nodes.
 * This enables subgraphNode() to accept workflow names as strings
 * that are resolved at runtime via the workflow registry.
 *
 * Call this function during application initialization, after
 * loadWorkflowsFromDisk() has been called.
 *
 * @example
 * ```typescript
 * import { loadWorkflowsFromDisk, initializeWorkflowResolver } from "./workflow-commands";
 *
 * // In app initialization
 * await loadWorkflowsFromDisk();
 * initializeWorkflowResolver();
 * ```
 */
export function initializeWorkflowResolver(): void {
  setWorkflowResolver(resolveWorkflowRef);
}

/**
 * Register all workflow commands with the global registry.
 * Includes both built-in and dynamically loaded workflows.
 *
 * Also initializes the workflow resolver for subgraph nodes,
 * enabling subgraphNode() to accept workflow names as strings.
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
  // Initialize the workflow resolver so subgraphNode can use string workflow names
  initializeWorkflowResolver();

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
export function getWorkflowMetadata(name: string): WorkflowMetadata<BaseState> | undefined {
  const lowerName = name.toLowerCase();
  return getAllWorkflows().find(
    (w) =>
      w.name.toLowerCase() === lowerName ||
      w.aliases?.some((a) => a.toLowerCase() === lowerName)
  );
}

/**
 * Create a workflow instance by name.
 *
 * @param name - Workflow name (or alias)
 * @param config - Optional workflow configuration
 * @returns Compiled workflow graph, or undefined if not found
 */
export function createWorkflowByName(
  name: string,
  config?: Record<string, unknown>
): CompiledGraph<BaseState> | undefined {
  const metadata = getWorkflowMetadata(name);
  if (!metadata) {
    return undefined;
  }
  return metadata.createWorkflow({ ...metadata.defaultConfig, ...config });
}
