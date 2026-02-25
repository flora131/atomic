/**
 * Sub-Agent Graph Bridge
 *
 * Lightweight bridge for sub-agent execution within graph workflows.
 * Creates SDK sessions directly and sends task messages, letting each
 * SDK's native sub-agent dispatch handle execution.
 *
 * Result persistence: ~/.atomic/workflows/sessions/{sessionId}/agents/
 *
 */

import type { Session, SessionConfig } from "../../sdk/types.ts";
import { saveSubagentOutput } from "../session.ts";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Wraps an AsyncIterable so that it rejects immediately when the abort signal fires,
 * rather than waiting for the next value from the underlying iterator.
 */
async function* abortableAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncGenerator<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The operation was aborted", "AbortError"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("The operation was aborted", "AbortError")),
      { once: true },
    );
  });
  try {
    while (true) {
      const result = await Promise.race([iterator.next(), abortPromise]);
      if (result.done) break;
      yield result.value;
    }
  } finally {
    void iterator.return?.();
  }
}

// ============================================================================
// Types (moved from subagent-session-manager.ts)
// ============================================================================

/**
 * Factory function that creates independent sessions for sub-agents.
 */
export type CreateSessionFn = (config?: SessionConfig) => Promise<Session>;

/**
 * Options for spawning a single sub-agent session.
 */
export interface SubagentSpawnOptions {
  /** Unique identifier for this sub-agent */
  agentId: string;
  /** Display name (e.g., "codebase-analyzer", "debugger") */
  agentName: string;
  /** Task description to send to the sub-agent */
  task: string;
  /** Optional system prompt override */
  systemPrompt?: string;
  /** Optional model override */
  model?: string;
  /** Optional tool restrictions */
  tools?: string[];
  /** Optional timeout in milliseconds. When exceeded, the session is aborted. */
  timeout?: number;
  /** Optional external abort signal (e.g., from Ctrl+C) to cancel the sub-agent. */
  abortSignal?: AbortSignal;
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

// ============================================================================
// Constants
// ============================================================================

/** Maximum length of summary text returned to parent context */
const MAX_SUMMARY_LENGTH = 4000;

// ============================================================================
// Bridge Configuration
// ============================================================================

interface SubagentGraphBridgeConfig {
  /** Factory to create independent sessions */
  createSession: CreateSessionFn;
  /** Optional session directory for result persistence */
  sessionDir?: string;
}

// ============================================================================
// Bridge Class
// ============================================================================

/**
 * Lightweight bridge for sub-agent execution in graph workflows.
 *
 * Creates a session per sub-agent, sends the task message, collects
 * the response, and destroys the session. The SDK's native sub-agent
 * dispatch handles tool configuration and model selection.
 */
export class SubagentGraphBridge {
  private createSession: CreateSessionFn;
  private sessionDir: string | undefined;

  constructor(config: SubagentGraphBridgeConfig) {
    this.createSession = config.createSession;
    this.sessionDir = config.sessionDir;
  }

  setSessionDir(dir: string): void {
    this.sessionDir = dir;
  }

  /**
   * Spawn a single sub-agent by creating a session and sending a task message.
   */
  async spawn(options: SubagentSpawnOptions): Promise<SubagentResult> {
    const startTime = Date.now();
    let toolUses = 0;
    const summaryParts: string[] = [];
    let session: Session | null = null;

    try {
      // Create session with optional overrides
      const sessionConfig: SessionConfig = {};
      if (options.systemPrompt) sessionConfig.systemPrompt = options.systemPrompt;
      if (options.model) sessionConfig.model = options.model;
      if (options.tools) sessionConfig.tools = options.tools;

      session = await this.createSession(sessionConfig);

      // Set up abort controller for timeout and external abort signal
      const abortController = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (options.timeout) {
        timeoutId = setTimeout(() => abortController.abort(), options.timeout);
      }
      // Forward external abort signal (e.g., Ctrl+C) to the internal controller
      if (options.abortSignal) {
        if (options.abortSignal.aborted) {
          abortController.abort();
        } else {
          options.abortSignal.addEventListener(
            "abort",
            () => abortController.abort(),
            { once: true },
          );
        }
      }

      try {
        // Stream response with abort support — abortableAsyncIterable ensures
        // we reject immediately when the signal fires, rather than blocking
        // on the next iterator value.
        const stream = abortableAsyncIterable(session.stream(options.task), abortController.signal);
        for await (const msg of stream) {
          if (msg.type === "tool_use") {
            toolUses++;
          } else if (msg.type === "text" && typeof msg.content === "string") {
            summaryParts.push(msg.content);
          }
        }
      } catch (err) {
        // AbortError is expected when the signal fires — treat it the same as
        // the post-loop abort check below.
        if (err instanceof DOMException && err.name === "AbortError") {
          // fall through to the aborted-check below
        } else {
          throw err;
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      if (abortController.signal.aborted) {
        // Abort the session to cancel any in-flight SDK work
        if (session.abort) {
          await session.abort().catch(() => {});
        }
        const wasExternalAbort = options.abortSignal?.aborted;
        return {
          agentId: options.agentId,
          success: false,
          output: summaryParts.join(""),
          error: wasExternalAbort
            ? `Sub-agent "${options.agentName}" was cancelled`
            : `Sub-agent "${options.agentName}" timed out after ${options.timeout}ms`,
          toolUses,
          durationMs: Date.now() - startTime,
        };
      }

      // Build truncated summary
      const fullSummary = summaryParts.join("");
      const output =
        fullSummary.length > MAX_SUMMARY_LENGTH
          ? fullSummary.slice(0, MAX_SUMMARY_LENGTH) + "..."
          : fullSummary;

      const result: SubagentResult = {
        agentId: options.agentId,
        success: true,
        output,
        toolUses,
        durationMs: Date.now() - startTime,
      };

      if (this.sessionDir) {
        await saveSubagentOutput(this.sessionDir, options.agentId, result);
      }

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error ?? "Unknown error");

      const result: SubagentResult = {
        agentId: options.agentId,
        success: false,
        output: "",
        error: errorMessage,
        toolUses,
        durationMs,
      };

      if (this.sessionDir) {
        await saveSubagentOutput(this.sessionDir, options.agentId, result).catch(() => {});
      }

      return result;
    } finally {
      if (session) {
        try {
          await session.destroy();
        } catch {
          // Session may already be destroyed
        }
      }
    }
  }

  /**
   * Spawn multiple sub-agents concurrently.
   * Uses Promise.allSettled() so one agent's failure doesn't cancel others.
   * @param agents - Spawn options for each agent
   * @param abortSignal - Optional signal to cancel all agents (e.g., from Ctrl+C)
   */
  async spawnParallel(
    agents: SubagentSpawnOptions[],
    abortSignal?: AbortSignal,
  ): Promise<SubagentResult[]> {
    const results = await Promise.allSettled(
      agents.map((agent) => this.spawn(
        abortSignal ? { ...agent, abortSignal } : agent,
      ))
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
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason ?? "Unknown error"),
        toolUses: 0,
        durationMs: 0,
      };
    });
  }
}
