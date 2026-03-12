import { OpenCodeClient } from "@/services/agents/clients/opencode.ts";

export function createOpenCodeClient() {
  return new OpenCodeClient();
}

export function emitOpenCodeSdkEvent(client: OpenCodeClient, event: Record<string, unknown>) {
  (client as unknown as { handleSdkEvent: (sdkEvent: Record<string, unknown>) => void }).handleSdkEvent(event);
}

export function setOpenCodeCurrentSessionId(client: OpenCodeClient, sessionId: string | null) {
  (client as unknown as { currentSessionId: string | null }).currentSessionId = sessionId;
}
