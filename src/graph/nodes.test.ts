import { describe, expect, test } from "bun:test";
import {
  agentNode,
  askUserNode,
  clearContextNode,
  contextMonitorNode,
  criteriaLoopNode,
  customToolNode,
  decisionNode,
  parallelNode,
  parallelSubagentNode,
  subagentNode,
  subgraphNode,
  taskLoopNode,
  toolNode,
  waitNode,
  type AskUserWaitState,
  type ContextMonitoringState,
  type TaskLoopState,
} from "./nodes.ts";
import type { BaseState, NodeDefinition } from "./types.ts";

interface BasicState extends BaseState {
  marker?: string;
}

interface AskState extends BaseState, AskUserWaitState {}

interface MonitorState extends ContextMonitoringState {}

interface LoopState extends TaskLoopState {}

const PHASE_NAME = "Test Phase";
const PHASE_ICON = "T";

function expectPhaseMetadata(node: { phaseName?: string; phaseIcon?: string }): void {
  expect(node.phaseName).toBe(PHASE_NAME);
  expect(node.phaseIcon).toBe(PHASE_ICON);
}

describe("node factories - phase metadata", () => {
  test("propagates phaseName and phaseIcon from config to node definition", () => {
    const loopBodyNode: NodeDefinition<LoopState> = {
      id: "loop-body",
      type: "tool",
      execute: async () => ({ stateUpdate: {} }),
    };

    const nodes = [
      agentNode<BasicState>({
        id: "agent-node",
        agentType: "claude",
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      toolNode<BasicState, { value: string }, string>({
        id: "tool-node",
        toolName: "echo",
        execute: async (args) => args.value,
        args: { value: "ok" },
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      clearContextNode<BasicState>({
        id: "clear-context-node",
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      decisionNode<BasicState>({
        id: "decision-node",
        routes: [],
        fallback: "fallback-node",
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      waitNode<BasicState>({
        id: "wait-node",
        prompt: "Continue?",
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      askUserNode<AskState>({
        id: "ask-user-node",
        options: { question: "Proceed?" },
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      parallelNode<BasicState>({
        id: "parallel-node",
        branches: ["branch-a"],
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      subgraphNode<BasicState, BasicState>({
        id: "subgraph-node",
        subgraph: {
          execute: async (state) => state,
        },
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      contextMonitorNode<MonitorState>({
        id: "context-monitor-node",
        agentType: "claude",
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      customToolNode<BasicState>({
        id: "custom-tool-node",
        toolName: "custom.echo",
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      subagentNode<BasicState>({
        id: "subagent-node",
        agentName: "worker",
        task: "noop",
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      parallelSubagentNode<BasicState>({
        id: "parallel-subagent-node",
        agents: [{ agentName: "worker", task: "noop" }],
        merge: () => ({}),
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      taskLoopNode<LoopState>({
        id: "task-loop-node",
        taskNodes: loopBodyNode,
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
      criteriaLoopNode<BasicState>({
        id: "criteria-loop-node",
        taskNodes: [
          {
            id: "criteria-loop-body",
            type: "tool",
            execute: async () => ({ stateUpdate: {} }),
          },
        ],
        phaseName: PHASE_NAME,
        phaseIcon: PHASE_ICON,
      }),
    ];

    for (const node of nodes) {
      expectPhaseMetadata(node);
    }
  });
});
