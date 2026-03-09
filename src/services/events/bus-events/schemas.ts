import { z } from "zod";
import {
  workflowRuntimeTaskSchema,
  workflowRuntimeTaskStatusChangeSchema,
} from "@/services/workflows/runtime-contracts.ts";
import type { BusEventType } from "./types.ts";

export function defineBusEvent<T extends string, S extends z.ZodType>(
  type: T,
  schema: S,
) {
  return {
    type,
    schema,
    parse: (data: unknown) => schema.parse(data),
  } as const;
}

export const BusEventSchemas: Record<BusEventType, z.ZodType> = {
  "stream.text.delta": z.object({
    delta: z.string(),
    messageId: z.string(),
    agentId: z.string().optional(),
  }),
  "stream.text.complete": z.object({
    messageId: z.string(),
    fullText: z.string(),
  }),
  "stream.thinking.delta": z.object({
    delta: z.string(),
    sourceKey: z.string(),
    messageId: z.string(),
    agentId: z.string().optional(),
  }),
  "stream.thinking.complete": z.object({
    sourceKey: z.string(),
    durationMs: z.number(),
    agentId: z.string().optional(),
  }),
  "stream.tool.start": z.object({
    toolId: z.string(),
    toolName: z.string(),
    toolInput: z.record(z.string(), z.unknown()),
    sdkCorrelationId: z.string().optional(),
    toolMetadata: z.record(z.string(), z.unknown()).optional(),
    parentAgentId: z.string().optional(),
  }),
  "stream.tool.complete": z.object({
    toolId: z.string(),
    toolName: z.string(),
    toolInput: z.record(z.string(), z.unknown()).optional(),
    toolResult: z.unknown(),
    success: z.boolean(),
    error: z.string().optional(),
    sdkCorrelationId: z.string().optional(),
    toolMetadata: z.record(z.string(), z.unknown()).optional(),
    parentAgentId: z.string().optional(),
  }),
  "stream.tool.partial_result": z.object({
    toolCallId: z.string(),
    partialOutput: z.string(),
    parentAgentId: z.string().optional(),
  }),
  "stream.agent.start": z.object({
    agentId: z.string(),
    toolCallId: z.string(),
    agentType: z.string(),
    task: z.string(),
    isBackground: z.boolean(),
    sdkCorrelationId: z.string().optional(),
  }),
  "stream.agent.update": z.object({
    agentId: z.string(),
    currentTool: z.string().optional(),
    toolUses: z.number().optional(),
  }),
  "stream.agent.complete": z.object({
    agentId: z.string(),
    success: z.boolean(),
    result: z.string().optional(),
    error: z.string().optional(),
  }),
  "stream.session.start": z.object({
    config: z.record(z.string(), z.unknown()).optional(),
  }),
  "stream.session.idle": z.object({
    reason: z.string().optional(),
  }),
  "stream.session.error": z.object({
    error: z.string(),
    code: z.string().optional(),
  }),
  "stream.session.retry": z.object({
    attempt: z.number(),
    delay: z.number(),
    message: z.string(),
    nextRetryAt: z.number(),
  }),
  "stream.session.info": z.object({
    infoType: z.string(),
    message: z.string(),
  }),
  "stream.session.warning": z.object({
    warningType: z.string(),
    message: z.string(),
  }),
  "stream.session.title_changed": z.object({
    title: z.string(),
  }),
  "stream.session.truncation": z.object({
    tokenLimit: z.number(),
    tokensRemoved: z.number(),
    messagesRemoved: z.number(),
  }),
  "stream.session.compaction": z.object({
    phase: z.enum(["start", "complete"]),
    success: z.boolean().optional(),
    error: z.string().optional(),
  }),
  "stream.turn.start": z.object({
    turnId: z.string(),
  }),
  "stream.turn.end": z.object({
    turnId: z.string(),
    finishReason: z.enum(["tool-calls", "stop", "max-tokens", "max-turns", "error", "unknown"]).optional(),
    rawFinishReason: z.string().optional(),
  }),
  "workflow.step.start": z.object({
    workflowId: z.string(),
    nodeId: z.string(),
    nodeName: z.string(),
  }),
  "workflow.step.complete": z.object({
    workflowId: z.string(),
    nodeId: z.string(),
    nodeName: z.string(),
    status: z.enum(["success", "error", "skipped"]),
    result: z.unknown().optional(),
  }),
  "workflow.task.update": z.object({
    workflowId: z.string(),
    tasks: z.array(workflowRuntimeTaskSchema),
  }),
  "workflow.task.statusChange": workflowRuntimeTaskStatusChangeSchema,
  "stream.permission.requested": z.object({
    requestId: z.string(),
    toolName: z.string(),
    toolInput: z.record(z.string(), z.unknown()).optional(),
    question: z.string(),
    header: z.string().optional(),
    options: z.array(z.object({
      label: z.string(),
      value: z.string(),
      description: z.string().optional(),
    })),
    multiSelect: z.boolean().optional(),
    respond: z.function().optional(),
    toolCallId: z.string().optional(),
  }),
  "stream.human_input_required": z.object({
    requestId: z.string(),
    question: z.string(),
    header: z.string().optional(),
    options: z.array(z.object({
      label: z.string(),
      description: z.string().optional(),
    })).optional(),
    nodeId: z.string(),
    respond: z.function().optional(),
  }),
  "stream.skill.invoked": z.object({
    skillName: z.string(),
    skillPath: z.string().optional(),
    agentId: z.string().optional(),
  }),
  "stream.usage": z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    model: z.string().optional(),
    agentId: z.string().optional(),
  }),
};
