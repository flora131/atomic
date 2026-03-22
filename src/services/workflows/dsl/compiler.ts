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
 * @see specs/workflow-sdk-simplification.md section 5.1.5
 */

import type {
  Instruction,
  StageConfig,
  ToolConfig,
  LoopConfig,
} from "@/services/workflows/dsl/types.ts";
import type { WorkflowBuilder } from "@/services/workflows/dsl/define-workflow.ts";
import type { WorkflowDefinition } from "@/services/workflows/types/definition.ts";
import type {
  StageDefinition,
  StageContext,
} from "@/services/workflows/conductor/types.ts";
import type {
  BaseState,
  CompiledGraph,
  Edge,
  NodeDefinition,
  NodeResult,
  ExecutionContext,
} from "@/services/workflows/graph/types.ts";
import { createStateFactory } from "@/services/workflows/dsl/state-compiler.ts";
import {
  buildAgentLookup,
  resolveStageSystemPrompt,
} from "@/services/workflows/dsl/agent-resolution.ts";

// ============================================================================
// Agent No-op Execute
// ============================================================================

function agentNoopExecute(): Promise<NodeResult<BaseState>> {
  return Promise.resolve({});
}

// ============================================================================
// Instruction Validation
// ============================================================================

export function validateInstructions(instructions: Instruction[]): void {
  if (instructions.length === 0) {
    throw new Error("Workflow must have at least one stage or tool node");
  }
  const hasNode = instructions.some(
    (i) => i.type === "stage" || i.type === "tool",
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
    let resolvedSessionConfig = config.sessionConfig;
    if (!config.sessionConfig?.systemPrompt) {
      const agentSystemPrompt = resolveStageSystemPrompt(instruction.id, agentLookup);
      if (agentSystemPrompt) {
        resolvedSessionConfig = { ...config.sessionConfig, systemPrompt: agentSystemPrompt };
      }
    }

    const stage: StageDefinition = {
      id: instruction.id,
      name: config.name,
      indicator: config.description,
      buildPrompt: config.prompt,
      parseOutput: (response: string) => {
        const mapped = config.outputMapper(response);
        if (config.outputs && config.outputs.length > 0) {
          const mappedKeys = Object.keys(mapped);
          const missing = config.outputs.filter((k) => !mappedKeys.includes(k));
          const extra = mappedKeys.filter((k) => !config.outputs!.includes(k));
          if (missing.length > 0 || extra.length > 0) {
            const parts: string[] = [];
            if (missing.length > 0) parts.push(`missing keys: [${missing.join(", ")}]`);
            if (extra.length > 0) parts.push(`unexpected keys: [${extra.join(", ")}]`);
            throw new Error(
              `Stage "${instruction.id}" outputMapper keys do not match declared outputs. ` +
              `Declared: [${config.outputs.join(", ")}], returned: [${mappedKeys.join(", ")}]. ${parts.join("; ")}`,
            );
          }
        }
        const values = Object.values(mapped);
        if (values.length === 1 && Array.isArray(values[0])) {
          return values[0];
        }
        return mapped;
      },
      shouldRun,
      sessionConfig: resolvedSessionConfig,
      maxOutputBytes: config.maxOutputBytes,
    };
    stages.push(stage);
  }
  return stages;
}

// ============================================================================
// Graph Generation Types
// ============================================================================

interface LoopContext {
  readonly loopStartNodeId: string;
  readonly loopCheckNodeId: string;
  readonly config: LoopConfig;
  readonly breakNodeIds: string[];
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

  function addNode(
    id: string,
    type: "agent" | "tool",
    config: StageConfig | ToolConfig,
  ): string {
    const node: NodeDefinition<BaseState> = {
      id,
      type,
      name: config.name,
      description:
        "description" in config ? (config.description as string) : config.name,
      execute:
        type === "agent"
          ? agentNoopExecute
          : async (context: ExecutionContext<BaseState>) => {
              const toolConfig = config as ToolConfig;
              const result = await toolConfig.execute(context);
              return { stateUpdate: result as Partial<BaseState> };
            },
      reads: config.reads,
      outputs: config.outputs,
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
      edges.push({ from: previousNodeId, to: targetNodeId });
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
          breakNodeIds: [],
        });
        previousNodeId = loopStartId;
        break;
      }

      case "endLoop": {
        const loopCtx = loopStack.pop()!;

        // Connect last body node to loop check
        connectPrevious(loopCtx.loopCheckNodeId);

        // Create closure variables for loop termination.
        // The back-edge condition increments and evaluates; the exit-edge
        // reads the cached result so both are mutually exclusive.
        let iterationCount = 0;
        let shouldContinue = false;
        const maxCycles = loopCtx.config.maxCycles ?? 100;

        // Back-edge: continue looping (evaluated first by the conductor
        // because it appears earlier in the edges array).
        edges.push({
          from: loopCtx.loopCheckNodeId,
          to: loopCtx.loopStartNodeId,
          condition: (state: BaseState) => {
            iterationCount++;
            shouldContinue =
              !loopCtx.config.until(state) &&
              iterationCount < maxCycles;
            return shouldContinue;
          },
          label: "loop_continue",
        });

        // Create exit decision node
        const exitNodeId = `__loop_exit_${nodeCounter++}`;
        addDecisionNode(exitNodeId);

        // Exit edge: leave loop (evaluated second, uses cached result)
        edges.push({
          from: loopCtx.loopCheckNodeId,
          to: exitNodeId,
          condition: () => !shouldContinue,
          label: "loop_exit",
        });

        // Connect break nodes to exit (unconditional)
        for (const breakId of loopCtx.breakNodeIds) {
          edges.push({ from: breakId, to: exitNodeId });
        }

        previousNodeId = exitNodeId;
        break;
      }

      case "break": {
        const currentLoop = loopStack[loopStack.length - 1]!;
        const breakNodeId = `__break_${nodeCounter++}`;
        addDecisionNode(breakNodeId);
        connectPrevious(breakNodeId);
        currentLoop.breakNodeIds.push(breakNodeId);
        // Code after break in the same block is unreachable at runtime
        // because the break node routes unconditionally to the loop exit.
        // Setting previousNodeId here allows subsequent instructions to
        // still be wired into the graph (they just won't be reached when
        // the break path is taken).
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

  const graphResult = generateGraph(instructions);
  const compiledGraph: CompiledGraph<BaseState> = {
    nodes: graphResult.nodes,
    edges: graphResult.edges,
    startNode: graphResult.startNode,
    endNodes: graphResult.endNodes,
    config: {},
  };

  const createState = createStateFactory(stateSchema);

  const nodeDescriptions: Record<string, string> = {};
  for (const [id, node] of graphResult.nodes) {
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
    createConductorGraph: () => compiledGraph,
  };

  return definition;
}
