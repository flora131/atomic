import { formatTranscript, type TranscriptLine, type TranscriptLineType } from "@/lib/ui/transcript-formatter.ts";
import type { ChatMessage, StreamingMeta } from "@/screens/chat-screen.tsx";

export { formatTranscript };
export type { ChatMessage, StreamingMeta, TranscriptLine, TranscriptLineType };

export function findLinesByType(lines: TranscriptLine[], type: TranscriptLineType): TranscriptLine[] {
  return lines.filter((line) => line.type === type);
}

export function findFirstLineByType(lines: TranscriptLine[], type: TranscriptLineType): TranscriptLine | undefined {
  return lines.find((line) => line.type === type);
}
