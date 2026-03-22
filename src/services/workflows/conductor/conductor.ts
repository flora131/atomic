/**
 * WorkflowSessionConductor
 *
 * A lightweight state machine that sequences isolated context-window stages
 * through a compiled graph. For "agent" nodes, the conductor creates a fresh
 * session per stage, sends a prompt built from accumulated context, and
 * captures the raw + parsed output. For non-agent nodes (tool, decision),
 * the conductor delegates to the node's execute function directly.
 *
 * The conductor walks the graph following edges (with condition evaluation),
 * maintaining a `StageContext` that accumulates `StageOutput` records so each
 * downstream stage can reference prior outputs.
 *
 * @see specs/ralph-workflow-redesign.md §5.1
 */

import type { TaskItem } from "@/services/workflows/ralph/prompts.ts";
import type { Session } from "@/services/agents/types.ts";
import type {
  BaseState,
  NodeDefinition,
  NodeResult,
  ExecutionContext,
} from "@/services/workflows/graph/types.ts";
import {
  generateExecutionId,
  initializeExecutionState,
  mergeState,
  executionNow,
} from "@/services/workflows/graph/runtime/execution-state.ts";
import { getNextExecutableNodes } from "@/services/workflows/conductor/graph-traversal.ts";
import type {
  AccumulatedContextPressure,
  ConductorConfig,
  ContextPressureSnapshot,
  ContinuationRecord,
  StageContext,
  StageDefinition,
  StageOutput,
  WorkflowResult,
} from "@/services/workflows/conductor/types.ts";
import { truncateStageOutput } from "@/services/workflows/conductor/truncate.ts";
import {
  takeContextSnapshot,
  shouldContinueSession,
  buildContinuationPrompt,
  createContinuationRecord,
  createEmptyAccumulatedPressure,
  accumulateStageSnapshot,
  accumulateContinuation,
} from "@/services/workflows/conductor/context-pressure.ts";

// ---------------------------------------------------------------------------
// WorkflowSessionConductor
// ---------------------------------------------------------------------------

/**
 * Sequences workflow stages through a compiled graph, creating isolated
 * agent sessions for each stage and threading context forward.
 *
 * Usage:
 * ```ts
 * const conductor = new WorkflowSessionConductor(config, stages);
 * const result = await conductor.execute("Build an auth module");
 * ```
 */
export class WorkflowSessionConductor {
  private readonly config: ConductorConfig;
  private readonly stages: ReadonlyMap<string, StageDefinition>;
  private readonly stageOutputs: Map<string, StageOutput>;
  private tasks: TaskItem[];
  private accumulatedPressure: AccumulatedContextPressure;
  private currentStage: string | null = null;
  private currentSession: Session | null = null;

  constructor(config: ConductorConfig, stages: readonly StageDefinition[]) {
    this.config = config;
    this.stages = new Map(stages.map((s) => [s.id, s]));
    this.stageOutputs = new Map();
    this.tasks = [];
    this.accumulatedPressure = createEmptyAccumulatedPressure();

    this.validateStagesCoverAgentNodes();
  }

  // -------------------------------------------------------------------------
  // Public API — Interrupt & Stage Inspection
  // -------------------------------------------------------------------------

  /**
   * Interrupt the currently-running stage session, if any.
   *
   * Delegates to the session's `abort()` method, which cancels the
   * active streaming call. The conductor's `runStageSession` will
   * observe the abort and return an `"interrupted"` StageOutput.
   */
  interrupt(): void {
    this.currentSession?.abort?.();
  }

  /**
   * Returns the ID of the stage currently being executed, or `null`
   * if no stage is in progress.
   */
  getCurrentStage(): string | null {
    return this.currentStage;
  }

