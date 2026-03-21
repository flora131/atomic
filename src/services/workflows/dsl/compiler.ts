/**
 * DSL Compiler
 *
 * Transforms the WorkflowBuilder's recorded instruction list into a
 * WorkflowDefinition consumable by the existing conductor.
 *
 * The compiler performs five key steps:
 * 1. Validates the instruction sequence (balanced if/endIf, loop/endLoop,
 *    unique IDs, at least one node).
 * 2. Generates StageDefinition[] from stage instructions.
 * 3. Generates a CompiledGraph with nodes and edges.
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
import type { StageDefinition, StageContext } from "@/services/workflows/conductor/types.ts";
import type {
  BaseState,
  CompiledGraph,
  Edge,
  NodeDefinition,
  NodeResult,
  ExecutionContext,
} from "@/services/workflows/graph/types.ts";
import { createStateFactory } from "@/services/workflows/dsl/state-compiler.ts";

// ============================================================================
// Agent No-op Execute
// ============================================================================

/**
 * No-op execute for agent nodes.
 *
 * Agent nodes are executed by the conductor via StageDefinition, not by the
 * graph executor directly. This placeholder satisfies the NodeDefinition
 * contract without performing any work.
 */
function agentNoopExecute(): Promise<NodeResult<BaseState>> {
  return Promise.resolve({});
}

// ============================================================================
// Instruction Validation
// ============================================================================

/**
 * Validate the instruction sequence for structural correctness.
 *
 * Checks:
 * - At least one stage or tool node exists
 * - All node IDs are unique
 * - if/endIf blocks are balanced
 * - loop/endLoop blocks are balanced
 * - No branch in a conditional block is empty
 * - elseIf/else appear only inside an if block
 *
 * @throws Error with a descriptive message for any structural violation
 */
export function validateInstructions(instructions: Instruction[]): void {
  if (instructions.length === 0) {
    throw new Error("Workflow must have at least one stage or tool node");
  }

  // Check that there is at least one stage or tool node
  const hasNode = instructions.some(
    (i) => i.type === "stage" || i.type === "tool",
  );
  if (!hasNode) {
    throw new Error("Workflow must have at least one stage or tool node");
  }

  // Check balanced if/endIf and loop/endLoop, and unique node IDs
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
    }
  }

  if (ifDepth > 0) {
    throw new Error(`${ifDepth} unclosed "if" block(s) — missing "endIf"`);
  }
  if (loopDepth > 0) {
    throw new Error(`${loopDepth} unclosed "loop" block(s) — missing "endLoop"`);
  }

  // Validate that each branch in a conditional block has at least one node
  validateBranchesNotEmpty(instructions);
}

/**
 * Validate that every branch (if, elseIf, else) in conditional blocks
 * contains at least one stage or tool node.
 *
 * Uses a depth-aware approach to handle nested if blocks correctly.
 */
