import type {
  Event as OpenCodeEvent,
  EventMessagePartRemoved,
  EventPermissionAsked,
  EventQuestionAsked,
} from "@opencode-ai/sdk/v2/client";
import { assertNeverEvent } from "@/services/agents/clients/opencode/shared.ts";
import type { OpenCodeEventMapperContext } from "@/services/agents/clients/opencode/event-mapper-types.ts";
import {
  handleOpenCodeMessagePartRemoved,
  handleOpenCodePermissionAsked,
  handleOpenCodeQuestionAsked,
} from "@/services/agents/clients/opencode/event-interaction-handlers.ts";
import {
  handleOpenCodeMessagePartUpdated,
} from "@/services/agents/clients/opencode/event-part-handlers.ts";
import {
  handleOpenCodeMessagePartDelta,
  handleOpenCodeMessageUpdated,
  isOpenCodeIgnoredSdkEvent,
} from "@/services/agents/clients/opencode/event-message-handlers.ts";
import {
  handleOpenCodeSessionEvent,
} from "@/services/agents/clients/opencode/event-session-handlers.ts";

export function handleOpenCodeSdkEvent(
  event: OpenCodeEvent,
  context: OpenCodeEventMapperContext,
): void {
  const properties = event.properties as Record<string, unknown> | undefined;

  if (handleOpenCodeSessionEvent(event, properties, context)) {
    return;
  }

  switch (event.type) {
    case "message.updated":
      handleOpenCodeMessageUpdated(event, context);
      break;
    case "message.removed": {
      const removed = properties as { sessionID?: string; messageID?: string } | undefined;
      context.sessionStateSupport.deleteMessageRole(removed?.sessionID ?? "", removed?.messageID ?? "");
      break;
    }

    case "message.part.updated":
      handleOpenCodeMessagePartUpdated(event, properties, context);
      break;

    case "permission.asked":
      handleOpenCodePermissionAsked(event as EventPermissionAsked, context);
      break;

    case "question.asked":
      handleOpenCodeQuestionAsked(event as EventQuestionAsked, context);
      break;

    case "question.replied":
    case "question.rejected":
    case "permission.replied":
      break;

    case "message.part.removed":
      handleOpenCodeMessagePartRemoved(event as EventMessagePartRemoved, context);
      break;

    case "message.part.delta":
      handleOpenCodeMessagePartDelta(event, properties, context);
      break;

    default:
      if (isOpenCodeIgnoredSdkEvent(event)) {
        return;
      }
      assertNeverEvent(event as never);
      break;
  }
}
export {
  handleOpenCodeMessagePartRemoved,
  handleOpenCodePermissionAsked,
  handleOpenCodeQuestionAsked,
} from "@/services/agents/clients/opencode/event-interaction-handlers.ts";
