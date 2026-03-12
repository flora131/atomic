export interface ToolContext {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  abort: AbortSignal;
}

export type ToolHandlerResult = string | Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (
    input: Record<string, unknown>,
    context: ToolContext
  ) => ToolHandlerResult | Promise<ToolHandlerResult>;
}
