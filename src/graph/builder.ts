/**
 * Graph Builder for Workflow Definition
 *
 * This module provides a fluent API for building graph-based workflows.
 * The GraphBuilder class enables declarative workflow construction with:
 * - Linear node chaining with then()
 * - Conditional branching with if()/else()/endif()
 * - Parallel execution with parallel()
 * - Loop constructs with loop()
 * - Human-in-the-loop with wait()
 * - Error handling with catch()
 *
 * Reference: Feature 11 - Implement GraphBuilder with fluent API for workflow definition
 */

import type {
  BaseState,
  NodeId,
  NodeDefinition,
  NodeExecuteFn,
  Edge,
  EdgeCondition,
  CompiledGraph,
  GraphConfig,
  RetryConfig,
  NodeType,
} from "./types.ts";

// ============================================================================
// LOOP CONFIGURATION
// ============================================================================

/**
 * Configuration for loop constructs.
 *
 * @template TState - The state type for the workflow
 */
export interface LoopConfig<TState extends BaseState = BaseState> {
  /**
   * Condition to check after each iteration.
   * Loop exits when this returns true.
   */
  until: EdgeCondition<TState>;

  /**
   * Maximum number of iterations (safety limit).
   * Default: 100
   */
  maxIterations?: number;
}

// ============================================================================
// PARALLEL CONFIGURATION
// ============================================================================

/**
 * Merge strategy for parallel branch results.
 */
export type MergeStrategy = "all" | "race" | "any";

/**
 * Configuration for parallel execution.
 *
 * @template TState - The state type for the workflow
 */
export interface ParallelConfig<TState extends BaseState = BaseState> {
  /**
   * Array of branch node IDs to execute in parallel.
   */
  branches: NodeId[];

  /**
   * Strategy for handling branch completion:
   * - "all": Wait for all branches (Promise.all)
   * - "race": Wait for first branch (Promise.race)
   * - "any": Wait for first success (Promise.any)
   * Default: "all"
   */
  strategy?: MergeStrategy;

  /**
   * Optional merge function to combine results.
   * If not provided, results are stored in outputs.
   */
  merge?: (results: Map<NodeId, unknown>, state: TState) => Partial<TState>;
}

// ============================================================================
// CONDITIONAL BRANCH STATE
// ============================================================================

/**
 * Internal state for tracking conditional branches.
 */
interface ConditionalBranch<TState extends BaseState = BaseState> {
  /** ID of the decision node */
  decisionNodeId: NodeId;
  /** Condition for the 'if' branch */
  condition: EdgeCondition<TState>;
  /** First node of the 'if' branch */
  ifBranchStart?: NodeId;
  /** Last node of the 'if' branch */
  ifBranchEnd?: NodeId;
  /** First node of the 'else' branch */
  elseBranchStart?: NodeId;
  /** Last node of the 'else' branch */
  elseBranchEnd?: NodeId;
  /** Whether currently in else branch */
  inElseBranch: boolean;
}

// ============================================================================
// GRAPH BUILDER CLASS
// ============================================================================

/**
 * Fluent builder for constructing workflow graphs.
 *
 * @template TState - The state type for the workflow
 *
 * @example
 * ```typescript
 * const workflow = graph<MyState>()
 *   .start(researchNode)
 *   .then(specNode)
 *   .if((state) => state.specApproved)
 *     .then(implementNode)
 *   .else()
 *     .then(reviseNode)
 *   .endif()
 *   .then(reviewNode)
 *   .end()
 *   .compile({ checkpointer: myCheckpointer });
 * ```
 */
export class GraphBuilder<TState extends BaseState = BaseState> {
  /** All nodes in the graph */
  private nodes: Map<NodeId, NodeDefinition<TState>> = new Map();

  /** All edges in the graph */
  private edges: Edge<TState>[] = [];

  /** The starting node ID */
  private startNodeId: NodeId | null = null;

  /** Terminal node IDs */
  private endNodeIds: Set<NodeId> = new Set();

  /** Current node for chaining */
  private currentNodeId: NodeId | null = null;

