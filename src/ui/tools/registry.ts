/**
 * ToolResultRegistry for Tool-specific Rendering
 *
 * Provides renderers for different tool types, allowing customized
 * display of tool inputs, outputs, and metadata.
 *
 * Reference: Feature 15 - Create ToolResultRegistry for tool-specific rendering
 */

import type { SyntaxStyle } from "@opentui/core";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props passed to tool render functions.
 */
export interface ToolRenderProps {
  /** Input parameters passed to the tool */
  input: Record<string, unknown>;
  /** Output from the tool (if available) */
  output?: unknown;
  /** Optional syntax style for code highlighting */
  syntaxStyle?: SyntaxStyle;
}

/**
 * Rendered result from a tool renderer.
 */
export interface ToolRenderResult {
  /** Title line to display (e.g., file path, command) */
  title: string;
  /** Content lines to display */
  content: string[];
  /** Language for syntax highlighting (optional) */
  language?: string;
  /** Whether to show as expandable/collapsible */
  expandable?: boolean;
}

/**
 * Interface for tool-specific renderers.
 */
export interface ToolRenderer {
  /** Icon to display for this tool (emoji or symbol) */
  icon: string;
  /** Generate title based on input/output */
  getTitle: (props: ToolRenderProps) => string;
  /** Render the tool result */
  render: (props: ToolRenderProps) => ToolRenderResult;
}

// ============================================================================
// READ TOOL RENDERER
// ============================================================================

/**
 * Renderer for the Read tool.
 * Displays file path and file contents.
 */
export const readToolRenderer: ToolRenderer = {
  icon: "📄",

  getTitle(props: ToolRenderProps): string {
    const filePath = props.input.file_path as string | undefined;
    if (!filePath) return "Read file";
    // Show just the filename if path is long
    const parts = filePath.split("/");
    const filename = parts[parts.length - 1] || filePath;
    return filename;
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const filePath = (props.input.file_path as string) || "unknown";
    const content = props.output as string | undefined;

    // Detect language from file extension
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const language = getLanguageFromExtension(ext);

    return {
      title: filePath,
      content: content ? content.split("\n") : ["(empty file)"],
      language,
      expandable: true,
    };
  },
};

// ============================================================================
// EDIT TOOL RENDERER
// ============================================================================

/**
 * Renderer for the Edit tool.
 * Displays file path and diff of changes.
 */
export const editToolRenderer: ToolRenderer = {
  icon: "✏️",

  getTitle(props: ToolRenderProps): string {
    const filePath = props.input.file_path as string | undefined;
    if (!filePath) return "Edit file";
    const parts = filePath.split("/");
    return parts[parts.length - 1] || filePath;
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const filePath = (props.input.file_path as string) || "unknown";
    const oldString = (props.input.old_string as string) || "";
    const newString = (props.input.new_string as string) || "";

    // Create a simple diff display
    const diffLines: string[] = [];
    diffLines.push(`--- ${filePath}`);
    diffLines.push(`+++ ${filePath}`);

    // Add removed lines (old_string)
    if (oldString) {
      for (const line of oldString.split("\n")) {
        diffLines.push(`- ${line}`);
      }
    }

    // Add added lines (new_string)
    if (newString) {
      for (const line of newString.split("\n")) {
        diffLines.push(`+ ${line}`);
      }
    }

    return {
      title: filePath,
      content: diffLines,
      language: "diff",
      expandable: true,
    };
  },
};

// ============================================================================
// BASH TOOL RENDERER
// ============================================================================

/**
 * Renderer for the Bash tool.
 * Displays command and output.
 */
export const bashToolRenderer: ToolRenderer = {
  icon: "💻",

  getTitle(props: ToolRenderProps): string {
    const command = props.input.command as string | undefined;
    if (!command) return "Run command";
    // Truncate long commands
    const maxLen = 50;
    if (command.length > maxLen) {
      return command.slice(0, maxLen - 3) + "...";
    }
    return command;
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const command = (props.input.command as string) || "";
    const output = props.output as string | undefined;

    const content: string[] = [];
    content.push(`$ ${command}`);
    if (output) {
      content.push(""); // Blank line
      content.push(...output.split("\n"));
    }

    return {
      title: command,
      content,
      language: "bash",
      expandable: true,
    };
  },
};

// ============================================================================
// WRITE TOOL RENDERER
// ============================================================================

/**
 * Renderer for the Write tool.
 * Displays file path and status.
 */
export const writeToolRenderer: ToolRenderer = {
  icon: "📝",

  getTitle(props: ToolRenderProps): string {
    const filePath = props.input.file_path as string | undefined;
    if (!filePath) return "Write file";
    const parts = filePath.split("/");
    return parts[parts.length - 1] || filePath;
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const filePath = (props.input.file_path as string) || "unknown";
    const contentStr = (props.input.content as string) || "";
    const isSuccess = props.output !== undefined;

    // Detect language from file extension
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const language = getLanguageFromExtension(ext);

    const content: string[] = [];
    if (isSuccess) {
      content.push(`✓ File written: ${filePath}`);
    } else {
      content.push(`⏳ Writing: ${filePath}`);
    }

    // Show preview of content (first few lines)
    if (contentStr) {
      content.push(""); // Blank line
      const lines = contentStr.split("\n");
      const preview = lines.slice(0, 10);
      content.push(...preview);
      if (lines.length > 10) {
        content.push(`... (${lines.length - 10} more lines)`);
      }
    }

    return {
      title: filePath,
      content,
      language,
      expandable: true,
    };
  },
};

// ============================================================================
// GLOB TOOL RENDERER
// ============================================================================

