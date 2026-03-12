import type { AgentMessage } from "@/services/agents/types.ts";
import { buildOpenCodePromptParts } from "@/services/agents/clients/opencode/prompt.ts";
import {
  extractOpenCodeErrorMessage,
  type OpenCodeSessionState,
} from "@/services/agents/clients/opencode/shared.ts";
import type { OpenCodeResolvedPromptModel } from "@/services/agents/clients/opencode/model.ts";
import type { OpenCodeSessionRuntimeArgs } from "@/services/agents/clients/opencode/session-runtime-types.ts";

export async function sendOpenCodeSessionPrompt(args: {
  runtimeArgs: OpenCodeSessionRuntimeArgs;
  sessionState: OpenCodeSessionState;
  agentMode: string;
  initialPromptModel: OpenCodeResolvedPromptModel | undefined;
  message: string;
}): Promise<AgentMessage> {
  if (args.sessionState.isClosed) {
    throw new Error("Session is closed");
  }
  const sdkClient = args.runtimeArgs.getSdkClient();
  if (!sdkClient) {
    throw new Error("Client not connected");
  }

  const result = await sdkClient.session.prompt({
    sessionID: args.runtimeArgs.sessionId,
    directory: args.runtimeArgs.directory,
    agent: args.agentMode,
    model: args.runtimeArgs.getActivePromptModel() ?? args.initialPromptModel,
    parts: buildOpenCodePromptParts(
      args.message,
      undefined,
      args.runtimeArgs.config.additionalInstructions,
    ),
  });

  if (result.error) {
    throw new Error(extractOpenCodeErrorMessage(result.error));
  }

  const tokens = result.data?.info?.tokens;
  if (tokens) {
    args.sessionState.inputTokens = tokens.input ?? args.sessionState.inputTokens;
    args.sessionState.outputTokens = tokens.output ?? args.sessionState.outputTokens;
  }

  const parts = result.data?.parts ?? [];
  const textParts = parts.filter((part) => part.type === "text");
  const content = textParts
    .map((part) => (part.text as string) ?? "")
    .join("");

  const toolParts = parts.filter((part) => part.type === "tool");
  if (toolParts.length > 0) {
    return {
      type: "tool_use",
      content: {
        toolCalls: toolParts.map((part) => {
          const state = (part.state as Record<string, unknown>) ?? {};
          return {
            id: (part.id as string) ?? "",
            name: (part.tool as string) ?? "",
            input: (state.input ?? {}) as Record<string, unknown>,
          };
        }),
      },
      role: "assistant",
    };
  }

  return {
    type: "text",
    content,
    role: "assistant",
  };
}

export async function sendOpenCodeSessionPromptAsync(args: {
  runtimeArgs: OpenCodeSessionRuntimeArgs;
  sessionState: OpenCodeSessionState;
  agentMode: string;
  initialPromptModel: OpenCodeResolvedPromptModel | undefined;
  message: string;
  options?: { agent?: string; abortSignal?: AbortSignal };
}): Promise<void> {
  if (args.sessionState.isClosed) {
    throw new Error("Session is closed");
  }
  const sdkClient = args.runtimeArgs.getSdkClient();
  if (!sdkClient) {
    throw new Error("Client not connected");
  }

  const result = await sdkClient.session.promptAsync(
    {
      sessionID: args.runtimeArgs.sessionId,
      directory: args.runtimeArgs.directory,
      agent: args.agentMode,
      model: args.runtimeArgs.getActivePromptModel() ?? args.initialPromptModel,
      parts: buildOpenCodePromptParts(
        args.message,
        args.options?.agent,
        args.runtimeArgs.config.additionalInstructions,
      ),
    },
    args.options?.abortSignal ? { signal: args.options.abortSignal } : undefined,
  );

  if (result?.error) {
    throw new Error(extractOpenCodeErrorMessage(result.error));
  }
}

export async function runOpenCodeSessionCommand(args: {
  runtimeArgs: OpenCodeSessionRuntimeArgs;
  sessionState: OpenCodeSessionState;
  agentMode: string;
  initialPromptModel: OpenCodeResolvedPromptModel | undefined;
  commandName: string;
  commandArgs: string;
  options?: { agent?: string; abortSignal?: AbortSignal };
}): Promise<void> {
  if (args.sessionState.isClosed) {
    throw new Error("Session is closed");
  }
  const sdkClient = args.runtimeArgs.getSdkClient();
  if (!sdkClient) {
    throw new Error("Client not connected");
  }

  const resolvedModel = args.runtimeArgs.getActivePromptModel() ?? args.initialPromptModel;
  const modelString = resolvedModel
    ? `${resolvedModel.providerID}/${resolvedModel.modelID}`
    : undefined;

  const result = await sdkClient.session.command(
    {
      sessionID: args.runtimeArgs.sessionId,
      directory: args.runtimeArgs.directory,
      agent: args.agentMode,
      model: modelString,
      command: args.commandName,
      arguments: args.commandArgs,
    },
    args.options?.abortSignal ? { signal: args.options.abortSignal } : undefined,
  );

  if (result?.error) {
    throw new Error(extractOpenCodeErrorMessage(result.error));
  }
}
