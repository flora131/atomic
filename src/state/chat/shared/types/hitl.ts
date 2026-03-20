/**
 * Shared types for human-in-the-loop (HITL) question dialogs.
 *
 * These are pure type definitions extracted to the shared layer so
 * that both UI and state code can reference them without introducing
 * cross-layer imports.
 */

export interface QuestionOption {
  label: string;
  value: string;
  description?: string;
}

export interface UserQuestion {
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface QuestionAnswer {
  selected: string | string[];
  cancelled: boolean;
  responseMode: "option" | "custom_input" | "chat_about_this" | "declined";
}
