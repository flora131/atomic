import type {
  McpRuntimeServerSnapshot,
  McpRuntimeSnapshot,
  McpServerConfig,
} from "../../sdk/types.ts";

export type McpAuthStatusView = "Unsupported" | "Not logged in" | "Bearer token" | "OAuth" | "Unknown";

export interface McpResourceView {
  label: string;
  uri: string;
}

export interface McpResourceTemplateView {
  label: string;
  uriTemplate: string;
}

export interface McpTransportView {
  kind: "stdio" | "http" | "sse" | "unknown";
  commandLine?: string;
  cwd?: string;
  env?: string;
  url?: string;
  httpHeaders?: string;
  envHttpHeaders?: string;
}

export interface McpServerView {
  name: string;
  enabled: boolean;
  disabledReason?: string;
  authStatus: McpAuthStatusView;
  transport: McpTransportView;
  tools: string[];
  resources: McpResourceView[];
  resourceTemplates: McpResourceTemplateView[];
}

export interface McpSnapshotView {
  commandLabel: string;
  heading: string;
  docsHint: string;
  hasConfiguredServers: boolean;
  noToolsAvailable: boolean;
  servers: McpServerView[];
}

export type McpServerToggleMap = Record<string, boolean>;

interface BuildMcpSnapshotInput {
  servers: McpServerConfig[];
  toggles?: McpServerToggleMap;
  runtimeSnapshot?: McpRuntimeSnapshot | null;
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeToolName(serverName: string, toolName: string): string {
  const prefix = `mcp__${serverName.toLowerCase()}__`;
  const normalized = toolName.trim();
  if (normalized.toLowerCase().startsWith(prefix)) {
    return normalized.slice(prefix.length);
  }
  return normalized;
}

function normalizeToolNames(serverName: string, toolNames: string[] | undefined): string[] {
  if (!toolNames || toolNames.length === 0) return [];
  return [...new Set(toolNames.map((name) => normalizeToolName(serverName, name)).filter((name) => name.length > 0))]
    .sort((a, b) => a.localeCompare(b));
}

function maskPairValues(values: Record<string, string> | undefined): string {
  if (!values) return "-";
  const names = Object.keys(values).sort((a, b) => a.localeCompare(b));
  if (names.length === 0) return "-";
  return names.map((name) => `${name}=*****`).join(", ");
}

function formatEnvHeaderBindings(values: Record<string, string> | undefined): string {
  if (!values) return "-";
  const entries = Object.entries(values).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) return "-";
  return entries.map(([header, envVar]) => `${header}=${envVar}`).join(", ");
}

function normalizeAuthStatus(status: string | undefined): McpAuthStatusView {
  if (!status) return "Unknown";
  if (status === "Unsupported" || status === "Not logged in" || status === "Bearer token" || status === "OAuth") {
    return status;
  }
  return "Unknown";
}

function getRuntimeServerSnapshot(
  runtimeSnapshot: McpRuntimeSnapshot | null | undefined,
  serverName: string
): McpRuntimeServerSnapshot | undefined {
  if (!runtimeSnapshot) return undefined;
  if (runtimeSnapshot.servers[serverName]) {
    return runtimeSnapshot.servers[serverName];
  }
  const lower = serverName.toLowerCase();
  for (const [name, server] of Object.entries(runtimeSnapshot.servers)) {
    if (name.toLowerCase() === lower) {
      return server;
    }
  }
  return undefined;
}

function formatTransport(server: McpServerConfig, runtimeServer?: McpRuntimeServerSnapshot): McpTransportView {
  const kind = server.type ?? (server.url ? "http" : server.command ? "stdio" : "unknown");

  if (kind === "stdio") {
    const args = server.args?.length ? ` ${server.args.join(" ")}` : "";
    return {
      kind,
      commandLine: `${server.command ?? "(none)"}${args}`,
      cwd: server.cwd,
      env: maskPairValues(server.env),
    };
  }

  if (kind === "http" || kind === "sse") {
    const maskedHeaders = runtimeServer?.httpHeaders ? maskPairValues(runtimeServer.httpHeaders) : maskPairValues(server.headers);
    const envHttpHeaders = runtimeServer?.envHttpHeaders ? formatEnvHeaderBindings(runtimeServer.envHttpHeaders) : "-";
    return {
      kind,
      url: server.url,
      httpHeaders: maskedHeaders,
      envHttpHeaders,
    };
  }

  return { kind: "unknown" };
}

export function applyMcpServerToggles(servers: McpServerConfig[], toggles: McpServerToggleMap = {}): McpServerConfig[] {
  const normalized = new Map<string, boolean>(
    Object.entries(toggles).map(([name, enabled]) => [name.toLowerCase(), enabled])
  );

  return servers.map((server) => {
    const override = normalized.get(server.name.toLowerCase());
    if (override === undefined) return server;
    return {
      ...server,
      enabled: override,
      disabledReason: override ? undefined : "Disabled for this session",
    };
  });
}

export function getActiveMcpServers(servers: McpServerConfig[], toggles: McpServerToggleMap = {}): McpServerConfig[] {
  return applyMcpServerToggles(servers, toggles).filter((server) => server.enabled !== false);
}

export function buildMcpSnapshotView({
  servers,
  toggles = {},
  runtimeSnapshot = null,
}: BuildMcpSnapshotInput): McpSnapshotView {
  const toggledServers = applyMcpServerToggles(servers, toggles);
  const sortedServers = sortByName(toggledServers);

  const snapshotServers: McpServerView[] = sortedServers.map((server) => {
    const runtimeServer = getRuntimeServerSnapshot(runtimeSnapshot, server.name);
    const configTools = normalizeToolNames(server.name, server.tools);
    const isWildcard = !server.tools || (configTools.length === 1 && configTools[0] === "*");
    let tools: string[];
    if (runtimeServer?.tools) {
      const runtimeTools = normalizeToolNames(server.name, runtimeServer.tools);
      tools = isWildcard ? runtimeTools : runtimeTools.filter((t) => configTools.includes(t));
    } else {
      tools = configTools;
    }
    const resources = runtimeServer?.resources
      ? runtimeServer.resources.map((resource) => ({
        label: resource.title ?? resource.name,
        uri: resource.uri,
      })).sort((a, b) => a.label.localeCompare(b.label))
      : [];
    const resourceTemplates = runtimeServer?.resourceTemplates
      ? runtimeServer.resourceTemplates.map((template) => ({
        label: template.title ?? template.name,
        uriTemplate: template.uriTemplate,
      })).sort((a, b) => a.label.localeCompare(b.label))
      : [];

    return {
      name: server.name,
      enabled: server.enabled !== false,
      disabledReason: server.disabledReason,
      authStatus: normalizeAuthStatus(runtimeServer?.authStatus),
      transport: formatTransport(server, runtimeServer),
      tools,
      resources,
      resourceTemplates,
    };
  });

  return {
    commandLabel: "/mcp",
    heading: "🔌  MCP Tools",
    docsHint: "See the MCP docs to configure them.",
    hasConfiguredServers: snapshotServers.length > 0,
    noToolsAvailable: snapshotServers.length > 0 && snapshotServers.every((server) => server.tools.length === 0),
    servers: snapshotServers,
  };
}
