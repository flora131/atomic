/**
 * Workflow Commands for Chat UI
 *
 * Registers workflow commands that start graph-based workflow executions.
 * Each workflow command creates a new workflow instance and updates the UI state.
 *
 * The workflow sequence follows the Atomic pattern:
 * 1. /research-codebase → clear → 2. /create-spec → clear → 3. HIL spec review
 *
 * Reference: Feature 3 - Implement workflow command registration
 */

import { existsSync, watch } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";

import {
  createRalphWorkflow,
  type CreateRalphWorkflowConfig,
} from "../../workflows/ralph/workflow.ts";
import type { CompiledGraph, BaseState } from "../../graph/types.ts";
import type { AtomicWorkflowState } from "../../graph/annotation.ts";
import { setWorkflowResolver, type CompiledSubgraph } from "../../graph/nodes.ts";
import {
  generateRalphSessionId,
  getRalphSessionPaths,
} from "../../config/ralph.ts";
import type { TodoItem } from "../../sdk/tools/todo-write.ts";
import {
  generateSessionId,
  getSessionDir,
} from "../../workflows/ralph/session.ts";

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

/**
 * Workflow session state for tracking multi-step workflow execution.
 */
export interface WorkflowSession {
  /** Unique session ID */
  sessionId: string;
  /** Agent type (claude, opencode, copilot) */
  agentType: string;
  /** Current workflow step */
  currentStep: WorkflowStep;
  /** Session-specific file paths */
  paths: {
    featureListPath: string;
    progressFilePath: string;
    stateFilePath: string;
  };
  /** Timestamp when session was created */
  createdAt: number;
  /** Research document path (if created) */
  researchDocPath?: string;
  /** Spec document path (if created) */
  specDocPath?: string;
}

/**
 * Workflow steps for the Atomic workflow.
 */
export type WorkflowStep =
  | "research"
  | "research_complete"
  | "create_spec"
  | "spec_complete"
  | "spec_review"
  | "spec_approved"
  | "spec_rejected"
  | "create_features"
  | "implement"
  | "complete";

// ============================================================================
// WORKFLOW SESSION MANAGEMENT
// ============================================================================

/** Active workflow sessions (keyed by sessionId) */
const activeSessions = new Map<string, WorkflowSession>();

/**
 * Create a new workflow session with unique file paths.
 */
export function createWorkflowSession(agentType: string): WorkflowSession {
  const sessionId = generateRalphSessionId();
  const paths = getRalphSessionPaths(agentType, sessionId);

  const session: WorkflowSession = {
    sessionId,
    agentType,
    currentStep: "research",
    paths,
    createdAt: Date.now(),
  };

  activeSessions.set(sessionId, session);
  return session;
}

/**
 * Get the current active session (most recent if multiple).
 */
export function getActiveSession(): WorkflowSession | undefined {
  const sessions = Array.from(activeSessions.values());
  return sessions.sort((a, b) => b.createdAt - a.createdAt)[0];
}

/**
 * Update a session's current step.
 */
export function updateSessionStep(sessionId: string, step: WorkflowStep): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.currentStep = step;
  }
}

/**
 * Complete and remove a session.
 */
export function completeSession(sessionId: string): void {
  activeSessions.delete(sessionId);
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
 */
const BUILTIN_WORKFLOW_DEFINITIONS: WorkflowMetadata<BaseState>[] = [
  {
    name: "ralph",
    description: "Start autonomous implementation workflow",
    aliases: ["loop"],
    argumentHint: '"<prompt-or-spec-path>" [--resume UUID ["<prompt>"]]',
    createWorkflow: (config?: Record<string, unknown>) => {
      const ralphConfig: CreateRalphWorkflowConfig = {
        checkpointing: typeof config?.checkpointing === "boolean" ? config.checkpointing : true,
        userPrompt: typeof config?.userPrompt === "string" ? config.userPrompt : undefined,
        resumeSessionId: typeof config?.resumeSessionId === "string" ? config.resumeSessionId : undefined,
      };
      return createRalphWorkflow(ralphConfig) as unknown as CompiledGraph<BaseState>;
    },
    defaultConfig: {
      checkpointing: true,
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

function createRalphCommand(metadata: WorkflowMetadata<BaseState>): CommandDefinition {
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

        const sessionDir = getSessionDir(parsed.sessionId);
        if (!existsSync(sessionDir)) {
          return {
            success: false,
            message: `Session not found: ${parsed.sessionId}\nDirectory does not exist: ${sessionDir}`,
          };
        }

        context.addMessage("system", `Resuming session ${parsed.sessionId}`);

        return {
          success: true,
          message: `Resuming session ${parsed.sessionId}...`,
          stateUpdate: {
            workflowActive: true,
            workflowType: metadata.name,
            initialPrompt: parsed.prompt,
            pendingApproval: false,
            specApproved: undefined,
            feedback: null,
            ralphConfig: {
              resumeSessionId: parsed.sessionId,
              userPrompt: parsed.prompt,
            },
          },
        };
      }

      // Handle new run
      const sessionId = generateSessionId();
      
      context.addMessage(
        "system",
        `Session ${sessionId}\n\nStarting workflow...\n\nPrompt: "${parsed.prompt}"`
      );

      return {
        success: true,
        message: `Session ${sessionId} started. Running workflow...`,
        stateUpdate: {
          workflowActive: true,
          workflowType: metadata.name,
          initialPrompt: parsed.prompt,
          pendingApproval: false,
          specApproved: undefined,
          feedback: null,
          ralphConfig: {
            sessionId,
            userPrompt: parsed.prompt,
          },
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
  onUpdate: (items: TodoItem[]) => void
): () => void {
  const tasksPath = join(sessionDir, "tasks.json");
  const watcher = watch(tasksPath, async () => {
    try {
      const content = await readFile(tasksPath, "utf-8");
      const tasks = JSON.parse(content) as TodoItem[];
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
