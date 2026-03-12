import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

export const globToolRenderer: ToolRenderer = {
  icon: "◆",

  getTitle(props: ToolRenderProps): string {
    return (props.input.pattern as string | undefined) || "Find files";
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const pattern = (props.input.pattern as string) || "";
    const path = (props.input.path as string) || ".";
    let files: string[] | string | undefined;

    if (Array.isArray(props.output)) {
      files = props.output as string[];
    } else if (typeof props.output === "string") {
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
      const record = props.output as Record<string, unknown>;
      if (Array.isArray(record.matches)) {
        files = record.matches as string[];
      } else if (typeof record.content === "string") {
        files = record.content;
      }
    }

    const content = [`Pattern: ${pattern}`, `Path: ${path}`, ""];
    if (Array.isArray(files)) {
      content.push(`Found ${files.length} file(s):`);
      for (const file of files.slice(0, 20)) {
        content.push(`  ${file}`);
      }
      if (files.length > 20) {
        content.push(`  ... (${files.length - 20} more files)`);
      }
    } else if (typeof files === "string") {
      const fileList = files.split("\n").filter((file) => file.trim());
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
