import { describe, expect, test, mock } from "bun:test";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveCopilotUserInputSessionId } from "@/services/agents/clients/copilot.ts";
import { resolveCopilotSdkCliLaunch } from "@/services/agents/clients/copilot.ts";
import { getBundledCopilotCliPath } from "@/services/agents/clients/copilot.ts";
import { CopilotClient } from "@/services/agents/clients/copilot.ts";

describe("resolveCopilotUserInputSessionId", () => {
  test("keeps preferred session when it is active", () => {
    const resolved = resolveCopilotUserInputSessionId("copilot_123", [
      "copilot_001",
      "copilot_123",
    ]);

    expect(resolved).toBe("copilot_123");
  });

  test("falls back to latest active session when preferred is unknown", () => {
    const resolved = resolveCopilotUserInputSessionId("tentative_session", [
      "copilot_001",
      "copilot_002",
    ]);

    expect(resolved).toBe("copilot_002");
  });

  test("returns preferred session when no active sessions exist", () => {
    const resolved = resolveCopilotUserInputSessionId("tentative_session", []);

    expect(resolved).toBe("tentative_session");
  });
});

describe("getBundledCopilotCliPath", () => {
  test("prefers an installed copilot binary on PATH over the bundled package", async () => {
    const cliPath = await getBundledCopilotCliPath({
      which: () => "/usr/local/bin/copilot",
      pathExists: async (path) => path === "/usr/local/bin/copilot",
      resolveImport: (specifier) => {
        if (specifier === "@github/copilot/sdk") {
          return "file:///tmp/node_modules/@github/copilot/sdk/index.js";
        }
        if (specifier === "@github/copilot-sdk") {
          return "file:///tmp/node_modules/@github/copilot-sdk/dist/index.js";
        }
        throw new Error(`Unexpected import resolution for ${specifier}`);
      },
    });

    expect(cliPath).toBe("/usr/local/bin/copilot");
  });

  test("skips project-local node_modules shims and prefers an external copilot binary", async () => {
    const shimBin = join("/workspace/app/node_modules/.bin", "copilot");
    const externalBin = join("/home/alice/.local/bin", "copilot");
    const cliPath = await getBundledCopilotCliPath({
      which: () => shimBin,
      pathEnv: [
        "/workspace/app/node_modules/.bin",
        "/home/alice/.local/bin",
        "/usr/bin",
      ].join(delimiter),
      pathExists: async (path) =>
        path === shimBin || path === externalBin,
      resolveImport: (specifier) => {
        if (specifier === "@github/copilot/sdk") {
          return "file:///tmp/node_modules/@github/copilot/sdk/index.js";
        }
        if (specifier === "@github/copilot-sdk") {
          return "file:///tmp/node_modules/@github/copilot-sdk/dist/index.js";
        }
        throw new Error(`Unexpected import resolution for ${specifier}`);
      },
    });

    expect(cliPath).toBe(externalBin);
  });

  test("falls back to the bundled copilot package when no PATH binary exists", async () => {
    const sdkAbsPath = resolve("/tmp/node_modules/@github/copilot/sdk/index.js");
    const sdkUrl = pathToFileURL(sdkAbsPath).href;
    const copilotSdkAbsPath = resolve("/tmp/node_modules/@github/copilot-sdk/dist/index.js");
    const copilotSdkUrl = pathToFileURL(copilotSdkAbsPath).href;
    const expectedPath = join(dirname(dirname(sdkAbsPath)), "index.js");
    const cliPath = await getBundledCopilotCliPath({
      which: () => undefined,
      pathExists: async (path) => path === expectedPath,
      resolveImport: (specifier) => {
        if (specifier === "@github/copilot/sdk") {
          return sdkUrl;
        }
        if (specifier === "@github/copilot-sdk") {
          return copilotSdkUrl;
        }
        throw new Error(`Unexpected import resolution for ${specifier}`);
      },
    });

    expect(cliPath).toBe(expectedPath);
  });

});

describe("resolveCopilotSdkCliLaunch", () => {
  test("adds the experimental flag for direct Copilot launches", () => {
    const launch = resolveCopilotSdkCliLaunch("/usr/local/bin/copilot", ["--server"]);

    expect(launch.cliArgs).toContain("--experimental");
    expect(launch.cliArgs).toContain("--server");
  });

  test("does not duplicate the experimental flag when already present", () => {
    const launch = resolveCopilotSdkCliLaunch("/usr/local/bin/copilot", [
      "--experimental",
      "--server",
    ]);

    expect(launch.cliArgs.filter((arg) => arg === "--experimental")).toHaveLength(1);
  });
});

