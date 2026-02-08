/**
 * SubagentSessionManager - Manages independent sub-agent sessions
 *
 * Creates, tracks, and cleans up independent SDK sessions for sub-agents.
 * Each sub-agent gets its own isolated context window via client.createSession().
 *
 * Follows the session lifecycle pattern from src/graph/nodes.ts:163-263
 * where sessions are created, streamed, and destroyed in a finally block.
 *
 * Reference: specs/subagent-ui-independent-context.md Section 5.1
 */

import type { Session, SessionConfig } from "../sdk/types.ts";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for spawning a single sub-agent session.
 */
export interface SubagentSpawnOptions {
  /** Unique identifier for this sub-agent */
  agentId: string;
  /** Display name (e.g., "Explore", "Plan", "debugger") */
  agentName: string;
  /** Task description to send to the sub-agent */
  task: string;
  /** Optional system prompt override */
  systemPrompt?: string;
  /** Optional model override */
  model?: string;
  /** Optional tool restrictions */
  tools?: string[];
}

/**
 * Result returned after a sub-agent completes or fails.
 */
export interface SubagentResult {
  /** Agent identifier matching SubagentSpawnOptions.agentId */
  agentId: string;
  /** Whether the sub-agent completed successfully */
  success: boolean;
  /** Summary text returned to parent (truncated to MAX_SUMMARY_LENGTH) */
  output: string;
  /** Error message if the sub-agent failed */
  error?: string;
  /** Number of tool invocations during execution */
  toolUses: number;
  /** Execution duration in milliseconds */
  durationMs: number;
}

/**
 * Callback for status updates during sub-agent execution.
 * Used to update ParallelAgentsTree in real-time.
 */
export type SubagentStatusCallback = (
  agentId: string,
  update: Partial<ParallelAgent>
) => void;

/**
 * Factory function that creates independent sessions for sub-agents.
 * Decouples SubagentSessionManager from CodingAgentClient.
 */
export type CreateSessionFn = (config?: SessionConfig) => Promise<Session>;

/**
 * Configuration for SubagentSessionManager.
 */
export interface SubagentSessionManagerConfig {
  /** Factory to create independent sessions */
  createSession: CreateSessionFn;
  /** Callback for status updates during execution */
  onStatusUpdate: SubagentStatusCallback;
  /** Maximum concurrent sub-agents (default: 5) */
  maxConcurrentSubagents?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum length of summary text returned to parent context */
const MAX_SUMMARY_LENGTH = 2000;

/** Default maximum concurrent sub-agents */
const DEFAULT_MAX_CONCURRENT = 5;

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Manages independent sub-agent sessions with lifecycle tracking.
 *
 * Each sub-agent spawned via spawn() gets:
 * - An independent SDK session via createSession()
 * - Real-time status updates via onStatusUpdate callback
 * - Automatic cleanup via session.destroy() in finally block
 * - Concurrency limiting with request queuing
 */
export class SubagentSessionManager {
  private sessions: Map<string, Session> = new Map();
  private createSession: CreateSessionFn;
  private onStatusUpdate: SubagentStatusCallback;
  private maxConcurrent: number;

  /** Queue for spawn requests when at concurrency limit */
  private pendingQueue: Array<{
    options: SubagentSpawnOptions;
    resolve: (result: SubagentResult) => void;
    reject: (error: Error) => void;
  }> = [];

  /** Count of currently executing spawn operations */
  private runningCount = 0;

  /** Whether the manager has been destroyed */
  private destroyed = false;

  constructor(config: SubagentSessionManagerConfig) {
    this.createSession = config.createSession;
    this.onStatusUpdate = config.onStatusUpdate;
    this.maxConcurrent = config.maxConcurrentSubagents ?? DEFAULT_MAX_CONCURRENT;
  }

  /**
   * Spawn a single sub-agent with an independent session.
   *
   * Flow:
   * 1. Create session via createSession()
   * 2. Store session in tracking map
   * 3. Emit "running" status update
   * 4. Stream response, tracking tool uses and accumulating text
   * 5. Emit "completed" status update with result summary
   * 6. Destroy session in finally block
   *
   * If at concurrency limit, the request is queued and executed
   * when a slot becomes available.
   */
  async spawn(options: SubagentSpawnOptions): Promise<SubagentResult> {
    if (this.destroyed) {
      return {
        agentId: options.agentId,
        success: false,
        output: "",
        error: "SubagentSessionManager has been destroyed",
        toolUses: 0,
        durationMs: 0,
      };
    }

    // Check concurrency limit
    if (this.runningCount >= this.maxConcurrent) {
      return new Promise<SubagentResult>((resolve, reject) => {
        this.pendingQueue.push({ options, resolve, reject });
      });
    }

    return this.executeSpawn(options);
  }

  /**
   * Spawn multiple sub-agents concurrently.
   *
   * Uses Promise.allSettled() so one agent's failure doesn't cancel others.
   * Results are returned in the same order as the input array.
   */
  async spawnParallel(agents: SubagentSpawnOptions[]): Promise<SubagentResult[]> {
    const results = await Promise.allSettled(
      agents.map((agent) => this.spawn(agent))
    );

    return results.map((result, i) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      const agent = agents[i];
      return {
        agentId: agent?.agentId ?? `unknown-${i}`,
        success: false,
        output: "",
        error: result.reason instanceof Error
          ? result.reason.message
          : String(result.reason ?? "Unknown error"),
        toolUses: 0,
        durationMs: 0,
      };
    });
  }

