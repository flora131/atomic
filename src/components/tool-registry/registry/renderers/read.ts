import { getFilename, getInputFilePath } from "@/components/tool-registry/registry/helpers/file-path.ts";
import { getLanguageFromExtension } from "@/components/tool-registry/registry/helpers/language.ts";
import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

function isRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

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

  if (!isRecord(output)) {
    return undefined;
  }

  if (isRecord(output.file)) {
    return typeof output.file.content === "string" ? output.file.content : undefined;
  }
  if (typeof output.output === "string") {
    return output.output;
  }
  if (typeof output.content === "string") {
    return output.content;
  }
  if (typeof output.text === "string") {
    return output.text;
  }
  if (typeof output.value === "string") {
    return output.value;
  }
  if (typeof output.data === "string") {
    return output.data;
  }
  if (typeof output.result === "string") {
    return output.result;
  }
  if (typeof output.rawOutput === "string") {
    return output.rawOutput;
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
