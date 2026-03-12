import {
  fromClaudeModelInfo,
  type Model,
} from "@/services/models/model-transform.ts";

export const CLAUDE_ALIASES: Record<string, string> = {
  sonnet: "sonnet",
  opus: "opus",
  haiku: "haiku",
};

const CLAUDE_CANONICAL_MODELS = ["opus", "sonnet", "haiku"] as const;
type ClaudeCanonicalModel = (typeof CLAUDE_CANONICAL_MODELS)[number];
const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200000;

export type ClaudeSdkListModelsFn = () => Promise<
  Array<{ value: string; displayName: string; description: string }>
>;

function inferClaudeContextWindow(modelInfo: {
  value: string;
  displayName: string;
  description: string;
}): number {
  const candidates = [modelInfo.displayName, modelInfo.description, modelInfo.value];

  for (const text of candidates) {
    const bracketed = text.match(/\[(\d+(?:\.\d+)?)\s*([kKmM])\]/);
    if (bracketed) {
      const amount = Number(bracketed[1]);
      const unit = bracketed[2]?.toLowerCase();
      if (!Number.isFinite(amount) || !unit) {
        continue;
      }
      if (unit === "m") {
        return Math.round(amount * 1_000_000);
      }
      if (unit === "k") {
        return Math.round(amount * 1_000);
      }
    }

    const windowLabel = text.match(/\b(\d+(?:\.\d+)?)\s*([kKmM])\b(?:\s*(?:ctx|context|context\s+window|tokens?))?/i);
    if (windowLabel) {
      const amount = Number(windowLabel[1]);
      const unit = windowLabel[2]?.toLowerCase();
      if (!Number.isFinite(amount) || !unit) {
        continue;
      }
      if (unit === "m") {
        return Math.round(amount * 1_000_000);
      }
      if (unit === "k") {
        return Math.round(amount * 1_000);
      }
    }
  }

  return DEFAULT_CLAUDE_CONTEXT_WINDOW;
}

export function normalizeClaudeModelInput(model: string): string {
  const trimmed = model.trim();
  if (trimmed.toLowerCase() === "default") {
    return "opus";
  }
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    if (parts.length === 2 && parts[1]?.toLowerCase() === "default") {
      return `${parts[0]}/opus`;
    }
  }
  return trimmed;
}

function isClaudeCanonicalModel(model: string): model is ClaudeCanonicalModel {
  return (CLAUDE_CANONICAL_MODELS as readonly string[]).includes(model);
}

export async function listClaudeModels(
  sdkListModels: ClaudeSdkListModelsFn | undefined,
): Promise<Model[]> {
  if (!sdkListModels) {
    throw new Error("Claude model listing requires an active session (sdkListModels callback not provided)");
  }

  const modelInfos = await sdkListModels();
  const canonicalInfo = new Map<ClaudeCanonicalModel, { value: string; displayName: string; description: string }>(
    CLAUDE_CANONICAL_MODELS.map((model) => [
      model,
      {
        value: model,
        displayName: model.charAt(0).toUpperCase() + model.slice(1),
        description: `Claude ${model} model alias`,
      },
    ]),
  );
  const extraModels = new Map<string, { value: string; displayName: string; description: string }>();

  for (const info of modelInfos) {
    const value = info.value.trim();
    if (!value) {
      continue;
    }

    const key = value.toLowerCase();
    if (key === "default") {
      continue;
    }

    if (isClaudeCanonicalModel(key)) {
      const existing = canonicalInfo.get(key)!;
      canonicalInfo.set(key, {
        value: key,
        displayName: info.displayName || existing.displayName,
        description: info.description || existing.description,
      });
      continue;
    }

    if (!extraModels.has(key)) {
      extraModels.set(key, {
        value,
        displayName: info.displayName || value,
        description: info.description || "",
      });
    }
  }

  const orderedModelInfos = [
    ...CLAUDE_CANONICAL_MODELS.map((model) => canonicalInfo.get(model)!),
    ...Array.from(extraModels.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, info]) => info),
  ];

  return orderedModelInfos.map((info) =>
    fromClaudeModelInfo(info, inferClaudeContextWindow(info))
  );
}
