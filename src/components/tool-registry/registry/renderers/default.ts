import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

export const defaultToolRenderer: ToolRenderer = {
  icon: "▶",

  getTitle(props: ToolRenderProps): string {
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
      title: "Tool Result",
      content,
      expandable: true,
    };
  },
};
