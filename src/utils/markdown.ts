/**
 * Markdown Frontmatter Parser
 *
 * Parses markdown files with YAML frontmatter delimited by `---` markers.
 * Shared utility used by both agent and skill discovery.
 */

/**
 * Parse YAML frontmatter from a markdown file.
 * Extracts the frontmatter as a key-value object and separates it from the body.
 *
 * @param content - Raw markdown file content
 * @returns Parsed frontmatter and body, or null if invalid format
 */
export function parseMarkdownFrontmatter(
  content: string
): { frontmatter: Record<string, unknown>; body: string } | null {
  // Normalize CRLF to LF so the regex and line splitting work on all platforms
  const normalized = content.replace(/\r\n/g, "\n");
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
  const match = normalized.match(frontmatterRegex);

  if (!match) {
    return null;
  }

  const yamlContent = match[1] ?? "";
  const body = match[2] ?? "";

  // Parse simple YAML (key: value pairs, arrays, and objects)
  const frontmatter: Record<string, unknown> = {};

  const lines = yamlContent.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      i++;
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    // Check if this is an array or object (value is empty and next lines are indented)
    if (!value && i + 1 < lines.length) {
      const nextLine = lines[i + 1]!;
      const isArrayItem = nextLine.match(/^\s+- /);
      const isObjectItem = nextLine.match(/^\s+\w+:/);

      if (isArrayItem) {
        // Parse array
        const arr: string[] = [];
        i++;
        while (i < lines.length) {
          const arrLine = lines[i]!;
          const arrMatch = arrLine.match(/^\s+- (.+)$/);
          if (arrMatch) {
            arr.push(arrMatch[1]!.trim());
            i++;
          } else if (arrLine.trim() === "" || !arrLine.startsWith(" ")) {
            break;
          } else {
            i++;
          }
        }
        frontmatter[key] = arr;
        continue;
      } else if (isObjectItem) {
        // Parse object (for OpenCode tools format)
        const obj: Record<string, boolean> = {};
        i++;
        while (i < lines.length) {
          const objLine = lines[i]!;
          const objMatch = objLine.match(/^\s+(\w+):\s*(true|false)$/);
          if (objMatch) {
            obj[objMatch[1]!] = objMatch[2] === "true";
            i++;
          } else if (objLine.trim() === "" || !objLine.startsWith(" ")) {
            break;
          } else {
            i++;
          }
        }
        frontmatter[key] = obj;
        continue;
      }
    }

    // Simple string/number value
    if (value) {
      // Try to parse YAML flow sequence: [item1, item2, ...]
      const flowSeqMatch = value.match(/^\[(.+)\]$/);
      if (flowSeqMatch) {
        const items = flowSeqMatch[1]!
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        frontmatter[key] = items;
      } else if (value === "true") {
        frontmatter[key] = true;
      } else if (value === "false") {
        frontmatter[key] = false;
      } else {
        // Try to parse as number
        const numValue = Number(value);
        frontmatter[key] = Number.isNaN(numValue) ? value : numValue;
      }
    }

    i++;
  }

  return { frontmatter, body };
}
