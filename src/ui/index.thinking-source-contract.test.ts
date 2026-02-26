import { describe, expect, spyOn, test } from "bun:test";

import type { CliRenderer } from "@opentui/core";
import type { Root } from "@opentui/react";
import * as opentuiCore from "@opentui/core";
import * as opentuiReact from "@opentui/react";

import type {
  AgentMessage,
  CodingAgentClient,
  Session,
} from "../sdk/types.ts";
import type { ChatAppProps } from "./chat.tsx";

interface ElementWithProps {
  props?: {
    children?: unknown;
  };
}

interface Harness {
  chatAppProps: ChatAppProps;
  uiPromise: Promise<unknown>;
  restore: () => void;
}

function extractChatAppProps(rootElement: unknown): ChatAppProps | null {
  const themeProvider = rootElement as ElementWithProps;
  const eventBusProvider = themeProvider.props?.children as ElementWithProps | undefined;
  const boundary = eventBusProvider?.props?.children as ElementWithProps | undefined;
  const chatApp = boundary?.props?.children as { props?: ChatAppProps } | undefined;
  return chatApp?.props ?? null;
}

async function waitFor(condition: () => boolean, attempts = 200): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition not met in time");
}

function createClient(
  streamImpl: (message: string, options?: { agent?: string }) => AsyncIterable<AgentMessage>,
): CodingAgentClient {
  const session: Session = {
    id: "session-thinking-contract",
    send: async () => ({ type: "text", content: "", role: "assistant" }),
    stream: streamImpl,
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
    createSession: async () => session,
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

async function createHarness(client: CodingAgentClient): Promise<Harness> {
  let renderedTree: unknown = null;

  const fakeRenderer = {
    destroy: () => {
      return;
    },
  } as CliRenderer;

  const fakeRoot = {
    render: (tree: unknown) => {
      renderedTree = tree;
    },
    unmount: () => {
      return;
    },
  } as Root;

  const createRendererSpy = spyOn(opentuiCore, "createCliRenderer").mockImplementation(
    (async () => fakeRenderer) as typeof opentuiCore.createCliRenderer,
  );

  const createRootSpy = spyOn(opentuiReact, "createRoot").mockImplementation(
    (() => fakeRoot) as typeof opentuiReact.createRoot,
  );

  try {
    const { startChatUI } = await import("./index.ts");
    const uiPromise = startChatUI(client);
    await waitFor(() => renderedTree !== null);

    const chatAppProps = extractChatAppProps(renderedTree);
    if (!chatAppProps?.onStreamMessage || !chatAppProps.onExit || !chatAppProps.onInterrupt) {
      throw new Error("Failed to extract ChatApp props");
    }

    return {
      chatAppProps,
      uiPromise,
      restore: () => {
        createRendererSpy.mockRestore();
        createRootSpy.mockRestore();
      },
    };
  } catch (error) {
    createRendererSpy.mockRestore();
    createRootSpy.mockRestore();
    throw error;
  }
}

describe("startChatUI stream contract", () => {
  test("exposes callback-free onStreamMessage and removes legacy registration props", async () => {
    const client = createClient(async function* () {
      yield { type: "text", content: "ok", role: "assistant" };
    });
    const harness = await createHarness(client);

    try {
      expect(typeof harness.chatAppProps.onStreamMessage).toBe("function");
      expect((harness.chatAppProps as Record<string, unknown>).registerToolStartHandler).toBeUndefined();
      expect((harness.chatAppProps as Record<string, unknown>).registerToolCompleteHandler).toBeUndefined();
      expect((harness.chatAppProps as Record<string, unknown>).registerPermissionRequestHandler).toBeUndefined();
      expect((harness.chatAppProps as Record<string, unknown>).registerAskUserQuestionHandler).toBeUndefined();
      expect((harness.chatAppProps as Record<string, unknown>).registerParallelAgentHandler).toBeUndefined();
    } finally {
      await Promise.resolve(harness.chatAppProps.onExit?.());
      await harness.uiPromise;
      harness.restore();
    }
  });

  test("passes stream options to session.stream", async () => {
    let capturedOptions: { agent?: string } | undefined;
    const client = createClient(async function* (_message: string, options?: { agent?: string }) {
      capturedOptions = options;
      yield { type: "text", content: "ok", role: "assistant" };
    });
    const harness = await createHarness(client);

    try {
      await expect(
        harness.chatAppProps.onStreamMessage?.("hello", { agent: "codebase-analyzer" }),
      ).resolves.toBeUndefined();
      expect(capturedOptions?.agent).toBe("codebase-analyzer");
    } finally {
      await Promise.resolve(harness.chatAppProps.onExit?.());
      await harness.uiPromise;
      harness.restore();
    }
  });

  test("accepts thinking streams without callback metadata hooks", async () => {
    const client = createClient(async function* () {
      yield {
        type: "thinking",
        content: "reasoning",
        role: "assistant",
        metadata: { provider: "claude", thinkingSourceKey: "source:1" },
      };
      yield { type: "text", content: "done", role: "assistant" };
    });
    const harness = await createHarness(client);

    try {
      await expect(
        harness.chatAppProps.onStreamMessage?.("hello"),
      ).resolves.toBeUndefined();
    } finally {
      await Promise.resolve(harness.chatAppProps.onExit?.());
      await harness.uiPromise;
      harness.restore();
    }
  });
});
