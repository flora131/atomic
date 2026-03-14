import type { ParallelAgent } from "@/types/parallel-agents.ts";
import { createPartId } from "@/state/parts/id.ts";
import type { AgentPart, Part, TextPart, ToolPart } from "@/state/parts/types.ts";
import { isClaudeSyntheticForegroundAgentId } from "@/state/chat/shared/helpers/subagents.ts";
import { isSubagentToolName } from "@/state/streaming/pipeline-tools/shared.ts";
import { normalizeParallelAgents } from "@/state/streaming/pipeline-agents/normalization.ts";

function getAgentInsertIndex(parts: Part[]): number {
  let lastTaskToolIdx = -1;
  let lastToolIdx = -1;

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (!part || part.type !== "tool") {
      continue;
    }
    lastToolIdx = index;
    if (isSubagentToolName((part as ToolPart).toolName)) {
      lastTaskToolIdx = index;
    }
  }

  let insertIndex = parts.length;
  if (lastTaskToolIdx >= 0) {
    insertIndex = lastTaskToolIdx + 1;
  } else if (lastToolIdx >= 0) {
    insertIndex = lastToolIdx + 1;
  }

  while (insertIndex < parts.length && parts[insertIndex]?.type === "agent") {
    insertIndex++;
  }
  return insertIndex;
}

function carryOverInlineParts(
  agents: ParallelAgent[],
  existingInlineParts: Map<string, Part[]>,
): ParallelAgent[] {
  if (existingInlineParts.size === 0) {
    return agents;
  }

  let changed = false;
  const claimedKeys = new Set<string>();
  const result = agents.map((agent) => {
    const existing =
      existingInlineParts.get(agent.id) ??
      (agent.taskToolCallId
        ? existingInlineParts.get(agent.taskToolCallId)
        : undefined);
    if (
      existing &&
      existing.length > 0 &&
      (!agent.inlineParts || agent.inlineParts.length === 0)
    ) {
      changed = true;
      claimedKeys.add(agent.id);
      return { ...agent, inlineParts: existing };
    }

    if (!agent.inlineParts || agent.inlineParts.length === 0) {
      if (!isClaudeSyntheticForegroundAgentId(agent.id)) {
        for (const [key, parts] of existingInlineParts) {
          if (
            isClaudeSyntheticForegroundAgentId(key) &&
            parts.length > 0 &&
            !claimedKeys.has(key)
          ) {
            changed = true;
            claimedKeys.add(key);
            return { ...agent, inlineParts: parts };
          }
        }
      }
    }

    return agent;
  });

  return changed ? result : agents;
}

export function mergeParallelAgentsIntoParts(
  parts: Part[],
  parallelAgents: ParallelAgent[],
  messageTimestamp: string,
): Part[] {
  const normalizedAgents = normalizeParallelAgents(parallelAgents);
  const nonAgentParts = parts.filter((part) => part.type !== "agent");
  const existingAgentParts = parts.filter(
    (part): part is AgentPart => part.type === "agent",
  );

  const existingInlineParts = new Map<string, Part[]>();
  for (const agentPart of existingAgentParts) {
    for (const agent of agentPart.agents) {
      if (agent.inlineParts && agent.inlineParts.length > 0) {
        existingInlineParts.set(agent.id, agent.inlineParts);
        if (agent.taskToolCallId) {
          existingInlineParts.set(agent.taskToolCallId, agent.inlineParts);
        }
      }
    }
  }

  const mergedAgents = carryOverInlineParts(
    normalizedAgents,
    existingInlineParts,
  );
  if (mergedAgents.length === 0) {
    return nonAgentParts;
  }

  const existingByParent = new Map<string | undefined, AgentPart>();
  for (const existing of existingAgentParts) {
    if (!existingByParent.has(existing.parentToolPartId)) {
      existingByParent.set(existing.parentToolPartId, existing);
    }
  }

  const agentsByToolCall = new Map<string | undefined, ParallelAgent[]>();
  for (const agent of mergedAgents) {
    const grouped = agentsByToolCall.get(agent.taskToolCallId) ?? [];
    grouped.push(agent);
    agentsByToolCall.set(agent.taskToolCallId, grouped);
  }

  const finalParts: Part[] = [];
  const handledToolCallIds = new Set<string>();
  let currentGroup: ToolPart[] = [];
  let currentGroupAgents: ParallelAgent[] = [];

  for (let index = 0; index < nonAgentParts.length; index++) {
    const part = nonAgentParts[index];
    if (!part) {
      continue;
    }
    finalParts.push(part);

    if (part.type === "tool" && isSubagentToolName(part.toolName)) {
      const toolPart = part as ToolPart;
      currentGroup.push(toolPart);
      const agents = agentsByToolCall.get(toolPart.toolCallId);
      if (agents) {
        currentGroupAgents.push(...agents);
        if (toolPart.toolCallId) {
          handledToolCallIds.add(toolPart.toolCallId);
        }
      }
    }

    let endsGroup = false;
    if (currentGroup.length > 0) {
      if (index === nonAgentParts.length - 1) {
        endsGroup = true;
      } else {
        const nextPart = nonAgentParts[index + 1];
        if (!nextPart) {
          endsGroup = true;
        } else if (nextPart.type === "tool") {
          if (!isSubagentToolName((nextPart as ToolPart).toolName)) {
            endsGroup = true;
          }
        } else if (nextPart.type === "text") {
          if ((nextPart as TextPart).content.trim().length > 0) {
            endsGroup = true;
          }
        } else if (nextPart.type === "task-result") {
          endsGroup = true;
        }
      }
    }

    if (endsGroup) {
      if (currentGroupAgents.length > 0) {
        const lastToolPart = currentGroup[currentGroup.length - 1];
        if (lastToolPart) {
          finalParts.push({
            id:
              existingByParent.get(lastToolPart.id)?.id ?? createPartId(),
            type: "agent",
            agents: currentGroupAgents,
            parentToolPartId: lastToolPart.id,
            createdAt:
              existingByParent.get(lastToolPart.id)?.createdAt ??
              messageTimestamp,
          });
        }
      }
      currentGroup = [];
      currentGroupAgents = [];
    }
  }

  const remainingAgents: ParallelAgent[] = [];
  for (const [toolCallId, agents] of agentsByToolCall) {
    if (!toolCallId || !handledToolCallIds.has(toolCallId)) {
      remainingAgents.push(...agents);
    }
  }

  if (remainingAgents.length > 0) {
    finalParts.splice(getAgentInsertIndex(finalParts), 0, {
      id: existingByParent.get(undefined)?.id ?? createPartId(),
      type: "agent",
      agents: remainingAgents,
      parentToolPartId: undefined,
      createdAt: existingByParent.get(undefined)?.createdAt ?? messageTimestamp,
    });
  }

  return finalParts;
}