  /**
   * Execute the workflow by walking the compiled graph.
   *
   * Agent nodes are executed as isolated session stages. Non-agent nodes
   * (tool, decision, etc.) are executed via their node `execute` function.
   *
   * @param userPrompt - The user's original request that initiated the workflow.
   * @returns The final workflow result with all stage outputs and state.
   */
  async execute(userPrompt: string): Promise<WorkflowResult> {
    const executionId = generateExecutionId();
    let state = initializeExecutionState<BaseState>(executionId);
    const { graph, abortSignal } = this.config;

    const nodeQueue: string[] = [graph.startNode];
    const visited = new Set<string>();
    let previousStageId: string | null = null;
    let encounteredError = false;

    while (nodeQueue.length > 0) {
      if (abortSignal.aborted) {
        break;
      }

      const nodeId = nodeQueue.shift()!;
      const node = graph.nodes.get(nodeId);

      if (!node) {
        continue;
      }

      // Prevent re-visiting nodes that have already executed.
      // Loop-start nodes are exempt: re-entering one signals a new loop
      // iteration (via the back-edge).  When that happens we clear the
      // visited set so every node in the body can re-execute.  Pre-loop
      // nodes won't be re-queued because no edges lead back to them.
      // The loop's own maxCycles / until predicate governs termination.
      if (visited.has(nodeId)) {
        if (nodeId.startsWith("__loop_start_")) {
          visited.clear();
        } else {
          continue;
        }
      }
      visited.add(nodeId);

      let result: NodeResult<BaseState>;

      if (node.type === "agent") {
        const stageResult = await this.executeAgentStage(
          nodeId,
          userPrompt,
          state,
          previousStageId,
        );
        result = stageResult.result;

        // Only update previousStageId when the stage actually executed
        if (!stageResult.skipped) {
          previousStageId = nodeId;
        }

        if (stageResult.output.status === "error") {
          encounteredError = true;
          state = mergeState(state, {
            outputs: { ...state.outputs, [nodeId]: stageResult.output },
            lastUpdated: executionNow(),
          });
          break;
        }
      } else {
        result = await this.executeDeterministicNode(node, state);
      }

      // Merge state updates from node result
      if (result.stateUpdate) {
        state = mergeState(state, result.stateUpdate);
      }

      // Determine next nodes from edge conditions
      const nextNodes = getNextExecutableNodes(graph, nodeId, state, result);
      nodeQueue.push(...nextNodes);

      // Check if we've reached an end node with nothing more to process
      if (graph.endNodes.has(nodeId) && nodeQueue.length === 0) {
        break;
      }
    }

    const success = !abortSignal.aborted && !encounteredError;
    return this.buildResult(success, state);
  }

  // -------------------------------------------------------------------------
  // Agent Stage Execution
  // -------------------------------------------------------------------------

