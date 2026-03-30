import type { AskUserQuestionEventData } from "@/services/workflows/graph/index.ts";
import type { CreateSessionFn } from "@/services/workflows/graph/types.ts";
import type { AgentType, ModelOperations } from "@/services/models/index.ts";
import type { McpServerConfig, Session, ToolDefinition } from "@/services/agents/types.ts";
import type { ChatMessage } from "@/state/chat/shared/types/message.ts";

export type OnToolStart = (
  toolId: string,
  toolName: string,
  input: Record<string, unknown>,
) => void;

export type OnToolComplete = (
  toolId: string,
  toolName: string,
  output: unknown,
  success: boolean,
  error?: string,
  input?: Record<string, unknown>,
) => void;

export type OnSkillInvoked = (
  skillName: string,
  skillPath?: string,
) => void;

export type OnPermissionRequest = (
  requestId: string,
  toolName: string,
  question: string,
  options: Array<{ label: string; value: string; description?: string }>,
  respond: (answer: string | string[]) => void,
  header?: string,
) => void;

export type OnInterrupt = () => void;

export type OnTerminateBackgroundAgents = () => void | Promise<void>;

export type OnAskUserQuestion = (eventData: AskUserQuestionEventData) => void;

export type CommandExecutionTrigger = "input" | "autocomplete" | "initial_prompt" | "mention";

export interface CommandExecutionTelemetry {
  commandName: string;
  commandCategory: import("@/commands/tui/index.ts").CommandCategory | "unknown";
  argsLength: number;
  success: boolean;
  trigger: CommandExecutionTrigger;
}

export interface MessageSubmitTelemetry {
  messageLength: number;
  queued: boolean;
  fromInitialPrompt: boolean;
  hasFileMentions: boolean;
  hasAgentMentions: boolean;
}

export interface ChatAppProps {
  initialMessages?: ChatMessage[];
  onSendMessage?: (content: string) => void | Promise<void>;
  onStreamMessage?: (
    content: string,
    options?: import("@/commands/tui/registry.ts").StreamMessageOptions,
  ) => void | Promise<void>;
  onExit?: () => void | Promise<void>;
  onResetSession?: () => void | Promise<void>;
  onInterrupt?: OnInterrupt;
  onTerminateBackgroundAgents?: OnTerminateBackgroundAgents;
  setStreamingState?: (isStreaming: boolean) => void;
  version?: string;
  model?: string;
  tier?: string;
  workingDir?: string;
  getSession?: () => import("@/services/agents/types.ts").Session | null;
  ensureSession?: () => Promise<void>;
  onWorkflowResumeWithAnswer?: (requestId: string, answer: string | string[]) => void;
  agentType?: AgentType;
  modelOps?: ModelOperations;
  getModelDisplayInfo?: (
    modelHint?: string,
  ) => Promise<import("@/services/agents/types.ts").ModelDisplayInfo>;
  createSubagentSession?: CreateSessionFn;
  /**
   * Register a custom tool on the underlying CodingAgentClient.
   * Makes the tool available to all sessions created via createSubagentSession.
   * Used by the conductor executor to register workflow-scoped tools (e.g., task_list).
   */
  registerTool?: (tool: ToolDefinition) => void;
  /**
   * Stream a message through a specific session using the real SDK adapter
   * pipeline, returning the captured response text. Used by the workflow
   * conductor for full rendering parity per stage.
   */
  streamWithSession?: (
    session: Session,
    prompt: string,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<string>;
  initialPrompt?: string;
  /** Maximum graph traversal steps for the conductor (overrides default 100) */
  maxIterations?: number;
  onModelChange?: (model: string) => void;
  onSessionMcpServersChange?: (servers: McpServerConfig[]) => void;
  initialModelId?: string;
  initialReasoningEffort?: string;
  onCommandExecutionTelemetry?: (event: CommandExecutionTelemetry) => void;
  onMessageSubmitTelemetry?: (event: MessageSubmitTelemetry) => void;
}
