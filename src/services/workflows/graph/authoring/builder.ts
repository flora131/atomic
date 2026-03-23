/**
 * Graph Builder for Workflow Definition
 *
 * This module provides a fluent API for building graph-based workflows.
 */

import type {
  BaseState,
  CompiledGraph,
  Edge,
  EdgeCondition,
  GraphConfig,
  NodeDefinition,
  NodeId,
} from "@/services/workflows/graph/types.ts";
import {
  applyIfConfig,
  beginConditionalBranch,
  beginElseBranch,
  closeConditionalBranch,
} from "@/services/workflows/graph/authoring/conditional-dsl.ts";
import {
  buildToolBuilderNode,
  buildWaitBuilderNode,
} from "@/services/workflows/graph/authoring/node-adapters.ts";
import {
  createNoopDecisionNode,
} from "@/services/workflows/graph/authoring/node-factories.ts";
import {
  addLoopSegment,
  addParallelSegment,
} from "@/services/workflows/graph/authoring/iteration-dsl.ts";
import type {
  AuthoringGraphOps,
  ConditionalBranch,
  ConditionalDslState,
  IfConfig,
  IterationDslState,
  LoopConfig,
  ParallelConfig,
  ToolBuilderConfig,
} from "@/services/workflows/graph/authoring/types.ts";

export type {
  IfConfig,
  LoopConfig,
  MergeStrategy,
  ParallelConfig,
  ToolBuilderConfig,
} from "@/services/workflows/graph/authoring/types.ts";
export {
  createDecisionNode,
  createNode,
  createWaitNode,
} from "@/services/workflows/graph/authoring/node-factories.ts";

export class GraphBuilder<TState extends BaseState = BaseState> {
  private nodes: Map<NodeId, NodeDefinition<TState>> = new Map();
  private edges: Edge<TState>[] = [];
  private startNodeId: NodeId | null = null;
  private endNodeIds: Set<NodeId> = new Set();
  private currentNodeId: NodeId | null = null;
  private conditionalStack: ConditionalBranch<TState>[] = [];
  private nodeCounter = 0;
  private pendingEdgeCondition?: EdgeCondition<TState>;
  private pendingEdgeLabel?: string;
  private errorHandlerId: NodeId | null = null;

  private generateNodeId(prefix: string = "node"): NodeId {
    return `${prefix}_${++this.nodeCounter}`;
  }

