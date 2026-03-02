import { describe, expect, mock, test } from "bun:test";

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
    query: () => ({
        async *[Symbol.asyncIterator]() {
            throw new Error("Claude Code process exited with code 1");
        },
        close: () => {
            return;
        },
        mcpServerStatus: async () => [],
        supportedModels: async () => [],
    }),
    createSdkMcpServer: () => ({
        close: () => {
            return;
        },
    }),
}));

describe("ClaudeAgentClient process-exit diagnostics", () => {
    test("propagates Claude process-exit errors without rewriting the message", async () => {
        const { ClaudeAgentClient } = await import("./claude.ts");
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
                send: (message: string) => Promise<unknown>;
                stream: (
                    message: string,
                    options?: { agent?: string },
                ) => AsyncIterable<unknown>;
                destroy: () => Promise<void>;
            };
        };

        privateClient.buildSdkOptions = () => ({});
        const session = privateClient.wrapQuery(null, "diagnostic-session", {});

        await expect(session.send("hello")).rejects.toThrow(
            "Claude Code process exited with code 1",
        );

        let streamError: Error | null = null;
        try {
            for await (const _chunk of session.stream("hello", { agent: "planner" })) {
                // Stream is expected to error before yielding chunks.
            }
        } catch (error) {
            streamError = error instanceof Error ? error : new Error(String(error));
        }

        expect(streamError).not.toBeNull();
        expect(streamError!.message).toBe("Claude Code process exited with code 1");

        await session.destroy();
    });
});
