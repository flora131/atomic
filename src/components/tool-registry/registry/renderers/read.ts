import { getFilename, getInputFilePath } from "@/components/tool-registry/registry/helpers/file-path.ts";
import { getLanguageFromExtension } from "@/components/tool-registry/registry/helpers/language.ts";
import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

function extractReadContent(output: unknown): string | undefined {
  if (typeof output === "string") {
    if (output === "") {
      return "";
    }

    try {
      const parsed = JSON.parse(output);
      if (parsed.file && typeof parsed.file.content === "string") {
        return parsed.file.content;
      }
      if (typeof parsed.content === "string") {
        return parsed.content;
      }
      if (typeof parsed === "string") {
        return parsed;
      }
      if (typeof parsed.text === "string") {
        return parsed.text;
      }
      if (typeof parsed.value === "string") {
        return parsed.value;
      }
      if (typeof parsed.data === "string") {
        return parsed.data;
      }
      return output;
    } catch {
      return output;
    }
  }

  if (!output || typeof output !== "object") {
    return undefined;
  }

  const record = output as Record<string, unknown>;
  if (record.file && typeof record.file === "object") {
    const file = record.file as Record<string, unknown>;
    return typeof file.content === "string" ? file.content : undefined;
  }
  if (typeof record.output === "string") {
    return record.output;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.value === "string") {
    return record.value;
  }
  if (typeof record.data === "string") {
    return record.data;
  }
  if (typeof record.result === "string") {
    return record.result;
  }
  if (typeof record.rawOutput === "string") {
    return record.rawOutput;
  }
  return undefined;
}

export const readToolRenderer: ToolRenderer = {
  icon: "≡",

  getTitle(props: ToolRenderProps): string {
    const filePath = getInputFilePath(props.input);
    if (!filePath) {
      return "Read file";
    }
    return getFilename(filePath);
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const filePath = getInputFilePath(props.input) ?? "unknown";
    const content = extractReadContent(props.output);
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
