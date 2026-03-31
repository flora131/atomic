/**
 * List CLI Commands
 *
 * Handlers for `atomic list agents`.
 *
 * Lists discovered agent definitions from both project-level and global
 * (user-level) directories, showing name, source, and description.
 */

import { COLORS } from "@/theme/colors.ts";
import { truncateText } from "@/lib/ui/format.ts";

/**
 * Entry point for `atomic list agents`.
 *
 * Discovers all agent definition files across all three SDK directories
 * (Claude, OpenCode, Copilot) at both project and global scope.
 * Deduplicates by name (project overrides global) and prints a table.
 */
export async function listAgentsCommand(): Promise<void> {
  const { discoverAgentInfos } = await import(
    "@/services/agent-discovery/index.ts"
  );
  const agents = discoverAgentInfos();

  if (agents.length === 0) {
    console.log(
      `${COLORS.yellow}No agent definitions found.${COLORS.reset}`,
    );
    console.log(
      "Agent definitions are markdown files in .claude/agents/, .opencode/agents/, or .github/agents/.",
    );
    return;
  }

  const projectAgents = agents.filter((a) => a.source === "project");
  const globalAgents = agents.filter((a) => a.source === "user");

  console.log(`\n${COLORS.bold}Discovered Agents${COLORS.reset}`);
  console.log(`${"─".repeat(60)}`);

  if (projectAgents.length > 0) {
    console.log(
      `\n${COLORS.bold}Project agents${COLORS.reset} (${projectAgents.length}):`,
    );
    for (const agent of projectAgents) {
      const desc = truncateDescription(agent.name, agent.description);
      console.log(
        `  ${COLORS.green}${agent.name}${COLORS.reset}  ${COLORS.dim}${desc}${COLORS.reset}`,
      );
    }
  }

  if (globalAgents.length > 0) {
    console.log(
      `\n${COLORS.bold}Global agents${COLORS.reset} (${globalAgents.length}):`,
    );
    for (const agent of globalAgents) {
      const desc = truncateDescription(agent.name, agent.description);
      console.log(
        `  ${COLORS.green}${agent.name}${COLORS.reset}  ${COLORS.dim}${desc}${COLORS.reset}`,
      );
    }
  }

  console.log(
    `\n${COLORS.dim}Total: ${agents.length} agent(s)${COLORS.reset}`,
  );
  console.log(
    `${COLORS.dim}Use these names in workflow .stage({ agent: "<name>" }) or agent: null for SDK defaults.${COLORS.reset}\n`,
  );
}

/** Prefix width: 2 leading spaces + name + 2 spaces separator. */
const PREFIX_PADDING = 4;
const DEFAULT_COLUMNS = 80;

function truncateDescription(name: string, description: string): string {
  const cleaned = description.replace(/\n/g, " ").trim();
  const columns = process.stdout.columns || DEFAULT_COLUMNS;
  const available = columns - PREFIX_PADDING - name.length;
  return available > 0 ? truncateText(cleaned, available) : cleaned;
}
