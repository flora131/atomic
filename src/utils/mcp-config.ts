/**
 * MCP Config Discovery Module
 *
 * Provides format-specific parsers and a unified discovery function for
 * MCP server configurations across Claude, Copilot, and OpenCode config formats.
 *
 * Reference: specs/mcp-support-and-discovery.md section 5.2
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServerConfig } from "../sdk/types.ts";

/**
 * Parse Claude Code MCP config (.mcp.json).
 * Format: { "mcpServers": { "<name>": { type?, command?, args?, env?, url?, headers? } } }
 */
export function parseClaudeMcpConfig(filePath: string): McpServerConfig[] {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = Bun.JSONC.parse(raw) as Record<string, unknown>;
    const mcpServers = parsed.mcpServers;
    if (!mcpServers || typeof mcpServers !== "object") return [];
    return Object.entries(mcpServers as Record<string, Record<string, unknown>>).map(([name, cfg]) => ({
      name,
      type: cfg.type as McpServerConfig["type"],
      command: cfg.command as string | undefined,
      args: cfg.args as string[] | undefined,
      env: cfg.env as Record<string, string> | undefined,
      url: cfg.url as string | undefined,
      headers: cfg.headers as Record<string, string> | undefined,
      tools: Array.isArray(cfg.tools) ? (cfg.tools as string[]) : undefined,
      enabled: cfg.enabled !== false,
    }));
  } catch {
    return [];
  }
}

/**
 * Parse Copilot CLI MCP config (mcp-config.json).
 * Format: { "mcpServers": { "<name>": { type, command?, args?, env?, url?, headers?, cwd?, tools?, timeout? } } }
 * Maps "local" type to "stdio".
 */
