/**
 * TodoWrite Tool Definition
 *
 * Provides a TodoWrite tool for SDK clients that don't have it built-in
 * (e.g., Copilot SDK). Mirrors the Claude Agent SDK's TodoWrite interface
 * so the persistent todo panel in the TUI works across all agents.
 */

import type { ToolDefinition } from "@/services/agents/types.ts";

/**
 * JSON Schema for TodoWrite input, matching Claude SDK's TodoWriteInput.
 */
const todoWriteInputSchema = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      description: "The updated todo list",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Unique identifier for the todo item (e.g., '1', 'setup-project')",
          },
          description: {
            type: "string",
            description: "The todo item text",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed"],
            description: "Current status of the todo item",
          },
          summary: {
            type: "string",
            description: "Present-participle phrase for the task (e.g., 'Fixing bug')",
          },
          blockedBy: {
            type: "array",
            items: { type: "string" },
            description: "IDs of todo items that must complete before this one can start",
          },
        },
        required: ["description", "status", "summary"],
      },
    },
  },
  required: ["todos"],
};

export interface TodoItem {
  id?: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  summary: string;
  blockedBy?: string[];
}

/**
 * Create a TodoWrite tool definition that can be registered with any SDK client.
 *
 * The handler stores the todo list in memory and returns a summary.
 * The TUI intercepts the tool input to update the persistent todo panel.
 */
export function createTodoWriteTool(): ToolDefinition {
  let currentTodos: TodoItem[] = [];

  return {
    name: "TodoWrite",
    description:
      "Write or update the todo list to track task progress. Use this to plan work, " +
      "mark tasks as in_progress or completed, and show the user your progress.",
    inputSchema: todoWriteInputSchema,
    handler: (input: unknown) => {
      const { todos } = input as { todos: TodoItem[] };
      const oldTodos = currentTodos;
      currentTodos = todos;

      const done = todos.filter((t) => t.status === "completed").length;
      const inProgress = todos.filter((t) => t.status === "in_progress").length;
      const pending = todos.length - done - inProgress;

      return {
        oldTodos,
        newTodos: currentTodos,
        statusSummary: `${todos.length} tasks: ${done} done, ${inProgress} in progress, ${pending} pending`,
      };
    },
  };
}
