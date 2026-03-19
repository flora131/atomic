import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

const AT_REFERENCE_REGEX = /@([\w./_-]+)/g;

export function hasAnyAtReferenceToken(message: string): boolean {
  return /@([\w./_-]+)/.test(message);
}

/**
 * Process file @mentions in a message. Resolves @filepath references and collects
 * metadata about mentioned files without loading their content into the context window.
 */
export function processFileMentions(
  message: string,
): ProcessedMention {
  const filesRead: FileReadInfo[] = [];
  const cleanedMessage = message.replace(AT_REFERENCE_REGEX, (match, filePath: string) => {
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
