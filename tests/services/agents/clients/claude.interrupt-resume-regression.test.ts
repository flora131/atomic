import { beforeEach, describe, expect, mock, test } from "bun:test";

let queryCallCount = 0;
let interruptCalls = 0;
let closeCalls = 0;
let forceClosed = false;
let releaseFirstRun: (() => void) | null = null;
let resolveFirstQueryStarted: (() => void) | null = null;
let firstQueryStarted: Promise<void> = Promise.resolve();
let resolveFirstRunBlocked: (() => void) | null = null;
let firstRunBlocked: Promise<void> = Promise.resolve();
const capturedOptions: Array<Record<string, unknown> | undefined> = [];

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
    query: ({
        options,
    }: {
        prompt: string;
        options?: Record<string, unknown>;
    }) => {
        queryCallCount += 1;
        const callNumber = queryCallCount;
        capturedOptions.push(options);

        if (callNumber === 1) {
            resolveFirstQueryStarted?.();
        }

        return {
            async *[Symbol.asyncIterator]() {
                if (callNumber === 2 && forceClosed) {
                    throw new Error("Claude Code process exited with code 1");
                }

                const sdkSessionId = "sdk-interrupt-regression";
                yield {
                    type: "system",
                    subtype: "init",
                    model: "claude-3-5-sonnet-20241022",
                    session_id: sdkSessionId,
                };

                yield {
                    type: "stream_event",
                    event: {
                        type: "content_block_delta",
                        delta: {
                            type: "text_delta",
                            text: callNumber === 1 ? "first" : "second",
                        },
                    },
                    session_id: sdkSessionId,
                };

                if (callNumber === 1) {
                    await new Promise<void>((resolve) => {
                        releaseFirstRun = resolve;
                        resolveFirstRunBlocked?.();
                    });
                }

                yield {
                    type: "result",
                    subtype: "success",
                    usage: { input_tokens: 1, output_tokens: 1 },
                    session_id: sdkSessionId,
                };
            },
            interrupt: async () => {
                interruptCalls += 1;
                releaseFirstRun?.();
                releaseFirstRun = null;
            },
            close: () => {
                closeCalls += 1;
                forceClosed = true;
                releaseFirstRun?.();
                releaseFirstRun = null;
            },
            mcpServerStatus: async () => [],
            supportedModels: async () => [],
        };
    },
    createSdkMcpServer: () => ({
        close: () => {
            return;
        },
    }),
}));

describe("ClaudeAgentClient interrupt resume regression", () => {
    beforeEach(() => {
        queryCallCount = 0;
        interruptCalls = 0;
        closeCalls = 0;
        forceClosed = false;
        releaseFirstRun = null;
        capturedOptions.length = 0;
        firstQueryStarted = new Promise<void>((resolve) => {
            resolveFirstQueryStarted = resolve;
        });
        firstRunBlocked = new Promise<void>((resolve) => {
            resolveFirstRunBlocked = resolve;
        });
    });

    test("interrupting a run does not poison the next resumed stream", async () => {
        const { ClaudeAgentClient } = await import("@/services/agents/clients/claude.ts");
        const client = new ClaudeAgentClient();

        const privateClient = client as unknown as {
            buildSdkOptions: (
                config: Record<string, unknown>,
                sessionId?: string,
            ) => Record<string, unknown>;
            wrapQuery: (
                queryInstance: null,
                sessionId: string,
                config: Record<string, unknown>,
            ) => {
                stream: (message: string) => AsyncIterable<{
                    type: string;
                    content?: unknown;
                }>;
                abort: () => Promise<void>;
                destroy: () => Promise<void>;
            };
        };

        privateClient.buildSdkOptions = () => ({});
        const session = privateClient.wrapQuery(null, "interrupt-session", {});

        const firstRunChunks: string[] = [];
        const firstRunPromise = (async () => {
            for await (const chunk of session.stream("first run")) {
                if (chunk.type === "text" && typeof chunk.content === "string") {
                    firstRunChunks.push(chunk.content);
                }
            }
        })();

        await firstQueryStarted;
        await firstRunBlocked;
        await session.abort();
        await firstRunPromise;

        const secondRunChunks: string[] = [];
        for await (const chunk of session.stream("second run")) {
            if (chunk.type === "text" && typeof chunk.content === "string") {
                secondRunChunks.push(chunk.content);
            }
        }

        expect(firstRunChunks.join("")).toBe("first");
        expect(secondRunChunks.join("")).toBe("second");
        expect(interruptCalls).toBe(1);
        expect(closeCalls).toBe(0);
        expect(capturedOptions[1]?.resume).toBe("sdk-interrupt-regression");

        await session.destroy();
    });
});
