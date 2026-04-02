import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type {
    ToolDefinition,
    ToolContext,
} from "@/services/agents/types.ts";
import type { ClaudeSessionState } from "@/services/agents/clients/claude/internal-types.ts";

export function registerClaudeTool(args: {
    tool: ToolDefinition;
    sessions: Map<string, ClaudeSessionState>;
    registeredTools: Map<string, McpSdkServerConfigWithInstance>;
}): void {
    const sdkToolDef = {
        name: args.tool.name,
        description: args.tool.description,
        inputSchema: args.tool.inputSchema,
        handler: async (input: unknown, _extra: unknown) => {
            try {
                const context: ToolContext = {
                    sessionID: args.sessions.keys().next().value ?? "",
                    messageID: "",
                    agent: "claude",
                    directory: process.cwd(),
                    abort: new AbortController().signal,
                };
                const result = await args.tool.handler(
                    input as Record<string, unknown>,
                    context,
                );
                return {
                    content: [
                        {
                            type: "text" as const,
                            text:
                                typeof result === "string"
                                    ? result
                                    : JSON.stringify(result),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    };

    const mcpServer = createSdkMcpServer({
        name: `tool-${args.tool.name}`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [sdkToolDef as any],
    });

    args.registeredTools.set(args.tool.name, mcpServer);
}
