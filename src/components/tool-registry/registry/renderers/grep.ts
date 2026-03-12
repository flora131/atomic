import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

export const grepToolRenderer: ToolRenderer = {
  icon: "★",

  getTitle(props: ToolRenderProps): string {
    return (props.input.pattern as string | undefined) || "Search content";
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const pattern = (props.input.pattern as string) || "";
    const path = (props.input.path as string) || ".";
    let output: string | undefined;

    if (typeof props.output === "string") {
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
      const record = props.output as Record<string, unknown>;
      output = typeof record.content === "string"
        ? record.content
        : JSON.stringify(props.output, null, 2);
    }

    const content = [`Pattern: ${pattern}`, `Path: ${path}`, ""];
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
