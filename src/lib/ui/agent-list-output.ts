import type { AgentInfo, AgentSource } from "@/services/agent-discovery/types.ts";
import { truncateDescription } from "@/lib/ui/format.ts";

export interface AgentListItemView {
  name: string;
  description: string;
  source: AgentSource;
}

export interface AgentListView {
  heading: string;
  totalCount: number;
  projectAgents: AgentListItemView[];
  globalAgents: AgentListItemView[];
}

function toItemView(agent: AgentInfo): AgentListItemView {
  const truncated = truncateDescription(agent.name, agent.description);
  return {
    name: truncated.name,
    description: truncated.description,
    source: agent.source,
  };
}

export function buildAgentListView(agents: AgentInfo[]): AgentListView {
  const projectAgents: AgentListItemView[] = [];
  const globalAgents: AgentListItemView[] = [];
  for (const agent of agents) {
    if (agent.source === "project") {
      projectAgents.push(toItemView(agent));
    } else if (agent.source === "user") {
      globalAgents.push(toItemView(agent));
    }
  }

  return {
    heading: "Agents",
    totalCount: agents.length,
    projectAgents,
    globalAgents,
  };
}
