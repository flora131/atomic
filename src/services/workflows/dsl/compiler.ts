/**
 * DSL Compiler
 *
 * Transforms the WorkflowBuilder's recorded instruction list into a
 * WorkflowDefinition consumable by the existing conductor.
 *
 * The compiler performs five key steps:
 * 1. Validates the instruction sequence (balanced if/endIf, loop/endLoop,
 *    unique IDs, at least one node).
 * 2. Generates StageDefinition[] from stage instructions (with shouldRun
 *    derived from enclosing .if() conditions).
 * 3. Generates a CompiledGraph with nodes and edges. Conditional blocks
 *    produce a linear graph (no decision/merge nodes) because the conductor
 *    handles skipping via StageDefinition.shouldRun.
 * 4. Generates a createState() factory via state-compiler.
 * 5. Assembles the final WorkflowDefinition.
 *
 * @see specs/2026-03-23-workflow-sdk-simplification-z3-verification.md section 5.1.5
 */

import type {
  Instruction,
  StageOptions,
  ToolOptions,
  LoopOptions,
} from "@/services/workflows/dsl/types.ts";
import type { WorkflowBuilder } from "@/services/workflows/dsl/define-workflow.ts";
import type { WorkflowDefinition } from "@/services/workflows/types/definition.ts";
import type {
  StageDefinition,
  StageContext,
} from "@/services/workflows/conductor/types.ts";
import type {
  BaseState,
  Edge,
  NodeDefinition,
  NodeResult,
  ExecutionContext,
} from "@/services/workflows/graph/types.ts";
import { createStateFactory } from "@/services/workflows/dsl/state-compiler.ts";
import { askUserNode, USER_DECLINED_ANSWER } from "@/services/workflows/graph/nodes/control.ts";
import {
  buildAgentLookup,
  resolveStageAgentModelConfig,
  resolveStageSystemPrompt,
} from "@/services/workflows/dsl/agent-resolution.ts";
import {
  inferStageOutputs,
  inferStageReads,
  inferToolOutputs,
  inferToolReads,
  inferAskUserOutputs,
  inferAskUserReads,
} from "@/services/workflows/dsl/infer-reads-outputs.ts";

// ============================================================================
// Agent No-op Execute
// ============================================================================

function agentNoopExecute(): Promise<NodeResult<BaseState>> {
  return Promise.resolve({});
}

// ============================================================================
// Abort-aware Promise race helper
// ============================================================================

/**
 * Race a promise against an optional AbortSignal.
 *
 * - When a signal is provided, rejects with an `AbortError` if the signal
 *   fires before the promise resolves. The abort listener is cleaned up
 *   once the promise settles to avoid leaks.
 * - When no signal is provided, returns the promise unchanged.
 */
function raceAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(
      new DOMException("askUserQuestion aborted", "AbortError"),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(new DOMException("askUserQuestion aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

// ============================================================================
// Instruction Validation
// ============================================================================

export function validateInstructions(instructions: Instruction[]): void {
  if (instructions.length === 0) {
    throw new Error("Workflow must have at least one stage or tool node");
  }
  const hasNode = instructions.some(
    (i) => i.type === "stage" || i.type === "tool" || i.type === "askUserQuestion",
  );
  if (!hasNode) {
    throw new Error("Workflow must have at least one stage or tool node");
  }
  let ifDepth = 0;
  let loopDepth = 0;
  const nodeIds = new Set<string>();
  for (const instruction of instructions) {
    switch (instruction.type) {
      case "stage":
      case "tool":
      case "askUserQuestion":
        if (nodeIds.has(instruction.id)) {
          throw new Error(`Duplicate node ID: "${instruction.id}"`);
        }
        nodeIds.add(instruction.id);
        break;
      case "if":
        ifDepth++;
        break;
      case "elseIf":
      case "else":
        if (ifDepth === 0) {
          throw new Error(`"${instruction.type}" without matching "if"`);
        }
        break;
      case "endIf":
        if (ifDepth === 0) {
          throw new Error('"endIf" without matching "if"');
        }
        ifDepth--;
        break;
      case "loop":
        loopDepth++;
        break;
      case "endLoop":
        if (loopDepth === 0) {
          throw new Error('"endLoop" without matching "loop"');
        }
        loopDepth--;
        break;
      case "break":
        if (loopDepth === 0) {
          throw new Error('"break" can only be used inside a loop');
        }
        break;
    }
  }
  if (ifDepth > 0) {
    throw new Error(
      `${ifDepth} unclosed "if" block(s) \u2014 missing "endIf"`,
    );
  }
  if (loopDepth > 0) {
    throw new Error(
      `${loopDepth} unclosed "loop" block(s) \u2014 missing "endLoop"`,
    );
  }
  validateBranchesNotEmpty(instructions);
}

function validateBranchesNotEmpty(instructions: Instruction[]): void {
  const branchHasNode: boolean[] = [];
  let currentDepth = 0;
  for (const instruction of instructions) {
    switch (instruction.type) {
      case "if":
        currentDepth++;
        branchHasNode[currentDepth] = false;
        break;
      case "elseIf":
      case "else":
        if (!branchHasNode[currentDepth]) {
          throw new Error("Empty branch in conditional block");
        }
        branchHasNode[currentDepth] = false;
        break;
      case "endIf":
        if (!branchHasNode[currentDepth]) {
          throw new Error("Empty branch in conditional block");
        }
        branchHasNode[currentDepth] = false;
        currentDepth--;
        break;
      case "stage":
      case "tool":
      case "askUserQuestion":
        if (currentDepth > 0) {
          branchHasNode[currentDepth] = true;
        }
        break;
    }
  }
}

// ============================================================================
// Conditional shouldRun Resolution
// ============================================================================

/**
 * Compute the shouldRun condition for each stage inside a conditional block.
 *
 * Stages inside an if or elseIf block get the enclosing branch condition
 * as their shouldRun predicate. Stages inside an else block get undefined
 * (always runs when the else branch is taken). Stages outside any conditional
 * block are not present in the returned map.
 */
function computeShouldRunMap(
  instructions: Instruction[],
): Map<string, ((ctx: StageContext) => boolean) | undefined> {
  const result = new Map<string, ((ctx: StageContext) => boolean) | undefined>();
  const conditionStack: Array<((ctx: StageContext) => boolean) | undefined> = [];
  for (const instruction of instructions) {
    switch (instruction.type) {
      case "if":
        conditionStack.push(instruction.condition);
        break;
      case "elseIf":
        conditionStack[conditionStack.length - 1] = instruction.condition;
        break;
      case "else":
        conditionStack[conditionStack.length - 1] = undefined;
        break;
      case "endIf":
        conditionStack.pop();
        break;
      case "stage":
      case "askUserQuestion":
        if (conditionStack.length > 0) {
          result.set(instruction.id, conditionStack[conditionStack.length - 1]);
        }
        break;
    }
  }
  return result;
}

// ============================================================================
// Stage Definition Generation
// ============================================================================

/**
 * Generate StageDefinition[] from stage instructions.
 *
 * Propagates shouldRun from enclosing .if() conditions to each stage.
 */
function generateStageDefinitions(
  instructions: Instruction[],
): StageDefinition[] {
  const stages: StageDefinition[] = [];
  const shouldRunMap = computeShouldRunMap(instructions);

  // Build agent lookup once — used to auto-resolve system prompts
  const agentLookup = buildAgentLookup();

  for (const instruction of instructions) {
    if (instruction.type !== "stage") continue;
    const config = instruction.config;
    const shouldRun = shouldRunMap.get(instruction.id);

    // Auto-resolve agent definition body as the stage's system prompt.
    // If no explicit systemPrompt is already configured and a matching
    // agent definition file exists, inject its body as the system prompt.
    // When agent is null/undefined, skip resolution — the SDK's default
    // session instructions are preserved.
    let resolvedSessionConfig = config.sessionConfig;
    if (config.agent && !config.sessionConfig?.systemPrompt) {
      const agentSystemPrompt = resolveStageSystemPrompt(config.agent, agentLookup);
      if (agentSystemPrompt) {
        resolvedSessionConfig = { ...config.sessionConfig, systemPrompt: agentSystemPrompt };
      }
    }

    // Resolve the model from the agent definition's frontmatter and merge
    // it into sessionConfig.model as a per-agent-type entry (e.g.,
    // `{ claude: "opus" }`). Explicit sessionConfig.model entries from the
    // workflow DSL take precedence — frontmatter values only fill in gaps.
    if (config.agent) {
      const frontmatterModelConfig = resolveStageAgentModelConfig(config.agent, agentLookup);
      if (frontmatterModelConfig) {
        resolvedSessionConfig = {
          ...resolvedSessionConfig,
          model: { ...frontmatterModelConfig, ...resolvedSessionConfig?.model },
        };
      }
    }

    const stage: StageDefinition = {
      id: instruction.id,
      indicator: config.description,
      buildPrompt: config.prompt,
      parseOutput: (response: string) => {
        return config.outputMapper(response);
      },
      shouldRun,
      sessionConfig: resolvedSessionConfig,
      maxOutputBytes: config.maxOutputBytes,
      disallowedTools: config.disallowedTools,
    };
    stages.push(stage);
  }
  return stages;
}

// ============================================================================
// Graph Generation Types
// ============================================================================

interface BreakEntry {
  readonly nodeId: string;
}

interface LoopContext {
  readonly loopStartNodeId: string;
  readonly loopCheckNodeId: string;
  readonly config: LoopOptions;
  readonly breaks: BreakEntry[];
}

interface GraphBuildResult {
  readonly nodes: Map<string, NodeDefinition<BaseState>>;
  readonly edges: Edge<BaseState>[];
  readonly startNode: string;
  readonly endNodes: Set<string>;
}

// ============================================================================
// Graph Generation
// ============================================================================

/**
 * Generate a CompiledGraph from the instruction list.
 *
 * The graph is kept linear for stage/tool nodes. Conditional blocks
 * (if/elseIf/else/endIf) do NOT produce decision/merge nodes in the graph
 * because the conductor handles conditional execution via shouldRun on
 * each StageDefinition. The graph simply chains all stage/tool nodes
 * in declaration order.
 *
 * Loop blocks produce loop-start + loop-check nodes with back-edges.
 */
function generateGraph(instructions: Instruction[]): GraphBuildResult {
  const nodes = new Map<string, NodeDefinition<BaseState>>();
  const edges: Edge<BaseState>[] = [];
  let previousNodeId: string | null = null;
  let nodeCounter = 0;
  const loopStack: LoopContext[] = [];
  // Maps conditional break node IDs to their resolved predicates.
  // Used by connectPrevious to make the flow-through edge conditional.
  const breakPredicates = new Map<string, (state: BaseState) => boolean>();

  function addNode(
    id: string,
    type: "agent" | "tool",
    options: StageOptions | ToolOptions<any>,
  ): string {
    const stageAgent = "agent" in options && type === "agent"
      ? (options as StageOptions).agent
      : undefined;
    const nodeName = stageAgent ?? options.name;
    const node: NodeDefinition<BaseState> = {
      id,
      type,
      name: nodeName,
      agent: stageAgent,
      description:
        "description" in options ? (options.description as string) : nodeName,
      execute:
        type === "agent"
          ? agentNoopExecute
          : async (context: ExecutionContext<BaseState>) => {
              const toolOptions = options as ToolOptions<any>;
              const result = await toolOptions.execute(context);
              const mapped = toolOptions.outputMapper
                ? toolOptions.outputMapper(result)
                : result;
              return { stateUpdate: mapped as Partial<BaseState> };
            },
      reads: type === "agent"
        ? inferStageReads((options as StageOptions).prompt)
        : inferToolReads((options as ToolOptions<any>).execute),
      outputs: type === "agent"
        ? inferStageOutputs((options as StageOptions).outputMapper)
        : inferToolOutputs((options as ToolOptions<any>).outputMapper, (options as ToolOptions<any>).execute),
    };
    nodes.set(id, node);
    return id;
  }

  function addDecisionNode(id: string): string {
    const node: NodeDefinition<BaseState> = {
      id,
      type: "tool",
      name: "Decision",
      execute: () => Promise.resolve({}),
    };
    nodes.set(id, node);
    return id;
  }

  function connectPrevious(targetNodeId: string): void {
    if (previousNodeId !== null) {
      const breakPred = breakPredicates.get(previousNodeId);
      if (breakPred) {
        // Conditional break: only continue to next node when predicate is false.
        // Share a conditionGroup with the matching exit edge (wired in endLoop)
        // so the deadlock-freedom verifier recognises the pair as exhaustive.
        edges.push({
          from: previousNodeId,
          to: targetNodeId,
          condition: (state: BaseState) => !breakPred(state),
          label: "break_continue",
          conditionGroup: `break_decision_${previousNodeId}`,
        });
      } else {
        edges.push({ from: previousNodeId, to: targetNodeId });
      }
    }
  }

  for (const instruction of instructions) {
    switch (instruction.type) {
      case "stage": {
        const nodeId = addNode(instruction.id, "agent", instruction.config);
        connectPrevious(nodeId);
        previousNodeId = nodeId;
        break;
      }

      case "tool": {
        const nodeId = addNode(instruction.id, "tool", instruction.config);
        connectPrevious(nodeId);
        previousNodeId = nodeId;
        break;
      }

      case "askUserQuestion": {
        const config = instruction.config;
        const questionOptions = config.question;
        const askUserOutputMapper = config.outputMapper;

        // Create an ask_user node using the existing factory
        const askNode = askUserNode({
          id: instruction.id,
          options: typeof questionOptions === "function"
            ? (state: BaseState) => {
                const resolved = questionOptions(state);
                return {
                  question: resolved.question,
                  header: resolved.header,
                  options: resolved.options ? [...resolved.options] : undefined,
                  multiSelect: resolved.multiSelect,
                };
              }
            : {
                question: questionOptions.question,
                header: questionOptions.header,
                options: questionOptions.options ? [...questionOptions.options] : undefined,
                multiSelect: questionOptions.multiSelect,
              },
          name: config.name,
          description: config.description,
        });

        // Propagate inferred reads and outputs to the node definition.
        askNode.reads = inferAskUserReads(config.question);
        askNode.outputs = inferAskUserOutputs(askUserOutputMapper);

        // Wrap execute to set dslAskUser flag on emitted events and
        // wire the outputMapper callback when provided.
        const originalExecute = askNode.execute;
        askNode.execute = async (ctx: ExecutionContext<BaseState>) => {
          // When outputMapper is provided AND emit is available, block the
          // node's execution until the user answers via the respond
          // callback. This lets the conductor receive the mapped state
          // updates as part of the normal NodeResult.stateUpdate flow.
          //
          // Guard: also require abortSignal so we never block on a
          // promise that has no cancellation path. Without an abort
          // signal, the promise would hang forever if respond() is
          // never called (e.g., in tests or contexts without a TUI).
          if (askUserOutputMapper && ctx.emit) {
            if (!ctx.abortSignal) {
              throw new Error(
                `[workflow:${instruction.id}] askUserQuestion has outputMapper but no abortSignal — ` +
                `outputMapper requires an abortSignal to avoid a blocking promise that cannot be cancelled.`,
              );
            }

            let resolveAnswer!: (answer: string | string[]) => void;
            const answerPromise = new Promise<string | string[]>((resolve) => {
              resolveAnswer = resolve;
            });

            const outputMapperCtx: ExecutionContext<BaseState> = {
              ...ctx,
              emit: (type: string, data?: Record<string, unknown>) => {
                ctx.emit!(type, {
                  ...data,
                  dslAskUser: true,
                  respond: (answer: string | string[]) => {
                    resolveAnswer(answer);
                  },
                });
              },
            };

            // Execute the original node (emits the event with our
            // custom respond callback that resolves the promise).
            const result = await originalExecute(outputMapperCtx);

            // Wait for the user's answer via the respond callback,
            // but bail out if the execution is aborted (ESC / Ctrl+C)
            // so we never block forever on a promise that will never
            // resolve.  On abort we treat it as a "declined" answer and
            // continue to the next step instead of crashing the workflow.
            let answer: string | string[];
            let userDeclined = false;
            try {
              answer = await raceAbortSignal(answerPromise, ctx.abortSignal);
            } catch (err: unknown) {
              if (err instanceof DOMException && err.name === "AbortError") {
                answer = USER_DECLINED_ANSWER;
                userDeclined = true;
              } else {
                throw err;
              }
            }

            // Apply outputMapper mapping and merge with original state update.
            const mappedUpdates = askUserOutputMapper(answer);
            return {
              ...result,
              stateUpdate: {
                ...result.stateUpdate,
                ...mappedUpdates,
                __waitingForInput: false,
                __userDeclined: userDeclined,
              },
            };
          }

          // No outputMapper or no emit: just add dslAskUser flag.
          const wrappedCtx: ExecutionContext<BaseState> = {
            ...ctx,
            emit: ctx.emit
              ? (type: string, data?: Record<string, unknown>) => {
                  ctx.emit!(type, { ...data, dslAskUser: true });
                }
              : undefined,
          };
          return originalExecute(wrappedCtx);
        };

        nodes.set(instruction.id, askNode);
        connectPrevious(instruction.id);
        previousNodeId = instruction.id;
        break;
      }

      // Conditional blocks: skip control-flow instructions.
      // The conductor uses shouldRun on StageDefinition to skip stages.
      case "if":
      case "elseIf":
      case "else":
      case "endIf":
        break;

      case "loop": {
        const loopStartId = `__loop_start_${nodeCounter++}`;
        const loopCheckId = `__loop_check_${nodeCounter++}`;
        addDecisionNode(loopStartId);
        addDecisionNode(loopCheckId);
        connectPrevious(loopStartId);
        loopStack.push({
          loopStartNodeId: loopStartId,
          loopCheckNodeId: loopCheckId,
          config: instruction.config,
          breaks: [],
        });
        previousNodeId = loopStartId;
        break;
      }

      case "endLoop": {
        const loopCtx = loopStack.pop()!;

        // Connect last body node to loop check
        connectPrevious(loopCtx.loopCheckNodeId);

        // Create closure variables for loop termination.
        let iterationCount = 0;
        let shouldContinue = false;
        const maxCycles = loopCtx.config.maxCycles ?? 100;

        // Both the continue and exit edges form a single boolean decision
        // at this loop-check node. They share a conditionGroup so the
        // deadlock-freedom verifier can recognise them as exhaustive.
        const loopDecisionGroup = `loop_decision_${loopCtx.loopCheckNodeId}`;

        // Back-edge: continue looping while under maxCycles.
        edges.push({
          from: loopCtx.loopCheckNodeId,
          to: loopCtx.loopStartNodeId,
          condition: () => {
            iterationCount++;
            shouldContinue = iterationCount < maxCycles;
            return shouldContinue;
          },
          label: "loop_continue",
          conditionGroup: loopDecisionGroup,
        });

        // Create exit decision node
        const exitNodeId = `__loop_exit_${nodeCounter++}`;
        addDecisionNode(exitNodeId);

        // Exit edge: leave loop when maxCycles reached
        edges.push({
          from: loopCtx.loopCheckNodeId,
          to: exitNodeId,
          condition: () => !shouldContinue,
          label: "loop_exit",
          conditionGroup: loopDecisionGroup,
        });

        // Connect break nodes to exit.
        // Conditional breaks: exit edge fires when predicate is true;
        // the flow-through (continue) edge was already wired by
        // connectPrevious using the breakPredicates map.
        // Unconditional breaks: always route to exit.
        for (const entry of loopCtx.breaks) {
          const predicate = breakPredicates.get(entry.nodeId);
          if (predicate) {
            // Share a conditionGroup with the matching continue edge (wired by
            // connectPrevious) so the verifier sees the break as exhaustive.
            edges.push({
              from: entry.nodeId,
              to: exitNodeId,
              condition: (state: BaseState) => predicate(state),
              label: "break_exit",
              conditionGroup: `break_decision_${entry.nodeId}`,
            });
          } else {
            edges.push({ from: entry.nodeId, to: exitNodeId });
          }
        }

        previousNodeId = exitNodeId;
        break;
      }

      case "break": {
        const currentLoop = loopStack[loopStack.length - 1]!;
        const breakNodeId = `__break_${nodeCounter++}`;
        addDecisionNode(breakNodeId);
        connectPrevious(breakNodeId);
        // Resolve the condition factory NOW so the same predicate instance
        // is shared between the exit edge (endLoop) and the flow-through
        // edge (connectPrevious for the next instruction).
        const resolvedCondition = instruction.condition?.();
        if (resolvedCondition) {
          breakPredicates.set(breakNodeId, resolvedCondition);
        }
        currentLoop.breaks.push({ nodeId: breakNodeId });
        previousNodeId = breakNodeId;
        break;
      }
    }
  }

  const allNodeIds = Array.from(nodes.keys());
  const startNode = allNodeIds[0] ?? "";
  const nodesWithOutgoing = new Set(edges.map((e) => e.from));
  const endNodes = new Set<string>();
  for (const nodeId of allNodeIds) {
    if (!nodesWithOutgoing.has(nodeId)) {
      endNodes.add(nodeId);
    }
  }
  if (endNodes.size === 0 && allNodeIds.length > 0) {
    endNodes.add(allNodeIds[allNodeIds.length - 1]!);
  }
  return { nodes, edges, startNode, endNodes };
}

// ============================================================================
// Compile
// ============================================================================

export function compileWorkflow(builder: WorkflowBuilder): WorkflowDefinition {
  const { instructions, name, description } = builder;
  const version = builder.getVersion();
  const argumentHint = builder.getArgumentHint();
  const stateSchema = builder.getStateSchema();

  validateInstructions(instructions);
  const conductorStages = generateStageDefinitions(instructions);

  // Generate the graph once for static metadata (nodeDescriptions).
  // createConductorGraph below regenerates it per execution so that
  // mutable closure state (iteration counters, break predicates)
  // starts fresh for each workflow run.
  const initialGraphResult = generateGraph(instructions);

  const createState = createStateFactory(stateSchema);

  const nodeDescriptions: Record<string, string> = {};
  for (const [id, node] of initialGraphResult.nodes) {
    if (node.name) {
      nodeDescriptions[id] = node.name;
    }
  }

  const definition: WorkflowDefinition = {
    name,
    description,
    version,
    argumentHint,
    source: "builtin",
    createState,
    nodeDescriptions,
    conductorStages,
    stateFields: stateSchema ? Object.keys(stateSchema) : undefined,
    createConductorGraph: () => {
      const graphResult = generateGraph(instructions);
      return {
        nodes: graphResult.nodes,
        edges: graphResult.edges,
        startNode: graphResult.startNode,
        endNodes: graphResult.endNodes,
        config: {},
      };
    },
  };

  return definition;
}
