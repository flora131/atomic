/**
 * HITL response utilities for AskUserQuestion/question tool rendering.
 */

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

interface HitlOutputShape {
  answer?: string | null;
  cancelled?: boolean;
  responseMode?: HitlResponseMode;
  displayText?: string;
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
    return "User declined to answer question";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getHitlResponseRecord(toolCall: {
  hitlResponse?: HitlResponseRecord;
  output?: unknown;
}): HitlResponseRecord | null {
  if (toolCall.hitlResponse) {
    return toolCall.hitlResponse;
  }

  if (!isRecord(toolCall.output)) {
    return null;
  }

  const output = toolCall.output as HitlOutputShape;
  const hasLegacyFields = (
    Object.hasOwn(output, "answer")
    || Object.hasOwn(output, "cancelled")
    || Object.hasOwn(output, "responseMode")
    || Object.hasOwn(output, "displayText")
  );
  if (!hasLegacyFields) {
    return null;
  }

  const cancelled = output.cancelled ?? false;
  const responseMode = cancelled
    ? "declined"
    : (output.responseMode ?? "option");
  const answerText = cancelled ? "" : String(output.answer ?? "");

  return {
    cancelled,
    responseMode,
    answerText,
    displayText: output.displayText ?? formatHitlDisplayText({
      cancelled,
      responseMode,
      answerText,
    }),
  };
}
