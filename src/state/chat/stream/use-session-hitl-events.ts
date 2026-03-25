import { useBusSubscription } from "@/services/events/hooks.ts";
import type { AskUserQuestionEventData } from "@/services/workflows/graph/index.ts";
import type { MessageSkillLoad } from "@/state/chat/shared/types/index.ts";
import {
  shouldDisplaySkillLoadIndicator,
  tryTrackLoadedSkill,
} from "@/state/chat/shared/helpers/skill-load-tracking.ts";
import type { UseStreamSubscriptionsArgs } from "@/state/chat/stream/subscription-types.ts";

export function useSessionHitlEvents({
  appendSkillLoadIndicator,
  batchDispatcher,
  handleAskUserQuestion,
  handlePermissionRequest,
  loadedSkillsRef,
  runningAskQuestionToolIdsRef,
}: Pick<
  UseStreamSubscriptionsArgs,
  | "appendSkillLoadIndicator"
  | "batchDispatcher"
  | "handleAskUserQuestion"
  | "handlePermissionRequest"
  | "loadedSkillsRef"
  | "runningAskQuestionToolIdsRef"
>): void {
  useBusSubscription("stream.permission.requested", (event) => {
    // Flush the batch dispatcher so any pending stream.tool.start events
    // are processed before permission resolution needs to match tool parts.
    batchDispatcher.flush();

    const data = event.data;
    handlePermissionRequest(
      data.requestId,
      data.toolName,
      data.question,
      data.options,
      data.respond ?? (() => {}),
      data.header,
      data.toolCallId,
    );
  });

  useBusSubscription("stream.human_input_required", (event) => {
    // Flush the batch dispatcher so any pending stream.tool.start events
    // are processed first — this creates the ToolPart and populates
    // runningAskQuestionToolIdsRef before we try to resolve the toolCallId.
    batchDispatcher.flush();

    const data = event.data;
    // When the SDK doesn't provide a toolCallId (e.g. Copilot SDK's
    // onUserInputRequest), resolve it from the running ask-question tool
    // IDs that were registered synchronously during stream.tool.start.
    let resolvedToolCallId = data.toolCallId as string | undefined;
    if (!resolvedToolCallId && runningAskQuestionToolIdsRef.current.size > 0) {
      const ids = [...runningAskQuestionToolIdsRef.current];
      resolvedToolCallId = ids[ids.length - 1];
    }
    const askEvent: AskUserQuestionEventData = {
      requestId: data.requestId,
      question: data.question,
      header: data.header,
      options: data.options,
      multiSelect: data.multiSelect,
      dslAskUser: data.dslAskUser,
      nodeId: data.nodeId,
      respond: data.respond as ((answer: string | string[]) => void) | undefined,
      toolCallId: resolvedToolCallId,
    };
    handleAskUserQuestion(askEvent);
  });

  useBusSubscription("stream.skill.invoked", (event) => {
    const { skillName, agentId } = event.data;
    if (!shouldDisplaySkillLoadIndicator(agentId)) {
      return;
    }
    if (!tryTrackLoadedSkill(loadedSkillsRef.current, skillName)) {
      return;
    }

    const skillLoad: MessageSkillLoad = {
      skillName,
      status: "loaded",
    };
    appendSkillLoadIndicator(skillLoad);
  });
}
