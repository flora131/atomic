/**
 * Command Type Definitions
 *
 * Shared types for the command system. These types are used by both
 * the command layer (`commands/`) and the service layer (`services/`).
 * They live in `types/` to enforce the dependency direction rule:
 * services must not import from commands.
 */

import type { Session, ModelDisplayInfo, McpServerConfig } from "@/services/agents/types.ts";
import type { AgentType, ModelOperations } from "@/services/models/index.ts";
import type { TodoItem } from "@/services/agents/tools/todo-write.ts";
import type { McpServerToggleMap, McpSnapshotView } from "@/lib/ui/mcp-output.ts";
import type { SubagentSpawnOptions, SubagentStreamResult } from "@/services/workflows/graph/types.ts";
import type { WorkflowRuntimeTask, WorkflowRuntimeTaskStatus } from "@/services/workflows/runtime-contracts.ts";
import type {
  StreamRunHandle,
  StreamRunKind,
  StreamRunResult,
  StreamRunVisibility,
} from "@/state/runtime/stream-run-runtime.ts";

export type StreamResult = StreamRunResult;

export interface StreamMessageOptions {
  agent?: string;
  isAgentOnlyStream?: boolean;
  skillCommand?: { name: string; args: string };
  visibility?: StreamRunVisibility;
  runKind?: StreamRunKind;
  parentRunId?: string;
}

export interface SpawnSubagentOptions {
  name?: string;
  message: string;
  tools?: string[];
  model?: string;
}

export interface SpawnSubagentResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface CommandContextState {
  isStreaming: boolean;
  messageCount: number;
  workflowActive?: boolean;
  workflowType?: string | null;
  initialPrompt?: string | null;
  workflowConfig?: {
    userPrompt: string | null;
    sessionId?: string;
    workflowName?: string;
  };
}

export interface CommandContext {
  session: Session | null;
  ensureSession?: () => Promise<void>;
  state: CommandContextState;
  addMessage: (role: "user" | "assistant" | "system", content: string) => void;
  setStreaming: (streaming: boolean) => void;
  sendMessage: (content: string) => void;
  sendSilentMessage: (content: string, options?: StreamMessageOptions) => void;
  startStreamRun?: (content: string, options?: StreamMessageOptions) => StreamRunHandle | null;
  spawnSubagent: (options: SpawnSubagentOptions) => Promise<SpawnSubagentResult>;
  spawnSubagentParallel?: (agents: SubagentSpawnOptions[], abortSignal?: AbortSignal, onAgentComplete?: (result: SubagentStreamResult) => void) => Promise<SubagentStreamResult[]>;
  streamAndWait: (prompt: string, options?: { hideContent?: boolean }) => Promise<StreamResult>;
  clearContext: () => Promise<void>;
  setTodoItems: (items: TodoItem[]) => void;
  setWorkflowSessionDir: (dir: string | null) => void;
  setWorkflowSessionId: (id: string | null) => void;
  setWorkflowTaskIds: (ids: Set<string>) => void;
  /** Direct task list update — bypasses bus events. Used by workflow executor. */
  updateTaskList?: (tasks: WorkflowRuntimeTask[]) => void;
  /** Direct task status change notification — bypasses bus events. */
  onTaskStatusChange?: (
    taskIds: string[],
    newStatus: WorkflowRuntimeTaskStatus,
    tasks: WorkflowRuntimeTask[],
  ) => void;
  waitForUserInput: () => Promise<string>;
  updateWorkflowState: (update: Partial<CommandContextState>) => void;
  eventBus?: import("@/services/events/event-bus.ts").EventBus;
  agentType?: AgentType;
  modelOps?: ModelOperations;
  getModelDisplayInfo?: () => Promise<ModelDisplayInfo>;
  getMcpServerToggles?: () => McpServerToggleMap;
  setMcpServerEnabled?: (name: string, enabled: boolean) => void;
  setSessionMcpServers?: (servers: McpServerConfig[]) => void;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  stateUpdate?: Partial<CommandContextState>;
  clearMessages?: boolean;
  destroySession?: boolean;
  shouldExit?: boolean;
  showModelSelector?: boolean;
  themeChange?: "dark" | "light" | "toggle";
  compactionSummary?: string;
  skillLoaded?: string;
  skillLoadError?: string;
  showMcpOverlay?: boolean;
  mcpServers?: McpServerConfig[];
  mcpSnapshot?: McpSnapshotView;
  modelDisplayName?: string;
}

export type CommandCategory = "builtin" | "workflow" | "skill" | "agent" | "file" | "folder";

export interface CommandDefinition {
  name: string;
  description: string;
  category: CommandCategory;
  execute: (args: string, context: CommandContext) => CommandResult | Promise<CommandResult>;
  aliases?: string[];
  hidden?: boolean;
  argumentHint?: string;
}