describe("CopilotClient.getModelDisplayInfo", () => {
  test("includes default reasoning effort for hinted reasoning-capable model", async () => {
    const client = new CopilotClient({});
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as { sdkClient: { listModels: () => Promise<unknown[]> } }).sdkClient = {
      listModels: mock(async () => ([
        {
          id: "gpt-5",
          defaultReasoningEffort: "high",
          capabilities: {
            supports: { reasoningEffort: true },
            limits: { max_context_window_tokens: 256000 },
          },
        },
      ])),
    };

    const info = await client.getModelDisplayInfo("github-copilot/gpt-5");

    expect(info.model).toBe("gpt-5");
    expect(info.supportsReasoning).toBe(true);
    expect(info.defaultReasoningEffort).toBe("high");
  });

  test("uses first model default reasoning effort when no hint is provided", async () => {
    const client = new CopilotClient({});
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as { sdkClient: { listModels: () => Promise<unknown[]> } }).sdkClient = {
      listModels: mock(async () => ([
        {
          id: "claude-opus-4.6",
          defaultReasoningEffort: "medium",
          capabilities: {
            supports: { reasoningEffort: true },
            limits: { max_context_window_tokens: 200000 },
          },
        },
      ])),
    };

    const info = await client.getModelDisplayInfo();

    expect(info.model).toBe("claude-opus-4.6");
    expect(info.supportsReasoning).toBe(true);
    expect(info.defaultReasoningEffort).toBe("medium");
  });
});

describe("CopilotClient.listAvailableModels", () => {
  test("returns models from the active SDK client when using an external server", async () => {
    const client = new CopilotClient({});
    const expectedModels = [
      {
        id: "gpt-5",
        capabilities: {
          supports: { reasoningEffort: true },
          limits: { max_context_window_tokens: 256000 },
        },
      },
    ];
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as { isExternalServer: boolean }).isExternalServer = true;
    (client as unknown as { sdkClient: { listModels: () => Promise<unknown[]> } }).sdkClient = {
      listModels: mock(async () => expectedModels),
    };

    await expect(client.listAvailableModels()).resolves.toEqual(expectedModels);
  });

  test("bypasses the SDK model cache via fresh models.list RPC for external servers", async () => {
    const client = new CopilotClient({});
    const staleModels = [
      {
        id: "old-model",
        capabilities: {
          supports: {},
          limits: { max_context_window_tokens: 128000 },
        },
      },
    ];
    const freshModels = [
      {
        id: "new-model",
        capabilities: {
          supports: {},
          limits: { max_context_window_tokens: 256000 },
        },
      },
    ];
    const sendRequest = mock(async (method: string) => {
      expect(method).toBe("models.list");
      return { models: freshModels };
    });
    const listModels = mock(async () => staleModels);

    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as { isExternalServer: boolean }).isExternalServer = true;
    (client as unknown as {
      sdkClient: {
        connection: { sendRequest: (method: string, params: Record<string, never>) => Promise<{ models: unknown[] }> };
        modelsCache: unknown[] | null;
        listModels: () => Promise<unknown[]>;
      };
    }).sdkClient = {
      connection: { sendRequest },
      modelsCache: staleModels,
      listModels,
    };

    await expect(client.listAvailableModels()).resolves.toEqual(freshModels);
    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(listModels).not.toHaveBeenCalled();
  });

  test("uses a fresh temporary SDK client for local model discovery", async () => {
    const client = new CopilotClient({});
    const freshModels = [
      {
        id: "new-model",
        capabilities: {
          supports: {},
          limits: { max_context_window_tokens: 256000 },
        },
      },
    ];
    const start = mock(async () => {});
    const stop = mock(async () => []);
    const sendRequest = mock(async () => ({ models: freshModels }));

    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as { sdkClient: object }).sdkClient = {};
    (
      client as unknown as {
        buildSdkOptions: () => Promise<object>;
        createSdkClientInstance: (options: object) => {
          start: () => Promise<void>;
          stop: () => Promise<unknown[]>;
          connection: { sendRequest: (method: string, params: Record<string, never>) => Promise<{ models: unknown[] }> };
        };
      }
    ).buildSdkOptions = async () => ({ useStdio: true });
    (
      client as unknown as {
        createSdkClientInstance: (options: object) => {
          start: () => Promise<void>;
          stop: () => Promise<unknown[]>;
          connection: { sendRequest: (method: string, params: Record<string, never>) => Promise<{ models: unknown[] }> };
        };
      }
    ).createSdkClientInstance = () => ({
      start,
      stop,
      connection: { sendRequest },
    });

    await expect(client.listAvailableModels()).resolves.toEqual(freshModels);
    expect(start).toHaveBeenCalledTimes(1);
    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
