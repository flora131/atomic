import type {
  EventMessagePartRemoved,
  EventPermissionAsked,
  EventQuestionAsked,
} from "@opencode-ai/sdk/v2/client";
import type { ProviderStreamEventDataMap } from "@/services/agents/provider-events.ts";
import type {
  OpenCodePermissionContext,
  OpenCodeProviderOnlyContext,
} from "@/services/agents/clients/opencode/event-mapper-types.ts";

export function handleOpenCodePermissionAsked(
  event: EventPermissionAsked,
  context: OpenCodePermissionContext,
): void {
  const request = event.properties;
  const sessionId = request.sessionID;
  const toolInput = request.metadata;
  const providerData = {
    requestId: request.id,
    toolName: request.permission,
    toolInput,
    question: `Allow ${request.permission} for ${request.patterns.join(", ") || "this request"}?`,
    header: "Permission",
    options: [
      { label: "Allow once", value: "once", description: "Approve this request one time." },
      { label: "Always allow", value: "always", description: "Approve this request and remember it." },
      { label: "Reject", value: "reject", description: "Deny this request." },
    ],
    respond: (answer: string | string[]) => {
      if (!context.sdkClient) return;
      const reply = context.sessionStateSupport.mapOpenCodePermissionReply(answer);
      context.sdkClient.permission.reply({
        requestID: request.id,
        directory: context.directory,
        reply,
      }).catch((error) => {
        console.error("Failed to reply to permission request:", error);
      });
    },
    toolCallId: request.tool?.callID,
  } satisfies ProviderStreamEventDataMap["permission.requested"];

  context.emitEvent("permission.requested", sessionId, providerData);
  context.emitProviderEvent("permission.requested", sessionId, providerData, {
    native: event,
    nativeEventId: request.id,
    nativeSessionId: sessionId,
  });
}

export function handleOpenCodeQuestionAsked(
  event: EventQuestionAsked,
  context: OpenCodeProviderOnlyContext,
): void {
  const request = event.properties;
  const requestId = request.id;
  const sessionId = request.sessionID;
  const firstQuestion = request.questions[0];

  if (!requestId || !firstQuestion) return;

  const providerData = {
    requestId,
    question: firstQuestion.question,
    header: firstQuestion.header,
    options: firstQuestion.options.map((opt) => ({
      label: opt.label,
      description: opt.description,
    })),
    nodeId: request.tool?.callID ?? requestId,
    respond: (answer: string | string[]) => {
      if (!context.sdkClient) return;
      const answers = Array.isArray(answer) ? [answer] : [[answer]];
      context.sdkClient.question.reply({
        requestID: requestId,
        directory: context.directory,
        answers,
      }).catch((error) => {
        console.error("Failed to reply to question:", error);
      });
    },
  } satisfies ProviderStreamEventDataMap["human_input_required"];

  context.emitEvent("human_input_required", sessionId, providerData);
  context.emitProviderEvent("human_input_required", sessionId, providerData, {
    native: event,
    nativeEventId: requestId,
    nativeSessionId: sessionId,
  });
}

export function handleOpenCodeMessagePartRemoved(
  event: EventMessagePartRemoved,
  context: Pick<OpenCodePermissionContext, "sessionStateSupport">,
): void {
  context.sessionStateSupport.clearPartTracking(
    event.properties.sessionID,
    event.properties.messageID,
    event.properties.partID,
  );
}
