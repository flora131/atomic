import type { AgentInfo, AgentSource } from "@/services/agent-discovery/types.ts";

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
  return {
    name: agent.name,
    description: firstSentence(agent.description),
    source: agent.source,
  };
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\n/g, " ").trim();
  const match = cleaned.match(/^(.+?\.)\s/);
  return match?.[1] ?? cleaned;
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
