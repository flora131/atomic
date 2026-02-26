/**
 * Checkpointer Implementations for Graph Execution Engine
 *
 * This module provides implementations of the Checkpointer interface for
 * persisting and resuming graph execution state.
 *
 * Implementations:
 * - MemorySaver: In-memory storage using Map (for testing/development)
 * - FileSaver: File-based storage using JSON files
 * - ResearchDirSaver: Research directory storage with YAML frontmatter
 *
 * Reference: Feature 14 - Implement Checkpointer interface
 */

import { mkdir, readFile, writeFile, readdir, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import type { BaseState, Checkpointer } from "./types.ts";

// ============================================================================
// MEMORY SAVER
// ============================================================================

/**
 * Checkpoint entry stored in memory.
 */
interface MemoryCheckpoint<TState extends BaseState = BaseState> {
  state: TState;
  label: string;
  timestamp: string;
}

/**
 * In-memory checkpointer using Map storage.
 * Uses structuredClone for deep copies to prevent mutation.
 *
 * Best for:
 * - Testing
 * - Development
 * - Short-lived workflows
 *
 * @template TState - The state type being checkpointed
 *
 * @example
 * ```typescript
 * const saver = new MemorySaver<MyState>();
 *
 * await saver.save("exec-1", myState, "step_1");
 * const restored = await saver.load("exec-1");
 * ```
 */
export class MemorySaver<TState extends BaseState = BaseState>
  implements Checkpointer<TState>
{
  /** Map from executionId to list of checkpoints */
  private storage: Map<string, MemoryCheckpoint<TState>[]> = new Map();

  /**
   * Save a checkpoint of the current execution state.
   */
  async save(executionId: string, state: TState, label?: string): Promise<void> {
    const checkpoints = this.storage.get(executionId) ?? [];

    const checkpoint: MemoryCheckpoint<TState> = {
      state: structuredClone(state),
      label: label ?? `checkpoint_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };

    checkpoints.push(checkpoint);
    this.storage.set(executionId, checkpoints);
  }

  /**
   * Load the most recent checkpoint for an execution.
   */
  async load(executionId: string): Promise<TState | null> {
    const checkpoints = this.storage.get(executionId);

    if (!checkpoints || checkpoints.length === 0) {
      return null;
    }

    // Return the most recent checkpoint (last in array)
    const latest = checkpoints[checkpoints.length - 1]!;
    return structuredClone(latest.state);
  }

  /**
   * Load a specific checkpoint by label.
   *
   * @param executionId - The execution ID
   * @param label - The checkpoint label
   * @returns The checkpoint state or null
   */
  async loadByLabel(executionId: string, label: string): Promise<TState | null> {
    const checkpoints = this.storage.get(executionId);

    if (!checkpoints) {
      return null;
    }

    const checkpoint = checkpoints.find((c) => c.label === label);
    return checkpoint ? structuredClone(checkpoint.state) : null;
  }

  /**
   * List all checkpoint labels for an execution.
   */
  async list(executionId: string): Promise<string[]> {
    const checkpoints = this.storage.get(executionId);

    if (!checkpoints) {
      return [];
    }

    return checkpoints.map((c) => c.label);
  }

  /**
   * Delete a specific checkpoint or all checkpoints for an execution.
   */
  async delete(executionId: string, label?: string): Promise<void> {
    if (!label) {
      // Delete all checkpoints for this execution
      this.storage.delete(executionId);
      return;
    }

    // Delete specific checkpoint
    const checkpoints = this.storage.get(executionId);

    if (!checkpoints) {
      return;
    }

    const filtered = checkpoints.filter((c) => c.label !== label);
    this.storage.set(executionId, filtered);
  }

  /**
   * Clear all stored checkpoints.
   */
  clear(): void {
    this.storage.clear();
  }

  /**
   * Get the number of checkpoints for an execution.
   */
  count(executionId: string): number {
    return this.storage.get(executionId)?.length ?? 0;
  }
}

// ============================================================================
// FILE SAVER
// ============================================================================

/**
 * File-based checkpointer using JSON files.
 *
 * Storage structure:
 * ```
 * baseDir/
 *   {executionId}/
 *     {label}.json
 *     ...
 * ```
 *
 * Best for:
 * - Persistent storage
 * - Production workflows
 * - Large state objects
 *
 * @template TState - The state type being checkpointed
 *
 * @example
 * ```typescript
 * const saver = new FileSaver<MyState>('/tmp/checkpoints');
 *
 * await saver.save("exec-1", myState, "step_1");
 * const restored = await saver.load("exec-1");
 * ```
 */
export class FileSaver<TState extends BaseState = BaseState>
  implements Checkpointer<TState>
{
  constructor(private readonly baseDir: string) {}

  /**
   * Get the directory path for an execution.
   */
  private getExecutionDir(executionId: string): string {
    return join(this.baseDir, executionId);
  }

  /**
   * Get the file path for a checkpoint.
   */
  private getCheckpointPath(executionId: string, label: string): string {
    // Sanitize label for use as filename
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.getExecutionDir(executionId), `${safeLabel}.json`);
  }

  /**
   * Ensure the execution directory exists.
   */
  private async ensureDir(executionId: string): Promise<void> {
    const dir = this.getExecutionDir(executionId);
    await mkdir(dir, { recursive: true });
  }

  /**
   * Save a checkpoint of the current execution state.
   */
  async save(executionId: string, state: TState, label?: string): Promise<void> {
    await this.ensureDir(executionId);

    const checkpointLabel = label ?? `checkpoint_${Date.now()}`;
    const filePath = this.getCheckpointPath(executionId, checkpointLabel);

    const data = {
      label: checkpointLabel,
      timestamp: new Date().toISOString(),
      state,
    };

    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Load the most recent checkpoint for an execution.
   */
  async load(executionId: string): Promise<TState | null> {
    const labels = await this.list(executionId);

    if (labels.length === 0) {
      return null;
    }

    // Get the most recent checkpoint (last in sorted list)
    const latestLabel = labels[labels.length - 1]!;
    return this.loadByLabel(executionId, latestLabel);
  }

  /**
   * Load a specific checkpoint by label.
   */
  async loadByLabel(executionId: string, label: string): Promise<TState | null> {
    const filePath = this.getCheckpointPath(executionId, label);

    try {
      const content = await readFile(filePath, "utf-8");
      const data = JSON.parse(content);
      return data.state as TState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all checkpoint labels for an execution.
   */
  async list(executionId: string): Promise<string[]> {
    const dir = this.getExecutionDir(executionId);

    try {
      const files = await readdir(dir);
      return files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(".json", ""))
        .sort(); // Sort alphabetically (timestamps sort correctly)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  /**
   * Delete a specific checkpoint or all checkpoints for an execution.
   */
  async delete(executionId: string, label?: string): Promise<void> {
    if (!label) {
      // Delete the entire execution directory
      const dir = this.getExecutionDir(executionId);
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      return;
    }

    // Delete specific checkpoint
    const filePath = this.getCheckpointPath(executionId, label);
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

// ============================================================================
// RESEARCH DIR SAVER
// ============================================================================

/**
 * YAML frontmatter + JSON format for research directory checkpoints.
 */
interface ResearchCheckpointFile {
  frontmatter: {
    executionId: string;
    label: string;
    timestamp: string;
    nodeCount?: number;
  };
  state: unknown;
}

/**
 * Parse YAML frontmatter from file content.
 */
function parseYamlFrontmatter(content: string): ResearchCheckpointFile | null {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return null;
  }

  const yamlContent = match[1]!;
  const jsonContent = match[2]!;

  // Parse simple YAML (key: value pairs)
  const frontmatter: Record<string, string | number> = {};
  for (const line of yamlContent.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();

      // Try to parse as number
      const numValue = Number(value);
      frontmatter[key] = Number.isNaN(numValue) ? value : numValue;
    }
  }

  try {
    const state = JSON.parse(jsonContent);
    return {
      frontmatter: frontmatter as ResearchCheckpointFile["frontmatter"],
      state,
    };
  } catch {
    return null;
  }
}

/**
 * Generate YAML frontmatter + JSON content.
 */
function generateYamlFrontmatter(data: ResearchCheckpointFile): string {
  const lines = ["---"];

  for (const [key, value] of Object.entries(data.frontmatter)) {
    lines.push(`${key}: ${value}`);
  }

  lines.push("---");
  lines.push(JSON.stringify(data.state, null, 2));

  return lines.join("\n");
}

/**
 * Research directory checkpointer with YAML frontmatter format.
 *
 * Storage structure:
 * ```
 * research/checkpoints/
 *   {executionId}/
 *     {label}.md
 *     ...
 * ```
 *
 * File format:
 * ```
 * ---
 * executionId: exec-1
 * label: step_1
 * timestamp: 2024-01-01T00:00:00.000Z
 * nodeCount: 5
 * ---
 * {
 *   "executionId": "exec-1",
 *   "lastUpdated": "...",
 *   ...
 * }
 * ```
 *
 * Best for:
 * - Human-readable checkpoints
 * - Git-friendly storage
 * - Ralph loop workflows
 *
 * @template TState - The state type being checkpointed
 */
export class ResearchDirSaver<TState extends BaseState = BaseState>
  implements Checkpointer<TState>
{
  private readonly checkpointsDir: string;

  constructor(researchDir: string = "research") {
    this.checkpointsDir = join(researchDir, "checkpoints");
  }

  /**
   * Get the directory path for an execution.
   */
  private getExecutionDir(executionId: string): string {
    return join(this.checkpointsDir, executionId);
  }

  /**
   * Get the file path for a checkpoint.
   */
  private getCheckpointPath(executionId: string, label: string): string {
    // Sanitize label for use as filename
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.getExecutionDir(executionId), `${safeLabel}.md`);
  }

  /**
   * Ensure the execution directory exists.
   */
  private async ensureDir(executionId: string): Promise<void> {
    const dir = this.getExecutionDir(executionId);
    await mkdir(dir, { recursive: true });
  }

  /**
   * Count nodes in state outputs.
   */
  private countNodes(state: TState): number {
    return Object.keys(state.outputs).length;
  }

  /**
   * Save a checkpoint of the current execution state.
   */
  async save(executionId: string, state: TState, label?: string): Promise<void> {
    await this.ensureDir(executionId);

    const checkpointLabel = label ?? `checkpoint_${Date.now()}`;
    const filePath = this.getCheckpointPath(executionId, checkpointLabel);

    const data: ResearchCheckpointFile = {
      frontmatter: {
        executionId,
        label: checkpointLabel,
        timestamp: new Date().toISOString(),
        nodeCount: this.countNodes(state),
      },
      state,
    };

    const content = generateYamlFrontmatter(data);
    await writeFile(filePath, content, "utf-8");
  }

  /**
   * Load the most recent checkpoint for an execution.
   */
  async load(executionId: string): Promise<TState | null> {
    const labels = await this.list(executionId);

    if (labels.length === 0) {
      return null;
    }

    // Get the most recent checkpoint (last in sorted list)
    const latestLabel = labels[labels.length - 1]!;
    return this.loadByLabel(executionId, latestLabel);
  }

  /**
   * Load a specific checkpoint by label.
   */
  async loadByLabel(executionId: string, label: string): Promise<TState | null> {
    const filePath = this.getCheckpointPath(executionId, label);

    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = parseYamlFrontmatter(content);

      if (!parsed) {
        return null;
      }

      return parsed.state as TState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all checkpoint labels for an execution.
   */
  async list(executionId: string): Promise<string[]> {
    const dir = this.getExecutionDir(executionId);

    try {
      const files = await readdir(dir);
      return files
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(".md", ""))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  /**
   * Delete a specific checkpoint or all checkpoints for an execution.
   */
  async delete(executionId: string, label?: string): Promise<void> {
    if (!label) {
      // Delete the entire execution directory
      const dir = this.getExecutionDir(executionId);
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      return;
    }

    // Delete specific checkpoint
    const filePath = this.getCheckpointPath(executionId, label);
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  /**
   * Get metadata for a checkpoint without loading the full state.
   */
  async getMetadata(
    executionId: string,
    label: string
  ): Promise<ResearchCheckpointFile["frontmatter"] | null> {
    const filePath = this.getCheckpointPath(executionId, label);

    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = parseYamlFrontmatter(content);

      return parsed?.frontmatter ?? null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
}

// ============================================================================
// SESSION DIR SAVER
// ============================================================================

/**
 * Session directory checkpointer for Ralph sessions.
 *
 * This checkpointer saves checkpoints to the session's checkpoints directory,
 * using sequential naming (node-001.json, node-002.json, etc.).
 *
 * Storage structure:
 * ```
 * .ralph/sessions/{sessionId}/
 *   checkpoints/
 *     node-001.json
 *     node-002.json
 *     ...
 * ```
 *
 * Features:
 * - Sequential checkpoint naming for easy ordering
 * - Full state included in each checkpoint
 * - Supports resumption from any checkpoint
 * - Dynamic directory based on session state
 *
 * @template TState - The state type being checkpointed
 */
export class SessionDirSaver<TState extends BaseState = BaseState>
  implements Checkpointer<TState>
{
  private checkpointCounter = 0;

  /**
   * Create a SessionDirSaver.
   *
   * @param sessionDirGetter - Function that returns the session directory from state
   *                           or a static session directory path
   */
  constructor(
    private readonly sessionDirGetter: string | ((state: TState) => string)
  ) {}

  /**
   * Get the checkpoints directory for a session.
   */
  private getCheckpointsDir(sessionDir: string): string {
    return join(sessionDir, "checkpoints");
  }

  /**
   * Get the checkpoint file path with sequential naming.
   */
  private getCheckpointPath(sessionDir: string, label: string): string {
    const checkpointsDir = this.getCheckpointsDir(sessionDir);
    // Sanitize label for use as filename
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(checkpointsDir, `${safeLabel}.json`);
  }

  /**
   * Generate a sequential checkpoint label (node-001, node-002, etc.)
   */
  private generateSequentialLabel(): string {
    this.checkpointCounter++;
    return `node-${String(this.checkpointCounter).padStart(3, "0")}`;
  }

  /**
   * Resolve the session directory from the getter.
   */
  private resolveSessionDir(state?: TState): string {
    if (typeof this.sessionDirGetter === "string") {
      return this.sessionDirGetter;
    }
    if (!state) {
      throw new Error("SessionDirSaver requires state to resolve dynamic session directory");
    }
    return this.sessionDirGetter(state);
  }

  /**
   * Ensure the checkpoints directory exists.
   */
  private async ensureDir(sessionDir: string): Promise<void> {
    const checkpointsDir = this.getCheckpointsDir(sessionDir);
    await mkdir(checkpointsDir, { recursive: true });
  }

  /**
   * Extract checkpoint number from a label in the format "node-NNN".
   * Returns null if the label doesn't match the sequential format.
   */
  private extractCheckpointNumber(label: string): number | null {
    const match = label.match(/^node-(\d+)$/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
    return null;
  }

  /**
   * Save a checkpoint of the current execution state.
   *
   * Uses sequential naming (node-001, node-002, etc.) if no label is provided.
   */
  async save(executionId: string, state: TState, label?: string): Promise<void> {
    const sessionDir = this.resolveSessionDir(state);
    await this.ensureDir(sessionDir);

    let checkpointLabel: string;
    let checkpointNumber: number;

    if (label) {
      checkpointLabel = label;
      // If the label matches our sequential pattern, extract and update the counter
      const extractedNumber = this.extractCheckpointNumber(label);
      if (extractedNumber !== null) {
        checkpointNumber = extractedNumber;
        // Update internal counter if this is higher than current
        if (extractedNumber > this.checkpointCounter) {
          this.checkpointCounter = extractedNumber;
        }
      } else {
        // Non-sequential label, just use current counter
        checkpointNumber = this.checkpointCounter;
      }
    } else {
      // Generate sequential label
      checkpointLabel = this.generateSequentialLabel();
      checkpointNumber = this.checkpointCounter;
    }

    const filePath = this.getCheckpointPath(sessionDir, checkpointLabel);

    const data = {
      executionId,
      label: checkpointLabel,
      timestamp: new Date().toISOString(),
      checkpointNumber,
      state,
    };

    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Load the most recent checkpoint for an execution.
   *
   * Note: This method requires the session directory to be provided via
   * a static path in the constructor.
   */
  async load(executionId: string): Promise<TState | null> {
    if (typeof this.sessionDirGetter !== "string") {
      throw new Error(
        "SessionDirSaver.load() requires a static session directory. " +
        "Use loadFromSessionDir() for dynamic session directories."
      );
    }

    return this.loadFromSessionDir(this.sessionDirGetter, executionId);
  }

  /**
   * Load the most recent checkpoint from a specific session directory.
   *
   * @param sessionDir - Path to the session directory
   * @param executionId - Execution ID to match (optional, uses most recent if not provided)
   * @returns The checkpointed state, or null if not found
   */
  async loadFromSessionDir(sessionDir: string, executionId?: string): Promise<TState | null> {
    const labels = await this.listFromSessionDir(sessionDir);

    if (labels.length === 0) {
      return null;
    }

    // Get the most recent checkpoint (last in sorted list)
    const latestLabel = labels[labels.length - 1]!;
    return this.loadByLabelFromSessionDir(sessionDir, latestLabel, executionId);
  }

  /**
   * Load a specific checkpoint by label.
   */
  async loadByLabel(executionId: string, label: string): Promise<TState | null> {
    if (typeof this.sessionDirGetter !== "string") {
      throw new Error(
        "SessionDirSaver.loadByLabel() requires a static session directory. " +
        "Use loadByLabelFromSessionDir() for dynamic session directories."
      );
    }

    return this.loadByLabelFromSessionDir(this.sessionDirGetter, label, executionId);
  }

  /**
   * Load a specific checkpoint by label from a session directory.
   */
  async loadByLabelFromSessionDir(
    sessionDir: string,
    label: string,
    executionId?: string
  ): Promise<TState | null> {
    const filePath = this.getCheckpointPath(sessionDir, label);

    try {
      const content = await readFile(filePath, "utf-8");
      const data = JSON.parse(content);

      // Optionally verify execution ID matches
      if (executionId && data.executionId !== executionId) {
        return null;
      }

      // Update internal counter to continue from this checkpoint
      if (typeof data.checkpointNumber === "number") {
        this.checkpointCounter = data.checkpointNumber;
      }

      return data.state as TState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all checkpoint labels for an execution.
   */
  async list(_executionId: string): Promise<string[]> {
    if (typeof this.sessionDirGetter !== "string") {
      throw new Error(
        "SessionDirSaver.list() requires a static session directory. " +
        "Use listFromSessionDir() for dynamic session directories."
      );
    }

    return this.listFromSessionDir(this.sessionDirGetter);
  }

  /**
   * List all checkpoint labels from a session directory.
   */
  async listFromSessionDir(sessionDir: string): Promise<string[]> {
    const checkpointsDir = this.getCheckpointsDir(sessionDir);

    try {
      const files = await readdir(checkpointsDir);
      return files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(".json", ""))
        .sort(); // Sort alphabetically (node-001, node-002, etc.)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  /**
   * Delete a specific checkpoint or all checkpoints for an execution.
   */
  async delete(executionId: string, label?: string): Promise<void> {
    if (typeof this.sessionDirGetter !== "string") {
      throw new Error(
        "SessionDirSaver.delete() requires a static session directory. " +
        "Use deleteFromSessionDir() for dynamic session directories."
      );
    }

    return this.deleteFromSessionDir(this.sessionDirGetter, label);
  }

  /**
   * Delete checkpoints from a session directory.
   */
  async deleteFromSessionDir(sessionDir: string, label?: string): Promise<void> {
    const checkpointsDir = this.getCheckpointsDir(sessionDir);

    if (!label) {
      // Delete all checkpoints in the directory
      try {
        await rm(checkpointsDir, { recursive: true, force: true });
        this.checkpointCounter = 0;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      return;
    }

    // Delete specific checkpoint
    const filePath = this.getCheckpointPath(sessionDir, label);
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  /**
   * Get the current checkpoint count.
   */
  getCheckpointCount(): number {
    return this.checkpointCounter;
  }

  /**
   * Reset the checkpoint counter.
   */
  resetCounter(): void {
    this.checkpointCounter = 0;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Checkpointer type for factory function.
 */
export type CheckpointerType = "memory" | "file" | "research" | "session";

/**
 * Options for creating a checkpointer.
 */
export interface CreateCheckpointerOptions<TState extends BaseState = BaseState> {
  /** Base directory for FileSaver */
  baseDir?: string;
  /** Research directory for ResearchDirSaver */
  researchDir?: string;
  /** Session directory or getter function for SessionDirSaver */
  sessionDir?: string | ((state: TState) => string);
}

/**
 * Create a checkpointer instance.
 *
 * @param type - The type of checkpointer to create
 * @param options - Options for the checkpointer
 * @returns A Checkpointer instance
 *
 * @example
 * ```typescript
 * const memory = createCheckpointer("memory");
 * const file = createCheckpointer("file", { baseDir: "/tmp/checkpoints" });
 * const research = createCheckpointer("research", { researchDir: "research" });
 * const session = createCheckpointer("session", {
 *   sessionDir: (state) => state.sessionDir
 * });
 * ```
 */
export function createCheckpointer<TState extends BaseState = BaseState>(
  type: CheckpointerType,
  options?: CreateCheckpointerOptions<TState>
): Checkpointer<TState> {
  switch (type) {
    case "memory":
      return new MemorySaver<TState>();

    case "file":
      if (!options?.baseDir) {
        throw new Error("FileSaver requires baseDir option");
      }
      return new FileSaver<TState>(options.baseDir);

    case "research":
      return new ResearchDirSaver<TState>(options?.researchDir ?? "research");

    case "session":
      if (!options?.sessionDir) {
        throw new Error("SessionDirSaver requires sessionDir option");
      }
      return new SessionDirSaver<TState>(options.sessionDir);

    default:
      throw new Error(`Unknown checkpointer type: ${type}`);
  }
}