function validateBranchesNotEmpty(instructions: Instruction[]): void {
  // Track if-depth and whether the current branch at depth has a node
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
// Stage Definition Generation
// ============================================================================

/**
 * Generate StageDefinition[] from stage instructions.
 *
 * Each `stage` instruction is converted to a StageDefinition with:
 * - `buildPrompt` from `StageConfig.prompt`
 * - `parseOutput` wrapping `StageConfig.outputMapper`
 * - `indicator` from `StageConfig.description`
 * - `sessionConfig` and `maxOutputBytes` passed through
 */
function generateStageDefinitions(instructions: Instruction[]): StageDefinition[] {
  const stages: StageDefinition[] = [];

  for (const instruction of instructions) {
    if (instruction.type !== "stage") continue;

    const config = instruction.config;
    const stage: StageDefinition = {
      id: instruction.id,
      name: config.name,
      indicator: config.description,
      buildPrompt: config.prompt,
      parseOutput: (response: string) => {
        return config.outputMapper(response);
      },
      sessionConfig: config.sessionConfig,
      maxOutputBytes: config.maxOutputBytes,
    };

    stages.push(stage);
  }

  return stages;
}

// ============================================================================
// Graph Generation — Internal Types
// ============================================================================

/** Context tracked during if/elseIf/else/endIf processing. */
interface IfContext {
  /** The decision node that routes to branches. */
  readonly decisionNodeId: string;
  /** Last node of each completed branch (for connecting to merge). */
  readonly branchEndpoints: string[];
  /** The merge node that all branches converge to. */
  readonly mergeNodeId: string;
  /** Conditions for each branch (undefined for else). */
  readonly conditions: Array<{ condition?: (ctx: StageContext) => boolean }>;
  /** Current branch index (0-based). */
  branchIndex: number;
}

/** Context tracked during loop/endLoop processing. */
interface LoopContext {
  /** The entry point node for the loop. */
  readonly loopStartNodeId: string;
  /** The check node that decides continue vs. exit. */
  readonly loopCheckNodeId: string;
  /** The loop configuration (until predicate, maxIterations). */
  readonly config: LoopConfig;
}

/** Result of graph generation — nodes, edges, and metadata. */
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
 * Processes instructions linearly, creating graph nodes and edges:
 * - `stage` → agent node (no-op execute; conductor uses StageDefinition)
 * - `tool` → tool node with real execute function
 * - `if/elseIf/else/endIf` → decision + merge nodes with conditional edges
 * - `loop/endLoop` → loop-start + loop-check nodes with back-edges
 */
function generateGraph(instructions: Instruction[]): GraphBuildResult {
  const nodes = new Map<string, NodeDefinition<BaseState>>();
  const edges: Edge<BaseState>[] = [];

  // Track the "previous" node for linear sequencing
  let previousNodeId: string | null = null;
  let nodeCounter = 0;

  // Stacks for structured control flow
  const ifStack: IfContext[] = [];
  const loopStack: LoopContext[] = [];

  /**
   * Register a node in the graph and return its ID.
   */
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
    };
    nodes.set(id, node);
    return id;
  }

  /**
   * Add a synthetic decision/merge node (no-op tool node).
   */
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

  /**
   * Connect the previous node to the target node, if there is a previous node.
   */
  function connectPrevious(targetNodeId: string): void {
    if (previousNodeId !== null) {
      edges.push({ from: previousNodeId, to: targetNodeId });
    }
  }

  // Process each instruction
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

      case "if": {
        const decisionId = `__decision_${nodeCounter++}`;
        const mergeId = `__merge_${nodeCounter++}`;
        addDecisionNode(decisionId);
        addDecisionNode(mergeId);
        connectPrevious(decisionId);

        ifStack.push({
          decisionNodeId: decisionId,
          branchEndpoints: [],
          mergeNodeId: mergeId,
          conditions: [{ condition: instruction.condition }],
          branchIndex: 0,
        });

        // Reset previous — will be set by the first node in the branch
        previousNodeId = null;
        break;
      }

      case "elseIf": {
        const ctx = ifStack[ifStack.length - 1]!;
        // Record the end of the current branch
        if (previousNodeId !== null) {
          ctx.branchEndpoints.push(previousNodeId);
        }
        ctx.conditions.push({ condition: instruction.condition });
        ctx.branchIndex++;
        previousNodeId = null;
        break;
      }

      case "else": {
        const ctx = ifStack[ifStack.length - 1]!;
        if (previousNodeId !== null) {
          ctx.branchEndpoints.push(previousNodeId);
        }
        ctx.conditions.push({}); // No condition = else branch
        ctx.branchIndex++;
        previousNodeId = null;
        break;
      }

      case "endIf": {
        const ctx = ifStack.pop()!;
        if (previousNodeId !== null) {
          ctx.branchEndpoints.push(previousNodeId);
        }

        // Connect all branch endpoints to the merge node
        for (const endpoint of ctx.branchEndpoints) {
          edges.push({ from: endpoint, to: ctx.mergeNodeId });
        }

        // If no else branch exists, add a direct edge from decision to merge
        // so that when no condition matches, execution skips the entire block
        const hasElse = ctx.conditions.some((c) => !c.condition);
        if (!hasElse) {
          edges.push({ from: ctx.decisionNodeId, to: ctx.mergeNodeId });
        }

        previousNodeId = ctx.mergeNodeId;
        break;
      }

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
        });

        previousNodeId = loopStartId;
        break;
      }

      case "endLoop": {
        const ctx = loopStack.pop()!;
        // Connect last body node to loop check
        if (previousNodeId !== null) {
          edges.push({ from: previousNodeId, to: ctx.loopCheckNodeId });
        }
        // Loop check → back to loop start (continue loop)
        edges.push({
          from: ctx.loopCheckNodeId,
          to: ctx.loopStartNodeId,
          condition: () => true, // Placeholder — conductor uses until()
          label: "loop_continue",
        });

        previousNodeId = ctx.loopCheckNodeId;
        break;
      }
    }
  }

  // Determine start and end nodes
  const allNodeIds = Array.from(nodes.keys());
  const startNode = allNodeIds[0] ?? "";

  // End nodes: nodes with no outgoing edges
  const nodesWithOutgoing = new Set(edges.map((e) => e.from));
  const endNodes = new Set<string>();
  for (const nodeId of allNodeIds) {
    if (!nodesWithOutgoing.has(nodeId)) {
      endNodes.add(nodeId);
    }
  }

  // Ensure at least one end node
  if (endNodes.size === 0 && allNodeIds.length > 0) {
    endNodes.add(allNodeIds[allNodeIds.length - 1]!);
  }

  return { nodes, edges, startNode, endNodes };
}

// ============================================================================
// Compile
// ============================================================================

/**
 * Compile a WorkflowBuilder into a WorkflowDefinition.
 *
 * Validates the instruction sequence, generates stage definitions,
 * builds the compiled graph, and assembles the final definition.
 *
 * @param builder - The WorkflowBuilder instance to compile
 * @returns A WorkflowDefinition ready for conductor execution
 * @throws Error if the instruction sequence is structurally invalid
 */
export function compileWorkflow(builder: WorkflowBuilder): WorkflowDefinition {
  const { instructions, name, description } = builder;
  const version = builder.getVersion();
  const argumentHint = builder.getArgumentHint();
  const stateSchema = builder.getStateSchema();

  // Step 1: Validate
  validateInstructions(instructions);

  // Step 2: Generate stage definitions
  const conductorStages = generateStageDefinitions(instructions);

  // Step 3: Generate graph
  const graphResult = generateGraph(instructions);
  const compiledGraph: CompiledGraph<BaseState> = {
    nodes: graphResult.nodes,
    edges: graphResult.edges,
    startNode: graphResult.startNode,
    endNodes: graphResult.endNodes,
    config: {},
  };

  // Step 4: Generate state factory
  const createState = createStateFactory(stateSchema);

  // Step 5: Generate node descriptions
  const nodeDescriptions: Record<string, string> = {};
  for (const [id, node] of graphResult.nodes) {
    if (node.name) {
      nodeDescriptions[id] = node.name;
    }
  }

  // Step 6: Assemble WorkflowDefinition
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
