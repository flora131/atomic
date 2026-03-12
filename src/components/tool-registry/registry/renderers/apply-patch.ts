import { getFilename } from "@/components/tool-registry/registry/helpers/file-path.ts";
import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

interface ApplyPatchOperation {
  type: "add" | "update" | "delete";
  path: string;
  moveTo?: string;
}

function isLikelyApplyPatchText(value: string): boolean {
  return /\*\*\*\s+Begin Patch/.test(value)
    || /^\*\*\*\s+(Update|Add|Delete) File:/m.test(value)
    || /^\*\*\*\s+Move to:/m.test(value);
}

function extractApplyPatchText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    if (isLikelyApplyPatchText(trimmed)) {
      return value;
    }

    try {
      return extractApplyPatchText(JSON.parse(value));
    } catch {
      return undefined;
    }
  }

  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === "string")) {
      const joined = value.join("\n");
      return isLikelyApplyPatchText(joined) ? joined : undefined;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const patchKeys = [
    "patchText",
    "patch_text",
    "patch",
    "diff",
    "content",
    "input",
    "arguments",
    "params",
    "payload",
    "data",
  ];

  for (const key of patchKeys) {
    const candidate = extractApplyPatchText(record[key]);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function getApplyPatchText(props: ToolRenderProps): string | undefined {
  return extractApplyPatchText(props.input) ?? extractApplyPatchText(props.output);
}

function parseApplyPatchOperations(patchText: string): ApplyPatchOperation[] {
  const operations: ApplyPatchOperation[] = [];

  for (const line of patchText.split("\n")) {
    const updateMatch = line.match(/^\*\*\* Update File:\s+(.+)$/);
    if (updateMatch?.[1]) {
      operations.push({ type: "update", path: updateMatch[1].trim() });
      continue;
    }

    const addMatch = line.match(/^\*\*\* Add File:\s+(.+)$/);
    if (addMatch?.[1]) {
      operations.push({ type: "add", path: addMatch[1].trim() });
      continue;
    }

    const deleteMatch = line.match(/^\*\*\* Delete File:\s+(.+)$/);
    if (deleteMatch?.[1]) {
      operations.push({ type: "delete", path: deleteMatch[1].trim() });
      continue;
    }

    const moveMatch = line.match(/^\*\*\* Move to:\s+(.+)$/);
    if (moveMatch?.[1] && operations.length > 0) {
      operations[operations.length - 1] = {
        ...operations[operations.length - 1]!,
        moveTo: moveMatch[1].trim(),
      };
    }
  }

  return operations;
}

function getApplyPatchOutputOperations(output: unknown): ApplyPatchOperation[] {
  if (typeof output === "string") {
    try {
      return getApplyPatchOutputOperations(JSON.parse(output));
    } catch {
      return [];
    }
  }

  if (!output || typeof output !== "object") {
    return [];
  }

  const record = output as Record<string, unknown>;
  const metadata = record.metadata;
  const metadataRecord = metadata && typeof metadata === "object"
    ? metadata as Record<string, unknown>
    : undefined;

  const files = Array.isArray(record.files)
    ? record.files
    : Array.isArray(metadataRecord?.files)
      ? metadataRecord.files
      : undefined;

  if (!files) {
    return [];
  }

  const operations: ApplyPatchOperation[] = [];
  for (const file of files) {
    if (!file || typeof file !== "object") {
      continue;
    }

    const fileRecord = file as Record<string, unknown>;
    const path =
      (typeof fileRecord.relativePath === "string" && fileRecord.relativePath)
      || (typeof fileRecord.filePath === "string" && fileRecord.filePath)
      || (typeof fileRecord.path === "string" && fileRecord.path);

    if (!path) {
      continue;
    }

    const rawType = typeof fileRecord.type === "string"
      ? fileRecord.type.toLowerCase()
      : "update";

    const type: ApplyPatchOperation["type"] = rawType === "add" || rawType === "create"
      ? "add"
      : rawType === "delete" || rawType === "remove"
        ? "delete"
        : "update";

    const moveTo = typeof fileRecord.movePath === "string"
      ? fileRecord.movePath
      : typeof fileRecord.moveTo === "string"
        ? fileRecord.moveTo
        : undefined;

    operations.push({ type, path, moveTo });
  }

  return operations;
}

function getApplyPatchTitle(operations: ApplyPatchOperation[]): string {
  if (operations.length === 0) {
    return "Apply patch";
  }

  if (operations.length === 1) {
    return getFilename(operations[0]!.path);
  }

  return `${operations.length} files`;
}

function getApplyPatchRendererTitle(props: ToolRenderProps): string {
  const patchText = getApplyPatchText(props);
  if (patchText) {
    return getApplyPatchTitle(parseApplyPatchOperations(patchText));
  }

  const outputOperations = getApplyPatchOutputOperations(props.output);
  if (outputOperations.length > 0) {
    return getApplyPatchTitle(outputOperations);
  }

  return getApplyPatchTitle([]);
}

export const applyPatchToolRenderer: ToolRenderer = {
  icon: "△",

  getTitle(props: ToolRenderProps): string {
    return getApplyPatchRendererTitle(props);
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const patchText = getApplyPatchText(props);
    if (patchText) {
      return {
        title: getApplyPatchRendererTitle(props),
        content: patchText.split("\n"),
        language: "diff",
        expandable: true,
      };
    }

    const outputOperations = getApplyPatchOutputOperations(props.output);
    if (outputOperations.length > 0) {
      const content: string[] = [];
      for (const operation of outputOperations) {
        if (operation.type === "add") {
          content.push(`*** Add File: ${operation.path}`);
        } else if (operation.type === "delete") {
          content.push(`*** Delete File: ${operation.path}`);
        } else {
          content.push(`*** Update File: ${operation.path}`);
        }

        if (operation.moveTo) {
          content.push(`*** Move to: ${operation.moveTo}`);
        }
      }

      return {
        title: getApplyPatchTitle(outputOperations),
        content,
        language: "diff",
        expandable: true,
      };
    }

    return {
      title: getApplyPatchTitle([]),
      content: [],
      language: "diff",
      expandable: false,
    };
  },
};