/**
 * Renderer for the Glob tool.
 * Displays pattern and matching files.
 */
export const globToolRenderer: ToolRenderer = {
  icon: "🔍",

  getTitle(props: ToolRenderProps): string {
    const pattern = props.input.pattern as string | undefined;
    return pattern || "Find files";
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const pattern = (props.input.pattern as string) || "";
    const path = (props.input.path as string) || ".";
    const files = props.output as string[] | string | undefined;

    const content: string[] = [];
    content.push(`Pattern: ${pattern}`);
    content.push(`Path: ${path}`);
    content.push(""); // Blank line

    if (Array.isArray(files)) {
      content.push(`Found ${files.length} file(s):`);
      for (const file of files.slice(0, 20)) {
        content.push(`  ${file}`);
      }
      if (files.length > 20) {
        content.push(`  ... (${files.length - 20} more files)`);
      }
    } else if (typeof files === "string") {
      content.push(files);
    } else {
      content.push("(no results)");
    }

    return {
      title: pattern,
      content,
      expandable: true,
    };
  },
};

// ============================================================================
// GREP TOOL RENDERER
// ============================================================================

/**
 * Renderer for the Grep tool.
 * Displays pattern and matching content.
 */
export const grepToolRenderer: ToolRenderer = {
  icon: "🔎",

  getTitle(props: ToolRenderProps): string {
    const pattern = props.input.pattern as string | undefined;
    return pattern || "Search content";
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const pattern = (props.input.pattern as string) || "";
    const path = (props.input.path as string) || ".";
    const output = props.output as string | undefined;

    const content: string[] = [];
    content.push(`Pattern: ${pattern}`);
    content.push(`Path: ${path}`);
    content.push(""); // Blank line

    if (output) {
      const lines = output.split("\n");
      content.push(...lines.slice(0, 30));
      if (lines.length > 30) {
        content.push(`... (${lines.length - 30} more lines)`);
      }
    } else {
      content.push("(no matches)");
    }

    return {
      title: pattern,
      content,
      expandable: true,
    };
  },
};

// ============================================================================
// DEFAULT TOOL RENDERER
// ============================================================================

/**
 * Default renderer for unknown tools.
 * Shows generic input/output display.
 */
export const defaultToolRenderer: ToolRenderer = {
  icon: "🔧",

  getTitle(props: ToolRenderProps): string {
    // Try to extract a meaningful title from input
    const firstKey = Object.keys(props.input)[0];
    if (firstKey) {
      const value = props.input[firstKey];
      if (typeof value === "string" && value.length < 50) {
        return value;
      }
    }
    return "Tool execution";
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const content: string[] = [];

    // Show input
    content.push("Input:");
    content.push(JSON.stringify(props.input, null, 2));

    // Show output if present
    if (props.output !== undefined) {
      content.push(""); // Blank line
      content.push("Output:");
      if (typeof props.output === "string") {
        content.push(...props.output.split("\n"));
      } else {
        content.push(JSON.stringify(props.output, null, 2));
      }
    }

    return {
      title: "Tool Result",
      content,
      expandable: true,
    };
  },
};

// ============================================================================
// TOOL RENDERERS REGISTRY
// ============================================================================

/**
 * Registry mapping tool names to their renderers.
 */
export const TOOL_RENDERERS: Record<string, ToolRenderer> = {
  Read: readToolRenderer,
  read: readToolRenderer,
  Edit: editToolRenderer,
  edit: editToolRenderer,
  Bash: bashToolRenderer,
  bash: bashToolRenderer,
  Write: writeToolRenderer,
  write: writeToolRenderer,
  Glob: globToolRenderer,
  glob: globToolRenderer,
  Grep: grepToolRenderer,
  grep: grepToolRenderer,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the renderer for a tool by name.
 * Returns the default renderer if no specific renderer is found.
 *
 * @param toolName - Name of the tool
 * @returns The tool renderer
 */
export function getToolRenderer(toolName: string): ToolRenderer {
  return TOOL_RENDERERS[toolName] || defaultToolRenderer;
}

/**
 * Get all registered tool names.
 */
export function getRegisteredToolNames(): string[] {
  // Get unique tool names (ignoring case duplicates)
  const names = new Set<string>();
  for (const key of Object.keys(TOOL_RENDERERS)) {
    names.add(key.charAt(0).toUpperCase() + key.slice(1).toLowerCase());
  }
  return Array.from(names).sort();
}

/**
 * Check if a tool has a custom renderer.
 *
 * @param toolName - Name of the tool
 * @returns True if a custom renderer exists
 */
export function hasCustomRenderer(toolName: string): boolean {
  return toolName in TOOL_RENDERERS;
}

/**
 * Get programming language from file extension.
 */
export function getLanguageFromExtension(ext: string): string | undefined {
  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    mjs: "javascript",
    cjs: "javascript",

    // Python
    py: "python",
    pyw: "python",
    pyx: "python",

    // Rust
    rs: "rust",

    // Go
    go: "go",

    // Java
    java: "java",

    // C/C++
    c: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    h: "c",
    hpp: "cpp",

    // Ruby
    rb: "ruby",

    // PHP
    php: "php",

    // Swift
    swift: "swift",

    // Kotlin
    kt: "kotlin",
    kts: "kotlin",

    // Scala
    scala: "scala",

    // Shell
    sh: "bash",
    bash: "bash",
    zsh: "bash",

    // Config files
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",

    // Web
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",

    // Documentation
    md: "markdown",
    markdown: "markdown",

    // SQL
    sql: "sql",

    // Dockerfile
    dockerfile: "dockerfile",
  };

  return languageMap[ext.toLowerCase()];
}
