import {
  fromOpenCodeModel,
  type Model,
  type OpenCodeModel,
} from "@/services/models/model-transform.ts";

export type OpenCodeSdkProvider = {
  id: string;
  name: string;
  api?: string;
  models?: Record<string, OpenCodeModel>;
};

export type OpenCodeSdkListProvidersFn = () => Promise<OpenCodeSdkProvider[]>;

export async function listOpenCodeModels(
  sdkListOpenCodeProviders: OpenCodeSdkListProvidersFn | undefined,
): Promise<Model[]> {
  const providers = sdkListOpenCodeProviders
    ? await sdkListOpenCodeProviders()
    : await fetchOpenCodeProviders();
  const models: Model[] = [];

  for (const provider of providers) {
    if (!provider.models) {
      continue;
    }

    for (const [modelID, model] of Object.entries(provider.models)) {
      if (model.status === "deprecated") {
        continue;
      }

      models.push(
        fromOpenCodeModel(provider.id, modelID, model as OpenCodeModel, provider.api, provider.name),
      );
    }
  }

  if (models.length === 0) {
    throw new Error("No models available from connected OpenCode providers");
  }

  return models;
}

async function fetchOpenCodeProviders(): Promise<OpenCodeSdkProvider[]> {
  const { createOpencodeClient } = await import("@opencode-ai/sdk");
  const client = createOpencodeClient({
    baseUrl: "http://localhost:4096",
    directory: process.cwd(),
  });

  const providerListResult = await client.provider.list();
  const providerListData = providerListResult.data as
    | {
        all?: OpenCodeSdkProvider[];
        connected?: string[];
      }
    | undefined;

  if (!providerListData?.all) {
    throw new Error("OpenCode SDK returned no provider data");
  }

  const connectedIds = new Set(providerListData.connected ?? []);
  return providerListData.all.filter((provider) =>
    connectedIds.size === 0 || connectedIds.has(provider.id)
  );
}
