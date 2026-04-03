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
 * @see specs/2026-03-23-ralph-workflow-redesign.md §5.1
 */

import type { TaskItem } from "@/services/workflows/builtin/ralph/helpers/prompts.ts";
import { z } from "zod";

/**
 * Zod schema for validating TaskItem-shaped objects from parsed output.
 * Mirrors the core fields of TaskItem without the runtime-only extensions
 * (identity, taskResult) that the conductor adds after validation.
 */
const TaskItemBaseSchema = z.object({
  id: z.string().optional(),
  description: z.string(),
  status: z.string(),
  summary: z.string(),
  blockedBy: z.array(z.string()).optional(),
});

const TaskItemArraySchema = TaskItemBaseSchema.array();
import type { Session, SessionConfig } from "@/services/agents/types.ts";
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
  ConductorConfig,
  StageContext,
  StageDefinition,
  StageOutput,
  WorkflowResult,
} from "@/services/workflows/conductor/types.ts";
import type { WorkflowSessionConfig } from "@/services/workflows/dsl/types.ts";
import { truncateStageOutput } from "@/services/workflows/conductor/truncate.ts";
import { isPipelineDebug } from "@/services/events/pipeline-logger.ts";
import { DEFAULT_LOG_DIR } from "@/services/events/debug-subscriber/config.ts";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDirSync } from "@/services/system/copy.ts";

const CONDUCTOR_LOG_DIR = process.env.LOG_DIR?.trim() || DEFAULT_LOG_DIR;
const CONDUCTOR_LOG = join(CONDUCTOR_LOG_DIR, "conductor-debug.log");

let conductorLogDirEnsured = false;

