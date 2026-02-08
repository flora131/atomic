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

import { existsSync } from "fs";
import { join } from "path";
import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";
import { getBuiltinSkill } from "./skill-commands.ts";

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
  RALPH_DEFAULTS,
} from "../../config/ralph.ts";
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
export interface RalphCommandArgs {
  /** Whether --yolo flag is present */
  yolo: boolean;
  /** User prompt (required for --yolo mode) */
  prompt: string | null;
  /** Session ID to resume (from --resume flag) */
  resumeSessionId: string | null;
  /** Maximum number of iterations (from --max-iterations flag) */
  maxIterations: number;
  /** Path to feature list JSON file (from --feature-list flag) */
  featureListPath: string;
}

/** Default max iterations if not specified */
const DEFAULT_MAX_ITERATIONS = 100;

/**
 * Parse /ralph command arguments for --yolo, --resume, --max-iterations, and --feature-list flags.
 *
 * Supported formats:
 *   /ralph --yolo <prompt>                    - Run in yolo mode with the given prompt
 *   /ralph --resume <uuid>                    - Resume a previous session
 *   /ralph --max-iterations <n> <prompt>      - Set max iterations
 *   /ralph --feature-list <path> <prompt>     - Use custom feature list path
 *   /ralph <prompt>                           - Normal mode with feature list
 *
 * The --max-iterations and --feature-list flags can be combined with --yolo:
 *   /ralph --max-iterations 50 --yolo <prompt>
 *   /ralph --feature-list custom.json --yolo <prompt>
 *   /ralph --yolo --max-iterations 50 <prompt>
 *
 * @param args - Raw argument string from the command
 * @returns Parsed RalphCommandArgs
 *
 * @example
 * parseRalphArgs("--yolo implement auth")
 * // => { yolo: true, prompt: "implement auth", resumeSessionId: null, maxIterations: 100, featureListPath: "research/feature-list.json" }
 *
 * parseRalphArgs("--max-iterations 50 --yolo implement auth")
 * // => { yolo: true, prompt: "implement auth", resumeSessionId: null, maxIterations: 50, featureListPath: "research/feature-list.json" }
 *
 * parseRalphArgs("--feature-list custom.json implement auth")
 * // => { yolo: false, prompt: "implement auth", resumeSessionId: null, maxIterations: 100, featureListPath: "custom.json" }
 *
 * parseRalphArgs("--resume abc123-def456")
 * // => { yolo: false, prompt: null, resumeSessionId: "abc123-def456", maxIterations: 100, featureListPath: "research/feature-list.json" }
 *
 * parseRalphArgs("my feature")
 * // => { yolo: false, prompt: "my feature", resumeSessionId: null, maxIterations: 100, featureListPath: "research/feature-list.json" }
 */
