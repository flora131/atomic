/**
 * Utility for converting HTML with inline RGB styles to ANSI escape codes
 */

const ANSI_RESET = "\x1b[0m";

/**
 * Parse RGB values from a CSS style string
 * Matches patterns like "color: rgb(255, 128, 0)"
 */
export function parseRgb(
  styleAttr: string | null
): [number, number, number] | null {
  if (!styleAttr) return null;

  const match = styleAttr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return null;

  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

/**
 * Convert RGB values to ANSI 24-bit true color escape code (foreground)
 */
export function rgbToAnsi(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Convert RGB values to ANSI 24-bit true color escape code (background)
 */
export function rgbToAnsiBg(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}

/**
 * Check if a color is considered "black" (transparent)
 * Colors very close to black are treated as transparent to allow
 * the terminal background to show through.
 */
export function isBlack(r: number, g: number, b: number): boolean {
  // Treat very dark colors (sum < 30) as black/transparent
  return r + g + b < 30;
}

/**
 * Colorize text with RGB values using ANSI escape codes
 * Black colors (0,0,0) are treated as transparent - no color codes applied
 */
export function colorize(
  text: string,
  r: number,
  g: number,
  b: number
): string {
  // Treat black as transparent - just output the text without color codes
  if (isBlack(r, g, b)) {
    return text;
  }
  return `${rgbToAnsi(r, g, b)}${text}${ANSI_RESET}`;
}

/**
 * Convert HTML with inline RGB color styles to ANSI-colored text
 *
 * Supports:
 * - <span style="color: rgb(R, G, B)">text</span>
 * - Plain text nodes
 * - <br> and <br/> tags as newlines
 * - Full HTML documents (skips doctype, head, style, etc.)
 *
 * @param html The HTML string to convert
 * @returns Terminal-ready string with ANSI color codes
 */
export function htmlToAnsi(html: string): string {
  // Normalize HTML: join split closing tags like "</span\n      >"
  // Some HTML formatters split closing tags across lines
  html = html.replace(/<\/(\w+)\s*\n\s*>/g, "</$1>");

  let result = "";
  let pos = 0;
  let skipContent = false;

  while (pos < html.length) {
    // Look for the next tag
    const tagStart = html.indexOf("<", pos);

    if (tagStart === -1) {
      // No more tags, append remaining text (if not skipping)
      if (!skipContent) {
        const text = html.slice(pos).trim();
        if (text) result += text;
      }
      break;
    }

    // Append text before the tag (if not skipping)
    if (tagStart > pos && !skipContent) {
      result += html.slice(pos, tagStart);
    }

    // Find the end of the tag
    const tagEnd = html.indexOf(">", tagStart);
    if (tagEnd === -1) {
      // Malformed HTML, append rest as text
      if (!skipContent) {
        result += html.slice(tagStart);
      }
      break;
    }

    const tag = html.slice(tagStart + 1, tagEnd).toLowerCase();
    pos = tagEnd + 1;

    // Handle doctype and comments
    if (tag.startsWith("!")) {
      // Skip doctype and comments
      continue;
    }

    // Handle tags that should skip their content
    if (
      tag === "head" ||
      tag === "style" ||
      tag === "script" ||
      tag === "title" ||
      tag === "meta" ||
      tag === "link"
    ) {
      // Find closing tag and skip everything in between
      const closingTag = `</${tag.split(" ")[0]}>`;
      const closePos = html.toLowerCase().indexOf(closingTag, pos);
      if (closePos !== -1) {
        pos = closePos + closingTag.length;
      }
      continue;
    }

    // Handle different tag types
    if (tag.startsWith("br")) {
      // <br> or <br/>
      result += "\n";
    } else if (tag.startsWith("span")) {
      // Extract style attribute
      const originalTag = html.slice(tagStart + 1, tagEnd);
      const styleMatch = originalTag.match(/style="([^"]*)"/);
      const style = styleMatch ? styleMatch[1] : null;
      const rgb = parseRgb(style);

      // Find the closing </span>
      const closeTag = "</span>";
      const closePos = html.toLowerCase().indexOf(closeTag, pos);

      if (closePos === -1) {
        // Malformed HTML, skip
        continue;
      }

      const content = html.slice(pos, closePos);
      pos = closePos + closeTag.length;

      if (rgb && content.length > 0) {
        const [r, g, b] = rgb;
        result += colorize(content, r, g, b);
      } else {
        result += content;
      }
    } else if (tag.startsWith("/")) {
      // Closing tag without matching open, skip
      continue;
    } else if (
      tag.startsWith("div") ||
      tag.startsWith("pre") ||
      tag.startsWith("html") ||
      tag.startsWith("body")
    ) {
      // Skip container tags, they don't affect output
      continue;
    } else if (
      tag === "/div" ||
      tag === "/pre" ||
      tag === "/html" ||
      tag === "/body"
    ) {
      // Closing container tags
      continue;
    }
    // Skip other tags
  }

  return result;
}

/**
 * Strip ANSI escape codes from a string
 * Useful for calculating the visible width of colored text
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Get the visible width of a string (excluding ANSI codes)
 */
export function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}
