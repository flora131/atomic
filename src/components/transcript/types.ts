export type TranscriptLineType =
  | "user-prompt"
  | "file-read"
  | "thinking-header"
  | "thinking-content"
  | "timestamp"
  | "assistant-bullet"
  | "assistant-text"
  | "tool-header"
  | "tool-content"
  | "agent-header"
  | "agent-row"
  | "agent-substatus"
  | "separator"
  | "footer"
  | "blank";

export interface TranscriptLine {
  type: TranscriptLineType;
  content: string;
  indent: number;
}
