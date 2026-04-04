import type {
  EventMessagePartRemoved,
  EventPermissionAsked,
  EventQuestionAsked,
} from "@opencode-ai/sdk/v2/client";
import type { ProviderStreamEventDataMap } from "@/services/agents/provider-events.ts";
import type {
  OpenCodeAutoDenyPermissionContext,
  OpenCodePermissionContext,
  OpenCodeProviderOnlyContext,
} from "@/services/agents/clients/opencode/event-mapper-types.ts";

export function handleOpenCodePermissionAsked(
  event: EventPermissionAsked,
  context: OpenCodeAutoDenyPermissionContext | OpenCodePermissionContext,
): void {
  const request = event.properties;
  const sessionId = request.sessionID;
  const toolInput = request.metadata;
  const autoDeny = "resolveAutoDenyForPermission" in context
    ? context.resolveAutoDenyForPermission(sessionId, request.permission)
    : null;

  if (autoDeny) {
    context.sdkClient?.permission.reply({
      requestID: request.id,
      directory: context.directory,
      reply: "reject",
    }).catch((error) => {
      console.error("Failed to auto-deny permission request:", error);
    });

    const message = `Auto-denied ${request.permission} because it is disabled in the ${autoDeny.subagentName} sub-agent frontmatter.`;
    context.emitEvent("session.warning", autoDeny.parentSessionId, {
      warningType: "permission_denied",
      message,
    });
    context.emitProviderEvent("session.warning", autoDeny.parentSessionId, {
      warningType: "permission_denied",
      message,
    }, {
      native: event,
      nativeEventId: request.id,
      nativeSessionId: sessionId,
    });
    return;
  }

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
  const questions = request.questions;

  if (!requestId || questions.length === 0) return;

  // Single-question fast path — preserves existing behavior exactly.
  if (questions.length === 1) {
    const question = questions[0]!;
    const providerData = {
      requestId,
      question: question.question,
      header: question.header,
      options: question.options.map((opt) => ({
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
      toolCallId: request.tool?.callID,
    } satisfies ProviderStreamEventDataMap["human_input_required"];

    context.emitEvent("human_input_required", sessionId, providerData);
    context.emitProviderEvent("human_input_required", sessionId, providerData, {
      native: event,
      nativeEventId: requestId,
      nativeSessionId: sessionId,
    });
    return;
  }

  // Multi-question: emit one event per question. The HITL queue in
  // use-workflow-hitl.ts handles sequential display. A barrier collects
  // all answers, then sends a single question.reply to the OpenCode SDK.
  const totalQuestions = questions.length;
  const collectedAnswers: (string[] | null)[] = Array.from({ length: totalQuestions }, () => null);
  let answeredCount = 0;
  let rejected = false;

  for (let i = 0; i < totalQuestions; i++) {
    const question = questions[i]!;
    const questionRequestId = `${requestId}_q${i}`;

    const providerData = {
      requestId: questionRequestId,
      question: question.question,
      header: question.header,
      options: question.options.map((opt) => ({
        label: opt.label,
        description: opt.description,
      })),
      nodeId: request.tool?.callID ?? requestId,
      respond: (answer: string | string[]) => {
        if (rejected || !context.sdkClient) return;

        if (answer === "deny") {
          rejected = true;
          context.sdkClient.question.reject({
            requestID: requestId,
            directory: context.directory,
          }).catch((error) => {
            console.error("Failed to reject question:", error);
          });
          return;
        }

        collectedAnswers[i] = Array.isArray(answer) ? answer : [answer];
        answeredCount++;

        if (answeredCount === totalQuestions) {
          context.sdkClient.question.reply({
            requestID: requestId,
            directory: context.directory,
            answers: collectedAnswers as string[][],
          }).catch((error) => {
            console.error("Failed to reply to question:", error);
          });
        }
      },
      toolCallId: request.tool?.callID,
    } satisfies ProviderStreamEventDataMap["human_input_required"];

    context.emitEvent("human_input_required", sessionId, providerData);
    context.emitProviderEvent("human_input_required", sessionId, providerData, {
      native: event,
      nativeEventId: requestId,
      nativeSessionId: sessionId,
    });
  }
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
