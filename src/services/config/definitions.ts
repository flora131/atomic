/**
 * Agent configuration definitions for atomic CLI
 */

export interface AgentConfig {
  /** Display name for the agent */
  name: string;
  /** Command to execute the agent */
  cmd: string;
  /** Flags used when spawning the agent in interactive chat mode */
  chat_flags: string[];
  /** Environment variables to set when spawning the agent (merged with process env) */
  env_vars: Record<string, string>;
  /** Config folder relative to repo root */
  folder: string;
  /** URL for installation instructions */
  install_url: string;
  /** Paths to exclude when copying (relative to folder) */
  exclude: string[];
  /** Project files applied during `atomic chat` preflight for provider onboarding */
  onboarding_files: Array<{
    source: string;
    destination: string;
    merge: boolean;
  }>;
}

const AGENT_KEYS = ["claude", "opencode", "copilot"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const AGENT_CONFIG: Record<AgentKey, AgentConfig> = {
  claude: {
    name: "Claude Code",
    cmd: "claude",
    chat_flags: [
      "--allow-dangerously-skip-permissions",
      "--dangerously-skip-permissions",
    ],
    env_vars: {},
    folder: ".claude",
    install_url: "https://code.claude.com/docs/en/setup",
    exclude: [],
    onboarding_files: [
      {
        source: ".mcp.json",
        destination: ".mcp.json",
        merge: true,
      },
      {
        source: ".claude/settings.json",
        destination: ".claude/settings.json",
        merge: true,
      },
      {
        source: ".claude/settings.json",
        destination: "~/.claude/settings.json",
        merge: true,
      },
    ],
  },
  opencode: {
    name: "OpenCode",
    cmd: "opencode",
    chat_flags: [],
    env_vars: { OPENCODE_EXPERIMENTAL_LSP_TOOL: "true" },
    folder: ".opencode",
    install_url: "https://opencode.ai",
    exclude: [".gitignore", "package.json"],
    onboarding_files: [
      {
        source: ".opencode/opencode.json",
        destination: ".opencode/opencode.json",
        merge: true,
      },
    ],
  },
  copilot: {
    name: "GitHub Copilot CLI",
    cmd: "copilot",
    chat_flags: ["--add-dir", ".", "--yolo", "--experimental"],
    env_vars: {
      COPILOT_ALLOW_ALL: "true",
    },
    folder: ".github",
    install_url:
      "https://github.com/github/copilot-cli?tab=readme-ov-file#installation",
    exclude: ["workflows", "dependabot.yml"],
    onboarding_files: [],
  },
};

/**
 * Per-provider overrides that users can set in `.atomic/settings.json`
 * (local) or `~/.atomic/settings.json` (global).
 *
 * - `chatFlags`: when set, replaces the agent's default `chat_flags` entirely.
 * - `envVars`: environment variables merged on top of the agent's default
 *   `env_vars` (user values win on conflict).
 */
export interface ProviderOverrides {
  chatFlags?: string[];
  envVars?: Record<string, string>;
}

export function isValidAgent(key: string): key is AgentKey {
  return key in AGENT_CONFIG;
}

export function getAgentConfig(key: AgentKey): AgentConfig {
  return AGENT_CONFIG[key];
}

export function getAgentKeys(): AgentKey[] {
  return [...AGENT_KEYS];
}
