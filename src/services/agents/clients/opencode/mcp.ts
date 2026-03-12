import type { McpRuntimeSnapshot } from "@/services/agents/types.ts";

function parseOpenCodeMcpToolId(
  toolId: string,
): { server: string; tool: string } | null {
  const match = toolId.match(/^mcp__(.+?)__(.+)$/);
  if (!match) {
    return null;
  }

  const server = match[1]?.trim();
  const tool = match[2]?.trim();
  if (!server || !tool) {
    return null;
  }

  return { server, tool };
}

function mapOpenCodeMcpStatusToAuth(
  status: string | undefined,
): "Not logged in" | undefined {
  return status === "needs_auth" ? "Not logged in" : undefined;
}

export async function buildOpenCodeMcpSnapshot(
  sdkClient: {
    mcp: {
      status: (params: { directory: string }) => Promise<{
        data?: Record<string, { status?: string }>;
        error?: unknown;
      }>;
    };
    tool: {
      ids: (params: { directory: string }) => Promise<{
        data?: string[];
        error?: unknown;
      }>;
    };
    experimental: {
      resource: {
        list: (params: { directory: string }) => Promise<{
          data?: Record<string, {
            name?: string;
            uri?: string;
            client?: string;
          }>;
          error?: unknown;
        }>;
      };
    };
  },
  directory: string,
): Promise<McpRuntimeSnapshot | null> {
  const [statusResult, toolIdsResult, resourcesResult] = await Promise.allSettled([
    sdkClient.mcp.status({ directory }),
    sdkClient.tool.ids({ directory }),
    sdkClient.experimental.resource.list({ directory }),
  ]);

  let hasSuccessfulSource = false;
  const servers: McpRuntimeSnapshot["servers"] = {};

  const ensureServer = (name: string) => {
    if (!servers[name]) {
      servers[name] = {};
    }
    return servers[name]!;
  };

  if (
    statusResult.status === "fulfilled" &&
    !statusResult.value.error &&
    statusResult.value.data
  ) {
    hasSuccessfulSource = true;
    for (const [serverName, status] of Object.entries(statusResult.value.data)) {
      const server = ensureServer(serverName);
      const authStatus = mapOpenCodeMcpStatusToAuth(status.status);
      if (authStatus) {
        server.authStatus = authStatus;
      }
    }
  }

  if (
    toolIdsResult.status === "fulfilled" &&
    !toolIdsResult.value.error &&
    Array.isArray(toolIdsResult.value.data)
  ) {
    hasSuccessfulSource = true;
    for (const toolId of toolIdsResult.value.data) {
      if (typeof toolId !== "string") {
        continue;
      }
      const parsed = parseOpenCodeMcpToolId(toolId);
      if (!parsed) {
        continue;
      }
      const server = ensureServer(parsed.server);
      const toolNames = server.tools ?? [];
      toolNames.push(toolId);
      server.tools = toolNames;
    }
  }

  if (
    resourcesResult.status === "fulfilled" &&
    !resourcesResult.value.error &&
    resourcesResult.value.data
  ) {
    hasSuccessfulSource = true;
    for (const resource of Object.values(resourcesResult.value.data)) {
      if (!resource.client || !resource.name || !resource.uri) {
        continue;
      }
      const server = ensureServer(resource.client);
      const serverResources = server.resources ?? [];
      serverResources.push({
        name: resource.name,
        uri: resource.uri,
      });
      server.resources = serverResources;
    }
  }

  if (!hasSuccessfulSource) {
    return null;
  }

  for (const server of Object.values(servers)) {
    if (server.tools && server.tools.length > 0) {
      server.tools = [...new Set(server.tools)].sort((left, right) =>
        left.localeCompare(right),
      );
    }

    if (server.resources && server.resources.length > 0) {
      const deduped: typeof server.resources = [];
      const seen = new Set<string>();
      for (const resource of server.resources) {
        const key = `${resource.name}\u0000${resource.uri}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        deduped.push(resource);
      }
      server.resources = deduped.sort((left, right) => {
        const byName = left.name.localeCompare(right.name);
        return byName !== 0 ? byName : left.uri.localeCompare(right.uri);
      });
    }
  }

  return { servers };
}
