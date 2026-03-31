import type { AgentInfo, AgentSource } from "@/services/agent-discovery/types.ts";
import { truncateText } from "@/lib/ui/format.ts";

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

const DEFAULT_COLUMNS = 80;
const PREFIX_PADDING = 4;

function toItemView(agent: AgentInfo): AgentListItemView {
  const cleaned = agent.description.replace(/\n/g, " ").trim();
  const columns = process.stdout.columns || DEFAULT_COLUMNS;
  const available = columns - PREFIX_PADDING - agent.name.length;
  return {
    name: agent.name,
    description: available > 0 ? truncateText(cleaned, available) : cleaned,
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
