import type { SyntaxStyle } from "@opentui/core";

export interface ToolRenderProps {
  input: Record<string, unknown>;
  output?: unknown;
  syntaxStyle?: SyntaxStyle;
}

export interface ToolRenderResult {
  title: string;
  content: string[];
  language?: string;
  expandable?: boolean;
}

export interface ToolRenderer {
  icon: string;
  getTitle: (props: ToolRenderProps) => string;
  render: (props: ToolRenderProps) => ToolRenderResult;
}
