// .atomic/workflows/edge-zod-validation.ts
//
// Edge case: Tool nodes using SDK-exported Zod schemas for validation.
// Tests: TaskItemSchema, JsonValueSchema, SessionConfigSchema, and
// AgentTypeSchema imports and runtime safeParse usage in tool nodes.

import {
  defineWorkflow,
  TaskItemSchema,
  JsonValueSchema,
  SessionConfigSchema,
  AgentTypeSchema,
} from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-zod-validation",
    description:
      "Tools validate data using SDK Zod schemas. " +
      "Tests that schema imports work and safeParse executes correctly.",
    globalState: {
      taskValid: { default: false },
      jsonValid: { default: false },
      configValid: { default: false },
      agentTypeValid: { default: false },
      errorCount: { default: 0, reducer: "sum" },
    },
  })
  .version("0.1.0")

  .tool({
    name: "validate-task-schema",
    description: "Validate a task item with TaskItemSchema",
    execute: async () => {
      const sample = {
        id: "test-1",
        description: "A sample task",
        status: "pending",
        summary: "Testing task validation",
        blockedBy: [],
      };
      const result = TaskItemSchema.safeParse(sample);
      return {
        taskValid: result.success,
        errorCount: result.success ? 0 : 1,
      };
    },
  })

  .tool({
    name: "validate-json-schema",
    description: "Validate nested JSON with JsonValueSchema",
    execute: async () => {
      const sample = {
        nested: { arr: [1, "two", true, null], obj: { deep: "value" } },
      };
      const result = JsonValueSchema.safeParse(sample);
      return {
        jsonValid: result.success,
        errorCount: result.success ? 0 : 1,
      };
    },
  })

  .tool({
    name: "validate-session-config",
    description: "Validate a session config object",
    execute: async () => {
      const sample = {
        model: { claude: "claude-sonnet-4-20250514" },
        maxTurns: 10,
        permissionMode: "auto" as const,
      };
      const result = SessionConfigSchema.safeParse(sample);
      return {
        configValid: result.success,
        errorCount: result.success ? 0 : 1,
      };
    },
  })

  .tool({
    name: "validate-agent-type",
    description: "Validate agent type enum",
    execute: async () => {
      const valid = AgentTypeSchema.safeParse("claude");
      const invalid = AgentTypeSchema.safeParse("unknown-agent-type");
      return {
        agentTypeValid: valid.success && !invalid.success,
        errorCount: valid.success ? 0 : 1,
      };
    },
  })

  .compile();
