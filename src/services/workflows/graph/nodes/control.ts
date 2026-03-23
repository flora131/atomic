import type {
  BaseState,
  NodeId,
  NodeDefinition,
  NodeResult,
  ExecutionContext,
} from "@/services/workflows/graph/types.ts";
import { BUFFER_EXHAUSTION_THRESHOLD } from "@/services/workflows/graph/types.ts";

export interface ClearContextNodeConfig<TState extends BaseState = BaseState> {
  id: NodeId;
  name?: string;
  description?: string;
  message?: string | ((state: TState) => string);
}

export function clearContextNode<TState extends BaseState = BaseState>(
  config: ClearContextNodeConfig<TState>,
): NodeDefinition<TState> {
  const { id, name, description, message } = config;

  return {
    id,
    type: "tool",
    name: name ?? "clear-context",
    description: description ?? "Clears the context window",
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const resolvedMessage =
        typeof message === "function" ? message(ctx.state) : message;

      return {
        signals: [
          {
            type: "context_window_warning",
            message: resolvedMessage ?? "Clearing context window",
            data: {
              usage: 100,
              threshold:
                ctx.contextWindowThreshold ??
                BUFFER_EXHAUSTION_THRESHOLD * 100,
              nodeId: id,
              action: "summarize",
            },
          },
        ],
      };
    },
  };
}

export interface DecisionRoute<TState extends BaseState = BaseState> {
  condition: (state: TState) => boolean;
  target: NodeId;
  label?: string;
}

export interface DecisionNodeConfig<TState extends BaseState = BaseState> {
  id: NodeId;
  routes: DecisionRoute<TState>[];
  fallback: NodeId;
  name?: string;
  description?: string;
}

export function decisionNode<TState extends BaseState = BaseState>(
  config: DecisionNodeConfig<TState>,
): NodeDefinition<TState> {
  const { id, routes, fallback, name, description } = config;

  return {
    id,
    type: "decision",
    name: name ?? "decision",
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      for (const route of routes) {
        if (route.condition(ctx.state)) {
          return { goto: route.target };
        }
      }

      return { goto: fallback };
    },
  };
}

export type InputMapper<TState extends BaseState = BaseState> = (
  input: string,
  state: TState,
) => Partial<TState>;

export interface WaitNodeConfig<TState extends BaseState = BaseState> {
  id: NodeId;
  prompt: string | ((state: TState) => string);
  autoApprove?: boolean;
  inputMapper?: InputMapper<TState>;
  name?: string;
  description?: string;
}

export function waitNode<TState extends BaseState = BaseState>(
  config: WaitNodeConfig<TState>,
): NodeDefinition<TState> {
  const {
    id,
    prompt,
    autoApprove = false,
    inputMapper,
    name,
    description,
  } = config;

  return {
    id,
    type: "wait",
    name: name ?? "wait",
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const resolvedPrompt =
        typeof prompt === "function" ? prompt(ctx.state) : prompt;

      if (autoApprove) {
        const stateUpdate = inputMapper
          ? inputMapper("", ctx.state)
          : undefined;
        return { stateUpdate };
      }

      return {
        signals: [
          {
            type: "human_input_required",
            message: resolvedPrompt,
            data: {
              nodeId: id,
              inputMapper: inputMapper ? true : false,
            },
          },
        ],
      };
    },
  };
}

export interface AskUserOption {
  label: string;
  description?: string;
}

export interface AskUserOptions {
  question: string;
  header?: string;
  options?: AskUserOption[];
  multiSelect?: boolean;
}

export interface AskUserNodeConfig<TState extends BaseState = BaseState> {
  id: NodeId;
  options: AskUserOptions | ((state: TState) => AskUserOptions);
  name?: string;
  description?: string;
}

export interface AskUserWaitState {
  __waitingForInput?: boolean;
  __waitNodeId?: string;
  __askUserRequestId?: string;
}

export interface AskUserQuestionEventData {
  requestId: string;
  question: string;
  header?: string;
  options?: AskUserOption[];
  multiSelect?: boolean;
  dslAskUser?: boolean;
  nodeId: string;
  respond?: (answer: string | string[]) => void;
  toolCallId?: string;
}

export function askUserNode<
  TState extends BaseState & AskUserWaitState = BaseState & AskUserWaitState,
>(config: AskUserNodeConfig<TState>): NodeDefinition<TState> {
  const { id, options, name, description } = config;

  return {
    id,
    type: "ask_user",
    name: name ?? "ask-user",
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const resolvedOptions =
        typeof options === "function" ? options(ctx.state) : options;
      const requestId = crypto.randomUUID();

      const eventData: AskUserQuestionEventData = {
        requestId,
        question: resolvedOptions.question,
        header: resolvedOptions.header,
        options: resolvedOptions.options,
        multiSelect: resolvedOptions.multiSelect,
        nodeId: id,
      };

      if (ctx.emit) {
        ctx.emit(
          "human_input_required",
          eventData as unknown as Record<string, unknown>,
        );
      }

      return {
        stateUpdate: {
          __waitingForInput: true,
          __waitNodeId: id,
          __askUserRequestId: requestId,
        } as Partial<TState>,
        signals: [
          {
            type: "human_input_required",
            message: resolvedOptions.question,
            data: eventData as unknown as Record<string, unknown>,
          },
        ],
      };
    },
  };
}
