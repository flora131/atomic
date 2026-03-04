/**
 * MCP Config Discovery Module
 *
 * Provides format-specific parsers and a unified discovery function for
 * MCP server configurations across Claude, Copilot, and OpenCode config formats.
 *
 * Reference: specs/mcp-support-and-discovery.md section 5.2
 */

import { join, resolve } from "node:path";
import type { McpServerConfig } from "../sdk/types.ts";
import { assertRealPathWithinRoot } from "./path-root-guard.ts";
import { resolveDefaultConfigHome } from "./provider-discovery-plan.ts";

async function readJsoncConfig(
  filePath: string,
  allowedRoot?: string,
): Promise<Record<string, unknown> | null> {
  try {
    if (allowedRoot) {
      await assertRealPathWithinRoot(allowedRoot, filePath, "MCP config path");
    }

    const raw = await Bun.file(filePath).text();
    return Bun.JSONC.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Parse Claude Code MCP config (.mcp.json).
 * Format: { "mcpServers": { "<name>": { type?, command?, args?, env?, url?, headers? } } }
 */
export async function parseClaudeMcpConfig(
  filePath: string,
  allowedRoot?: string,
): Promise<McpServerConfig[]> {
  const parsed = await readJsoncConfig(filePath, allowedRoot);
  if (!parsed) {
    return [];
  }

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
}

/**
 * Parse Copilot CLI MCP config (mcp-config.json).
 * Format: { "mcpServers": { "<name>": { type, command?, args?, env?, url?, headers?, cwd?, tools?, timeout? } } }
 * Maps "local" type to "stdio".
 */
export async function parseCopilotMcpConfig(
  filePath: string,
  allowedRoot?: string,
): Promise<McpServerConfig[]> {
  const parsed = await readJsoncConfig(filePath, allowedRoot);
  if (!parsed) {
    return [];
  }

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
}

/**
 * Parse OpenCode MCP config (opencode.json, opencode.jsonc, or .opencode/opencode.json).
 * Supports JSONC (comments + trailing commas) via Bun.JSONC.parse().
 * Format: { "mcp": { "<name>": { type, command?, url?, environment?, enabled?, timeout? } } }
 * Maps "local" -> "stdio", "remote" -> "http".
 * Splits "command: string[]" into command (first) + args (rest).
 * Maps "environment" to "env".
 */
export async function parseOpenCodeMcpConfig(
  filePath: string,
  allowedRoot?: string,
): Promise<McpServerConfig[]> {
  const parsed = await readJsoncConfig(filePath, allowedRoot);
  if (!parsed) {
    return [];
  }

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
}

/**
 * Discover and load MCP server configs from all known config file locations.
 *
 * Configs from different ecosystems (Claude, Copilot, OpenCode) are independent:
 * within the same ecosystem, later sources (project-level) override earlier ones
 * (user-level), but configs from one ecosystem never override another's.
 *
 * Discovery order per ecosystem (low -> high precedence):
 * 1. Atomic global: ~/.atomic/.{claude,copilot,opencode}/...
 * 2. Canonical user config-home: <config-home>/.{copilot,opencode}/...
 * 3. User home roots: ~/.{claude,copilot,opencode}/...
 * 4. Project local: .mcp.json, .github/mcp-config.json, opencode.json[c], ...
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

export async function discoverMcpConfigs(cwd?: string, options: DiscoverMcpConfigsOptions = {}): Promise<McpServerConfig[]> {
  const projectRoot = resolve(cwd ?? process.cwd());
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const atomicHome = homeDir.length > 0 ? join(homeDir, ".atomic") : "";
  const configHome = homeDir.length > 0
    ? resolveDefaultConfigHome({
        homeDir,
      })
    : "";

  const claudeAtomicPromise = atomicHome.length > 0
    ? parseClaudeMcpConfig(join(atomicHome, ".claude", ".mcp.json"), homeDir)
    : Promise.resolve<McpServerConfig[]>([]);
  const copilotAtomicPromise = atomicHome.length > 0
    ? parseCopilotMcpConfig(join(atomicHome, ".copilot", "mcp-config.json"), homeDir)
    : Promise.resolve<McpServerConfig[]>([]);
  const opencodeAtomicJsonPromise = atomicHome.length > 0
    ? parseOpenCodeMcpConfig(join(atomicHome, ".opencode", "opencode.json"), homeDir)
    : Promise.resolve<McpServerConfig[]>([]);
  const opencodeAtomicJsoncPromise = atomicHome.length > 0
    ? parseOpenCodeMcpConfig(join(atomicHome, ".opencode", "opencode.jsonc"), homeDir)
    : Promise.resolve<McpServerConfig[]>([]);

  const claudeUserPromise = homeDir.length > 0
    ? parseClaudeMcpConfig(join(homeDir, ".claude", ".mcp.json"), homeDir)
    : Promise.resolve<McpServerConfig[]>([]);
  const copilotCanonicalPromise = configHome.length > 0
    ? parseCopilotMcpConfig(join(configHome, ".copilot", "mcp-config.json"), homeDir)
    : Promise.resolve<McpServerConfig[]>([]);
  const opencodeCanonicalJsonPromise = configHome.length > 0
    ? parseOpenCodeMcpConfig(join(configHome, ".opencode", "opencode.json"), homeDir)
    : Promise.resolve<McpServerConfig[]>([]);
  const opencodeCanonicalJsoncPromise = configHome.length > 0
    ? parseOpenCodeMcpConfig(join(configHome, ".opencode", "opencode.jsonc"), homeDir)
    : Promise.resolve<McpServerConfig[]>([]);
  const copilotHomePromise = homeDir.length > 0
    ? parseCopilotMcpConfig(join(homeDir, ".copilot", "mcp-config.json"), homeDir)
    : Promise.resolve<McpServerConfig[]>([]);
  const opencodeHomeJsonPromise = homeDir.length > 0
    ? parseOpenCodeMcpConfig(join(homeDir, ".opencode", "opencode.json"), homeDir)
    : Promise.resolve<McpServerConfig[]>([]);
  const opencodeHomeJsoncPromise = homeDir.length > 0
    ? parseOpenCodeMcpConfig(join(homeDir, ".opencode", "opencode.jsonc"), homeDir)
    : Promise.resolve<McpServerConfig[]>([]);

  // Fire all config reads concurrently with Bun.file()
  const [
    claudeAtomic, copilotAtomic, opencodeAtomicJson, opencodeAtomicJsonc,
    claudeUser, copilotCanonical, opencodeCanonicalJson, opencodeCanonicalJsonc,
    copilotHome, opencodeHomeJson, opencodeHomeJsonc,
    claudeProject, copilotProject, copilotVscode, copilotRoot,
    opencodeProjectJson, opencodeProjectJsonc,
    opencodeProjectDirJson, opencodeProjectDirJsonc,
  ] = await Promise.all([
    claudeAtomicPromise,
    copilotAtomicPromise,
    opencodeAtomicJsonPromise,
    opencodeAtomicJsoncPromise,
    claudeUserPromise,
    copilotCanonicalPromise,
    opencodeCanonicalJsonPromise,
    opencodeCanonicalJsoncPromise,
    copilotHomePromise,
    opencodeHomeJsonPromise,
    opencodeHomeJsoncPromise,
    parseClaudeMcpConfig(join(projectRoot, ".mcp.json"), projectRoot),
    parseCopilotMcpConfig(join(projectRoot, ".github", "mcp-config.json"), projectRoot),
    parseCopilotMcpConfig(join(projectRoot, ".vscode", "mcp.json"), projectRoot),
    parseCopilotMcpConfig(join(projectRoot, "mcp-config.json"), projectRoot),
    parseOpenCodeMcpConfig(join(projectRoot, "opencode.json"), projectRoot),
    parseOpenCodeMcpConfig(join(projectRoot, "opencode.jsonc"), projectRoot),
    parseOpenCodeMcpConfig(join(projectRoot, ".opencode", "opencode.json"), projectRoot),
    parseOpenCodeMcpConfig(join(projectRoot, ".opencode", "opencode.jsonc"), projectRoot),
  ]);

  const sources: TaggedSource[] = [];

  function addSources(configs: McpServerConfig[], ecosystem: ConfigEcosystem): void {
    for (const config of configs) {
      sources.push({ config, ecosystem });
    }
  }

  // Atomic global configs (lowest priority within each ecosystem)
  addSources(claudeAtomic, "claude");
  addSources(copilotAtomic, "copilot");
  addSources(opencodeAtomicJson, "opencode");
  addSources(opencodeAtomicJsonc, "opencode");

  // Canonical config-home roots
  addSources(copilotCanonical, "copilot");
  addSources(opencodeCanonicalJson, "opencode");
  addSources(opencodeCanonicalJsonc, "opencode");

  // User home roots
  addSources(claudeUser, "claude");
  addSources(copilotHome, "copilot");
  addSources(opencodeHomeJson, "opencode");
  addSources(opencodeHomeJsonc, "opencode");

  // Project-level configs (override user-level within the same ecosystem)
  addSources(claudeProject, "claude");
  addSources(copilotProject, "copilot");
  addSources(copilotVscode, "copilot");
  addSources(copilotRoot, "copilot");
  addSources(opencodeProjectJson, "opencode");
  addSources(opencodeProjectJsonc, "opencode");
  addSources(opencodeProjectDirJson, "opencode");
  addSources(opencodeProjectDirJsonc, "opencode");

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