  /**
   * Execute an agent node as an isolated session stage.
   *
   * 1. Looks up the StageDefinition for this node
   * 2. Builds a StageContext from accumulated outputs
   * 3. Evaluates shouldRun (skips if false)
   * 4. Creates a fresh session, sends the prompt, collects response
   * 5. Parses output if a parser is provided
   * 6. Stores the StageOutput for downstream stages
   */
  private async executeAgentStage(
    nodeId: string,
    userPrompt: string,
    state: BaseState,
    previousStageId: string | null,
  ): Promise<{ output: StageOutput; result: NodeResult<BaseState>; skipped: boolean }> {
    const stage = this.stages.get(nodeId);
    if (!stage) {
      // No stage definition for this agent node — skip
      const skippedOutput: StageOutput = {
        stageId: nodeId,
        rawResponse: "",
        status: "completed",
      };
      return { output: skippedOutput, result: {}, skipped: true };
    }

    const context = this.buildStageContext(userPrompt);

    // Evaluate shouldRun condition
    if (stage.shouldRun && !stage.shouldRun(context)) {
      const skippedOutput: StageOutput = {
        stageId: nodeId,
        rawResponse: "",
        status: "completed",
      };
      this.emitStepComplete(stage, 0, "skipped");
      return { output: skippedOutput, result: {}, skipped: true };
    }

    // Notify UI of stage transition
    this.config.onStageTransition(previousStageId, nodeId);

    // Track the currently-executing stage
    this.currentStage = nodeId;

    // Emit workflow.step.start event
    this.emitStepStart(stage);
    const startTime = Date.now();

    // Execute the stage in an isolated session
    let output: StageOutput;
    try {
      output = await this.runStageSession(stage, context);
    } finally {
      this.currentStage = null;
    }

    const durationMs = Date.now() - startTime;

    // Emit workflow.step.complete event
    this.emitStepComplete(
      stage,
      durationMs,
      output.status === "completed" ? "completed" : "error",
      output.error,
    );

    // Apply inter-stage output size limiting.
    // The parser already received the full response inside runStageSession;
    // truncation only affects what downstream stages see via stageOutputs.
    const limitedOutput = this.applyOutputSizeLimit(output, stage);
    this.stageOutputs.set(nodeId, limitedOutput);

    // Update task list from parsed output when applicable
    if (limitedOutput.parsedOutput !== undefined) {
      this.updateTasksFromParsedOutput(limitedOutput.parsedOutput);
    }

    const stateUpdate: Partial<BaseState> = {
      outputs: { ...state.outputs, [nodeId]: limitedOutput },
    };

    return { output: limitedOutput, result: { stateUpdate }, skipped: false };
  }

