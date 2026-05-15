const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const ANSI_TOKEN_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]|[\s\S]/gu;

export function visibleWidth(text: string): number {
  const stripped = text.replace(ANSI_PATTERN, "");
  let width = 0;
  for (const char of stripped) {
    width += charWidth(char);
  }
  return width;
}

export function truncateToWidth(
  text: string,
  width: number,
  suffix = "",
  preserveAnsi = false,
): string {
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;

  const suffixWidth = visibleWidth(suffix);
  const target = Math.max(0, width - suffixWidth);
  let current = 0;
  let output = "";
  const ansiSeen: string[] = [];

  for (const token of text.match(ANSI_TOKEN_PATTERN) ?? []) {
    if (ANSI_PATTERN.test(token)) {
      ANSI_PATTERN.lastIndex = 0;
      output += token;
      if (preserveAnsi) ansiSeen.push(token);
      continue;
    }
    ANSI_PATTERN.lastIndex = 0;

    const nextWidth = charWidth(token);
    if (current + nextWidth > target) break;
    current += nextWidth;
    output += token;
  }

  if (preserveAnsi && ansiSeen.length > 0) {
    output += "\x1b[0m";
  }
  return output + suffix;
}

export function matchesKey(data: string, key: string): boolean {
  const normalized = key.toLowerCase();
  if (normalized.length === 1) return data.toLowerCase() === normalized;

  if (normalized === "enter") return data === "\r" || data === "\n";
  if (normalized === "escape") return data === "\x1b";
  if (normalized === "up") return data === "\x1b[A";
  if (normalized === "down") return data === "\x1b[B";
  if (normalized === "right") return data === "\x1b[C";
  if (normalized === "left") return data === "\x1b[D";
  return false;
}

function charWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (codePoint === 0) return 0;
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (codePoint >= 0x300 && codePoint <= 0x36f) return 0;
  if (isWide(codePoint)) return 2;
  return 1;
}

function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  );
}
