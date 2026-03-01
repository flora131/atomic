import { beforeEach, describe, expect, mock, test } from "bun:test";

const queryCalls: Array<{
    prompt: string;
    options: Record<string, unknown>;
}> = [];

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
    query: ({
        prompt,
        options,
    }: {
        prompt: string;
        options: Record<string, unknown>;
    }) => {
        queryCalls.push({ prompt, options });

        return {
            async *[Symbol.asyncIterator]() {
                yield {
                    type: "result",
                    subtype: "success",
                    usage: { input_tokens: 0, output_tokens: 0 },
                };
            },
            close: () => {
                return;
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

describe("ClaudeAgentClient stream sub-agent routing", () => {
    beforeEach(() => {
        queryCalls.length = 0;
    });

    test("passes the selected agent through SDK options", async () => {
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
                stream: (
                    message: string,
                    options?: { agent?: string },
                ) => AsyncIterable<{ type: string; content?: string }>;
                destroy: () => Promise<void>;
            };
        };

        privateClient.buildSdkOptions = () => ({});

        const session = privateClient.wrapQuery(
            null,
            "stream-agent-routing",
            {},
        );

        for await (const _chunk of session.stream("Review the implementation", {
            agent: "reviewer",
        })) {
            // Consume stream to trigger query invocation.
        }

        expect(queryCalls).toHaveLength(1);
        const call = queryCalls[0]!;
        expect(call.prompt).toBe("Review the implementation");
        expect(call.options.agent).toBe("reviewer");
        expect(call.prompt).not.toContain("Invoke the \"reviewer\" sub-agent");

        await session.destroy();
    });
});
