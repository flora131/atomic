/**
 * List CLI Commands
 *
 * Handlers for `atomic list agents`.
 *
 * Lists discovered agent definitions from both project-level and global
 * (user-level) directories, showing name, source, and description.
 */

import { COLORS } from "@/theme/colors.ts";
import { truncateDescription } from "@/lib/ui/format.ts";

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
      const { name, description: desc } = truncateDescription(agent.name, agent.description);
      console.log(
        `  ${COLORS.green}${name}${COLORS.reset}  ${COLORS.dim}${desc}${COLORS.reset}`,
      );
    }
  }

  if (globalAgents.length > 0) {
    console.log(
      `\n${COLORS.bold}Global agents${COLORS.reset} (${globalAgents.length}):`,
    );
    for (const agent of globalAgents) {
      const { name, description: desc } = truncateDescription(agent.name, agent.description);
      console.log(
        `  ${COLORS.green}${name}${COLORS.reset}  ${COLORS.dim}${desc}${COLORS.reset}`,
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