export function parseRalphArgs(args: string): RalphCommandArgs {
  let trimmed = args.trim();
  let maxIterations = DEFAULT_MAX_ITERATIONS;
  let featureListPath: string = RALPH_DEFAULTS.featureListPath;

  // First, check for and extract --max-iterations flag anywhere in the string
  const maxIterMatch = trimmed.match(/^(.*?)--max-iterations\s+(\d+)\s*(.*?)$/s);
  if (maxIterMatch) {
    const beforeFlag = maxIterMatch[1]?.trim() ?? "";
    const iterValue = maxIterMatch[2] ?? "";
    const afterFlag = maxIterMatch[3]?.trim() ?? "";
    
    // Parse the number (already validated as digits by regex)
    const parsed = parseInt(iterValue, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      maxIterations = parsed;
    }
    
    // Reconstruct trimmed without the --max-iterations flag
    trimmed = (beforeFlag + " " + afterFlag).trim();
  }

  // Check for and extract --feature-list flag at a valid position
  // The flag is valid if there's no non-flag content before it
  // We check if --feature-list is present and NOT preceded by non-flag words
  if (trimmed.includes("--feature-list")) {
    // Check if it's at the start or only preceded by other flags/values
    const beforeFeatureList = trimmed.split("--feature-list")[0] ?? "";
    const tokens = beforeFeatureList.trim().split(/\s+/).filter(t => t.length > 0);
    
    // Valid if: empty before, or all tokens before are flags (start with --) or immediately follow a flag
    let isValidPosition = true;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const prevToken = i > 0 ? tokens[i - 1] : undefined;
      // Token is valid if it starts with -- OR if the previous token starts with --
      if (!token.startsWith("--") && !(prevToken && prevToken.startsWith("--"))) {
        isValidPosition = false;
        break;
      }
    }
    
    if (isValidPosition) {
      // Extract the path after --feature-list
      const afterFeatureList = trimmed.split("--feature-list")[1]?.trim() ?? "";
      const pathMatch = afterFeatureList.match(/^(\S+)/);
      if (pathMatch) {
        featureListPath = pathMatch[1]!;
        // Reconstruct trimmed without --feature-list and its value
        const afterPath = afterFeatureList.slice(featureListPath.length).trim();
        trimmed = (beforeFeatureList.trim() + " " + afterPath).trim();
      }
    }
  }

  // Check for --resume flag
  if (trimmed.startsWith("--resume")) {
    // Extract everything after --resume as the session ID
    const afterFlag = trimmed.slice("--resume".length).trim();
    // Return empty string when --resume is used without a UUID so the caller
    // can distinguish "no --resume flag" (null) from "flag present, no value" ("")
    const sessionId = afterFlag.length > 0 ? (afterFlag.split(/\s+/)[0] ?? "") : "";
    return {
      yolo: false,
      prompt: null,
      resumeSessionId: sessionId,
      maxIterations,
      featureListPath,
    };
  }

  // Check for --yolo flag
  if (trimmed.startsWith("--yolo")) {
    // Extract everything after --yolo as the prompt
    const afterFlag = trimmed.slice("--yolo".length).trim();
    return {
      yolo: true,
      prompt: afterFlag.length > 0 ? afterFlag : null,
      resumeSessionId: null,
      maxIterations,
      featureListPath,
    };
  }

  // Normal mode - entire args string is the prompt
  return {
    yolo: false,
    prompt: trimmed.length > 0 ? trimmed : null,
    resumeSessionId: null,
    maxIterations,
    featureListPath,
  };
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
    description: "Start the Ralph autonomous implementation workflow",
    aliases: ["loop"],
    argumentHint: "[PROMPT] [--yolo] [--resume UUID] [--max-iterations N (100)] [--feature-list PATH (research/feature-list.json)]",
    createWorkflow: (config?: Record<string, unknown>) => {
      const ralphConfig: CreateRalphWorkflowConfig = {
        maxIterations: typeof config?.maxIterations === "number" ? config.maxIterations : undefined,
        checkpointing: typeof config?.checkpointing === "boolean" ? config.checkpointing : true,
        featureListPath: typeof config?.featureListPath === "string" ? config.featureListPath : undefined,
        yolo: typeof config?.yolo === "boolean" ? config.yolo : false,
        userPrompt: typeof config?.userPrompt === "string" ? config.userPrompt : undefined,
      };
      return createRalphWorkflow(ralphConfig) as unknown as CompiledGraph<BaseState>;
    },
    defaultConfig: {
      checkpointing: true,
      yolo: false,
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
 * Create a specialized command definition for the ralph workflow.
 *
 * Handles --yolo and --resume flag parsing:
 *   /ralph --yolo <prompt>     - Run in yolo mode with the given prompt
 *   /ralph --resume <uuid>     - Resume a previous session
 *   /ralph <prompt>            - Normal mode with feature list
 *
 * @param metadata - Ralph workflow metadata
 * @returns Command definition with flag parsing
 */
function createRalphCommand(metadata: WorkflowMetadata<BaseState>): CommandDefinition {
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

      // Parse ralph-specific flags
      const parsed = parseRalphArgs(args);

      // Handle --resume flag (non-null means --resume was used)
      if (parsed.resumeSessionId !== null) {
        // Check if UUID was actually provided
        if (parsed.resumeSessionId === "") {
          return {
            success: false,
            message: `Missing session ID. Please provide a UUID to resume.\nUsage: /ralph --resume <uuid>`,
          };
        }

        // Validate UUID format
        if (!isValidUUID(parsed.resumeSessionId)) {
          return {
            success: false,
            message: `Invalid session ID format. Expected a UUID (e.g., 550e8400-e29b-41d4-a716-446655440000).\nUsage: /ralph --resume <uuid>`,
          };
        }

        // Check if session exists
        const sessionDir = getSessionDir(parsed.resumeSessionId);
        if (!existsSync(sessionDir)) {
          return {
            success: false,
            message: `Session not found: ${parsed.resumeSessionId}\nDirectory does not exist: ${sessionDir}`,
          };
        }

        // Log resuming session
        context.addMessage(
          "system",
          `Resuming session: ${parsed.resumeSessionId}`
        );

        // Return success with state updates and resume config
        return {
          success: true,
          message: `Resuming Ralph session ${parsed.resumeSessionId}...`,
          stateUpdate: {
            workflowActive: true,
            workflowType: metadata.name,
            initialPrompt: null,
            pendingApproval: false,
            specApproved: undefined,
            feedback: null,
            maxIterations: parsed.maxIterations,
            // Ralph-specific config with resumeSessionId
            ralphConfig: {
              yolo: false,
              userPrompt: null,
              resumeSessionId: parsed.resumeSessionId,
              maxIterations: parsed.maxIterations,
              featureListPath: parsed.featureListPath,
            },
          },
        };
      }

      // Yolo mode requires a prompt
      if (parsed.yolo && !parsed.prompt) {
        return {
          success: false,
          message: `--yolo flag requires a prompt.\nUsage: /ralph --yolo <your task description>`,
        };
      }

      // Non-yolo mode with no prompt: auto-default to implement-feature if feature list exists
      if (!parsed.yolo && !parsed.prompt) {
        if (existsSync(parsed.featureListPath)) {
          const implSkill = getBuiltinSkill("implement-feature");
          if (implSkill) {
            parsed.prompt = implSkill.prompt.replace(/\$ARGUMENTS/g, "");
          } else {
            parsed.prompt = "Implement the next feature from the feature list.";
          }
        } else {
          return {
            success: false,
            message: `Please provide a prompt for the ralph workflow.\nUsage: /ralph <your task description>\n       /ralph --yolo <prompt>\n       /ralph --resume <uuid>`,
          };
        }
      }

      // In non-yolo mode, validate feature list file exists
      if (!parsed.yolo && !existsSync(parsed.featureListPath)) {
        return {
          success: false,
          message: `Feature list file not found: ${parsed.featureListPath}\nCreate the file or use --yolo mode for prompt-only execution.`,
        };
      }

      // Use implement-feature default prompt when prompt is minimal
      if (!parsed.prompt) {
        const implSkill = getBuiltinSkill("implement-feature");
        if (implSkill) {
          parsed.prompt = implSkill.prompt.replace(/\$ARGUMENTS/g, "");
        } else {
          parsed.prompt = "Implement the next feature from the feature list.";
        }
      }

      // Generate a new session ID for this Ralph session
      const sessionId = generateSessionId();

      // Build the mode indicator for the message
      const modeStr = parsed.yolo ? " (yolo mode)" : "";
      const iterStr = parsed.maxIterations !== 100 ? ` (max: ${parsed.maxIterations})` : "";
      const featureListStr = parsed.featureListPath !== RALPH_DEFAULTS.featureListPath
        ? ` (features: ${parsed.featureListPath})`
        : "";

      // Add a system message indicating workflow start with session UUID
      context.addMessage(
        "system",
        `Started Ralph session: ${sessionId}\n\nStarting **ralph** workflow${modeStr}${iterStr}${featureListStr}...\n\nPrompt: "${parsed.prompt}"`
      );

      // Return success with state updates and workflow config including sessionId
      return {
        success: true,
        message: `Started Ralph session: ${sessionId}\n\nWorkflow **ralph** initialized${modeStr}${iterStr}${featureListStr}. Starting implementation...`,
        stateUpdate: {
          workflowActive: true,
          workflowType: metadata.name,
          initialPrompt: parsed.prompt,
          pendingApproval: false,
          specApproved: undefined,
          feedback: null,
          maxIterations: parsed.maxIterations,
          // Ralph-specific config with sessionId
          ralphConfig: {
            sessionId,
            yolo: parsed.yolo,
            userPrompt: parsed.prompt,
            maxIterations: parsed.maxIterations,
            featureListPath: parsed.featureListPath,
          },
        },
      };
    },
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