export function parseCopilotMcpConfig(filePath: string): McpServerConfig[] {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = Bun.JSONC.parse(raw) as Record<string, unknown>;
    const mcpServers = parsed.mcpServers;
    if (!mcpServers || typeof mcpServers !== "object") return [];
    return Object.entries(mcpServers as Record<string, Record<string, unknown>>).map(([name, cfg]) => {
      const type = cfg.type === "local" ? "stdio" : (cfg.type as McpServerConfig["type"]);
      return {
        name,
        type,
        command: cfg.command as string | undefined,
        args: cfg.args as string[] | undefined,
        env: cfg.env as Record<string, string> | undefined,
        url: cfg.url as string | undefined,
        headers: cfg.headers as Record<string, string> | undefined,
        cwd: cfg.cwd as string | undefined,
        timeout: cfg.timeout as number | undefined,
        tools: Array.isArray(cfg.tools) ? (cfg.tools as string[]) : undefined,
        enabled: cfg.enabled !== false,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Parse OpenCode MCP config (opencode.json, opencode.jsonc, or .opencode/opencode.json).
 * Supports JSONC (comments + trailing commas) via Bun.JSONC.parse().
 * Format: { "mcp": { "<name>": { type, command?, url?, environment?, enabled?, timeout? } } }
 * Maps "local" -> "stdio", "remote" -> "http".
 * Splits "command: string[]" into command (first) + args (rest).
 * Maps "environment" to "env".
 */
export function parseOpenCodeMcpConfig(filePath: string): McpServerConfig[] {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = Bun.JSONC.parse(raw) as Record<string, unknown>;
    const mcp = parsed.mcp;
    if (!mcp || typeof mcp !== "object") return [];
    return Object.entries(mcp as Record<string, Record<string, unknown>>).map(([name, cfg]) => {
      const type = cfg.type === "local" ? "stdio"
        : cfg.type === "remote" ? "http"
        : (cfg.type as McpServerConfig["type"]);

      // OpenCode schema enforces command: string[] (Zod: z.string().array()).
      // Defensively handle string input: split on whitespace to normalize.
      let command: string | undefined;
      let args: string[] | undefined;
      if (Array.isArray(cfg.command)) {
        command = cfg.command[0] as string;
        args = cfg.command.slice(1) as string[];
      } else if (typeof cfg.command === "string") {
        const parts = cfg.command.trim().split(/\s+/);
        command = parts[0];
        args = parts.slice(1);
      }

      return {
        name,
        type,
        command,
        args,
        env: (cfg.environment ?? cfg.env) as Record<string, string> | undefined,
        url: cfg.url as string | undefined,
        headers: cfg.headers as Record<string, string> | undefined,
        timeout: cfg.timeout as number | undefined,
        tools: Array.isArray(cfg.tools) ? (cfg.tools as string[]) : undefined,
        enabled: cfg.enabled !== false,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Discover and load MCP server configs from all known config file locations.
 *
 * Configs from different ecosystems (Claude, Copilot, OpenCode) are independent:
 * within the same ecosystem, later sources (project-level) override earlier ones
 * (user-level), but configs from one ecosystem never override another's.
 *
 * Discovery order per ecosystem:
 * 1. Claude: ~/.claude/.mcp.json → .mcp.json
 * 2. Copilot: ~/.copilot/mcp-config.json → .github/mcp-config.json, mcp-config.json
 * 3. OpenCode: ~/.opencode/opencode.json[c] → opencode.json[c], .opencode/opencode.json[c]
 *
 * @param cwd - Project root directory (defaults to process.cwd())
 * @returns Deduplicated array of McpServerConfig
 */
export interface DiscoverMcpConfigsOptions {
  includeDisabled?: boolean;
}

type ConfigEcosystem = "claude" | "copilot" | "opencode";

interface TaggedSource {
  config: McpServerConfig;
  ecosystem: ConfigEcosystem;
}

export function discoverMcpConfigs(cwd?: string, options: DiscoverMcpConfigsOptions = {}): McpServerConfig[] {
  const projectRoot = cwd ?? process.cwd();
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";

  const sources: TaggedSource[] = [];

  function addSources(configs: McpServerConfig[], ecosystem: ConfigEcosystem): void {
    for (const config of configs) {
      sources.push({ config, ecosystem });
    }
  }

  // User-level configs (lowest priority within each ecosystem)
  addSources(parseClaudeMcpConfig(join(homeDir, ".claude", ".mcp.json")), "claude");
  addSources(parseCopilotMcpConfig(join(homeDir, ".copilot", "mcp-config.json")), "copilot");
  addSources(parseOpenCodeMcpConfig(join(homeDir, ".opencode", "opencode.json")), "opencode");
  addSources(parseOpenCodeMcpConfig(join(homeDir, ".opencode", "opencode.jsonc")), "opencode");

  // Project-level configs (override user-level within the same ecosystem)
  addSources(parseClaudeMcpConfig(join(projectRoot, ".mcp.json")), "claude");
  addSources(parseCopilotMcpConfig(join(projectRoot, ".github", "mcp-config.json")), "copilot");
  addSources(parseCopilotMcpConfig(join(projectRoot, "mcp-config.json")), "copilot");
  addSources(parseOpenCodeMcpConfig(join(projectRoot, "opencode.json")), "opencode");
  addSources(parseOpenCodeMcpConfig(join(projectRoot, "opencode.jsonc")), "opencode");
  addSources(parseOpenCodeMcpConfig(join(projectRoot, ".opencode", "opencode.json")), "opencode");
  addSources(parseOpenCodeMcpConfig(join(projectRoot, ".opencode", "opencode.jsonc")), "opencode");

  // Deduplicate by name with ecosystem isolation.
  // A source can override the existing entry only if it is from the same ecosystem.
  const byName = new Map<string, TaggedSource>();
  for (const entry of sources) {
    const existing = byName.get(entry.config.name);
    if (!existing || existing.ecosystem === entry.ecosystem) {
      byName.set(entry.config.name, entry);
    }
    // else: different ecosystem already owns this name — skip
  }

  // Apply default: missing tools means all tools are available.
  const allServers = Array.from(byName.values()).map((s) => ({
    ...s.config,
    tools: s.config.tools ?? ["*"],
  }));
  if (options.includeDisabled) {
    return allServers;
  }

  // Default behavior: only return enabled servers.
  return allServers.filter(s => s.enabled !== false);
}
