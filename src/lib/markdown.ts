/**
 * Markdown Frontmatter Parser
 *
 * Parses markdown files with YAML frontmatter delimited by `---` markers.
 * Shared utility used by both agent and skill discovery.
 */
/**
 * Lazy-loaded YAML parser. The `yaml` package uses CJS with ~20 chained
 * require() calls, so we defer loading until actually needed to avoid
 * penalizing CLI startup (e.g. `--help`) with ~14ms of module loading.
 */
let _parseYaml: typeof import("yaml")["parse"] | undefined;
function getParseYaml() {
  if (!_parseYaml) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _parseYaml = (require("yaml") as typeof import("yaml")).parse;
  }
  return _parseYaml;
}

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
    const parsedFrontmatter = getParseYaml()(yamlContent, {
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
