import type { CopilotClientOptions as SdkClientOptions } from "@github/copilot-sdk";

import type { CopilotConnectionMode, CopilotClientOptions } from "@/services/agents/clients/copilot.ts";
import {
  getBundledCopilotCliPath,
  resolveCopilotSdkCliLaunch,
} from "@/services/agents/clients/copilot/cli-path.ts";

function applyConnectionMode(
  options: SdkClientOptions,
  connectionMode: CopilotConnectionMode | undefined,
): void {
  if (!connectionMode) {
    return;
  }

  switch (connectionMode.type) {
    case "stdio":
      options.useStdio = true;
      return;
    case "port":
      options.port = connectionMode.port;
      options.useStdio = false;
      return;
    case "cliUrl":
      options.cliUrl = connectionMode.url;
      return;
  }
}

export async function buildCopilotSdkOptions(
  clientOptions: CopilotClientOptions,
): Promise<SdkClientOptions> {
  let cliPath = clientOptions.cliPath;
  const cliArgs = [...(clientOptions.cliArgs ?? [])];

  if (!cliPath) {
    const resolvedCliPath = await getBundledCopilotCliPath();
    const launch = await resolveCopilotSdkCliLaunch(resolvedCliPath, cliArgs);
    cliPath = launch.cliPath;
    cliArgs.splice(0, cliArgs.length, ...launch.cliArgs);
  }

  const options: SdkClientOptions = {
    cliPath,
    cliArgs,
    cwd: clientOptions.cwd,
    logLevel: clientOptions.logLevel,
    autoStart: clientOptions.autoStart ?? true,
    githubToken: clientOptions.githubToken,
  };

  applyConnectionMode(options, clientOptions.connectionMode);

  return options;
}
