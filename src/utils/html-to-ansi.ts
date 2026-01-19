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
 * Colorize text with RGB values using ANSI escape codes
 */
export function colorize(
  text: string,
  r: number,
  g: number,
  b: number
): string {
  return `${rgbToAnsi(r, g, b)}${text}${ANSI_RESET}`;
}

/**
 * Convert HTML with inline RGB color styles to ANSI-colored text
 *
 * Supports:
 * - <span style="color: rgb(R, G, B)">text</span>
 * - Plain text nodes
 * - <br> and <br/> tags as newlines
 *
 * @param html The HTML string to convert
 * @returns Terminal-ready string with ANSI color codes
 */
export function htmlToAnsi(html: string): string {
  let result = "";
  let pos = 0;

  while (pos < html.length) {
    // Look for the next tag
    const tagStart = html.indexOf("<", pos);

    if (tagStart === -1) {
      // No more tags, append remaining text
      result += html.slice(pos);
      break;
    }

    // Append text before the tag
    if (tagStart > pos) {
      result += html.slice(pos, tagStart);
    }

    // Find the end of the tag
    const tagEnd = html.indexOf(">", tagStart);
    if (tagEnd === -1) {
      // Malformed HTML, append rest as text
      result += html.slice(tagStart);
      break;
    }

    const tag = html.slice(tagStart + 1, tagEnd);
    pos = tagEnd + 1;

    // Handle different tag types
    if (tag.startsWith("br")) {
      // <br> or <br/>
      result += "\n";
    } else if (tag.startsWith("span")) {
      // Extract style attribute
      const styleMatch = tag.match(/style="([^"]*)"/);
      const style = styleMatch ? styleMatch[1] : null;
      const rgb = parseRgb(style);

      // Find the closing </span>
      const closeTag = "</span>";
      const closePos = html.indexOf(closeTag, pos);

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
    } else if (tag.startsWith("div") || tag.startsWith("pre")) {
      // Skip container tags, they don't affect output
      continue;
    } else if (tag === "/div" || tag === "/pre") {
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
