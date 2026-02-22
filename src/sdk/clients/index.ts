export {
    ClaudeAgentClient,
    createClaudeAgentClient,
    getBundledClaudeCodePath,
    type ClaudeHookConfig,
} from "./claude.ts";

export {
    OpenCodeClient,
    createOpenCodeClient,
    type OpenCodeClientOptions,
    type OpenCodeHealthStatus,
    buildOpenCodeMcpSnapshot,
} from "./opencode.ts";

export {
    CopilotClient,
    createCopilotClient,
    createAutoApprovePermissionHandler,
    createDenyAllPermissionHandler,
    type CopilotSdkEventType,
    type CopilotSdkEvent,
    type CopilotSdkPermissionRequest,
    type CopilotPermissionHandler,
    type CopilotConnectionMode,
    type CopilotClientOptions,
    resolveNodePath,
    getBundledCopilotCliPath,
} from "./copilot.ts";
