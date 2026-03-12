import { z } from "zod";
import type { BaseState } from "@/services/workflows/graph/types.ts";

export interface TestState extends BaseState {
  counter?: number;
  messages?: string[];
  flag?: boolean;
  errorCount?: number;
}

export const testStateSchema: z.ZodType<TestState> = z.object({
  executionId: z.string(),
  lastUpdated: z.string(),
  outputs: z.record(z.string(), z.unknown()),
  counter: z.number().optional(),
  messages: z.array(z.string()).optional(),
  flag: z.boolean().optional(),
  errorCount: z.number().optional(),
});
