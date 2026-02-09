import { z } from "zod";
import type { ToolContext } from "../types.ts";

// Re-export ToolContext so user tool files can import it from @atomic/plugin
export type { ToolContext };

/**
 * Input shape for the tool() helper.
 */
export interface ToolInput<Args extends z.ZodRawShape> {
  description: string;
  args: Args;
  execute: (
    args: z.infer<z.ZodObject<Args>>,
    context: ToolContext
  ) => Promise<string> | string;
}

/**
 * Type-safe tool definition helper.
 * Identity function that provides IDE autocompletion and type inference.
 * Mirrors OpenCode's tool() from @opencode-ai/plugin.
 *
 * @example
 * ```typescript
 * import { tool } from "@atomic/plugin";
 *
 * export default tool({
 *   description: "Run the project linter",
 *   args: {
 *     filePath: tool.schema.string().describe("Path to lint"),
 *   },
 *   async execute(args, context) {
 *     const proc = Bun.spawn(["bun", "lint", args.filePath], { cwd: context.directory });
 *     return await new Response(proc.stdout).text();
 *   },
 * });
 * ```
 */
export function tool<Args extends z.ZodRawShape>(
  input: ToolInput<Args>
): ToolInput<Args> {
  return input;
}

// Re-export zod as tool.schema for convenience (matches OpenCode's tool.schema)
tool.schema = z;
