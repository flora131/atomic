import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { globalRegistry } from "../commands/index.ts";

export interface ParsedAtMention {
  agentName: string;
  args: string;
}

export interface FileReadInfo {
  path: string;
  sizeBytes: number;
  lineCount: number;
  isImage: boolean;
  isDirectory: boolean;
}

export interface ProcessedMention {
  message: string;
  filesRead: FileReadInfo[];
}

interface MentionToken {
  token: string;
  start: number;
  end: number;
}

const AT_REFERENCE_REGEX = /@([\w./_-]+)/g;

function tokenizeAtReferences(message: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  const regex = new RegExp(AT_REFERENCE_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(message)) !== null) {
    const token = match[1] ?? "";
    if (!token) continue;
    const raw = match[0] ?? `@${token}`;
    tokens.push({
      token,
      start: match.index,
      end: match.index + raw.length,
    });
  }

  return tokens;
}

export function hasAnyAtReferenceToken(message: string): boolean {
  return /@([\w./_-]+)/.test(message);
}

/**
 * Parse @mentions in a message and extract agent invocations.
 * Returns an array of { agentName, args } for each agent mention found.
 */
export function parseAtMentions(message: string): ParsedAtMention[] {
  const atMentions: ParsedAtMention[] = [];
  const agentPositions: Array<{ name: string; start: number; end: number }> = [];

  for (const token of tokenizeAtReferences(message)) {
    const cmd = globalRegistry.get(token.token);
    if (cmd && cmd.category === "agent") {
      agentPositions.push({
        name: token.token,
        start: token.start,
        end: token.end,
      });
    }
  }

  for (let i = 0; i < agentPositions.length; i++) {
    const pos = agentPositions[i]!;
    const nextPos = agentPositions[i + 1];
    const argsStart = pos.end;
    const argsEnd = nextPos ? nextPos.start : message.length;
    const args = message.slice(argsStart, argsEnd).trim();
    atMentions.push({ agentName: pos.name, args });
  }

  return atMentions;
}

/**
 * Process file @mentions in a message. Resolves @filepath references and collects
 * metadata about mentioned files without loading their content into the context window.
 */
export function processFileMentions(message: string): ProcessedMention {
  const filesRead: FileReadInfo[] = [];
  const cleanedMessage = message.replace(AT_REFERENCE_REGEX, (match, filePath: string) => {
    const cmd = globalRegistry.get(filePath);
    if (cmd && cmd.category === "agent") return match;

    try {
      const fullPath = join(process.cwd(), filePath);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        const entries = readdirSync(fullPath, { withFileTypes: true });

        filesRead.push({
          path: filePath.endsWith("/") ? filePath : `${filePath}/`,
          sizeBytes: stats.size,
          lineCount: entries.length,
          isImage: false,
          isDirectory: true,
        });

        return filePath;
      }

      const content = readFileSync(fullPath, "utf-8");
      const lineCount = content.split("\n").length;
      const isImage = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(filePath);

      filesRead.push({
        path: filePath,
        sizeBytes: stats.size,
        lineCount,
        isImage,
        isDirectory: false,
      });

      return filePath;
    } catch {
      return match;
    }
  });

  return { message: cleanedMessage, filesRead };
}
