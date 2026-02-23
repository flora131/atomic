import { describe, expect, mock, spyOn, test } from "bun:test";

import type { CliRenderer } from "@opentui/core";
import type { Root } from "@opentui/react";
import * as opentuiCore from "@opentui/core";
import * as opentuiReact from "@opentui/react";

import type { AgentMessage, CodingAgentClient, Session } from "../sdk/types.ts";
import type { ChatAppProps, StreamingMeta } from "./chat.tsx";

interface ElementWithProps {
  props?: {
    children?: unknown;
  };
}

interface StreamHarness {
  onExit: NonNullable<ChatAppProps["onExit"]>;
  onInterrupt: NonNullable<ChatAppProps["onInterrupt"]>;
  onStreamMessage: NonNullable<ChatAppProps["onStreamMessage"]>;
  uiPromise: Promise<unknown>;
  restore: () => void;
}

type StreamIteratorResult = IteratorResult<AgentMessage, undefined>;

interface ControlledAgentStream {
  readonly iterable: AsyncIterable<AgentMessage>;
  emit: (message: AgentMessage) => void;
  end: () => void;
}

interface ControlledClientBundle {
  client: CodingAgentClient;
  streams: ControlledAgentStream[];
}

function extractChatAppProps(rootElement: unknown): ChatAppProps | null {
  const themeProvider = rootElement as ElementWithProps;
  const boundary = themeProvider.props?.children as ElementWithProps | undefined;
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

function createFakeClient(streamMessages: AgentMessage[]): CodingAgentClient {
  const session: Session = {
    id: "session-thinking-contract",
    send: async () => ({ type: "text", content: "", role: "assistant" }),
    stream: async function* (): AsyncIterable<AgentMessage> {
      for (const message of streamMessages) {
        yield message;
      }
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

function createControlledAgentStream(): ControlledAgentStream {
  const pending: StreamIteratorResult[] = [];
  const resolvers: Array<(value: StreamIteratorResult) => void> = [];
  let ended = false;

  const flush = (result: StreamIteratorResult): void => {
    const resolve = resolvers.shift();
    if (resolve) {
      resolve(result);
      return;
    }
    pending.push(result);
  };

  const end = (): void => {
    if (ended) {
      return;
    }
    ended = true;
    flush({ done: true, value: undefined });
  };

  const iterable: AsyncIterable<AgentMessage> = {
    [Symbol.asyncIterator](): AsyncIterator<AgentMessage, undefined> {
      return {
        next(): Promise<StreamIteratorResult> {
          if (pending.length > 0) {
            const nextValue = pending.shift();
            if (nextValue) {
              return Promise.resolve(nextValue);
            }
          }
          return new Promise<StreamIteratorResult>((resolve) => {
            resolvers.push(resolve);
          });
        },
        return(): Promise<IteratorReturnResult<undefined>> {
          end();
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };

  return {
    iterable,
    emit: (message: AgentMessage) => {
      if (ended) {
        return;
      }
      flush({ done: false, value: message });
    },
    end,
  };
}

function createControlledClient(streamCount: number): ControlledClientBundle {
  const streams = Array.from({ length: streamCount }, () => createControlledAgentStream());
  let streamCallIndex = 0;
  let activeStream: ControlledAgentStream | null = null;

  const session: Session = {
    id: "session-thinking-contract-controlled",
    send: async () => ({ type: "text", content: "", role: "assistant" }),
    stream: async function* (): AsyncIterable<AgentMessage> {
      const stream = streams[streamCallIndex];
      streamCallIndex += 1;
      if (!stream) {
        return;
      }
      activeStream = stream;
      try {
        for await (const message of stream.iterable) {
          yield message;
        }
      } finally {
        if (activeStream === stream) {
          activeStream = null;
        }
      }
    },
    abort: async () => {
      activeStream?.end();
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
    streams,
    client: {
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
    },
  };
}

async function createStreamHarnessFromClient(client: CodingAgentClient): Promise<StreamHarness> {
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

  mock.module("./chat.tsx", () => ({
    ChatApp: () => null,
    CompletionSummary: () => null,
    LoadingIndicator: () => null,
    StreamingBullet: () => null,
    traceThinkingSourceLifecycle: () => {
      return;
    },
    MAX_VISIBLE_MESSAGES: 100,
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
      throw new Error("Failed to extract ChatApp stream callbacks");
    }

    return {
      onExit: chatAppProps.onExit,
      onInterrupt: chatAppProps.onInterrupt,
      onStreamMessage: chatAppProps.onStreamMessage,
      uiPromise,
      restore: () => {
        createRendererSpy.mockRestore();
        createRootSpy.mockRestore();
        mock.restore();
      },
    };
  } catch (error) {
    createRendererSpy.mockRestore();
    createRootSpy.mockRestore();
    mock.restore();
    throw error;
  }
}

async function createStreamHarness(streamMessages: AgentMessage[]): Promise<StreamHarness> {
  return createStreamHarnessFromClient(createFakeClient(streamMessages));
}

describe("startChatUI thinking source key contract", () => {
  test("throws on thinking events that omit metadata.thinkingSourceKey", async () => {
    const harness = await createStreamHarness([
      {
        type: "thinking",
        content: "reasoning",
        role: "assistant",
        metadata: { provider: "claude" },
      },
    ]);

    try {
      let onCompleteCalls = 0;
      await expect(
        harness.onStreamMessage("hello", () => {}, () => {
          onCompleteCalls += 1;
        }),
      ).rejects.toThrow(
        "Contract violation: thinking stream message is missing required metadata.thinkingSourceKey",
      );
      expect(onCompleteCalls).toBe(1);
    } finally {
      await Promise.resolve(harness.onExit());
      await harness.uiPromise;
      harness.restore();
    }
  });

  test("throws on thinking events with empty metadata.thinkingSourceKey", async () => {
    const harness = await createStreamHarness([
      {
        type: "thinking",
        content: "reasoning",
        role: "assistant",
        metadata: { provider: "claude", thinkingSourceKey: "   " },
      },
    ]);

    try {
      await expect(
        harness.onStreamMessage("hello", () => {}, () => {
          return;
        }),
      ).rejects.toThrow(
        "Contract violation: thinking stream message is missing required metadata.thinkingSourceKey",
      );
    } finally {
      await Promise.resolve(harness.onExit());
      await harness.uiPromise;
      harness.restore();
    }
  });

  test("keeps non-thinking streams working without source identity", async () => {
    const harness = await createStreamHarness([
      {
        type: "text",
        content: "hello ",
        role: "assistant",
      },
      {
        type: "text",
        content: "world",
        role: "assistant",
      },
    ]);

    try {
      const chunks: string[] = [];
      let onCompleteCalls = 0;
      await expect(
        harness.onStreamMessage(
          "hello",
          (chunk) => {
            chunks.push(chunk);
          },
          () => {
            onCompleteCalls += 1;
          },
        ),
      ).resolves.toBeUndefined();

      expect(chunks.join("")).toBe("hello world");
      expect(onCompleteCalls).toBe(1);
    } finally {
      await Promise.resolve(harness.onExit());
      await harness.uiPromise;
      harness.restore();
    }
  });

  test("preserves thinking metadata behavior when source identity is present", async () => {
    const sourceKey = "claude:block-0";
    const harness = await createStreamHarness([
      {
        type: "thinking",
        content: "analyzing",
        role: "assistant",
        metadata: {
          provider: "claude",
          thinkingSourceKey: sourceKey,
          streamGeneration: 7,
          targetMessageId: "msg-1",
        },
      },
      {
        type: "text",
        content: "done",
        role: "assistant",
      },
    ]);

    try {
      const metaEvents: StreamingMeta[] = [];

      await expect(
        harness.onStreamMessage(
          "hello",
          () => {
            return;
          },
          () => {
            return;
          },
          (meta) => {
            metaEvents.push(meta);
          },
        ),
      ).resolves.toBeUndefined();

      const thinkingMeta = metaEvents.find((meta) => meta.thinkingSourceKey === sourceKey);
      expect(thinkingMeta).toBeDefined();
      if (!thinkingMeta) {
        throw new Error("Expected thinking metadata event");
      }
      expect(thinkingMeta.thinkingTextBySource?.[sourceKey]).toBe("analyzing");
      expect(thinkingMeta.thinkingGenerationBySource?.[sourceKey]).toBe(7);
      expect(thinkingMeta.thinkingMessageBySource?.[sourceKey]).toBe("msg-1");
    } finally {
      await Promise.resolve(harness.onExit());
      await harness.uiPromise;
      harness.restore();
    }
  });

  test("keeps source message binding stable when later chunks omit message IDs", async () => {
    const sourceKey = "copilot:reasoning_7";
    const harness = await createStreamHarness([
      {
        type: "thinking",
        content: "step one",
        role: "assistant",
        metadata: {
          provider: "copilot",
          thinkingSourceKey: sourceKey,
          streamGeneration: 4,
          messageId: "msg-fallback",
        },
      },
      {
        type: "thinking",
        content: " + step two",
        role: "assistant",
        metadata: {
          provider: "copilot",
          thinkingSourceKey: sourceKey,
          streamGeneration: 4,
        },
      },
      {
        type: "text",
        content: "done",
        role: "assistant",
      },
    ]);

    try {
      const metaEvents: StreamingMeta[] = [];

      await expect(
        harness.onStreamMessage(
          "hello",
          () => {
            return;
          },
          () => {
            return;
          },
          (meta) => {
            metaEvents.push(meta);
          },
        ),
      ).resolves.toBeUndefined();

      const thinkingMeta = [...metaEvents]
        .reverse()
        .find((meta) => meta.thinkingSourceKey === sourceKey);
      expect(thinkingMeta).toBeDefined();
      if (!thinkingMeta) {
        throw new Error("Expected source-bound thinking metadata event");
      }

      expect(thinkingMeta.thinkingTextBySource?.[sourceKey]).toBe("step one + step two");
      expect(thinkingMeta.thinkingGenerationBySource?.[sourceKey]).toBe(4);
      expect(thinkingMeta.thinkingMessageBySource?.[sourceKey]).toBe("msg-fallback");
    } finally {
      await Promise.resolve(harness.onExit());
      await harness.uiPromise;
      harness.restore();
    }
  });

  test("keeps generation and message bindings isolated across sources", async () => {
    const sourceA = "claude:block-0";
    const sourceB = "opencode:reasoning_part_9";
    const harness = await createStreamHarness([
      {
        type: "thinking",
        content: "alpha",
        role: "assistant",
        metadata: {
          provider: "claude",
          thinkingSourceKey: sourceA,
          streamGeneration: 11,
          targetMessageId: "msg-a",
        },
      },
      {
        type: "thinking",
        content: "beta",
        role: "assistant",
        metadata: {
          provider: "opencode",
          thinkingSourceKey: sourceB,
          streamGeneration: 12,
          targetMessageId: "msg-b",
        },
      },
      {
        type: "text",
        content: "done",
        role: "assistant",
      },
    ]);

    try {
      const metaEvents: StreamingMeta[] = [];

      await expect(
        harness.onStreamMessage(
          "hello",
          () => {
            return;
          },
          () => {
            return;
          },
          (meta) => {
            metaEvents.push(meta);
          },
        ),
      ).resolves.toBeUndefined();

      const thinkingMeta = [...metaEvents]
        .reverse()
        .find((meta) => meta.thinkingSourceKey === sourceB);
      expect(thinkingMeta).toBeDefined();
      if (!thinkingMeta) {
        throw new Error("Expected multi-source thinking metadata event");
      }

      expect(thinkingMeta.thinkingTextBySource?.[sourceA]).toBe("alpha");
      expect(thinkingMeta.thinkingTextBySource?.[sourceB]).toBe("beta");
      expect(thinkingMeta.thinkingGenerationBySource?.[sourceA]).toBe(11);
      expect(thinkingMeta.thinkingGenerationBySource?.[sourceB]).toBe(12);
      expect(thinkingMeta.thinkingMessageBySource?.[sourceA]).toBe("msg-a");
      expect(thinkingMeta.thinkingMessageBySource?.[sourceB]).toBe("msg-b");
    } finally {
      await Promise.resolve(harness.onExit());
      await harness.uiPromise;
      harness.restore();
    }
  });

  test("regression: aggregates interleaved thinking chunks per source without concatenation bleed", async () => {
    const sourceA = "claude:block-0";
    const sourceB = "opencode:reasoning_1";
    const harness = await createStreamHarness([
      {
        type: "thinking",
        content: "alpha-1 ",
        role: "assistant",
        metadata: {
          provider: "claude",
          thinkingSourceKey: sourceA,
          streamGeneration: 9,
          targetMessageId: "msg-a",
        },
      },
      {
        type: "thinking",
        content: "beta-1 ",
        role: "assistant",
        metadata: {
          provider: "opencode",
          thinkingSourceKey: sourceB,
          streamGeneration: 10,
          targetMessageId: "msg-b",
        },
      },
      {
        type: "thinking",
        content: "alpha-2",
        role: "assistant",
        metadata: {
          provider: "claude",
          thinkingSourceKey: sourceA,
          streamGeneration: 9,
          targetMessageId: "msg-a",
        },
      },
      {
        type: "thinking",
        content: "beta-2",
        role: "assistant",
        metadata: {
          provider: "opencode",
          thinkingSourceKey: sourceB,
          streamGeneration: 10,
          targetMessageId: "msg-b",
        },
      },
      {
        type: "text",
        content: "final",
        role: "assistant",
      },
    ]);

    try {
      const metaEvents: StreamingMeta[] = [];

      await expect(
        harness.onStreamMessage(
          "hello",
          () => {
            return;
          },
          () => {
            return;
          },
          (meta) => {
            metaEvents.push(meta);
          },
        ),
      ).resolves.toBeUndefined();

      const latest = [...metaEvents]
        .reverse()
        .find((meta) => meta.thinkingSourceKey === sourceB);
      expect(latest).toBeDefined();
      if (!latest) {
        throw new Error("Expected interleaved thinking metadata event");
      }

      expect(latest.thinkingTextBySource?.[sourceA]).toBe("alpha-1 alpha-2");
      expect(latest.thinkingTextBySource?.[sourceB]).toBe("beta-1 beta-2");
      expect(latest.thinkingTextBySource?.[sourceA]).not.toContain("beta");
      expect(latest.thinkingTextBySource?.[sourceB]).not.toContain("alpha");
      expect(latest.thinkingGenerationBySource?.[sourceA]).toBe(9);
      expect(latest.thinkingGenerationBySource?.[sourceB]).toBe(10);
      expect(latest.thinkingMessageBySource?.[sourceA]).toBe("msg-a");
      expect(latest.thinkingMessageBySource?.[sourceB]).toBe("msg-b");
    } finally {
      await Promise.resolve(harness.onExit());
      await harness.uiPromise;
      harness.restore();
    }
  });

  test("interrupt handoff drops stale late thinking and keeps next stream isolated", async () => {
    const { client, streams } = createControlledClient(2);
    const firstStream = streams[0];
    const secondStream = streams[1];
    if (!firstStream || !secondStream) {
      throw new Error("Expected two controlled streams");
    }

    const harness = await createStreamHarnessFromClient(client);

    try {
      const firstMetaEvents: StreamingMeta[] = [];
      let firstCompleteCalls = 0;

      const firstPromise = harness.onStreamMessage(
        "first",
        () => {
          return;
        },
        () => {
          firstCompleteCalls += 1;
        },
        (meta) => {
          firstMetaEvents.push(meta);
        },
      );

      firstStream.emit({
        type: "thinking",
        content: "old-thought",
        role: "assistant",
        metadata: {
          provider: "claude",
          thinkingSourceKey: "source:old",
          streamGeneration: 1,
          targetMessageId: "msg-old",
        },
      });

      await waitFor(() => firstMetaEvents.length === 1);

      harness.onInterrupt();

      firstStream.emit({
        type: "thinking",
        content: "+late-old",
        role: "assistant",
        metadata: {
          provider: "claude",
          thinkingSourceKey: "source:old",
          streamGeneration: 1,
          targetMessageId: "msg-old",
        },
      });
      firstStream.end();
      await firstPromise;

      const secondMetaEvents: StreamingMeta[] = [];

      const secondPromise = harness.onStreamMessage(
        "second",
        () => {
          return;
        },
        () => {
          return;
        },
        (meta) => {
          secondMetaEvents.push(meta);
        },
      );

      secondStream.emit({
        type: "thinking",
        content: "new-thought",
        role: "assistant",
        metadata: {
          provider: "copilot",
          thinkingSourceKey: "source:new",
          streamGeneration: 2,
          targetMessageId: "msg-new",
        },
      });
      secondStream.emit({
        type: "text",
        content: "done",
        role: "assistant",
      });
      secondStream.end();
      await secondPromise;

      expect(firstCompleteCalls).toBe(1);
      expect(firstMetaEvents).toHaveLength(1);

      const secondThinkingMeta = [...secondMetaEvents]
        .reverse()
        .find((meta) => meta.thinkingSourceKey === "source:new");
      expect(secondThinkingMeta).toBeDefined();
      if (!secondThinkingMeta) {
        throw new Error("Expected next-stream thinking metadata");
      }

      expect(secondThinkingMeta.thinkingTextBySource?.["source:new"]).toBe("new-thought");
      expect(secondThinkingMeta.thinkingTextBySource?.["source:old"]).toBeUndefined();
      expect(secondThinkingMeta.thinkingGenerationBySource?.["source:old"]).toBeUndefined();
      expect(secondThinkingMeta.thinkingMessageBySource?.["source:old"]).toBeUndefined();
    } finally {
      await Promise.resolve(harness.onExit());
      await harness.uiPromise;
      harness.restore();
    }
  });
});
