/**
 * Code Block Component
 *
 * React component for syntax-highlighted code blocks using OpenTUI.
 * Supports streaming updates and language detection.
 *
 * Reference: Feature 18 - Add syntax-highlighted code blocks via CodeRenderable
 */

import React from "react";
import type { SyntaxStyle } from "@opentui/core";
import { useThemeColors } from "./theme.tsx";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for the CodeBlock component.
 */
export interface CodeBlockProps {
  /** The code content to display */
  content: string;
  /** Programming language for syntax highlighting (e.g., "typescript", "python") */
  language?: string;
  /** Whether the code is currently streaming */
  streaming?: boolean;
  /** Syntax style for highlighting (required for syntax highlighting) */
  syntaxStyle?: SyntaxStyle;
  /** Whether to show line numbers */
  showLineNumbers?: boolean;
  /** Title to display above the code block */
  title?: string;
}

/**
 * Parsed code block from markdown content.
 */
export interface ParsedCodeBlock {
  /** The code content */
  content: string;
  /** Programming language identifier */
  language: string;
  /** Start index in original text */
  startIndex: number;
  /** End index in original text */
  endIndex: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Map common language aliases to standard filetype identifiers.
 */
export function normalizeLanguage(language: string): string {
  const aliases: Record<string, string> = {
    // JavaScript/TypeScript
    js: "javascript",
    ts: "typescript",
    jsx: "javascript",
    tsx: "typescript",

    // Python
    py: "python",
    python3: "python",

    // Shell
    sh: "bash",
    shell: "bash",
    zsh: "bash",

    // Web
    html: "html",
    htm: "html",
    css: "css",
    scss: "css",
    sass: "css",
    less: "css",

    // Data formats
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    toml: "toml",

    // Other languages
    rs: "rust",
    go: "go",
    rb: "ruby",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    "c++": "cpp",
    cs: "csharp",
    "c#": "csharp",
    php: "php",
    sql: "sql",
    md: "markdown",
    markdown: "markdown",
  };

  const normalized = language.toLowerCase().trim();
  return aliases[normalized] ?? normalized;
}

/**
 * Extract code blocks from markdown content.
 *
 * Parses markdown-style fenced code blocks (```language ... ```)
 * and returns an array of parsed code blocks with their positions.
 *
 * @example
 * ```ts
 * const markdown = `
 * Here's some code:
 * \`\`\`typescript
 * const x = 1;
 * \`\`\`
 * `;
 * const blocks = extractCodeBlocks(markdown);
 * // [{ content: "const x = 1;", language: "typescript", startIndex: 17, endIndex: 52 }]
 * ```
 */
export function extractCodeBlocks(markdown: string): ParsedCodeBlock[] {
  const blocks: ParsedCodeBlock[] = [];

  // Regex to match fenced code blocks
  // Matches: ```language\ncontent\n```
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    const [fullMatch, language, content] = match;
    if (fullMatch && content !== undefined) {
      blocks.push({
        content: content.trimEnd(),
        language: normalizeLanguage(language ?? ""),
        startIndex: match.index,
        endIndex: match.index + fullMatch.length,
      });
    }
  }

  return blocks;
}

/**
 * Check if a string contains any code blocks.
 */
export function hasCodeBlocks(text: string): boolean {
  return /```\w*\n[\s\S]*?```/.test(text);
}

/**
 * Extract inline code from text (single backticks).
 */
export function extractInlineCode(text: string): string[] {
  const matches = text.match(/`([^`]+)`/g);
  if (!matches) return [];
  return matches.map((match) => match.slice(1, -1));
}

// ============================================================================
// CODE BLOCK COMPONENT
// ============================================================================

/**
 * Renders a syntax-highlighted code block.
 *
 * Uses OpenTUI's code renderable for syntax highlighting.
 * Falls back to plain text if no syntaxStyle is provided.
 *
 * @example
 * ```tsx
 * <CodeBlock
 *   content="const x = 1;"
 *   language="typescript"
 *   syntaxStyle={mySyntaxStyle}
 * />
 * ```
 */
export function CodeBlock({
  content,
  language = "",
  streaming = false,
  syntaxStyle,
  showLineNumbers = false,
  title,
}: CodeBlockProps): React.ReactNode {
  const themeColors = useThemeColors();
  const normalizedLanguage = normalizeLanguage(language);
  const displayTitle = title ?? (normalizedLanguage ? normalizedLanguage : undefined);

  // If no syntaxStyle provided, render as plain text in a box
  if (!syntaxStyle) {
    return (
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor={themeColors.codeBorder}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={0}
        paddingBottom={0}
        marginTop={1}
        marginBottom={1}
      >
        {displayTitle && (
          <text fg={themeColors.codeTitle} attributes={2}>
            {displayTitle}
          </text>
        )}
        <text wrapMode="none" fg={themeColors.foreground}>
          {content}
        </text>
      </box>
    );
  }

  // Render with syntax highlighting
  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={themeColors.codeBorder}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      marginTop={1}
      marginBottom={1}
    >
      {displayTitle && (
        <text fg={themeColors.codeTitle} attributes={2}>
          {displayTitle}
        </text>
      )}
      {showLineNumbers ? (
        <line-number>
          <code
            content={content}
            filetype={normalizedLanguage || undefined}
            syntaxStyle={syntaxStyle}
            streaming={streaming}
          />
        </line-number>
      ) : (
        <code
          content={content}
          filetype={normalizedLanguage || undefined}
          syntaxStyle={syntaxStyle}
          streaming={streaming}
        />
      )}
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default CodeBlock;
