import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  const matchUnderscore = toolName.match(/^mcp__(.+?)__(.+)$/);
  if (matchUnderscore?.[1] && matchUnderscore[2]) {
    return { server: matchUnderscore[1], tool: matchUnderscore[2] };
  }

  const matchSlash = toolName.match(/^([^/]+)\/(.+)$/);
  if (matchSlash?.[1] && matchSlash[2]) {
    return { server: matchSlash[1], tool: matchSlash[2] };
  }

  return null;
}

export const mcpToolRenderer: ToolRenderer = {
  icon: "§",

  getTitle(props: ToolRenderProps): string {
    const firstKey = Object.keys(props.input)[0];
    if (firstKey) {
      const value = props.input[firstKey];
      if (typeof value === "string" && value.length < 60) {
        return value;
      }
    }
    return "MCP tool call";
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const content = ["Input:", JSON.stringify(props.input, null, 2)];
    if (props.output !== undefined) {
      content.push("");
      content.push("Output:");
      if (typeof props.output === "string") {
        content.push(...props.output.split("\n"));
      } else {
        content.push(JSON.stringify(props.output, null, 2));
      }
    }

    return {
      title: "MCP Tool Result",
      content,
      expandable: true,
    };
  },
};
