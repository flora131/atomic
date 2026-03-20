import {
  fromCopilotModelInfo,
  type CopilotModelInfo,
  type Model,
} from "@/services/models/model-transform.ts";

export type CopilotSdkListModelsFn = () => Promise<CopilotModelInfo[]>;

export async function listCopilotModels(
  sdkListCopilotModels: CopilotSdkListModelsFn | undefined,
): Promise<Model[]> {
  if (sdkListCopilotModels) {
    const modelInfos = await sdkListCopilotModels();
    return modelInfos.map((modelInfo) => fromCopilotModelInfo(modelInfo));
  }

  const [{ CopilotClient }, { getBundledCopilotCliPath, resolveCopilotSdkCliLaunch }] = await Promise.all([
    import("@github/copilot-sdk"),
    import("@/services/agents/clients/index.ts"),
  ]);
  const clientOpts = resolveCopilotSdkCliLaunch(await getBundledCopilotCliPath());
  const client = new CopilotClient(clientOpts);

  try {
    await client.start();
    const modelInfos = await client.listModels();
    await client.stop();
    return modelInfos.map((modelInfo) => fromCopilotModelInfo(modelInfo));
  } catch (error) {
    try {
      await client.stop();
    } catch {
      // Ignore stop errors during fallback cleanup.
    }
    throw error;
  }
}
