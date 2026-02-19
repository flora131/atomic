/**
 * Test: Multiple task tool calls should create separate AgentParts
 *
 * Verifies the fix for the bug where sub-agent trees from different task tool calls
 * were overwriting each other. Each task tool call should have its own AgentPart
 * linked via parentToolPartId.
 */

import { describe, it, expect } from "bun:test";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import type { Part, AgentPart, ToolPart } from "./types.ts";
import { createPartId } from "./id.ts";

/**
 * Helper to create a ToolPart with a specific toolCallId
 */
function createToolPart(toolCallId: string, toolName: string): ToolPart {
  return {
    id: createPartId(),
    type: "tool",
    toolCallId,
    toolName,
    input: { prompt: "test" },
    state: { status: "running", startedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
  };
}

/**
 * Helper to create a ParallelAgent with taskToolCallId
 */
function createParallelAgent(taskToolCallId: string, agentName: string): ParallelAgent {
  return {
    id: `agent-${taskToolCallId}`,
    taskToolCallId,
    name: agentName,
    task: `Task for ${agentName}`,
    status: "running",
    startedAt: new Date().toISOString(),
  };
}

/**
 * Simulates the logic in chat.tsx for grouping agents by tool call and creating AgentParts.
 * This is the FIXED implementation that properly scopes AgentParts to tool calls.
 */
function createAgentPartsForMessage(
  parts: Part[],
  parallelAgents: ParallelAgent[],
  messageId: string,
  groupIntoSingleTree: boolean = false,
): Part[] {
  if (parallelAgents.length === 0) return parts;

  if (groupIntoSingleTree) {
    const nonAgentParts = parts.filter((p) => p.type !== "agent");
    return [
      ...nonAgentParts,
      {
        id: `agent-${messageId}-grouped`,
        type: "agent",
        agents: parallelAgents,
        parentToolPartId: undefined,
        createdAt: new Date().toISOString(),
      } satisfies AgentPart,
    ];
  }

  const updatedParts = parts.filter(
    (p) => !(p.type === "agent" && (p as AgentPart).id === `agent-${messageId}-grouped`)
  );

  // Group agents by their parent tool call to create separate AgentParts per tool
  const agentsByToolCall = new Map<string | undefined, ParallelAgent[]>();
  for (const agent of parallelAgents) {
    const toolCallId = agent.taskToolCallId;
    if (!agentsByToolCall.has(toolCallId)) {
      agentsByToolCall.set(toolCallId, []);
    }
    agentsByToolCall.get(toolCallId)!.push(agent);
  }

  // Create/update an AgentPart for each tool call
  for (const [toolCallId, agents] of agentsByToolCall) {
    // Find the ToolPart ID for this tool call
    let parentToolPartId: string | undefined = undefined;
    if (toolCallId) {
      const toolPart = updatedParts.find(
        (p) => p.type === "tool" && (p as ToolPart).toolCallId === toolCallId
      ) as ToolPart | undefined;
      parentToolPartId = toolPart?.id;
    }

    // Find existing AgentPart for this tool call or create new one
    const existingAgentIdx = updatedParts.findIndex(
      (p) => p.type === "agent" && (p as AgentPart).parentToolPartId === parentToolPartId
    );
    
    if (existingAgentIdx >= 0) {
      updatedParts[existingAgentIdx] = {
        ...(updatedParts[existingAgentIdx] as AgentPart),
        agents,
        parentToolPartId,
      };
    } else {
      updatedParts.push({
        id: `agent-${messageId}${toolCallId ? `-${toolCallId}` : ""}`,
        type: "agent",
        agents,
        parentToolPartId,
        createdAt: new Date().toISOString(),
      } satisfies AgentPart);
    }
  }
  
  return updatedParts;
}

describe("Multiple task tool calls - AgentPart scoping", () => {
  it("should create separate AgentParts for different task tool calls", () => {
    const messageId = "msg-123";
    
    // Create two ToolParts for two task tool calls
    const tool1 = createToolPart("tool-1", "task");
    const tool2 = createToolPart("tool-2", "task");
    
    let parts: Part[] = [tool1, tool2];
    
    // First tool spawns agents
    const agents1 = [
      createParallelAgent("tool-1", "codebase-locator"),
    ];
    
    parts = createAgentPartsForMessage(parts, agents1, messageId);
    
    // Should have 3 parts: 2 tools + 1 agent
    expect(parts.length).toBe(3);
    
    const agentPart1 = parts[2] as AgentPart;
    expect(agentPart1.type).toBe("agent");
    expect(agentPart1.parentToolPartId).toBe(tool1.id);
    expect(agentPart1.agents.length).toBe(1);
    expect(agentPart1.agents[0]!.name).toBe("codebase-locator");
    
    // Second tool spawns different agents
    const agents2 = [
      createParallelAgent("tool-2", "codebase-analyzer"),
    ];
    
    parts = createAgentPartsForMessage(parts, agents2, messageId);
    
    // Should have 4 parts: 2 tools + 2 agents
    expect(parts.length).toBe(4);
    
    const agentPart2 = parts[3] as AgentPart;
    expect(agentPart2.type).toBe("agent");
    expect(agentPart2.parentToolPartId).toBe(tool2.id);
    expect(agentPart2.agents.length).toBe(1);
    expect(agentPart2.agents[0]!.name).toBe("codebase-analyzer");
    
    // CRITICAL: First AgentPart should NOT be overwritten
    const stillAgentPart1 = parts[2] as AgentPart;
    expect(stillAgentPart1.type).toBe("agent");
    expect(stillAgentPart1.parentToolPartId).toBe(tool1.id);
    expect(stillAgentPart1.agents.length).toBe(1);
    expect(stillAgentPart1.agents[0]!.name).toBe("codebase-locator"); // Not "codebase-analyzer"!
  });

  it("should update the correct AgentPart when agents for a tool call change", () => {
    const messageId = "msg-456";
    
    const tool1 = createToolPart("tool-1", "task");
    const tool2 = createToolPart("tool-2", "task");
    
    let parts: Part[] = [tool1, tool2];
    
    // Both tools spawn agents
    const agents1 = [createParallelAgent("tool-1", "codebase-locator")];
    const agents2 = [createParallelAgent("tool-2", "codebase-analyzer")];
    
    parts = createAgentPartsForMessage(parts, agents1, messageId);
    parts = createAgentPartsForMessage(parts, agents2, messageId);
    
    expect(parts.length).toBe(4); // 2 tools + 2 agents
    
    // Update tool-1's agents (add a new agent)
    const updatedAgents1 = [
      ...agents1,
      createParallelAgent("tool-1", "debugger"),
    ];
    
    parts = createAgentPartsForMessage(parts, updatedAgents1, messageId);
    
    // Should still have 4 parts (update in place)
    expect(parts.length).toBe(4);
    
    // Find AgentPart for tool-1
    const agentPart1 = parts.find(
      (p) => p.type === "agent" && (p as AgentPart).parentToolPartId === tool1.id
    ) as AgentPart;
    
    expect(agentPart1).toBeDefined();
    expect(agentPart1.agents.length).toBe(2);
    expect(agentPart1.agents.map(a => a.name)).toEqual(["codebase-locator", "debugger"]);
    
    // AgentPart for tool-2 should be unchanged
    const agentPart2 = parts.find(
      (p) => p.type === "agent" && (p as AgentPart).parentToolPartId === tool2.id
    ) as AgentPart;
    
    expect(agentPart2).toBeDefined();
    expect(agentPart2.agents.length).toBe(1);
    expect(agentPart2.agents[0]!.name).toBe("codebase-analyzer");
  });

  it("should handle agents without taskToolCallId (legacy behavior)", () => {
    const messageId = "msg-789";
    
    const tool1 = createToolPart("tool-1", "task");
    let parts: Part[] = [tool1];
    
    // Agent without taskToolCallId
    const agent: ParallelAgent = {
      id: "agent-1",
      name: "general-purpose",
      task: "General task",
      status: "running",
      startedAt: new Date().toISOString(),
      // No taskToolCallId
    };
    
    parts = createAgentPartsForMessage(parts, [agent], messageId);
    
    expect(parts.length).toBe(2);
    
    const agentPart = parts[1] as AgentPart;
    expect(agentPart.type).toBe("agent");
    expect(agentPart.parentToolPartId).toBeUndefined();
    expect(agentPart.agents.length).toBe(1);
    expect(agentPart.agents[0]!.name).toBe("general-purpose");
  });

  it("should group agents by tool call correctly", () => {
    const messageId = "msg-mixed";
    
    const tool1 = createToolPart("tool-1", "task");
    const tool2 = createToolPart("tool-2", "task");
    
    let parts: Part[] = [tool1, tool2];
    
    // Mixed agents for both tools in one batch
    const mixedAgents = [
      createParallelAgent("tool-1", "codebase-locator"),
      createParallelAgent("tool-2", "codebase-analyzer"),
      createParallelAgent("tool-1", "debugger"), // Another for tool-1
    ];
    
    parts = createAgentPartsForMessage(parts, mixedAgents, messageId);
    
    expect(parts.length).toBe(4); // 2 tools + 2 agents
    
    // Check tool-1's AgentPart
    const agentPart1 = parts.find(
      (p) => p.type === "agent" && (p as AgentPart).parentToolPartId === tool1.id
    ) as AgentPart;
    
    expect(agentPart1).toBeDefined();
    expect(agentPart1.agents.length).toBe(2);
    expect(agentPart1.agents.map(a => a.name).sort()).toEqual(["codebase-locator", "debugger"].sort());
    
    // Check tool-2's AgentPart
    const agentPart2 = parts.find(
      (p) => p.type === "agent" && (p as AgentPart).parentToolPartId === tool2.id
    ) as AgentPart;
    
    expect(agentPart2).toBeDefined();
    expect(agentPart2.agents.length).toBe(1);
    expect(agentPart2.agents[0]!.name).toBe("codebase-analyzer");
  });

  it("preserves chronological tool-call order when multiple groups are inserted together", () => {
    const messageId = "msg-batch-order";
    const tool1 = createToolPart("tool-1", "task");
    const tool2 = createToolPart("tool-2", "task");

    const parts = createAgentPartsForMessage(
      [tool1, tool2],
      [
        createParallelAgent("tool-1", "a1"),
        createParallelAgent("tool-2", "b1"),
      ],
      messageId,
    );

    const agentParts = parts.filter((p) => p.type === "agent") as AgentPart[];
    expect(agentParts.length).toBe(2);
    expect(agentParts[0]!.parentToolPartId).toBe(tool1.id);
    expect(agentParts[1]!.parentToolPartId).toBe(tool2.id);
  });

  it("should maintain chronological order of parts", () => {
    const messageId = "msg-order";
    
    const tool1 = createToolPart("tool-1", "task");
    const tool2 = createToolPart("tool-2", "task");
    
    let parts: Part[] = [tool1, tool2];
    
    // Add agents in sequence
    parts = createAgentPartsForMessage(parts, [createParallelAgent("tool-1", "agent1")], messageId);
    parts = createAgentPartsForMessage(parts, [createParallelAgent("tool-2", "agent2")], messageId);
    
    // Order should be: tool1, tool2, agent1, agent2
    expect(parts.length).toBe(4);
    expect(parts[0]!.type).toBe("tool");
    expect((parts[0] as ToolPart).toolCallId).toBe("tool-1");
    expect(parts[1]!.type).toBe("tool");
    expect((parts[1] as ToolPart).toolCallId).toBe("tool-2");
    expect(parts[2]!.type).toBe("agent");
    expect((parts[2] as AgentPart).parentToolPartId).toBe(tool1.id);
    expect(parts[3]!.type).toBe("agent");
    expect((parts[3] as AgentPart).parentToolPartId).toBe(tool2.id);
  });

  it("should group all subagents into one AgentPart in grouped mode", () => {
    const messageId = "msg-grouped";

    const tool1 = createToolPart("tool-1", "task");
    const tool2 = createToolPart("tool-2", "task");
    const parts: Part[] = [tool1, tool2];

    const grouped = createAgentPartsForMessage(
      parts,
      [
        createParallelAgent("tool-1", "agent1"),
        createParallelAgent("tool-2", "agent2"),
        createParallelAgent("tool-1", "agent3"),
      ],
      messageId,
      true,
    );

    expect(grouped.length).toBe(3);
    const groupedPart = grouped.find((p) => p.type === "agent") as AgentPart;
    expect(groupedPart.parentToolPartId).toBeUndefined();
    expect(groupedPart.agents.length).toBe(3);
  });

  it("should remove grouped AgentPart when switching back to split mode", () => {
    const messageId = "msg-split-after-group";

    const tool1 = createToolPart("tool-1", "task");
    const tool2 = createToolPart("tool-2", "task");
    const agents = [
      createParallelAgent("tool-1", "agent1"),
      createParallelAgent("tool-2", "agent2"),
    ];

    const grouped = createAgentPartsForMessage([tool1, tool2], agents, messageId, true);
    const split = createAgentPartsForMessage(grouped, agents, messageId, false);

    expect(split.length).toBe(4);
    const groupedPart = split.find(
      (p) => p.type === "agent" && (p as AgentPart).parentToolPartId === undefined
    );
    expect(groupedPart).toBeUndefined();
  });
});
