import { z } from "zod";
import type { BaseState, NodeDefinition } from "@/services/workflows/graph/types.ts";

export interface TestState extends BaseState {
  count: number;
  flag: boolean;
  message: string;
}

export const testStateSchema: z.ZodType<TestState> = z.object({
  executionId: z.string(),
  lastUpdated: z.string(),
  outputs: z.record(z.string(), z.unknown()),
  count: z.number(),
  flag: z.boolean(),
  message: z.string(),
});

export const testNode1: NodeDefinition<TestState> = {
  id: "test1",
  type: "tool",
  execute: async () => ({ stateUpdate: { count: 1 } }),
};

export const testNode2: NodeDefinition<TestState> = {
  id: "test2",
  type: "tool",
  execute: async () => ({ stateUpdate: { count: 2 } }),
};

export const testNode3: NodeDefinition<TestState> = {
  id: "test3",
  type: "tool",
  execute: async () => ({ stateUpdate: { count: 3 } }),
};
