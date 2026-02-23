import { describe, expect, mock, spyOn, test } from "bun:test";

import type { AgentMessage, CodingAgentClient, Session } from "../sdk/types.ts";
import type { CliRenderer } from "@opentui/core";
import type { Root } from "@opentui/react";
import * as opentuiCore from "@opentui/core";
import * as opentuiReact from "@opentui/react";

const MODIFY_OTHER_KEYS_ENABLE = "\x1b[>4;2m";
const MODIFY_OTHER_KEYS_DISABLE = "\x1b[>4;0m";

interface ElementWithProps {
  props?: {
    children?: unknown;
    onExit?: () => void;
  };
}

function extractErrorBoundaryExit(rootElement: unknown): (() => void) | null {
  const themeProvider = rootElement as ElementWithProps;
  const boundary = themeProvider.props?.children as ElementWithProps | undefined;
  return boundary?.props?.onExit ?? null;
}

async function waitFor(condition: () => boolean, attempts = 200): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition not met in time");
}

function createFakeClient(): CodingAgentClient {
  const emptySession: Session = {
    id: "session-test",
    send: async () => ({ type: "text", content: "", role: "assistant" }),
    stream: async function* (): AsyncIterable<AgentMessage> {
      return;
    },
    summarize: async () => {
      return;
    },
    getContextUsage: async () => ({
      inputTokens: 0,
      outputTokens: 0,
      maxTokens: 1,
      usagePercentage: 0,
    }),
    getSystemToolsTokens: () => 0,
    destroy: async () => {
      return;
    },
  };

  return {
    agentType: "claude",
    createSession: async () => emptySession,
    resumeSession: async () => null,
    on: () => () => {
      return;
    },
    registerTool: () => {
      return;
    },
    start: async () => {
      return;
    },
    stop: async () => {
      return;
    },
    getModelDisplayInfo: async () => ({ model: "test", tier: "test" }),
    getSystemToolsTokens: () => null,
  };
}

describe("startChatUI protocol escape ordering", () => {
  test("sends startup/cleanup modifyOtherKeys sequences in lifecycle order", async () => {
    const lifecycleEvents: string[] = [];
    const escapeWrites: string[] = [];

    let renderedTree: unknown = null;

    const fakeRenderer = {
      destroy: () => {
        lifecycleEvents.push("renderer.destroy");
      },
    } as CliRenderer;

    const fakeRoot = {
      render: (tree: unknown) => {
        renderedTree = tree;
        lifecycleEvents.push("root.render");
      },
      unmount: () => {
        lifecycleEvents.push("root.unmount");
      },
    } as Root;

    mock.module("./chat.tsx", () => ({
      ChatApp: () => null,
      CompletionSummary: () => null,
      LoadingIndicator: () => null,
      StreamingBullet: () => null,
      defaultWorkflowChatState: {},
    }));

    mock.module("./theme.tsx", () => ({
      ThemeProvider: ({ children }: { children?: unknown }) => children ?? null,
      useTheme: () => null,
      useThemeColors: () => null,
      darkTheme: { isDark: true },
      lightTheme: { isDark: false },
    }));

    mock.module("./components/error-exit-screen.tsx", () => ({
      AppErrorBoundary: ({ children }: { children?: unknown }) => children ?? null,
    }));

    const createRendererSpy = spyOn(opentuiCore, "createCliRenderer").mockImplementation(
      (async () => {
        lifecycleEvents.push("renderer.ready");
        return fakeRenderer;
      }) as typeof opentuiCore.createCliRenderer,
    );

    const createRootSpy = spyOn(opentuiReact, "createRoot").mockImplementation(
      (() => {
        lifecycleEvents.push("createRoot");
        return fakeRoot;
      }) as typeof opentuiReact.createRoot,
    );

    const stdoutHadOwnIsTTY = Object.prototype.hasOwnProperty.call(process.stdout, "isTTY");
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });

    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      ((chunk: string | Uint8Array): boolean => {
        const value = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        if (value === MODIFY_OTHER_KEYS_ENABLE) {
          lifecycleEvents.push("write.enable");
          escapeWrites.push(value);
        }
        if (value === MODIFY_OTHER_KEYS_DISABLE) {
          lifecycleEvents.push("write.disable");
          escapeWrites.push(value);
        }
        return true;
      }) as typeof process.stdout.write,
    );

    try {
      const { startChatUI } = await import("./index.ts");
      const uiPromise = startChatUI(createFakeClient());

      await waitFor(() => lifecycleEvents.includes("root.render"));

      const errorBoundaryExit = extractErrorBoundaryExit(renderedTree);
      expect(errorBoundaryExit).toBeTruthy();
      errorBoundaryExit?.();

      await uiPromise;

      expect(escapeWrites).toEqual([
        MODIFY_OTHER_KEYS_ENABLE,
        MODIFY_OTHER_KEYS_DISABLE,
      ]);

      const rendererReadyIndex = lifecycleEvents.indexOf("renderer.ready");
      const startupWriteIndex = lifecycleEvents.indexOf("write.enable");
      const createRootIndex = lifecycleEvents.indexOf("createRoot");
      const cleanupWriteIndex = lifecycleEvents.indexOf("write.disable");
      const rendererDestroyIndex = lifecycleEvents.indexOf("renderer.destroy");

      expect(rendererReadyIndex).toBeGreaterThanOrEqual(0);
      expect(startupWriteIndex).toBeGreaterThan(rendererReadyIndex);
      expect(createRootIndex).toBeGreaterThan(startupWriteIndex);

      expect(cleanupWriteIndex).toBeGreaterThanOrEqual(0);
      expect(rendererDestroyIndex).toBeGreaterThan(cleanupWriteIndex);
    } finally {
      createRendererSpy.mockRestore();
      createRootSpy.mockRestore();
      writeSpy.mockRestore();
      if (stdoutHadOwnIsTTY) {
        Object.defineProperty(process.stdout, "isTTY", {
          value: originalIsTTY,
          configurable: true,
          writable: true,
        });
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      }
      mock.restore();
    }
  });
});
