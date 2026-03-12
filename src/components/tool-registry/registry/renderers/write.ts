import { getFilename, getInputFilePath } from "@/components/tool-registry/registry/helpers/file-path.ts";
import { getLanguageFromExtension } from "@/components/tool-registry/registry/helpers/language.ts";
import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";
import { STATUS } from "@/theme/icons.ts";

export const writeToolRenderer: ToolRenderer = {
  icon: "►",

  getTitle(props: ToolRenderProps): string {
    const filePath = getInputFilePath(props.input);
    if (!filePath) {
      return "Write file";
    }
    return getFilename(filePath);
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const filePath = getInputFilePath(props.input) ?? "unknown";
    const contentStr = (props.input.content as string) || "";
    const isSuccess = props.output !== undefined;
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const language = getLanguageFromExtension(ext);

    const content = [
      isSuccess ? `${STATUS.success} File written: ${filePath}` : `${STATUS.pending} Writing: ${filePath}`,
    ];

    if (contentStr) {
      const lines = contentStr.split("\n");
      content.push("");
      content.push(...lines.slice(0, 10));
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
