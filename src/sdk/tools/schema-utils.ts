import { z } from "zod";

/** JSON Schema representation of a Zod schema */
export interface JsonSchema {
  [key: string]: string | boolean | number | JsonSchema | JsonSchema[] | undefined;
}

/**
 * Convert a Zod schema to JSON Schema using Zod 4.x's built-in toJSONSchema().
 * Bridges user-authored Zod schemas to the ToolDefinition.inputSchema format.
 */
export function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema) as JsonSchema;
}
