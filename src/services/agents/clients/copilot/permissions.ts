import type {
  PermissionHandler as SdkPermissionHandler,
  SessionConfig as SdkSessionConfig,
} from "@github/copilot-sdk";

import type { ProviderStreamEventDataMap } from "@/services/agents/provider-events.ts";

export function resolveCopilotUserInputSessionId(
  preferredSessionId: string,
  activeSessionIds: string[],
): string {
  if (preferredSessionId.length > 0 && activeSessionIds.includes(preferredSessionId)) {
    return preferredSessionId;
  }
  const latestActive = activeSessionIds[activeSessionIds.length - 1];
  return latestActive ?? preferredSessionId;
}

export function createAutoApprovePermissionHandler(): SdkPermissionHandler {
  return async () => ({ kind: "approved" });
}

export function createDenyAllPermissionHandler(): SdkPermissionHandler {
  return async () => ({ kind: "denied-interactively-by-user" });
}

export function createCopilotUserInputHandler(args: {
  preferredSessionId: string;
  getActiveSessionIds: () => string[];
  emitPermissionRequested: (
    sessionId: string,
    data: ProviderStreamEventDataMap["permission.requested"],
  ) => void;
  emitProviderPermissionRequested: (
    sessionId: string,
    data: ProviderStreamEventDataMap["permission.requested"],
    options: { nativeSessionId: string; nativeEventId: string },
  ) => void;
}): SdkSessionConfig["onUserInputRequest"] {
  return async (request) => {
    const resolvedSessionId = resolveCopilotUserInputSessionId(
      args.preferredSessionId,
      args.getActiveSessionIds(),
    );
    const requestRecord = request as unknown as Record<string, unknown>;
    const toolCallId = typeof requestRecord.toolCallId === "string"
      ? requestRecord.toolCallId
      : undefined;

    const options = request.choices
      ? request.choices.map((choice: string) => ({
          label: choice,
          value: choice,
        }))
      : [];

    const response = await new Promise<string | string[]>((resolve) => {
      const requestId = `ask_user_${Date.now()}`;
      const providerData = {
        requestId,
        toolName: "ask_user",
        question: request.question,
        options,
        toolCallId,
        respond: resolve,
      } satisfies ProviderStreamEventDataMap["permission.requested"];

      args.emitPermissionRequested(resolvedSessionId, providerData);
      args.emitProviderPermissionRequested(resolvedSessionId, providerData, {
        nativeSessionId: resolvedSessionId,
        nativeEventId: requestId,
      });
    });

    const answer = Array.isArray(response) ? response.join(", ") : response;
    return {
      answer,
      wasFreeform: !request.choices?.includes(answer),
    };
  };
}