  private addNode(node: NodeDefinition<TState>): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node with ID "${node.id}" already exists`);
    }

    this.nodes.set(node.id, node);
  }

  private addEdge(
    from: NodeId,
    to: NodeId,
    condition?: EdgeCondition<TState>,
    label?: string,
  ): void {
    this.edges.push({ from, to, condition, label });
  }

  private get graphOps(): AuthoringGraphOps<TState> {
    return {
      addNode: (node) => {
        this.addNode(node);
      },
      addEdge: (from, to, condition, label) => {
        this.addEdge(from, to, condition, label);
      },
      generateNodeId: (prefix) => this.generateNodeId(prefix),
    };
  }

  private getConditionalDslState(): ConditionalDslState<TState> {
    const getBuilder = (): GraphBuilder<TState> => this;

    return {
      get currentNodeId() {
        return getBuilder().currentNodeId;
      },
      set currentNodeId(value: NodeId | null) {
        getBuilder().currentNodeId = value;
      },
      conditionalStack: getBuilder().conditionalStack,
    };
  }

  private getIterationDslState(): IterationDslState<TState> {
    const getBuilder = (): GraphBuilder<TState> => this;

    return {
      get startNodeId() {
        return getBuilder().startNodeId;
      },
      set startNodeId(value: NodeId | null) {
        getBuilder().startNodeId = value;
      },
      get currentNodeId() {
        return getBuilder().currentNodeId;
      },
      set currentNodeId(value: NodeId | null) {
        getBuilder().currentNodeId = value;
      },
      get pendingEdgeCondition() {
        return getBuilder().pendingEdgeCondition;
      },
      set pendingEdgeCondition(value: EdgeCondition<TState> | undefined) {
        getBuilder().pendingEdgeCondition = value;
      },
      get pendingEdgeLabel() {
        return getBuilder().pendingEdgeLabel;
      },
      set pendingEdgeLabel(value: string | undefined) {
        getBuilder().pendingEdgeLabel = value;
      },
    };
  }

  start(node: NodeDefinition<TState>): this {
    if (this.startNodeId !== null) {
      throw new Error("Start node already set. Use then() to add more nodes.");
    }

    this.addNode(node);
    this.startNodeId = node.id;
    this.currentNodeId = node.id;

    return this;
  }

  // oxlint-disable-next-line unicorn/no-thenable -- Intentional fluent API design
  then(node: NodeDefinition<TState>): this {
    if (this.startNodeId === null) {
      return this.start(node);
    }

    this.addNode(node);

    const currentBranch =
      this.conditionalStack[this.conditionalStack.length - 1];

    if (currentBranch && this.currentNodeId === null) {
      if (!currentBranch.inElseBranch && !currentBranch.ifBranchStart) {
        currentBranch.ifBranchStart = node.id;
      } else if (
        currentBranch.inElseBranch &&
        !currentBranch.elseBranchStart
      ) {
        currentBranch.elseBranchStart = node.id;
      }
    } else if (this.currentNodeId !== null) {
      this.addEdge(
        this.currentNodeId,
        node.id,
        this.pendingEdgeCondition,
        this.pendingEdgeLabel,
      );
      this.pendingEdgeCondition = undefined;
      this.pendingEdgeLabel = undefined;
    }

    this.currentNodeId = node.id;

    return this;
  }

  if(condition: EdgeCondition<TState>): this;
  if(config: IfConfig<TState>): this;
  if(conditionOrConfig: EdgeCondition<TState> | IfConfig<TState>): this {
    if (typeof conditionOrConfig === "function") {
      const conditionalState = this.getConditionalDslState();
      beginConditionalBranch(
        conditionalState,
        this.graphOps,
        conditionOrConfig,
      );
      return this;
    }

    const conditionalState = this.getConditionalDslState();
    applyIfConfig(conditionOrConfig, {
      beginConditional: (condition) => {
        beginConditionalBranch(conditionalState, this.graphOps, condition);
      },
      appendNode: (node) => {
        this.then(node);
      },
      appendPassThroughNode: () => {
        this.then(createNoopDecisionNode<TState>(this.generateNodeId("pass")));
      },
      openElseBranch: () => {
        beginElseBranch(conditionalState);
      },
      closeConditional: () => {
        closeConditionalBranch(conditionalState, this.graphOps);
      },
    });

    return this;
  }

  else(): this {
    beginElseBranch(this.getConditionalDslState());
    return this;
  }

  endif(): this {
    closeConditionalBranch(this.getConditionalDslState(), this.graphOps);
    return this;
  }

  parallel(config: ParallelConfig<TState>): this {
    addParallelSegment(this.getIterationDslState(), this.graphOps, config);
    return this;
  }

  loop(
    bodyNodes: NodeDefinition<TState> | NodeDefinition<TState>[],
    config: LoopConfig<TState>,
  ): this {
    addLoopSegment(this.getIterationDslState(), this.graphOps, bodyNodes, config);
    return this;
  }

  wait(promptOrNode: string | NodeDefinition<TState>): this {
    const waitNode =
      typeof promptOrNode === "string"
        ? buildWaitBuilderNode<TState>(
            this.generateNodeId("wait"),
            promptOrNode,
          )
        : promptOrNode;

    return this.then(waitNode);
  }

  tool<TArgs = unknown, TResult = unknown>(
    config: ToolBuilderConfig<TState, TArgs, TResult>,
  ): this {
    return this.then(buildToolBuilderNode(config));
  }

  catch(handler: NodeDefinition<TState>): this {
    this.addNode(handler);
    this.errorHandlerId = handler.id;

    return this;
  }

  end(): this {
    if (this.currentNodeId !== null) {
      this.endNodeIds.add(this.currentNodeId);
    }

    return this;
  }

  compile(config: GraphConfig<TState> = {}): CompiledGraph<TState> {
    if (this.startNodeId === null) {
      throw new Error("Cannot compile graph without a start node");
    }

    if (this.endNodeIds.size === 0) {
      const nodesWithOutgoing = new Set(this.edges.map((edge) => edge.from));
      for (const nodeId of this.nodes.keys()) {
        if (!nodesWithOutgoing.has(nodeId)) {
          this.endNodeIds.add(nodeId);
        }
      }
    }

    if (this.errorHandlerId !== null) {
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

  getNode(nodeId: NodeId): NodeDefinition<TState> | undefined {
    return this.nodes.get(nodeId);
  }

  getEdgesFrom(nodeId: NodeId): Edge<TState>[] {
    return this.edges.filter((edge) => edge.from === nodeId);
  }

  getEdgesTo(nodeId: NodeId): Edge<TState>[] {
    return this.edges.filter((edge) => edge.to === nodeId);
  }
}

export function graph<TState extends BaseState = BaseState>(): GraphBuilder<TState> {
  return new GraphBuilder<TState>();
}
