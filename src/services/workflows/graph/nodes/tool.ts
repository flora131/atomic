import type { z } from "zod";
import { getToolRegistry } from "@/services/agents/tools/registry.ts";
import type {
  BaseState,
  NodeId,
  NodeDefinition,
  NodeResult,
  RetryConfig,
  ExecutionContext,
  WorkflowToolContext,
} from "@/services/workflows/graph/types.ts";
import { DEFAULT_RETRY_CONFIG } from "@/services/workflows/graph/types.ts";
import {
  NodeExecutionError,
  SchemaValidationError,
} from "@/services/workflows/graph/errors.ts";

export type ToolExecuteFn<TArgs = unknown, TResult = unknown> = (
  args: TArgs,
  abortSignal?: AbortSignal,
) => Promise<TResult>;

export type ToolOutputMapper<
  TState extends BaseState = BaseState,
  TResult = unknown,
> = (result: TResult, state: TState) => Partial<TState>;

export interface ToolNodeConfig<
  TState extends BaseState = BaseState,
  TArgs = unknown,
  TResult = unknown,
> {
  id: NodeId;
  toolName: string;
  execute?: ToolExecuteFn<TArgs, TResult>;
  args?: TArgs | ((state: TState) => TArgs);
  outputMapper?: ToolOutputMapper<TState, TResult>;
  retry?: RetryConfig;
  name?: string;
  description?: string;
}

export function toolNode<
  TState extends BaseState = BaseState,
  TArgs = unknown,
  TResult = unknown,
>(config: ToolNodeConfig<TState, TArgs, TResult>): NodeDefinition<TState> {
  const {
    id,
    toolName,
    execute,
    args,
    outputMapper,
    retry = DEFAULT_RETRY_CONFIG,
    name,
    description,
  } = config;

  if (!execute) {
    throw new Error(`Tool node "${id}" requires an execute function`);
  }

  return {
    id,
    type: "tool",
    name: name ?? toolName,
    description,
    retry,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const resolvedArgs =
        typeof args === "function"
          ? (args as (state: TState) => TArgs)(ctx.state)
          : args;

      const result = await execute(
        resolvedArgs as TArgs,
        ctx.abortSignal,
      );

      const stateUpdate = outputMapper
        ? outputMapper(result, ctx.state)
        : ({
            outputs: {
              ...ctx.state.outputs,
              [id]: result,
            },
          } as Partial<TState>);

      return { stateUpdate };
    },
  };
}

export interface CustomToolNodeConfig<
  TState extends BaseState,
  TArgs = Record<string, unknown>,
  TResult = unknown,
> {
  id: string;
  toolName: string;
  name?: string;
  description?: string;
  inputSchema?: z.ZodType<TArgs>;
  args?: TArgs | ((state: TState) => TArgs);
  outputMapper?: (result: TResult, state: TState) => Partial<TState>;
  retry?: RetryConfig;
}

export function customToolNode<
  TState extends BaseState,
  TArgs = Record<string, unknown>,
  TResult = unknown,
>(config: CustomToolNodeConfig<TState, TArgs, TResult>): NodeDefinition<TState> {
  return {
    id: config.id,
    type: "tool",
    name: config.name ?? config.toolName,
    description: config.description ?? `Execute custom tool: ${config.toolName}`,
    retry: config.retry,
    async execute(ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> {
      const registry = getToolRegistry();
      const entry = registry.get(config.toolName);
      if (!entry) {
        throw new Error(
          `Custom tool "${config.toolName}" not found in registry. ` +
            `Available tools: ${registry.getAll().map((t) => t.name).join(", ")}`,
        );
      }

      const rawArgs =
        typeof config.args === "function"
          ? (config.args as (state: TState) => TArgs)(ctx.state)
          : (config.args ?? ({} as TArgs));

      let args: TArgs;
      if (config.inputSchema) {
        const parseResult = config.inputSchema.safeParse(rawArgs);
        if (!parseResult.success) {
          throw new SchemaValidationError(
            `Tool "${config.toolName}" input validation failed: ` +
              `${parseResult.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")}`,
            parseResult.error,
          );
        }
        args = parseResult.data;
      } else {
        args = rawArgs as TArgs;
      }

      const toolContext: WorkflowToolContext = {
        sessionID: ctx.state.executionId,
        messageID: crypto.randomUUID(),
        agent: "workflow",
        directory: process.cwd(),
        abort: ctx.abortSignal ?? new AbortController().signal,
        workflowState: Object.freeze({ ...ctx.state }),
        nodeId: config.id,
        executionId: ctx.state.executionId,
      };

      try {
        const result = (await entry.definition.handler(
          args as Record<string, unknown>,
          toolContext,
        )) as TResult;

        const stateUpdate = config.outputMapper
          ? config.outputMapper(result, ctx.state)
          : ({
              outputs: {
                ...ctx.state.outputs,
                [config.id]: result,
              },
            } as Partial<TState>);

        return { stateUpdate };
      } catch (error) {
        if (error instanceof SchemaValidationError) {
          throw error;
        }
        throw new NodeExecutionError(
          `Custom tool "${config.toolName}" failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          config.id,
          error instanceof Error ? error : undefined,
        );
      }
    },
  };
}
