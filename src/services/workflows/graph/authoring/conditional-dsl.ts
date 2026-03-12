import type {
  BaseState,
  EdgeCondition,
  NodeDefinition,
} from "@/services/workflows/graph/types.ts";
import { createNoopDecisionNode } from "@/services/workflows/graph/authoring/node-factories.ts";
import type {
  AuthoringGraphOps,
  ConditionalDslState,
  IfConfig,
} from "@/services/workflows/graph/authoring/types.ts";

export interface ConditionalConfigOps<TState extends BaseState> {
  beginConditional(condition: EdgeCondition<TState>): void;
  appendNode(node: NodeDefinition<TState>): void;
  appendPassThroughNode(): void;
  openElseBranch(): void;
  closeConditional(): void;
}

export function beginConditionalBranch<TState extends BaseState>(
  state: ConditionalDslState<TState>,
  ops: AuthoringGraphOps<TState>,
  condition: EdgeCondition<TState>,
): void {
  if (state.currentNodeId === null) {
    throw new Error("Cannot use if() without a preceding node. Use start() first.");
  }

  const decisionNodeId = ops.generateNodeId("decision");
  ops.addNode(createNoopDecisionNode<TState>(decisionNodeId));
  ops.addEdge(state.currentNodeId, decisionNodeId);

  state.conditionalStack.push({
    decisionNodeId,
    condition,
    inElseBranch: false,
  });
  state.currentNodeId = null;
}

export function applyIfConfig<TState extends BaseState>(
  config: IfConfig<TState>,
  ops: ConditionalConfigOps<TState>,
): void {
  ops.beginConditional(config.condition);

  for (const node of config.then) {
    ops.appendNode(node);
  }

  if (config.else_if && config.else_if.length > 0) {
    ops.openElseBranch();

    for (let i = 0; i < config.else_if.length; i++) {
      const elseIf = config.else_if[i];
      if (!elseIf) {
        continue;
      }

      ops.appendPassThroughNode();
      ops.beginConditional(elseIf.condition);

      for (const node of elseIf.then) {
        ops.appendNode(node);
      }

      const hasMore =
        i < config.else_if.length - 1 ||
        (config.else && config.else.length > 0);

      if (hasMore) {
        ops.openElseBranch();
      }
    }

    if (config.else && config.else.length > 0) {
      for (const node of config.else) {
        ops.appendNode(node);
      }
    }

    for (let i = 0; i < config.else_if.length; i++) {
      ops.closeConditional();
    }
  } else if (config.else && config.else.length > 0) {
    ops.openElseBranch();
    for (const node of config.else) {
      ops.appendNode(node);
    }
  }

  ops.closeConditional();
}

export function beginElseBranch<TState extends BaseState>(
  state: ConditionalDslState<TState>,
): void {
  const currentBranch =
    state.conditionalStack[state.conditionalStack.length - 1];

  if (!currentBranch) {
    throw new Error("Cannot use else() without a preceding if()");
  }

  if (currentBranch.inElseBranch) {
    throw new Error("Already in else branch. Use endif() to close.");
  }

  currentBranch.ifBranchEnd = state.currentNodeId ?? undefined;
  currentBranch.inElseBranch = true;
  state.currentNodeId = null;
}

export function closeConditionalBranch<TState extends BaseState>(
  state: ConditionalDslState<TState>,
  ops: AuthoringGraphOps<TState>,
): void {
  const branch = state.conditionalStack.pop();

  if (!branch) {
    throw new Error("Cannot use endif() without a preceding if()");
  }

  if (branch.inElseBranch) {
    branch.elseBranchEnd = state.currentNodeId ?? undefined;
  } else {
    branch.ifBranchEnd = state.currentNodeId ?? undefined;
  }

  const mergeNodeId = ops.generateNodeId("merge");
  ops.addNode(createNoopDecisionNode<TState>(mergeNodeId));

  if (branch.ifBranchStart) {
    ops.addEdge(branch.decisionNodeId, branch.ifBranchStart, branch.condition, "if-true");
  }

  if (branch.elseBranchStart) {
    ops.addEdge(
      branch.decisionNodeId,
      branch.elseBranchStart,
      (graphState) => !branch.condition(graphState),
      "if-false",
    );
  } else {
    ops.addEdge(
      branch.decisionNodeId,
      mergeNodeId,
      (graphState) => !branch.condition(graphState),
      "if-false",
    );
  }

  if (branch.ifBranchEnd) {
    ops.addEdge(branch.ifBranchEnd, mergeNodeId);
  }

  if (branch.elseBranchEnd) {
    ops.addEdge(branch.elseBranchEnd, mergeNodeId);
  }

  state.currentNodeId = mergeNodeId;
}
