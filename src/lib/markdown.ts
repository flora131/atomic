/**
 * Markdown Frontmatter Parser
 *
 * Parses markdown files with YAML frontmatter delimited by `---` markers.
 * Shared utility used by both agent and skill discovery.
 */
import { parse as parseYaml } from "yaml";

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

  try {
    const parsedFrontmatter = parseYaml(yamlContent, {
      strict: false,
      uniqueKeys: false,
    });

    if (parsedFrontmatter === null || parsedFrontmatter === undefined) {
      return { frontmatter: {}, body };
    }

    if (typeof parsedFrontmatter !== "object" || Array.isArray(parsedFrontmatter)) {
      return null;
    }

    return {
      frontmatter: parsedFrontmatter as Record<string, unknown>,
      body,
    };
  } catch {
    return null;
  }
}
