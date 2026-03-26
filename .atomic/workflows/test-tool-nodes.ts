/**
 * Test Workflow: Tool Nodes
 *
 * Exercises: .tool() for deterministic computation, data transforms, validation
 * Validates: ToolOptions shape, execute function signature, state integration
 */
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "test-tool-nodes",
    description: "Tests tool nodes for deterministic work between agent stages",
    globalState: {
      tasks: { default: () => [] as Array<{ id: string; description: string }>, reducer: "replace" },
      validationResult: { default: false },
      summary: { default: "" },
    },
  })
  .version("1.0.0")
  .stage({
    name: "plan",
    agent: "planner",
    description: "📋 PLAN",
    prompt: (ctx) => `Break this into tasks:\n${ctx.userPrompt}`,
    outputMapper: (response) => {
      try {
        return { tasks: JSON.parse(response) };
      } catch {
        return { tasks: [{ id: "1", description: response }] };
      }
    },
  })
  .tool({
    name: "validate-tasks",
    description: "Validate that all tasks have required fields",
    outputMapper: (result) => result,
    execute: async (ctx) => {
      const tasks = ctx.state.tasks;
      const valid = Array.isArray(tasks) && tasks.every((t) => t.id && t.description);
      return { validationResult: valid };
    },
  })
  .tool({
    name: "summarize-tasks",
    description: "Generate a summary from the task list",
    outputMapper: (result) => result,
    execute: async (ctx) => {
      const tasks = ctx.state.tasks;
      const summary = Array.isArray(tasks)
        ? tasks.map((t) => `- [${t.id}] ${t.description}`).join("\n")
        : "No tasks found";
      return { summary };
    },
  })
  .stage({
    name: "execute",
    description: "⚡ EXECUTE",
    prompt: (ctx) => {
      const summary = ctx.stageOutputs.get("summarize-tasks")?.rawResponse ?? "";
      return `Execute the following validated tasks:\n${summary}`;
    },
    outputMapper: () => ({}),
  })
  .compile();