  /**
   * Run a stage in a fresh isolated session, with optional context
   * pressure monitoring and continuation sessions.
   *
   * Creates a session, streams the prompt, collects the full response,
   * and runs the optional parser. When `contextPressure` is configured,
   * queries context usage after streaming and may create continuation
   * sessions if critical pressure is detected.
   *
   * Session cleanup runs in the finally block to ensure sessions are
   * destroyed even on error paths.
   */
  private async runStageSession(
    stage: StageDefinition,
    context: StageContext,
  ): Promise<StageOutput> {
    const prompt = stage.buildPrompt(context);
    const pressureConfig = this.config.contextPressure;
    const continuations: ContinuationRecord[] = [];
    let currentPrompt = prompt;
    let accumulatedResponse = "";
    let continuationCount = 0;

    // Outer loop: handles continuation sessions
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let session: Session | undefined;
      let contextUsage: ContextPressureSnapshot | null = null;

      try {
        session = await this.config.createSession(stage.sessionConfig);
        this.currentSession = session;

        // Stream through the full SDK adapter pipeline when available,
        // falling back to the bare session.stream() loop (for tests).
        let rawResponse: string;
        if (this.config.streamSession) {
          rawResponse = await this.config.streamSession(session, currentPrompt, {
            abortSignal: context.abortSignal,
          });
        } else {
          rawResponse = "";
          for await (const message of session.stream(currentPrompt, {
            abortSignal: context.abortSignal,
          })) {
            if (typeof message.content === "string") {
              rawResponse += message.content;
            }
          }
        }

        // Check for abort after streaming
        if (context.abortSignal.aborted) {
          return {
            stageId: stage.id,
            rawResponse: accumulatedResponse + rawResponse,
            status: "interrupted",
            contextUsage: contextUsage ?? undefined,
            continuations: continuations.length > 0 ? continuations : undefined,
          };
        }

        accumulatedResponse += rawResponse;

        // Capture context usage if monitoring is enabled
        if (pressureConfig && session) {
          contextUsage = await takeContextSnapshot(session, pressureConfig);

          if (contextUsage) {
            // Update accumulated pressure state
            this.accumulatedPressure = accumulateStageSnapshot(
              this.accumulatedPressure,
              stage.id,
              contextUsage,
            );

            // Notify UI of context pressure
            this.config.onContextPressure?.(
              stage.id,
              contextUsage,
              shouldContinueSession(contextUsage, pressureConfig, continuationCount),
            );

            // Check if continuation is needed
            if (shouldContinueSession(contextUsage, pressureConfig, continuationCount)) {
              const record = createContinuationRecord(
                stage.id,
                continuationCount,
                contextUsage,
                accumulatedResponse,
              );
              continuations.push(record);
              this.accumulatedPressure = accumulateContinuation(
                this.accumulatedPressure,
                record,
              );

              // Destroy the current session before creating a continuation
              await this.config.destroySession(session).catch(() => {});
              session = undefined;
              this.currentSession = null;

              // Build continuation prompt and loop
              currentPrompt = buildContinuationPrompt(
                prompt,
                accumulatedResponse,
                continuationCount,
              );
              continuationCount++;
              continue;
            }
          }
        }

        // Parse output if a parser is provided (uses full accumulated response)
        let parsedOutput: unknown;
        if (stage.parseOutput) {
          try {
            parsedOutput = stage.parseOutput(accumulatedResponse);
          } catch {
            // Parsing failure is non-fatal; parsedOutput stays undefined
          }
        }

        return {
          stageId: stage.id,
          rawResponse: accumulatedResponse,
          parsedOutput,
          status: "completed",
          contextUsage: contextUsage ?? undefined,
          continuations: continuations.length > 0 ? continuations : undefined,
        };
      } catch (error) {
        // Abort-induced errors are "interrupted", not "error"
        if (context.abortSignal.aborted) {
          return {
            stageId: stage.id,
            rawResponse: accumulatedResponse,
            status: "interrupted",
            continuations: continuations.length > 0 ? continuations : undefined,
          };
        }

        return {
          stageId: stage.id,
          rawResponse: accumulatedResponse,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          continuations: continuations.length > 0 ? continuations : undefined,
        };
      } finally {
        this.currentSession = null;
        if (session) {
          await this.config.destroySession(session).catch(() => {
            // Swallow destroy errors — session cleanup is best-effort
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Deterministic Node Execution
  // -------------------------------------------------------------------------

  /**
   * Execute a non-agent node (tool, decision, etc.) using its execute function.
   */
  private async executeDeterministicNode(
    node: NodeDefinition<BaseState>,
    state: BaseState,
  ): Promise<NodeResult<BaseState>> {
    const context: ExecutionContext<BaseState> = {
      state,
      config: this.config.graph.config,
      errors: [],
      abortSignal: this.config.abortSignal,
      getNodeOutput: (nodeId) => state.outputs[nodeId],
    };

    try {
      return await node.execute(context);
    } catch (error) {
      // Non-agent node failures are fatal — propagate as error
      throw new Error(
        `Deterministic node "${node.id}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Context & State Helpers
  // -------------------------------------------------------------------------

  /** Build a StageContext snapshot from accumulated state. */
  private buildStageContext(userPrompt: string): StageContext {
    const context: StageContext = {
      userPrompt,
      stageOutputs: new Map(this.stageOutputs),
      tasks: [...this.tasks],
      abortSignal: this.config.abortSignal,
    };

    // Include context pressure data when monitoring is configured
    if (this.config.contextPressure) {
      return {
        ...context,
        contextPressure: { ...this.accumulatedPressure },
      };
    }

    return context;
  }

  /** Build the final WorkflowResult. */
  private buildResult(success: boolean, state: BaseState): WorkflowResult {
    const result: WorkflowResult = {
      success,
      stageOutputs: new Map(this.stageOutputs),
      tasks: [...this.tasks],
      state,
    };

    // Include context pressure data when monitoring is configured
    if (this.config.contextPressure) {
      return {
        ...result,
        contextPressure: { ...this.accumulatedPressure },
      };
    }

    return result;
  }

  /**
   * Update the internal task list from parsed stage output.
   *
   * If the parsed output is an array of TaskItem-shaped objects, replace
   * the task list and notify the UI. This is the mechanism by which the
   * planner stage populates tasks for the orchestrator.
   */
  private updateTasksFromParsedOutput(parsedOutput: unknown): void {
    if (!Array.isArray(parsedOutput)) {
      return;
    }

    // Validate that items look like TaskItem (have description + status)
    const isTaskArray = parsedOutput.every(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        "description" in item &&
        "status" in item,
    );

    if (isTaskArray) {
      this.tasks = parsedOutput as TaskItem[];
      this.config.onTaskUpdate([...this.tasks]);
    }
  }

  /**
   * Apply inter-stage output size limiting to a completed stage's output.
   *
   * Resolves the effective byte limit from the stage-level override
   * (`StageDefinition.maxOutputBytes`) or the global default
   * (`ConductorConfig.maxStageOutputBytes`). When a limit is active and
   * the `rawResponse` exceeds it, the response is truncated and a notice
   * appended. The `originalByteLength` field is set to indicate trimming.
   *
   * Truncation is skipped for error/interrupted outputs (they typically
   * have empty or minimal rawResponse).
   */
  private applyOutputSizeLimit(
    output: StageOutput,
    stage: StageDefinition,
  ): StageOutput {
    // Only truncate completed outputs with content
    if (output.status !== "completed" || output.rawResponse.length === 0) {
      return output;
    }

    // Resolve effective limit: per-stage override > global config > no limit
    const effectiveLimit = stage.maxOutputBytes ?? this.config.maxStageOutputBytes;
    if (effectiveLimit === undefined) {
      return output;
    }

    const result = truncateStageOutput(output.rawResponse, effectiveLimit);
    if (!result.truncated) {
      return output;
    }

    return {
      ...output,
      rawResponse: result.text,
      originalByteLength: result.originalByteLength,
    };
  }

  // -------------------------------------------------------------------------
  // Event Dispatch
  // -------------------------------------------------------------------------

  /** Whether event dispatch is fully configured. */
  private get canDispatch(): boolean {
    return (
      this.config.dispatchEvent !== undefined &&
      this.config.workflowId !== undefined &&
      this.config.sessionId !== undefined &&
      this.config.runId !== undefined
    );
  }

  /** Emit a workflow.step.start bus event for a stage. */
  private emitStepStart(stage: StageDefinition): void {
    if (!this.canDispatch) return;
    const { dispatchEvent, workflowId, sessionId, runId } = this.config;
    dispatchEvent!({
      type: "workflow.step.start",
      sessionId: sessionId!,
      runId: runId!,
      timestamp: Date.now(),
      data: {
        workflowId: workflowId!,
        nodeId: stage.id,
        nodeName: stage.name,
        indicator: stage.indicator,
      },
    });
  }

  /** Emit a workflow.step.complete bus event for a stage. */
  private emitStepComplete(
    stage: StageDefinition,
    durationMs: number,
    status: "completed" | "error" | "skipped",
    error?: string,
  ): void {
    if (!this.canDispatch) return;
    const { dispatchEvent, workflowId, sessionId, runId, partsTruncation } = this.config;
    dispatchEvent!({
      type: "workflow.step.complete",
      sessionId: sessionId!,
      runId: runId!,
      timestamp: Date.now(),
      data: {
        workflowId: workflowId!,
        nodeId: stage.id,
        nodeName: stage.name,
        status,
        durationMs,
        ...(error ? { error } : {}),
        ...(partsTruncation && status === "completed" ? { truncation: partsTruncation } : {}),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Validate that every "agent" node in the graph has a matching StageDefinition.
   * Logs a warning for unmatched nodes (non-fatal, since the conductor can
   * skip agent nodes without definitions).
   */
  private validateStagesCoverAgentNodes(): void {
    const { nodes } = this.config.graph;
    for (const [nodeId, node] of nodes) {
      if (node.type === "agent" && !this.stages.has(nodeId)) {
        console.warn(
          `[WorkflowSessionConductor] Agent node "${nodeId}" has no matching StageDefinition — it will be skipped.`,
        );
      }
    }
  }
}