  /**
   * Cancel a running sub-agent by destroying its session.
   */
  async cancel(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (session) {
      try {
        await session.destroy();
      } catch {
        // Session may already be destroyed
      }
      this.sessions.delete(agentId);
      this.onStatusUpdate(agentId, { status: "interrupted", error: "Cancelled" });
    }

    // Also remove from pending queue if queued
    this.pendingQueue = this.pendingQueue.filter((item) => {
      if (item.options.agentId === agentId) {
        item.resolve({
          agentId,
          success: false,
          output: "",
          error: "Cancelled",
          toolUses: 0,
          durationMs: 0,
        });
        return false;
      }
      return true;
    });
  }

  /**
   * Cancel all running sub-agents.
   */
  async cancelAll(): Promise<void> {
    // Resolve all pending queue items
    for (const item of this.pendingQueue) {
      item.resolve({
        agentId: item.options.agentId,
        success: false,
        output: "",
        error: "Cancelled",
        toolUses: 0,
        durationMs: 0,
      });
    }
    this.pendingQueue = [];

    // Destroy all active sessions
    const destroyPromises = Array.from(this.sessions.entries()).map(
      async ([agentId, session]) => {
        try {
          await session.destroy();
        } catch {
          // Session may already be destroyed
        }
        this.onStatusUpdate(agentId, { status: "interrupted", error: "Cancelled" });
      }
    );
    await Promise.allSettled(destroyPromises);
    this.sessions.clear();
  }

  /**
   * Get the number of currently active sessions.
   */
  get activeCount(): number {
    return this.sessions.size;
  }

  /**
   * Destroy the manager and all active sessions.
   * After calling destroy(), no new spawn requests will be accepted.
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.cancelAll();
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Execute a spawn request (internal - bypasses concurrency check).
   */
  private async executeSpawn(options: SubagentSpawnOptions): Promise<SubagentResult> {
    this.runningCount++;
    const startTime = Date.now();
    let toolUses = 0;
    let summaryParts: string[] = [];
    let session: Session | null = null;
    let firstTextSeen = false;

    try {
      // 1. Create independent session
      const sessionConfig: SessionConfig = {
        systemPrompt: options.systemPrompt,
        model: options.model,
        tools: options.tools,
      };
      session = await this.createSession(sessionConfig);

      // 2. Store session for tracking
      this.sessions.set(options.agentId, session);

      // 3. Emit running status with initial progress indicator
      this.onStatusUpdate(options.agentId, {
        status: "running",
        startedAt: new Date().toISOString(),
        currentTool: "Starting session...",
      });

      // 4. Stream response
      for await (const msg of session.stream(options.task)) {
        if (msg.type === "tool_use") {
          toolUses++;
          const toolName =
            typeof msg.metadata?.toolName === "string"
              ? msg.metadata.toolName
              : "tool";
          this.onStatusUpdate(options.agentId, {
            toolUses,
            currentTool: toolName,
          });
        } else if (msg.type === "text" && typeof msg.content === "string") {
          if (!firstTextSeen) {
            firstTextSeen = true;
            this.onStatusUpdate(options.agentId, {
              currentTool: "Generating...",
            });
          }
          summaryParts.push(msg.content);
        }
      }

      // 5. Build truncated summary
      const fullSummary = summaryParts.join("");
      const output =
        fullSummary.length > MAX_SUMMARY_LENGTH
          ? fullSummary.slice(0, MAX_SUMMARY_LENGTH) + "..."
          : fullSummary;

      const durationMs = Date.now() - startTime;

      // 6. Emit completed status
      this.onStatusUpdate(options.agentId, {
        status: "completed",
        durationMs,
        toolUses,
        result: output,
        currentTool: undefined,
      });

      return {
        agentId: options.agentId,
        success: true,
        output,
        toolUses,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error ?? "Unknown error");

      // Emit error status
      this.onStatusUpdate(options.agentId, {
        status: "error",
        error: errorMessage,
        durationMs,
        toolUses,
        currentTool: undefined,
      });

      return {
        agentId: options.agentId,
        success: false,
        output: "",
        error: errorMessage,
        toolUses,
        durationMs,
      };
    } finally {
      // 7. Always cleanup session
      if (session) {
        try {
          await session.destroy();
        } catch {
          // Session may already be destroyed
        }
      }
      this.sessions.delete(options.agentId);
      this.runningCount--;

      // Process next queued request if any
      this.processQueue();
    }
  }

  /**
   * Process the next item in the pending queue if concurrency allows.
   */
  private processQueue(): void {
    if (this.pendingQueue.length === 0 || this.runningCount >= this.maxConcurrent) {
      return;
    }

    const next = this.pendingQueue.shift();
    if (!next) return;

    this.executeSpawn(next.options).then(next.resolve).catch(next.reject);
  }
}
