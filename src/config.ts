/**
 * Agent configuration definitions for atomic CLI
 */

export interface AgentConfig {
  /** Display name for the agent */
  name: string;
  /** Command to execute the agent */
  cmd: string;
  /** Additional flags to pass when spawning the agent */
  additional_flags: string[];
  /** Config folder relative to repo root */
  folder: string;
  /** URL for installation instructions */
  install_url: string;
  /** Paths to exclude when copying (relative to folder) */
  exclude: string[];
  /** Additional files to copy from repo root */
  additional_files: string[];
}

export const AGENT_CONFIG: Record<string, AgentConfig> = {
  "claude-code": {
    name: "Claude Code",
    cmd: "claude",
    additional_flags: ["dangerously-skip-permissions"],
    folder: ".claude",
    install_url: "https://docs.anthropic.com/en/docs/claude-code/setup",
    exclude: [],
    additional_files: ["CLAUDE.md"],
  },
  opencode: {
    name: "opencode",
    cmd: "opencode",
    additional_flags: [],
    folder: ".opencode",
    install_url: "https://opencode.ai",
    exclude: ["node_modules", ".gitignore", "bun.lock", "package.json"],
    additional_files: ["AGENTS.md"],
  },
  "copilot-cli": {
    name: "GitHub Copilot CLI",
    cmd: "copilot",
    additional_flags: ["--allow-all-tools", "--allow-all-paths"],
    folder: ".github",
    install_url:
      "https://github.com/github/copilot-cli?tab=readme-ov-file#installation",
    exclude: ["workflows", "dependabot.yml"],
    additional_files: ["AGENTS.md"],
  },
};

export type AgentKey = keyof typeof AGENT_CONFIG;

export function isValidAgent(key: string): key is AgentKey {
  return key in AGENT_CONFIG;
}

export function getAgentConfig(key: AgentKey): AgentConfig {
  return AGENT_CONFIG[key];
}

export function getAgentKeys(): AgentKey[] {
  return Object.keys(AGENT_CONFIG) as AgentKey[];
}
