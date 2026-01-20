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

const AGENT_KEYS = ["claude-code", "opencode", "copilot-cli"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const AGENT_CONFIG: Record<AgentKey, AgentConfig> = {
  "claude-code": {
    name: "Claude Code",
    cmd: "claude",
    additional_flags: [],
    folder: ".claude",
    install_url: "https://docs.anthropic.com/en/docs/claude-code/setup",
    exclude: [".DS_Store"],
    additional_files: ["CLAUDE.md", ".mcp.json"],
  },
  opencode: {
    name: "OpenCode",
    cmd: "opencode",
    additional_flags: [],
    folder: ".opencode",
    install_url: "https://opencode.ai",
    exclude: [
      "node_modules",
      ".gitignore",
      "bun.lock",
      "package.json",
      ".DS_Store",
    ],
    additional_files: ["AGENTS.md"],
  },
  "copilot-cli": {
    name: "GitHub Copilot CLI",
    cmd: "copilot",
    additional_flags: ["--allow-all-tools", "--allow-all-paths"],
    folder: ".github",
    install_url:
      "https://github.com/github/copilot-cli?tab=readme-ov-file#installation",
    exclude: ["workflows", "dependabot.yml", ".DS_Store"],
    additional_files: ["AGENTS.md"],
  },
};

export function isValidAgent(key: string): key is AgentKey {
  return key in AGENT_CONFIG;
}

export function getAgentConfig(key: AgentKey): AgentConfig {
  return AGENT_CONFIG[key];
}

export function getAgentKeys(): AgentKey[] {
  return [...AGENT_KEYS];
}