  /** Stack for tracking conditional branches */
  private conditionalStack: ConditionalBranch<TState>[] = [];

  /** Counter for generating unique node IDs */
  private nodeCounter = 0;

  /** Error handler node ID */
  private errorHandlerId: NodeId | null = null;

  /**
   * Generate a unique node ID.
   */
  private generateNodeId(prefix: string = "node"): NodeId {
    return `${prefix}_${++this.nodeCounter}`;
  }

  /**
   * Add a node to the graph.
   */
  private addNode(node: NodeDefinition<TState>): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node with ID "${node.id}" already exists`);
    }
    this.nodes.set(node.id, node);
  }

  /**
   * Add an edge between two nodes.
   */
  private addEdge(
    from: NodeId,
    to: NodeId,
    condition?: EdgeCondition<TState>,
    label?: string
  ): void {
    this.edges.push({ from, to, condition, label });
  }

  /**
   * Create a node definition from parameters.
   */
  private createNode(
    id: NodeId,
    type: NodeType,
    execute: NodeExecuteFn<TState>,
    options?: {
      name?: string;
      description?: string;
      retry?: RetryConfig;
    }
  ): NodeDefinition<TState> {
    return {
      id,
      type,
      execute,
      ...options,
    };
  }

  // ==========================================================================
  // FLUENT API METHODS
  // ==========================================================================

  /**
   * Set the starting node of the workflow.
   *
   * @param node - The node definition or a simple node config
   * @returns this for chaining
   */
  start(node: NodeDefinition<TState>): this {
    if (this.startNodeId !== null) {
      throw new Error("Start node already set. Use then() to add more nodes.");
    }

    this.addNode(node);
    this.startNodeId = node.id;
    this.currentNodeId = node.id;

    return this;
  }

  /**
   * Add a node and connect it from the current node.
   * Note: Named 'then' for fluent API chaining (e.g., start().then().then())
   *
   * @param node - The node definition to add
   * @returns this for chaining
   */
  // oxlint-disable-next-line unicorn/no-thenable -- Intentional fluent API design
  then(node: NodeDefinition<TState>): this {
    if (this.startNodeId === null) {
      // If no start node, use this as start
      return this.start(node);
    }

    this.addNode(node);

    // Check if we're in a conditional branch (after if() or else())
    const currentBranch = this.conditionalStack[this.conditionalStack.length - 1];

    if (currentBranch && this.currentNodeId === null) {
      // We're at the start of a conditional branch
      if (!currentBranch.inElseBranch && !currentBranch.ifBranchStart) {
        // First node in if branch
        currentBranch.ifBranchStart = node.id;
      } else if (currentBranch.inElseBranch && !currentBranch.elseBranchStart) {
        // First node in else branch
        currentBranch.elseBranchStart = node.id;
      }
    } else if (this.currentNodeId !== null) {
      // Normal case - connect from current node
      this.addEdge(this.currentNodeId, node.id);
    }

    this.currentNodeId = node.id;

    return this;
  }

  /**
   * Begin a conditional branch.
   *
   * @param condition - Function that returns true if the if-branch should be taken
   * @returns this for chaining
   */
  if(condition: EdgeCondition<TState>): this {
    if (this.currentNodeId === null) {
      throw new Error("Cannot use if() without a preceding node. Use start() first.");
    }

    // Create a decision node
    const decisionNodeId = this.generateNodeId("decision");
    const decisionNode = this.createNode(decisionNodeId, "decision", async (_ctx) => {
      // Decision nodes just mark decision points
      // The actual routing is handled by edges with conditions
      return {};
    });

    this.addNode(decisionNode);
    this.addEdge(this.currentNodeId, decisionNodeId);

    // Push branch state
    this.conditionalStack.push({
      decisionNodeId,
      condition,
      inElseBranch: false,
    });

    // Current node is now the decision node, but we don't connect directly
    // The first then() in the if branch will set ifBranchStart
    this.currentNodeId = null;

    return this;
  }

  /**
   * Begin the else branch of a conditional.
   *
   * @returns this for chaining
   */
  else(): this {
    const currentBranch = this.conditionalStack[this.conditionalStack.length - 1];

    if (!currentBranch) {
      throw new Error("Cannot use else() without a preceding if()");
    }

    if (currentBranch.inElseBranch) {
      throw new Error("Already in else branch. Use endif() to close.");
    }

    // Record the end of the if branch
    currentBranch.ifBranchEnd = this.currentNodeId ?? undefined;
    currentBranch.inElseBranch = true;

    // Reset current node for else branch
    this.currentNodeId = null;

    return this;
  }

  /**
   * Close a conditional block.
   *
   * @returns this for chaining
   */
  endif(): this {
    const branch = this.conditionalStack.pop();

    if (!branch) {
      throw new Error("Cannot use endif() without a preceding if()");
    }

    // Record the end of the else branch (or if branch if no else)
    if (branch.inElseBranch) {
      branch.elseBranchEnd = this.currentNodeId ?? undefined;
    } else {
      branch.ifBranchEnd = this.currentNodeId ?? undefined;
    }

    // Create merge node
    const mergeNodeId = this.generateNodeId("merge");
    const mergeNode = this.createNode(mergeNodeId, "decision", async () => ({}));
    this.addNode(mergeNode);

    // Add conditional edges from decision node
    if (branch.ifBranchStart) {
      this.addEdge(branch.decisionNodeId, branch.ifBranchStart, branch.condition, "if-true");
    }

    if (branch.elseBranchStart) {
      this.addEdge(
        branch.decisionNodeId,
        branch.elseBranchStart,
        (state) => !branch.condition(state),
        "if-false"
      );
    } else {
      // No else branch - connect decision directly to merge when condition is false
      this.addEdge(
        branch.decisionNodeId,
        mergeNodeId,
        (state) => !branch.condition(state),
        "if-false"
      );
    }

    // Connect branch ends to merge node
    if (branch.ifBranchEnd) {
      this.addEdge(branch.ifBranchEnd, mergeNodeId);
    }

    if (branch.elseBranchEnd) {
      this.addEdge(branch.elseBranchEnd, mergeNodeId);
    }

    this.currentNodeId = mergeNodeId;

    return this;
  }

  /**
   * Add parallel execution of multiple branches.
   *
   * @param config - Parallel execution configuration
   * @returns this for chaining
   */
  parallel(config: ParallelConfig<TState>): this {
    const parallelNodeId = this.generateNodeId("parallel");

    const parallelNode = this.createNode(parallelNodeId, "parallel", async (ctx) => {
      // Parallel execution is handled by the execution engine
      // This just marks the node for parallel processing
      return {
        stateUpdate: {
          outputs: {
            ...ctx.state.outputs,
            [parallelNodeId]: {
              branches: config.branches,
              strategy: config.strategy ?? "all",
            },
          },
        } as Partial<TState>,
      };
    });

    this.addNode(parallelNode);

    if (this.currentNodeId !== null) {
      this.addEdge(this.currentNodeId, parallelNodeId);
    } else if (this.startNodeId === null) {
      this.startNodeId = parallelNodeId;
    }

    // Add edges to all branches
    for (const branchId of config.branches) {
      this.addEdge(parallelNodeId, branchId, undefined, `parallel-${branchId}`);
    }

    this.currentNodeId = parallelNodeId;

    return this;
  }

  /**
   * Add a loop construct.
   *
   * The loop body can be a single node or an array of nodes that execute
   * sequentially within each iteration. When the loop continues, execution
   * returns to the first node in the body.
   *
   * @param bodyNodes - The node(s) to execute in each iteration
   * @param config - Loop configuration with exit condition
   * @returns this for chaining
   *
   * @example
   * ```typescript
   * // Single node loop
   * builder.loop(processNode, { until: (s) => s.done });
   *
   * // Multi-node loop (e.g., clear context then process)
   * builder.loop([clearContextNode, processNode], { until: (s) => s.done });
   * ```
   */
  loop(
    bodyNodes: NodeDefinition<TState> | NodeDefinition<TState>[],
    config: LoopConfig<TState>
  ): this {
    // Normalize to array
    const bodyNodeArray = Array.isArray(bodyNodes) ? bodyNodes : [bodyNodes];

    if (bodyNodeArray.length === 0) {
      throw new Error("Loop body must contain at least one node");
    }

    const loopStartId = this.generateNodeId("loop_start");
    const loopCheckId = this.generateNodeId("loop_check");
    const maxIterations = config.maxIterations ?? 100;

    // Loop start node - initializes iteration counter
    const loopStartNode = this.createNode(loopStartId, "decision", async (ctx) => {
      const iterationKey = `${loopStartId}_iteration`;
      const currentIteration = (ctx.state.outputs[iterationKey] as number) ?? 0;

      return {
        stateUpdate: {
          outputs: {
            ...ctx.state.outputs,
            [iterationKey]: currentIteration,
          },
        } as Partial<TState>,
      };
    });

    // Loop check node - evaluates exit condition
    const loopCheckNode = this.createNode(loopCheckId, "decision", async (ctx) => {
      const iterationKey = `${loopStartId}_iteration`;
      const currentIteration = (ctx.state.outputs[iterationKey] as number) ?? 0;

      // Increment iteration
      return {
        stateUpdate: {
          outputs: {
            ...ctx.state.outputs,
            [iterationKey]: currentIteration + 1,
          },
        } as Partial<TState>,
      };
    });

    // Add all nodes to the graph
    this.addNode(loopStartNode);
    for (const node of bodyNodeArray) {
      this.addNode(node);
    }
    this.addNode(loopCheckNode);

    // Connect current to loop start
    if (this.currentNodeId !== null) {
      this.addEdge(this.currentNodeId, loopStartId);
    } else if (this.startNodeId === null) {
      this.startNodeId = loopStartId;
    }

    // Get first and last body nodes
    const firstBodyNode = bodyNodeArray[0]!;
    const lastBodyNode = bodyNodeArray[bodyNodeArray.length - 1]!;

    // Chain body nodes together: node1 -> node2 -> ... -> nodeN
    for (let i = 0; i < bodyNodeArray.length - 1; i++) {
      this.addEdge(bodyNodeArray[i]!.id, bodyNodeArray[i + 1]!.id);
    }

    // Loop structure: start -> first body -> ... -> last body -> check -> (continue to first body OR exit)
    this.addEdge(loopStartId, firstBodyNode.id);
    this.addEdge(lastBodyNode.id, loopCheckId);

    // Continue loop if condition not met and under max iterations
    // Return to the FIRST body node when continuing
    this.addEdge(
      loopCheckId,
      firstBodyNode.id,
      (state) => {
        const iterationKey = `${loopStartId}_iteration`;
        const currentIteration = (state.outputs[iterationKey] as number) ?? 0;
        return !config.until(state) && currentIteration < maxIterations;
      },
      "loop-continue"
    );

    // The exit edge will be added by the next then() or end()
    this.currentNodeId = loopCheckId;

    return this;
  }

  /**
   * Add a wait node for human-in-the-loop interaction.
   *
   * @param promptOrNode - Either a string prompt or a full node definition
   * @returns this for chaining
   */
  wait(promptOrNode: string | NodeDefinition<TState>): this {
    let waitNode: NodeDefinition<TState>;

    if (typeof promptOrNode === "string") {
      const waitNodeId = this.generateNodeId("wait");
      waitNode = this.createNode(waitNodeId, "wait", async () => {
        return {
          signals: [
            {
              type: "human_input_required",
              message: promptOrNode,
            },
          ],
        };
      });
    } else {
      waitNode = promptOrNode;
    }

    return this.then(waitNode);
  }

  /**
   * Set an error handler node.
   *
   * @param handler - The error handler node
   * @returns this for chaining
   */
  catch(handler: NodeDefinition<TState>): this {
    this.addNode(handler);
    this.errorHandlerId = handler.id;

    return this;
  }

  /**
   * Mark the current node as a terminal node.
   *
   * @returns this for chaining
   */
  end(): this {
    if (this.currentNodeId !== null) {
      this.endNodeIds.add(this.currentNodeId);
    }

    return this;
  }

  /**
   * Compile the graph into a CompiledGraph ready for execution.
   *
   * @param config - Optional graph configuration
   * @returns The compiled graph
   */
  compile(config: GraphConfig<TState> = {}): CompiledGraph<TState> {
    if (this.startNodeId === null) {
      throw new Error("Cannot compile graph without a start node");
    }

    // If no explicit end nodes, find nodes with no outgoing edges
    if (this.endNodeIds.size === 0) {
      const nodesWithOutgoing = new Set(this.edges.map((e) => e.from));
      for (const nodeId of this.nodes.keys()) {
        if (!nodesWithOutgoing.has(nodeId)) {
          this.endNodeIds.add(nodeId);
        }
      }
    }

    // If error handler is set, add edges from all non-handler nodes
    if (this.errorHandlerId !== null) {
      // The execution engine will handle error routing
      // We just mark the handler in metadata
      config = {
        ...config,
        metadata: {
          ...config.metadata,
          errorHandlerId: this.errorHandlerId,
        },
      };
    }

    return {
      nodes: new Map(this.nodes),
      edges: [...this.edges],
      startNode: this.startNodeId,
      endNodes: new Set(this.endNodeIds),
      config,
    };
  }

  /**
   * Get a node by ID.
   *
   * @param nodeId - The node ID
   * @returns The node definition or undefined
   */
  getNode(nodeId: NodeId): NodeDefinition<TState> | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Get all edges from a node.
   *
   * @param nodeId - The source node ID
   * @returns Array of edges from this node
   */
  getEdgesFrom(nodeId: NodeId): Edge<TState>[] {
    return this.edges.filter((e) => e.from === nodeId);
  }

  /**
   * Get all edges to a node.
   *
   * @param nodeId - The target node ID
   * @returns Array of edges to this node
   */
  getEdgesTo(nodeId: NodeId): Edge<TState>[] {
    return this.edges.filter((e) => e.to === nodeId);
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new graph builder instance.
 *
 * @returns A new GraphBuilder instance
 *
 * @example
 * ```typescript
 * const workflow = graph<MyState>()
 *   .start(startNode)
 *   .then(processNode)
 *   .end()
 *   .compile();
 * ```
 */
export function graph<TState extends BaseState = BaseState>(): GraphBuilder<TState> {
  return new GraphBuilder<TState>();
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a simple node definition.
 *
 * @param id - Node ID
 * @param type - Node type
 * @param execute - Execution function
 * @param options - Optional name, description, retry config
 * @returns A NodeDefinition
 */
export function createNode<TState extends BaseState = BaseState>(
  id: NodeId,
  type: NodeType,
  execute: NodeExecuteFn<TState>,
  options?: {
    name?: string;
    description?: string;
    retry?: RetryConfig;
  }
): NodeDefinition<TState> {
  return {
    id,
    type,
    execute,
    ...options,
  };
}

/**
 * Create a decision node that routes based on a condition.
 *
 * @param id - Node ID
 * @param routes - Map of condition functions to target node IDs
 * @param fallback - Default node ID if no condition matches
 * @returns A NodeDefinition
 */
export function createDecisionNode<TState extends BaseState = BaseState>(
  id: NodeId,
  routes: Array<{ condition: EdgeCondition<TState>; target: NodeId }>,
  fallback: NodeId
): NodeDefinition<TState> {
  return {
    id,
    type: "decision",
    execute: async (ctx) => {
      for (const route of routes) {
        if (route.condition(ctx.state)) {
          return { goto: route.target };
        }
      }
      return { goto: fallback };
    },
  };
}

/**
 * Create a wait node that pauses for human input.
 *
 * @param id - Node ID
 * @param prompt - Message to display to the user
 * @returns A NodeDefinition
 */
export function createWaitNode<TState extends BaseState = BaseState>(
  id: NodeId,
  prompt: string
): NodeDefinition<TState> {
  return {
    id,
    type: "wait",
    execute: async () => ({
      signals: [
        {
          type: "human_input_required",
          message: prompt,
        },
      ],
    }),
  };
}
