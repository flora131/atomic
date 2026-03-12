import { getFilename, getInputFilePath } from "@/components/tool-registry/registry/helpers/file-path.ts";
import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

export const editToolRenderer: ToolRenderer = {
  icon: "△",

  getTitle(props: ToolRenderProps): string {
    const filePath = getInputFilePath(props.input);
    if (!filePath) {
      return "Edit file";
    }
    return getFilename(filePath);
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const filePath = getInputFilePath(props.input) ?? "unknown";
    const oldString = (props.input.old_string as string) || "";
    const newString = (props.input.new_string as string) || "";
    const content = [`--- ${filePath}`, `+++ ${filePath}`];

    if (oldString) {
      for (const line of oldString.split("\n")) {
        content.push(`- ${line}`);
      }
    }

    if (newString) {
      for (const line of newString.split("\n")) {
        content.push(`+ ${line}`);
      }
    }

    return {
      title: filePath,
      content,
      language: "diff",
      expandable: true,
    };
  },
};