function conductorLog(action: string, data?: Record<string, unknown>): void {
  if (!isPipelineDebug()) return;
  if (!conductorLogDirEnsured) {
    ensureDirSync(CONDUCTOR_LOG_DIR);
    conductorLogDirEnsured = true;
  }
  const ts = new Date().toISOString();
  const payload = data ? ` ${JSON.stringify(data)}` : "";
  appendFileSync(CONDUCTOR_LOG, `[${ts}] ${action}${payload}\n`);
}

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
  private currentStage: string | null = null;
  private currentSession: Session | null = null;
  private interrupted = false;
  private resumeResolver: ((message: string | null) => void) | null = null;
  private pendingResumeMessage: string | null = null;
  private preserveSessionForResume = false;
  private preservedSession: Session | null = null;
  private isResuming = false;

  constructor(config: ConductorConfig, stages: readonly StageDefinition[]) {
    this.config = config;
    this.stages = new Map(stages.map((s) => [s.id, s]));
    this.stageOutputs = new Map();
    this.tasks = [];

    this.validateStagesCoverAgentNodes();
  }

  // -------------------------------------------------------------------------
  // Session Config Resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve a `WorkflowSessionConfig` (SDK-agnostic, per-agent model maps)
   * into an agent-level `SessionConfig` for the active agent.
   *
   * Model-coupled fields (`model`, `reasoningEffort`, `maxThinkingTokens`)
   * are treated as a group. If the stage's `sessionConfig` mentions the
   * active agent type in *any* per-agent-type field (`model` or
   * `reasoningEffort`), the stage is taking ownership of the model config
   * for this provider — all three fields are explicitly set on the
   * resolved config (stage value or `undefined`). This prevents the
   * parent session's values from leaking through `createSubagentSession`'s
   * spread merge to a potentially incompatible model.
   *
   * When the stage does NOT mention the active agent type, these fields
   * are omitted entirely so the parent session's model, reasoning effort,
   * and thinking tokens are inherited as a coherent set.
   *
   * `disallowedTools` is resolved from the stage definition's per-provider
   * map and mapped to `SessionConfig.excludedTools` for the active agent.
   *
   * Other fields (systemPrompt, tools, etc.) pass through unchanged.
   */
  private async resolveSessionConfig(
    workflowConfig?: Partial<WorkflowSessionConfig>,
    disallowedTools?: Partial<Record<string, string[]>>,
  ): Promise<SessionConfig | undefined> {
    const agentType = this.config.agentType;

    const agentKey = agentType as keyof NonNullable<WorkflowSessionConfig["model"]> | undefined;

    // Check whether the stage mentions the active agent type in any
    // per-agent-type field. If so, the stage owns the model config for
    // this provider and all model-coupled fields are set explicitly
    // (even as undefined) to prevent parent session values from leaking.
    const stageOwnsModelConfig = Boolean(agentKey && (
      workflowConfig?.model?.[agentKey] !== undefined ||
      workflowConfig?.reasoningEffort?.[agentKey] !== undefined
    ));

    const model = agentKey ? workflowConfig?.model?.[agentKey] : undefined;
    const reasoningEffort = agentKey ? workflowConfig?.reasoningEffort?.[agentKey] : undefined;

    // Resolve disallowed tools for the active agent type
    const resolvedExcludedTools = agentKey && disallowedTools
      ? disallowedTools[agentKey]
      : undefined;

    // If no workflow config and no defaults resolved, return undefined
    if (!workflowConfig && !stageOwnsModelConfig && !resolvedExcludedTools) {
      return undefined;
    }

    const resolved: SessionConfig = {};
    if (workflowConfig?.sessionId !== undefined) resolved.sessionId = workflowConfig.sessionId;
    if (workflowConfig?.systemPrompt !== undefined) resolved.systemPrompt = workflowConfig.systemPrompt;
    if (workflowConfig?.additionalInstructions !== undefined) resolved.additionalInstructions = workflowConfig.additionalInstructions;
    if (workflowConfig?.tools !== undefined) resolved.tools = workflowConfig.tools;
    if (workflowConfig?.permissionMode !== undefined) resolved.permissionMode = workflowConfig.permissionMode;
    if (workflowConfig?.maxBudgetUsd !== undefined) resolved.maxBudgetUsd = workflowConfig.maxBudgetUsd;
    if (workflowConfig?.maxTurns !== undefined) resolved.maxTurns = workflowConfig.maxTurns;
    if (resolvedExcludedTools !== undefined) resolved.excludedTools = resolvedExcludedTools;

    if (stageOwnsModelConfig) {
      // Stage mentions the active provider — set all model-coupled fields
      // explicitly (stage value or undefined) so the parent's values are
      // cleared by the spread merge in createSubagentSession.
      resolved.model = model;
      resolved.reasoningEffort = reasoningEffort;
      resolved.maxThinkingTokens = workflowConfig?.maxThinkingTokens;
    } else {
      // Stage does not mention the active provider — omit model-coupled
      // fields so the parent session's values inherit as a coherent set.
      if (workflowConfig?.maxThinkingTokens !== undefined) resolved.maxThinkingTokens = workflowConfig.maxThinkingTokens;
    }

    return resolved;
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
    this.interrupted = true;
    const sessionId = this.currentSession?.id ?? null;
    conductorLog("conductor_interrupt", {
      sessionId,
      hasAbort: typeof this.currentSession?.abort === "function",
      currentStage: this.currentStage,
      preservedSessionId: this.preservedSession?.id ?? null,
    });
    this.currentSession?.abort?.();
  }

  /**
   * Resume the conductor after an interrupt with a follow-up message.
   * Called by the conductor executor when user input arrives.
   * Passing `null` means "no follow-up; advance to next node."
   */
  resume(message: string | null): void {
    if (this.resumeResolver) {
      this.resumeResolver(message);
      this.resumeResolver = null;
    }
  }

  /**
   * Wait for a resume message — checks queued messages first, then
   * delegates to the config callback for user input.
   */
  private async waitForResumeInput(): Promise<string | null> {
    const queuedMessage = this.config.checkQueuedMessage?.();
    if (queuedMessage) {
      conductorLog("conductor_waitForResume_queued", {
        message: queuedMessage.slice(0, 50),
        preservedSessionId: this.preservedSession?.id ?? null,
      });
      return queuedMessage;
    }

    if (this.config.waitForResumeInput) {
      conductorLog("conductor_waitForResume_awaiting_user", {
        preservedSessionId: this.preservedSession?.id ?? null,
      });
      const result = await this.config.waitForResumeInput();
      conductorLog("conductor_waitForResume_user_responded", {
        result: result?.slice(0, 50) ?? null,
        preservedSessionId: this.preservedSession?.id ?? null,
      });
      return result;
    }

    return null;
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
    let state = this.config.createState
      ? this.config.createState({ sessionId: executionId, prompt: userPrompt, sessionDir: "" })
      : initializeExecutionState<BaseState>(executionId);
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

        // Handle interrupted status: pause and wait for resume input
        if (stageResult.output.status === "interrupted") {
          conductorLog("conductor_await_resume", {
            nodeId,
            preservedSessionId: this.preservedSession?.id ?? null,
          });
          const resumeInput = await this.waitForResumeInput();

          conductorLog("conductor_resume_received", {
            nodeId,
            resumeInput: resumeInput?.slice(0, 50) ?? null,
            preservedSessionId: this.preservedSession?.id ?? null,
          });

          if (resumeInput !== null && resumeInput.trim().length > 0) {
            // Re-execute the same stage with the follow-up message
            nodeQueue.unshift(nodeId);
            visited.delete(nodeId);
            this.pendingResumeMessage = resumeInput;
            this.preserveSessionForResume = true;
            this.isResuming = true;
            conductorLog("conductor_resume_requeue", {
              nodeId,
              preservedSessionId: this.preservedSession?.id ?? null,
              preserveSessionForResume: true,
              isResuming: true,
            });
            continue;
          }
          // No follow-up — destroy the preserved session immediately
          if (this.preservedSession) {
            await this.config.destroySession(this.preservedSession).catch(() => {});
            this.preservedSession = null;
          }
          // Fall through to advance to next node
        }
      } else {
        result = await this.executeDeterministicNode(node, state);

        // Deterministic nodes (tool, askUserQuestion) may produce state
        // updates via outputMapper. Store a synthetic StageOutput so
        // downstream stages can access the result via
        // `ctx.stageOutputs.get(nodeId)` — the same way agent stage
        // outputs are accessible.
        if (result.stateUpdate) {
          const { __waitingForInput, __userDeclined, __waitNodeId, __askUserRequestId, outputs: _outputs, lastUpdated: _lastUpdated, ...parsedFields } = result.stateUpdate as Record<string, unknown>;
          const hasMeaningfulOutput = Object.keys(parsedFields).length > 0;
          if (hasMeaningfulOutput) {
            const syntheticOutput: StageOutput = {
              stageId: nodeId,
              rawResponse: JSON.stringify(parsedFields),
              parsedOutput: parsedFields as Record<string, unknown>,
              status: "completed",
            };
            this.stageOutputs.set(nodeId, syntheticOutput);
          }
        }
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

    // Clean up any preserved session that wasn't reused
    if (this.preservedSession) {
      await this.config.destroySession(this.preservedSession).catch(() => {});
      this.preservedSession = null;
    }

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

    const context = this.buildStageContext(userPrompt, state);

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

    // Notify UI of stage transition (skip banner on resume re-entry)
    const resuming = this.isResuming;
    this.config.onStageTransition(previousStageId, nodeId, resuming ? { isResume: true } : undefined);
    this.isResuming = false;

    // Track the currently-executing stage
    this.currentStage = nodeId;

    // Emit workflow.step.start event — also on resume so the UI
    // transitions the step indicator back from "interrupted" to "running".
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
      output.status === "completed"
        ? "completed"
        : output.status === "interrupted"
          ? "interrupted"
          : "error",
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
   * Run a stage in a fresh isolated session.
   *
   * Creates a session, streams the prompt, collects the full response,
   * and runs the optional parser.
   *
   * Session cleanup runs in the finally block to ensure sessions are
   * destroyed even on error paths.
   */
  private async runStageSession(
    stage: StageDefinition,
    context: StageContext,
  ): Promise<StageOutput> {
    const prompt = stage.buildPrompt(context);
    let currentPrompt = prompt;
    let accumulatedResponse = "";
    let session: Session | undefined;

    try {
        conductorLog("conductor_runStageSession_entry", {
          stageId: stage.id,
          preserveSessionForResume: this.preserveSessionForResume,
          pendingResumeMessage: this.pendingResumeMessage?.slice(0, 50) ?? null,
          preservedSessionId: this.preservedSession?.id ?? null,
          interrupted: this.interrupted,
          isResuming: this.isResuming,
        });

        // When resuming an interrupted stage, reuse the pending message
        // instead of the original prompt
        if (this.preserveSessionForResume && this.pendingResumeMessage !== null) {
          currentPrompt = this.pendingResumeMessage;
          this.pendingResumeMessage = null;
          this.preserveSessionForResume = false;
        }

        // Reuse preserved session from a previous interrupt when available,
        // otherwise create a fresh session
        if (this.preservedSession) {
          session = this.preservedSession;
          this.preservedSession = null;
          conductorLog("conductor_session_reused", {
            stageId: stage.id,
            sessionId: session.id,
          });
        } else {
          const resolvedConfig = await this.resolveSessionConfig(stage.sessionConfig, stage.disallowedTools);
          session = await this.config.createSession(resolvedConfig);
          conductorLog("conductor_session_created", {
            stageId: stage.id,
            sessionId: session.id,
          });
        }
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

        // Accumulate the streaming response immediately so all
        // subsequent paths (interrupt, abort, completion) see it.
        accumulatedResponse += rawResponse;

        // Check for abort after streaming
        if (context.abortSignal.aborted) {
          conductorLog("conductor_abort_signal_detected", {
            stageId: stage.id,
            sessionId: session?.id ?? null,
          });
          return {
            stageId: stage.id,
            rawResponse: accumulatedResponse,
            status: "interrupted",
          };
        }

        conductorLog("conductor_post_stream", {
          stageId: stage.id,
          sessionId: session?.id ?? null,
          interrupted: this.interrupted,
          abortSignalAborted: context.abortSignal.aborted,
          responseLength: rawResponse.length,
        });

        // Check for per-stage interrupt (set by conductor.interrupt()).
        // Even if a follow-up is already queued, preserve the current session
        // and return "interrupted" so execute() can consume that input via
        // waitForResumeInput() and resume through the normal stage re-entry
        // path. That path restores the spinner / streaming target before the
        // follow-up stream starts.
        if (this.interrupted) {
          this.interrupted = false;
          this.preservedSession = session;
          session = undefined;
          conductorLog("conductor_session_preserved", {
            stageId: stage.id,
            preservedSessionId: this.preservedSession?.id ?? null,
          });
          return {
            stageId: stage.id,
            rawResponse: accumulatedResponse,
            status: "interrupted",
          };
        }

        // Drain queued messages to the active session before completing.
        // Each iteration re-enables streaming in the TUI via onBeforeQueuedStream
        // because the previous stream's `stream.session.idle` already stopped it.
        while (session) {
          const queuedMessage = this.config.checkQueuedMessage?.();
          if (!queuedMessage) break;

          // Re-enable streaming and create a new message target so the
          // queued message's text deltas have a UI destination.
          this.config.onBeforeQueuedStream?.();

          // Deliver the queued message to the still-active session
          let queuedResponse: string;
          if (this.config.streamSession) {
            queuedResponse = await this.config.streamSession(session, queuedMessage, {
              abortSignal: context.abortSignal,
            });
          } else {
            queuedResponse = "";
            for await (const message of session.stream(queuedMessage, {
              abortSignal: context.abortSignal,
            })) {
              if (typeof message.content === "string") {
                queuedResponse += message.content;
              }
            }
          }

          accumulatedResponse += queuedResponse;

          // Check for interrupt during the follow-up stream
          if (this.interrupted) {
            this.interrupted = false;

            // Preserve the session for potential reuse on resume
            this.preservedSession = session;
            session = undefined;

            return {
              stageId: stage.id,
              rawResponse: accumulatedResponse,
              status: "interrupted",
            };
          }
        }

        // Parse output if a parser is provided (uses full accumulated response)
        let parsedOutput: Record<string, unknown> | undefined;
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
        };
      } catch (error) {
        conductorLog("conductor_catch_block", {
          stageId: stage.id,
          interrupted: this.interrupted,
          abortSignalAborted: context.abortSignal.aborted,
          sessionId: session?.id ?? null,
          error: error instanceof Error ? error.message : String(error),
        });

        // Abort-induced errors are "interrupted", not "error"
        if (this.interrupted || context.abortSignal.aborted) {
          if (this.interrupted) {
            // Conductor interrupt — preserve session for potential resume
            this.preservedSession = session ?? null;
            session = undefined;
            conductorLog("conductor_catch_session_preserved", {
              stageId: stage.id,
              preservedSessionId: this.preservedSession?.id ?? null,
            });
          }
          this.interrupted = false;
          return {
            stageId: stage.id,
            rawResponse: accumulatedResponse,
            status: "interrupted",
          };
        }

        return {
          stageId: stage.id,
          rawResponse: accumulatedResponse,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        conductorLog("conductor_finally_block", {
          stageId: stage.id,
          sessionId: session?.id ?? null,
          willDestroy: !!session,
          preservedSessionId: this.preservedSession?.id ?? null,
        });
        this.currentSession = null;
        if (session) {
          await this.config.destroySession(session).catch(() => {
            // Swallow destroy errors — session cleanup is best-effort
          });
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
    // Build an emit function that dispatches bus events when the event bus
    // is available. This is required for askUserQuestion nodes to emit
    // human_input_required events that the TUI subscribes to.
    const emitFn = this.canDispatch
      ? (type: string, data?: Record<string, unknown>) => {
          const busType = `stream.${type}`;
          this.config.dispatchEvent!({
            type: busType,
            sessionId: this.config.sessionId!,
            runId: this.config.runId!,
            timestamp: Date.now(),
            data: { ...data, nodeId: node.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
        }
      : undefined;

    const context: ExecutionContext<BaseState> = {
      state,
      config: this.config.graph.config,
      errors: [],
      abortSignal: this.config.abortSignal,
      getNodeOutput: (nodeId) => state.outputs[nodeId],
      emit: emitFn,
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
  private buildStageContext(userPrompt: string, state: BaseState): StageContext {
    const context: StageContext = {
      userPrompt,
      stageOutputs: new Map(this.stageOutputs),
      tasks: [...this.tasks],
      abortSignal: this.config.abortSignal,
      state,
    };

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

    return result;
  }

  /**
   * Update the internal task list from parsed stage output.
   *
   * If the parsed output is an array of TaskItem-shaped objects, replace
   * the task list and notify the UI. This is the mechanism by which the
   * planner stage populates tasks for the orchestrator.
   */
  private updateTasksFromParsedOutput(parsedOutput: Record<string, unknown>): void {
    // Task lists are stored under a "tasks" key or as a direct array value.
    // Check each value in the parsed output for an array of TaskItem-shaped objects.
    // Use the SDK's Zod schema for structural validation instead of duck-typing.
    const values = Object.values(parsedOutput);
    for (const value of values) {
      if (!Array.isArray(value)) continue;

      const result = TaskItemArraySchema.safeParse(value);
      if (result.success) {
        this.tasks = result.data as TaskItem[];
        this.config.onTaskUpdate([...this.tasks]);
        return;
      }
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
        indicator: stage.indicator,
      },
    });
  }

  /** Emit a workflow.step.complete bus event for a stage. */
  private emitStepComplete(
    stage: StageDefinition,
    durationMs: number,
    status: "completed" | "error" | "skipped" | "interrupted",
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
