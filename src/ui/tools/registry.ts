/**
 * ToolResultRegistry for Tool-specific Rendering
 *
 * Provides renderers for different tool types, allowing customized
 * display of tool inputs, outputs, and metadata.
 *
 * Reference: Feature 15 - Create ToolResultRegistry for tool-specific rendering
 */

import type { SyntaxStyle } from "@opentui/core";
import { STATUS, CHECKBOX } from "../constants/icons.ts";

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
 * Handles both Claude SDK (file_path) and OpenCode (path, filePath) parameter names.
 */
export const readToolRenderer: ToolRenderer = {
  icon: "≡",

  getTitle(props: ToolRenderProps): string {
    // Handle multiple parameter name conventions
    const filePath = (props.input.file_path ?? props.input.path ?? props.input.filePath) as string | undefined;
    if (!filePath) return "Read file";
    // Show just the filename if path is long
    const parts = filePath.split("/");
    const filename = parts[parts.length - 1] || filePath;
    return filename;
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const filePath = (props.input.file_path ?? props.input.path ?? props.input.filePath ?? "unknown") as string;
    let content: string | undefined;

    if (typeof props.output === "string") {
      if (props.output === "") {
        content = "";
      } else {
        try {
          const parsed = JSON.parse(props.output);
          if (parsed.file && typeof parsed.file.content === "string") {
            content = parsed.file.content;
          } else if (typeof parsed.content === "string") {
            content = parsed.content;
          } else if (typeof parsed === "string") {
            content = parsed;
          } else if (typeof parsed.text === "string") {
            content = parsed.text;
          } else if (typeof parsed.value === "string") {
            content = parsed.value;
          } else if (typeof parsed.data === "string") {
            content = parsed.data;
          } else {
            content = props.output;
          }
        } catch {
          content = props.output;
        }
      }
    } else if (props.output && typeof props.output === "object") {
      const output = props.output as Record<string, unknown>;
      if (output.file && typeof output.file === "object") {
        const file = output.file as Record<string, unknown>;
        content = typeof file.content === "string" ? file.content : undefined;
      } else if (typeof output.output === "string") {
        content = output.output;
      } else if (typeof output.content === "string") {
        content = output.content;
      } else if (typeof output.text === "string") {
        content = output.text;
      } else if (typeof output.value === "string") {
        content = output.value;
      } else if (typeof output.data === "string") {
        content = output.data;
      } else if (typeof output.result === "string") {
        content = output.result;
      } else if (typeof output.rawOutput === "string") {
        content = output.rawOutput;
      }
    }

    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const language = getLanguageFromExtension(ext);

    if (content !== undefined) {
      return {
        title: filePath,
        content: content === "" ? ["(empty file)"] : content.split("\n"),
        language,
        expandable: true,
      };
    }

    if (props.output === undefined || props.output === null) {
      return {
        title: filePath,
        content: ["(file read pending...)"],
        language,
        expandable: true,
      };
    }

    return {
      title: filePath,
      content: ["(could not extract file content)"],
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
 * Handles both Claude SDK (file_path) and OpenCode (path, filePath) parameter names.
 */
export const editToolRenderer: ToolRenderer = {
  icon: "△",

  getTitle(props: ToolRenderProps): string {
    // Handle multiple parameter name conventions
    const filePath = (props.input.file_path ?? props.input.path ?? props.input.filePath) as string | undefined;
    if (!filePath) return "Edit file";
    const parts = filePath.split("/");
    return parts[parts.length - 1] || filePath;
  },

  render(props: ToolRenderProps): ToolRenderResult {
    // Handle multiple parameter name conventions
    const filePath = (props.input.file_path ?? props.input.path ?? props.input.filePath ?? "unknown") as string;
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
 * Handles both Claude SDK (command) and OpenCode (cmd) parameter names.
 */
export const bashToolRenderer: ToolRenderer = {
  icon: "$",

  getTitle(props: ToolRenderProps): string {
    // Handle multiple parameter name conventions
    const command = (props.input.command ?? props.input.cmd) as string | undefined;
    if (!command) return "Run command";
    // Truncate long commands
    const maxLen = 50;
    if (command.length > maxLen) {
      return command.slice(0, maxLen - 3) + "...";
    }
    return command;
  },

  render(props: ToolRenderProps): ToolRenderResult {
    // Handle multiple parameter name conventions
    const command = (props.input.command ?? props.input.cmd ?? "") as string;
    // Handle output which may be a string or object
    let output: string | undefined;
    if (typeof props.output === "string") {
      // Try parsing as JSON if it looks like JSON
      try {
        const parsed = JSON.parse(props.output);
        if (parsed.stdout) {
          output = parsed.stdout;
        } else if (parsed.output) {
          output = parsed.output;
        } else {
          output = props.output;
        }
      } catch {
        output = props.output;
      }
    } else if (props.output && typeof props.output === "object") {
      const out = props.output as Record<string, unknown>;
      // Extract stdout from bash tool response
      if (typeof out.stdout === "string") {
        output = out.stdout;
      } else if (typeof out.output === "string") {
        output = out.output;
      } else {
        output = JSON.stringify(props.output, null, 2);
      }
    }

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
 * Handles both Claude SDK (file_path) and OpenCode (path, filePath) parameter names.
 */
export const writeToolRenderer: ToolRenderer = {
  icon: "►",

  getTitle(props: ToolRenderProps): string {
    // Handle multiple parameter name conventions (Claude: file_path, OpenCode: path/filePath)
    const filePath = (props.input.file_path ?? props.input.path ?? props.input.filePath) as string | undefined;
    if (!filePath) return "Write file";
    const parts = filePath.split("/");
    return parts[parts.length - 1] || filePath;
  },

  render(props: ToolRenderProps): ToolRenderResult {
    // Handle multiple parameter name conventions (Claude: file_path, OpenCode: path/filePath)
    const filePath = (props.input.file_path ?? props.input.path ?? props.input.filePath ?? "unknown") as string;
    const contentStr = (props.input.content as string) || "";
    const isSuccess = props.output !== undefined;

    // Detect language from file extension
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const language = getLanguageFromExtension(ext);

    const content: string[] = [];
    if (isSuccess) {
      content.push(`${STATUS.success} File written: ${filePath}`);
    } else {
      content.push(`${STATUS.pending} Writing: ${filePath}`);
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
  icon: "◆",

  getTitle(props: ToolRenderProps): string {
    const pattern = props.input.pattern as string | undefined;
    return pattern || "Find files";
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const pattern = (props.input.pattern as string) || "";
    const path = (props.input.path as string) || ".";
    // Handle output which may be an array, string, or object
    let files: string[] | string | undefined;
    if (Array.isArray(props.output)) {
      files = props.output as string[];
    } else if (typeof props.output === "string") {
      // Try parsing as JSON if it looks like JSON (Claude SDK response)
      try {
        const parsed = JSON.parse(props.output);
        if (Array.isArray(parsed.matches)) {
          files = parsed.matches as string[];
        } else if (Array.isArray(parsed)) {
          files = parsed as string[];
        } else if (typeof parsed.content === "string") {
          files = parsed.content;
        } else {
          files = props.output;
        }
      } catch {
        files = props.output;
      }
    } else if (props.output && typeof props.output === "object") {
      // Tool response might be wrapped in an object
      const out = props.output as Record<string, unknown>;
      if (Array.isArray(out.matches)) {
        files = out.matches as string[];
      } else if (typeof out.content === "string") {
        files = out.content;
      }
    }

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
      // Parse newline-separated file list
      const fileList = files.split("\n").filter(f => f.trim());
      if (fileList.length > 0) {
        content.push(`Found ${fileList.length} file(s):`);
        for (const file of fileList.slice(0, 20)) {
          content.push(`  ${file}`);
        }
        if (fileList.length > 20) {
          content.push(`  ... (${fileList.length - 20} more files)`);
        }
      } else {
        content.push(files);
      }
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
  icon: "★",

  getTitle(props: ToolRenderProps): string {
    const pattern = props.input.pattern as string | undefined;
    return pattern || "Search content";
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const pattern = (props.input.pattern as string) || "";
    const path = (props.input.path as string) || ".";
    // Handle output which may be a string or object
    let output: string | undefined;
    if (typeof props.output === "string") {
      // Try parsing as JSON if it looks like JSON (Claude SDK response)
      try {
        const parsed = JSON.parse(props.output);
        if (typeof parsed.content === "string") {
          output = parsed.content;
        } else if (typeof parsed === "string") {
          output = parsed;
        } else {
          output = props.output;
        }
      } catch {
        output = props.output;
      }
    } else if (props.output && typeof props.output === "object") {
      const out = props.output as Record<string, unknown>;
      output = typeof out.content === "string" ? out.content : JSON.stringify(props.output, null, 2);
    }

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
  icon: "▶",

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
// MCP TOOL RENDERER
// ============================================================================

/**
 * Parse an MCP tool name into server and tool components.
 * MCP tools follow the convention: mcp__<server>__<tool>
 *
 * @returns Parsed server/tool names, or null if not an MCP tool name
 */
export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  const match = toolName.match(/^mcp__(.+?)__(.+)$/);
  if (!match || !match[1] || !match[2]) return null;
  return { server: match[1], tool: match[2] };
}

/**
 * Renderer for MCP (Model Context Protocol) tools.
 * Displays server/tool name and input/output.
 */
export const mcpToolRenderer: ToolRenderer = {
  icon: "§",

  getTitle(props: ToolRenderProps): string {
    const firstKey = Object.keys(props.input)[0];
    if (firstKey) {
      const val = props.input[firstKey];
      if (typeof val === "string" && val.length < 60) return val;
    }
    return "MCP tool call";
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const content: string[] = [];
    content.push("Input:");
    content.push(JSON.stringify(props.input, null, 2));
    if (props.output !== undefined) {
      content.push("");
      content.push("Output:");
      if (typeof props.output === "string") {
        content.push(...props.output.split("\n"));
      } else {
        content.push(JSON.stringify(props.output, null, 2));
      }
    }
    return { title: "MCP Tool Result", content, expandable: true };
  },
};

// ============================================================================
// TASK TOOL RESULT PARSING
// ============================================================================

/**
 * Extract the clean result text from a Task tool response.
 * The SDK may return the result in different formats:
 *
 * 1. Actual SDK format: { content: [{ type: "text", text: "..." }], totalDurationMs, ... }
 * 2. Documented TaskOutput: { result: "..." }
 * 3. Plain string
 *
 * Returns the extracted text and optional metadata.
 */
export function parseTaskToolResult(output: unknown): {
  text: string | undefined;
  durationMs?: number;
  toolUses?: number;
  tokens?: number;
} {
  if (output === undefined || output === null) {
    return { text: undefined };
  }

  // Plain string result
  if (typeof output === "string") {
    // Try parsing as JSON first
    try {
      const parsed = JSON.parse(output);
      return parseTaskToolResult(parsed);
    } catch {
      return { text: output };
    }
  }

  if (typeof output !== "object") {
    return { text: String(output) };
  }

  const obj = output as Record<string, unknown>;

  // Format 1: Actual SDK response with content array
  if (Array.isArray(obj.content)) {
    const textBlock = (obj.content as Array<Record<string, unknown>>).find(
      (b) => b.type === "text" && typeof b.text === "string"
    );
    const text = textBlock?.text as string | undefined;
    return {
      text,
      durationMs: typeof obj.totalDurationMs === "number" ? obj.totalDurationMs : undefined,
      toolUses: typeof obj.totalToolUseCount === "number" ? obj.totalToolUseCount : undefined,
      tokens: typeof obj.totalTokens === "number" ? obj.totalTokens : undefined,
    };
  }

  // Format 2: Documented TaskOutput with result field
  if (typeof obj.result === "string") {
    return {
      text: obj.result,
      durationMs: typeof obj.duration_ms === "number" ? obj.duration_ms : undefined,
    };
  }

  // Fallback: try common text fields
  if (typeof obj.text === "string") return { text: obj.text };
  if (typeof obj.output === "string") return { text: obj.output };

  // Last resort: stringify
  return { text: JSON.stringify(output, null, 2) };
}

// ============================================================================
// TASK TOOL RENDERER
// ============================================================================

/**
 * Renderer for the Task tool (sub-agent spawning).
 * Shows agent type, description/prompt, and model info.
 * Works for both Claude (Task) and Copilot (task) tool names.
 */
export const taskToolRenderer: ToolRenderer = {
  icon: "◉",

  getTitle(props: ToolRenderProps): string {
    const desc = (props.input.description as string) || (props.input.prompt as string) || "";
    const agentType = (props.input.agent_type as string) || "";
    if (desc && agentType) return `${agentType}: ${desc}`;
    if (desc) return desc;
    if (agentType) return agentType;
    return "Sub-agent task";
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const content: string[] = [];
    const desc = (props.input.description as string) || "";
    const prompt = (props.input.prompt as string) || "";
    const agentType = (props.input.agent_type as string) || "";
    const model = (props.input.model as string) || "";
    const mode = (props.input.mode as string) || "";

    if (agentType) content.push(`Agent: ${agentType}`);
    if (model) content.push(`Model: ${model}`);
    if (mode) content.push(`Mode: ${mode}`);
    if (desc) content.push(`Task: ${desc}`);

    // Show prompt (truncated if long)
    if (prompt) {
      const truncated = prompt.length > 200 ? prompt.slice(0, 197) + "…" : prompt;
      content.push(`Prompt: ${truncated}`);
    }

    // Show clean result text (not raw JSON)
    if (props.output !== undefined) {
      const parsed = parseTaskToolResult(props.output);
      if (parsed.text) {
        content.push("");
        const lines = parsed.text.split("\n");
        const preview = lines.slice(0, 15);
        content.push(...preview);
        if (lines.length > 15) {
          content.push(`… ${lines.length - 15} more lines`);
        }
      }
    }

    const title = this.getTitle(props);
    return { title, content, expandable: true };
  },
};

export const todoWriteToolRenderer: ToolRenderer = {
  icon: CHECKBOX.checked,
  getTitle(props: ToolRenderProps): string {
    const todos = (props.input?.todos as Array<{ content: string; status: string }>) ?? [];
    const done = todos.filter((t) => t.status === "completed").length;
    const open = todos.length - done;
    return `${todos.length} tasks (${done} done, ${open} open)`;
  },
  render(props: ToolRenderProps): ToolRenderResult {
    const todos = (props.input?.todos as Array<{ content: string; status: string }>) ?? [];
    const done = todos.filter((t) => t.status === "completed").length;
    const open = todos.length - done;
    const title = `${todos.length} tasks (${done} done, ${open} open)`;
    const content: string[] = todos.map((t) => {
      const prefix = t.status === "completed" ? `${STATUS.success} ` : t.status === "in_progress" ? `${STATUS.selected} ` : `${STATUS.pending} `;
      return prefix + t.content;
    });
    return { title, content, expandable: false };
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
  TodoWrite: todoWriteToolRenderer,
  todowrite: todoWriteToolRenderer,
  Task: taskToolRenderer,
  task: taskToolRenderer,
  // Copilot equivalents
  create: writeToolRenderer,
  view: readToolRenderer,
  // Claude MultiEdit
  MultiEdit: editToolRenderer,
  multiedit: editToolRenderer,
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
  if (TOOL_RENDERERS[toolName]) return TOOL_RENDERERS[toolName];
  if (parseMcpToolName(toolName)) return mcpToolRenderer;
  return defaultToolRenderer;
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
