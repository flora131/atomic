import { OpenCodeClient } from "@/services/agents/clients/opencode.ts";

export type OpenCodeSettlingClient = {
  resolveModelContextWindow: (modelHint?: string) => Promise<number>;
  handleSdkEvent: (event: Record<string, unknown>) => void;
  sdkClient: {
    session: {
      promptAsync: (params: Record<string, unknown>) => Promise<void>;
    };
  };
  wrapSession: (
    sid: string,
    config: Record<string, unknown>,
  ) => Promise<{
    stream: (
      message: string,
      options?: { agent?: string },
    ) => AsyncIterable<{ type: string; content: unknown }>;
  }>;
  currentSessionId: string | null;
};

export function createSettlingClient(): OpenCodeSettlingClient {
  const client = new OpenCodeClient() as unknown as OpenCodeSettlingClient;
  client.resolveModelContextWindow = async () => 200_000;
  return client;
}

export function emitSdkEvent(
  client: OpenCodeSettlingClient,
  event: Record<string, unknown>,
): void {
  client.handleSdkEvent(event);
}

export async function wrapSettlingSession(
  client: OpenCodeSettlingClient,
  sessionId: string,
) {
  return client.wrapSession(sessionId, {});
}
