import type {
  PermissionHandler as SdkPermissionHandler,
  SessionConfig as SdkSessionConfig,
} from "@github/copilot-sdk";

import type { ProviderStreamEventDataMap } from "@/services/agents/provider-events.ts";
import {
  isToolDisabledBySubagentPolicy,
  resolveSubagentToolPolicy,
} from "@/services/agents/subagent-tool-policy.ts";
import type {
  CopilotAgentToolPolicy,
  CopilotSessionState,
} from "@/services/agents/clients/copilot/types.ts";

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

function getPermissionRequestToolName(request: unknown): string | undefined {
  if (typeof request !== "object" || request === null) {
    return undefined;
  }

  const record = request as Record<string, unknown>;
  const toolName = typeof record.toolName === "string" ? record.toolName : undefined;
  const mcpToolName = typeof record.mcpToolName === "string" ? record.mcpToolName : undefined;
  return toolName ?? mcpToolName;
}

function getPermissionRequestToolCallId(request: unknown): string | undefined {
  if (typeof request !== "object" || request === null) {
    return undefined;
  }

  const record = request as Record<string, unknown>;
  return typeof record.toolCallId === "string" ? record.toolCallId : undefined;
}

export function createAutoApprovePermissionHandler(args?: {
  sessions?: Map<string, CopilotSessionState>;
  agentToolPolicies?: Record<string, CopilotAgentToolPolicy>;
  fallbackHandler?: SdkPermissionHandler;
}): SdkPermissionHandler {
  return async (request, invocation) => {
    const sessionId = typeof invocation?.sessionId === "string"
      ? invocation.sessionId
      : "";
    const toolCallId = getPermissionRequestToolCallId(request);
    const toolName = getPermissionRequestToolName(request);
    const subagentName = toolCallId && sessionId
      ? args?.sessions?.get(sessionId)?.toolCallIdToSubagentName.get(toolCallId)
      : undefined;
    const policy = subagentName
      ? resolveSubagentToolPolicy(args?.agentToolPolicies, subagentName)
      : undefined;

    if (
      toolName
      && isToolDisabledBySubagentPolicy(policy, toolName, { treatToolsAsAllowlist: true })
    ) {
      return { kind: "denied-interactively-by-user" as const };
    }

    if (args?.fallbackHandler) {
      return await args.fallbackHandler(request, invocation);
    }

    return { kind: "approved" as const };
  };
}

export function createDenyAllPermissionHandler(): SdkPermissionHandler {
  return async () => ({ kind: "denied-interactively-by-user" });
}

export function createCopilotUserInputHandler(args: {
  preferredSessionId: string;
  getActiveSessionIds: () => string[];
  emitHumanInputRequired: (
    sessionId: string,
    data: ProviderStreamEventDataMap["human_input_required"],
  ) => void;
  emitProviderHumanInputRequired: (
    sessionId: string,
    data: ProviderStreamEventDataMap["human_input_required"],
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
        }))
      : [];

    const response = await new Promise<string | string[]>((resolve) => {
      const requestId = `ask_user_${Date.now()}`;
      const providerData = {
        requestId,
        question: request.question,
        options,
        nodeId: requestId,
        toolCallId,
        respond: resolve,
      } satisfies ProviderStreamEventDataMap["human_input_required"];

      args.emitHumanInputRequired(resolvedSessionId, providerData);
      args.emitProviderHumanInputRequired(resolvedSessionId, providerData, {
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
