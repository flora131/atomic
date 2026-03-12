import { describe, expect, mock, spyOn, test } from "bun:test";

import type { AgentMessage, CodingAgentClient, Session } from "@/services/agents/types.ts";
import type { CliRenderer, StyleDefinition } from "@opentui/core";
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
  const eventBusProvider = themeProvider.props?.children as ElementWithProps | undefined;
  const boundary = eventBusProvider?.props?.children as ElementWithProps | undefined;
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

    mock.module("@/screens/chat-screen.tsx", () => ({
      ChatApp: () => null,
      CompletionSummary: () => null,
      LoadingIndicator: () => null,
      StreamingBullet: () => null,
      defaultWorkflowChatState: {},
      traceThinkingSourceLifecycle: () => {
        return;
      },
    }));

    mock.module("@/theme/index.tsx", () => ({
      ThemeProvider: ({ children }: { children?: unknown }) => children ?? null,
      useTheme: () => null,
      useThemeColors: () => null,
      createMarkdownSyntaxStyle: () =>
        opentuiCore.SyntaxStyle.fromStyles({
          keyword: { fg: opentuiCore.RGBA.fromHex("#cba6f7"), bold: true },
          string: { fg: opentuiCore.RGBA.fromHex("#a6e3a1") },
          comment: { fg: opentuiCore.RGBA.fromHex("#9399b2"), italic: true },
          default: { fg: opentuiCore.RGBA.fromHex("#cdd6f4") },
        }),
      createDimmedSyntaxStyle: (
        baseStyle: InstanceType<typeof opentuiCore.SyntaxStyle>,
        opacity: number = 0.6,
      ) => {
        const dimmedRecord: Record<string, StyleDefinition> = {};

        for (const [name, def] of baseStyle.getAllStyles()) {
          const dimmedDef: StyleDefinition = { ...def };
          if (dimmedDef.fg) {
            dimmedDef.fg = opentuiCore.RGBA.fromValues(
              dimmedDef.fg.r,
              dimmedDef.fg.g,
              dimmedDef.fg.b,
              dimmedDef.fg.a * opacity,
            );
          }
          dimmedRecord[name] = dimmedDef;
        }

        return opentuiCore.SyntaxStyle.fromStyles(dimmedRecord);
      },
      getCatppuccinPalette: () => ({
        blue: "#89b4fa",
        green: "#a6e3a1",
        lavender: "#b4befe",
        mauve: "#cba6f7",
        overlay0: "#6c7086",
        pink: "#f5c2e7",
        red: "#f38ba8",
        surface0: "#313244",
        surface1: "#45475a",
        surface2: "#585b70",
        teal: "#94e2d5",
        text: "#cdd6f4",
        yellow: "#f9e2af",
        rosewater: "#f5e0dc",
        flamingo: "#f2cdcd",
        maroon: "#eba0ac",
        peach: "#fab387",
        sky: "#89dceb",
        sapphire: "#74c7ec",
        subtext1: "#bac2de",
        subtext0: "#a6adc8",
        overlay2: "#9399b2",
        overlay1: "#7f849c",
        base: "#1e1e2e",
        mantle: "#181825",
        crust: "#11111b",
      }),
      darkTheme: { isDark: true },
      lightTheme: { isDark: false },
      darkThemeAnsi: { isDark: true },
      lightThemeAnsi: { isDark: false },
    }));

    mock.module("@/components/error-exit-screen.tsx", () => ({
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
      const { startChatUI } = await import("@/app.tsx");
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
