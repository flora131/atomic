import { initOpenCodeConfigOverrides } from "@/services/agents/init.ts";
import type { OpencodeClient as OpenCodeSdkClient } from "@opencode-ai/sdk/v2/client";
import type {
  EventType,
  Session,
  SessionConfig,
  SessionMessageWithParts,
} from "@/services/agents/types.ts";
import type { OpenCodeListableProvider } from "@/services/agents/clients/opencode/client-types.ts";
import { extractOpenCodeErrorMessage } from "@/services/agents/clients/opencode/shared.ts";

type OpenCodeMcpClient = OpenCodeSdkClient;
type OpenCodeSessionClient = OpenCodeSdkClient;
type OpenCodeManagementClient = OpenCodeSdkClient;

export async function listOpenCodeSessions(args: {
  sdkClient: OpenCodeSessionClient | null;
  directory?: string;
}): Promise<Array<{ id: string; title?: string; createdAt?: number }>> {
  if (!args.sdkClient) {
    return [];
  }

  const result = await args.sdkClient.session.list({
    directory: args.directory,
  });

  if (result.error || !result.data) {
    return [];
  }

  return (
    result.data as Array<{
      id: string;
      title?: string;
      time?: { created?: number };
    }>
  ).map((session) => ({
    id: session.id,
    title: session.title,
    createdAt: session.time?.created,
  }));
}

export async function listOpenCodeProviderModels(args: {
  sdkClient: OpenCodeManagementClient | null;
  createProviderClient: () => OpenCodeManagementClient;
  directory?: string;
}): Promise<OpenCodeListableProvider[]> {
  const providerClient = args.sdkClient ?? args.createProviderClient();

  const result = await (
    providerClient.provider?.list as
    | ((params: { query: { directory?: string } }) => Promise<{
      data?: {
        all?: OpenCodeListableProvider[];
        connected?: string[];
      };
    }>)
    | undefined
  )?.({
    query: {
      directory: args.directory,
    },
  });
  const data = result?.data;

  if (!data?.all) {
    throw new Error("OpenCode SDK returned no provider data");
  }

  const connectedIds = new Set(data.connected ?? []);
  return data.all.filter((provider) =>
    connectedIds.size === 0 || connectedIds.has(provider.id)
  );
}

export async function registerOpenCodeMcpServers(args: {
  sdkClient: OpenCodeMcpClient | null;
  directory?: string;
  servers: NonNullable<SessionConfig["mcpServers"]>;
}): Promise<void> {
  if (!args.sdkClient) return;

  for (const server of args.servers) {
    try {
      if (server.url) {
        await args.sdkClient.mcp.add({
          directory: args.directory,
          name: server.name,
          config: {
            type: "remote",
            url: server.url,
            headers: server.headers,
            enabled: server.enabled !== false,
            timeout: server.timeout,
          },
        });
      } else if (server.command) {
        const command = [server.command, ...(server.args ?? [])];
        await args.sdkClient.mcp.add({
          directory: args.directory,
          name: server.name,
          config: {
            type: "local",
            command,
            environment: server.env,
            enabled: server.enabled !== false,
            timeout: server.timeout,
          },
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to register MCP server '${server.name}': ${errorMsg}`);
    }
  }
}

export async function createManagedOpenCodeSession(args: {
  isRunning: boolean;
  sdkClient: OpenCodeManagementClient | null;
  directory?: string;
  config: SessionConfig;
  registerMcpServers: (servers: NonNullable<SessionConfig["mcpServers"]>) => Promise<void>;
  setCurrentSessionId: (sessionId: string) => void;
  onSessionCreated?: (sessionId: string) => void;
  registerActiveSession: (sessionId: string) => void;
  emitEvent: <T extends EventType>(
    eventType: T,
    sessionId: string,
    data: Record<string, unknown>,
  ) => void;
  wrapSession: (sessionId: string, config: SessionConfig) => Promise<Session>;
}): Promise<Session> {
  if (!args.isRunning || !args.sdkClient) {
    throw new Error("Client not started. Call start() first.");
  }

  if (args.config.mcpServers && args.config.mcpServers.length > 0) {
    await args.registerMcpServers(args.config.mcpServers);
  }

  const result = await args.sdkClient.session.create({
    directory: args.directory,
    title: args.config.sessionId ?? undefined,
    permission: initOpenCodeConfigOverrides(),
  });

  if (result.error || !result.data) {
    throw new Error(
      `Failed to create session: ${extractOpenCodeErrorMessage(result.error)}`,
    );
  }

  const sessionId = result.data.id;
  args.setCurrentSessionId(sessionId);
  args.onSessionCreated?.(sessionId);
  args.registerActiveSession(sessionId);
  args.emitEvent("session.start", sessionId, { config: args.config });

  return args.wrapSession(sessionId, args.config);
}

export async function resumeManagedOpenCodeSession(args: {
  isRunning: boolean;
  sdkClient: OpenCodeSessionClient | null;
  directory?: string;
  sessionId: string;
  setCurrentSessionId: (sessionId: string) => void;
  registerActiveSession: (sessionId: string) => void;
  wrapSession: (sessionId: string, config: SessionConfig) => Promise<Session>;
}): Promise<Session | null> {
  if (!args.isRunning || !args.sdkClient) {
    throw new Error("Client not started. Call start() first.");
  }

  const result = await args.sdkClient.session.get({
    sessionID: args.sessionId,
    directory: args.directory,
  });

  if (result.error || !result.data) {
    return null;
  }

  args.setCurrentSessionId(args.sessionId);
  args.registerActiveSession(args.sessionId);
  return args.wrapSession(args.sessionId, {});
}

export async function getOpenCodeSessionMessagesWithParts(args: {
  isRunning: boolean;
  sdkClient: OpenCodeSessionClient | null;
  sessionId: string;
}): Promise<SessionMessageWithParts[]> {
  if (!args.isRunning || !args.sdkClient) {
    throw new Error("Client not started. Call start() first.");
  }

  const result = await args.sdkClient.session.messages({
    sessionID: args.sessionId,
  });

  if (result.error || !result.data) {
    throw new Error(
      `Failed to load session messages: ${extractOpenCodeErrorMessage(result.error)}`,
    );
  }

  return result.data.map((message) => ({
    info: {
      id: message.info.id,
      sessionID: message.info.sessionID,
      ...(message.info.role ? { role: message.info.role } : {}),
    },
    parts: message.parts.map((part) => part as Record<string, unknown>),
  }));
}
