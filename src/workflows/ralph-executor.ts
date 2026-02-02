/**
 * Ralph Executor
 *
 * This module provides the RalphExecutor class for managing the execution
 * of Ralph workflows with proper interrupt handling and session management.
 *
 * The executor handles:
 * - SIGINT (Ctrl+C) for graceful interruption
 * - Esc key press for graceful interruption (in TTY mode)
 * - Session state persistence on interrupt
 * - Workflow execution with abort signal support
 *
 * Reference: Feature - Create src/workflows/ralph-executor.ts with RalphExecutor class
 */

import type { CompiledGraph } from "../graph/types.ts";
import type { RalphWorkflowState } from "../graph/nodes/ralph-nodes.ts";
import type { CreateRalphWorkflowConfig } from "./ralph.ts";
import {
  loadSession,
  saveSession,
  loadSessionIfExists,
} from "./ralph-session.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for running the Ralph executor.
 */
export interface RalphExecutorRunOptions {
  /** Initial state for the workflow (optional, created internally if not provided) */
  initialState?: Partial<RalphWorkflowState>;
}

/**
 * Result of Ralph executor run.
 */
export interface RalphExecutorResult {
  /** Final workflow state */
  state: RalphWorkflowState;
  /** Whether execution completed successfully */
  completed: boolean;
  /** Whether execution was interrupted */
  interrupted: boolean;
  /** Error if execution failed */
  error?: Error;
}

// ============================================================================
// RALPH EXECUTOR CLASS
// ============================================================================

/**
 * Executor for Ralph workflows with interrupt handling.
 *
 * Manages workflow execution lifecycle including:
 * - Setting up interrupt handlers (SIGINT, Esc key)
 * - Running the workflow with abort signal support
 * - Persisting session state on interruption
 * - Cleaning up handlers on completion
 *
 * @example
 * ```typescript
 * const workflow = createRalphWorkflow({ maxIterations: 50 });
 * const executor = new RalphExecutor();
 *
 * try {
 *   const result = await executor.run(workflow, config);
 *   if (result.completed) {
 *     console.log("Workflow completed successfully");
 *   } else if (result.interrupted) {
 *     console.log("Workflow was interrupted");
 *   }
 * } finally {
 *   executor.cleanup();
 * }
 * ```
 */
export class RalphExecutor {
  /** Abort controller for signaling workflow cancellation */
  private abortController: AbortController;

  /** Session directory path (set during execution) */
  private sessionDir: string | null = null;

  /** Session ID (set during execution) */
  private sessionId: string | null = null;

  /** SIGINT handler reference for cleanup */
  private sigintHandler: (() => void) | null = null;

  /** stdin data handler reference for cleanup */
  private stdinHandler: ((data: Buffer) => void) | null = null;

  /** Whether interrupt handlers have been set up */
  private handlersSetUp = false;

  /** Whether cleanup has already been performed */
  private cleanedUp = false;

  /**
   * Create a new RalphExecutor instance.
   */
  constructor() {
    this.abortController = new AbortController();
  }

  /**
   * Set up interrupt handlers for SIGINT (Ctrl+C) and Esc key.
   *
   * @private
   */
  private setupInterruptHandlers(): void {
    if (this.handlersSetUp) {
      return;
    }

    // SIGINT handler (Ctrl+C)
    this.sigintHandler = () => {
      this.handleInterrupt();
    };
    process.on("SIGINT", this.sigintHandler);

    // Esc key handler (TTY only)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();

      this.stdinHandler = (data: Buffer) => {
        // Check for Esc key (0x1b)
        if (data[0] === 0x1b) {
          this.handleInterrupt();
        }
      };
      process.stdin.on("data", this.stdinHandler);
    }

    this.handlersSetUp = true;
  }

  /**
   * Handle an interrupt signal (from SIGINT or Esc key).
   *
   * This method:
   * 1. Signals abort to the workflow
   * 2. Saves session state as "paused"
   * 3. Logs resume instructions
   * 4. Exits the process
   *
   * @private
   */
  private async handleInterrupt(): Promise<void> {
    console.log("\nStopping Ralph execution...");

    // Signal abort to workflow
    this.abortController.abort();

    // Save session state if we have a session
    if (this.sessionDir && this.sessionId) {
      try {
        const session = await loadSessionIfExists(this.sessionDir);

        if (session) {
          session.status = "paused";
          session.lastUpdated = new Date().toISOString();
          await saveSession(this.sessionDir, session);

          console.log(`Paused Ralph session: ${this.sessionId}`);
          console.log(`Resume with: /ralph --resume ${this.sessionId}`);
        }
      } catch (error) {
        console.error("Failed to save session state:", error);
      }
    }

    // Cleanup and exit
    this.cleanup();
    process.exit(0);
  }

  /**
   * Clean up interrupt handlers.
   *
   * Should be called when the executor is no longer needed.
   */
  cleanup(): void {
    if (this.cleanedUp) {
      return;
    }

    // Remove SIGINT handler
    if (this.sigintHandler) {
      process.off("SIGINT", this.sigintHandler);
      this.sigintHandler = null;
    }

    // Remove stdin handler and restore TTY mode
    if (this.stdinHandler) {
      process.stdin.off("data", this.stdinHandler);
      this.stdinHandler = null;

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }
    }

    this.handlersSetUp = false;
    this.cleanedUp = true;
  }

  /**
   * Get the abort signal for passing to workflow execution.
   */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * Check if execution has been aborted.
   */
  get aborted(): boolean {
    return this.abortController.signal.aborted;
  }

  /**
   * Run the Ralph workflow.
   *
   * @param workflow - Compiled Ralph workflow graph
   * @param config - Workflow configuration
   * @param options - Run options
   * @returns Execution result
   */
  async run(
    workflow: CompiledGraph<RalphWorkflowState>,
    config: CreateRalphWorkflowConfig,
    options: RalphExecutorRunOptions = {}
  ): Promise<RalphExecutorResult> {
    // Reset state for new run
    this.abortController = new AbortController();
    this.cleanedUp = false;

    // Set up interrupt handlers
    this.setupInterruptHandlers();

    try {
      // Note: The actual workflow execution is handled by the graph executor.
      // This class primarily manages interrupt handling and session state.
      // The workflow.run() method or executeGraph() should be called externally
      // with the abort signal from this executor.

      // For now, we return a placeholder result.
      // The actual integration will depend on how executeGraph is implemented.
      const result: RalphExecutorResult = {
        state: options.initialState as RalphWorkflowState ?? {} as RalphWorkflowState,
        completed: false,
        interrupted: this.aborted,
      };

      return result;
    } catch (error) {
      return {
        state: options.initialState as RalphWorkflowState ?? {} as RalphWorkflowState,
        completed: false,
        interrupted: this.aborted,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    } finally {
      // Don't cleanup here - let caller decide when to cleanup
      // This allows for inspection of state after execution
    }
  }

  /**
   * Set the session information for interrupt handling.
   *
   * This should be called after the workflow initializes a session
   * so that interrupt handling can properly save session state.
   *
   * @param sessionId - The Ralph session ID
   * @param sessionDir - Path to the session directory
   */
  setSession(sessionId: string, sessionDir: string): void {
    this.sessionId = sessionId;
    this.sessionDir = sessionDir;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new RalphExecutor instance.
 *
 * @returns A new RalphExecutor ready to execute workflows
 *
 * @example
 * ```typescript
 * const executor = createRalphExecutor();
 * const result = await executor.run(workflow, config);
 * executor.cleanup();
 * ```
 */
export function createRalphExecutor(): RalphExecutor {
  return new RalphExecutor();
}
