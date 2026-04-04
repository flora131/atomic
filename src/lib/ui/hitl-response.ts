/**
 * HITL response utilities for AskUserQuestion/question tool rendering.
 */

export const HITL_DECLINED_MESSAGE = "User declined to answer.";

export type HitlResponseMode = "option" | "custom_input" | "chat_about_this" | "declined";

export interface HitlResponseRecord {
  cancelled: boolean;
  responseMode: HitlResponseMode;
  answerText: string;
  displayText: string;
}

export interface HitlAnswerInput {
  selected: string | string[];
  cancelled: boolean;
  responseMode?: HitlResponseMode;
}

function toAnswerText(selected: string | string[]): string {
  return Array.isArray(selected) ? selected.join(", ") : String(selected ?? "");
}

export function formatHitlDisplayText(response: {
  cancelled: boolean;
  responseMode: HitlResponseMode;
  answerText: string;
}): string {
  if (response.cancelled || response.responseMode === "declined") {
    return HITL_DECLINED_MESSAGE;
  }

  if (response.responseMode === "chat_about_this") {
    return "User requested to chat about the question";
  }

  return `User answered: "${response.answerText}"`;
}

export function normalizeHitlAnswer(answer: HitlAnswerInput): HitlResponseRecord {
  const responseMode = answer.cancelled
    ? "declined"
    : (answer.responseMode ?? "option");
  const cancelled = answer.cancelled || responseMode === "declined";
  const answerText = cancelled ? "" : toAnswerText(answer.selected);

  return {
    cancelled,
    responseMode,
    answerText,
    displayText: formatHitlDisplayText({ cancelled, responseMode, answerText }),
  };
}

export function getHitlResponseRecord(toolCall: {
  hitlResponse?: HitlResponseRecord;
  output?: unknown;
}): HitlResponseRecord | null {
  return toolCall.hitlResponse ?? null;
}
