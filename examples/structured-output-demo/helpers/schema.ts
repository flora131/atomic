/**
 * Shared schema and prompt for the structured-output demo workflow.
 *
 * Each provider (Claude, Copilot, OpenCode) adapts this schema to its
 * native structured-output mechanism:
 *   - Claude: `outputFormat: { type: "json_schema", schema }` in
 *     `s.session.query()` options (headless); validated output is read
 *     from `s.session.lastStructuredOutput`.
 *   - OpenCode: `format: { type: "json_schema", schema }` in
 *     `s.client.session.prompt()`; validated output is read from
 *     `result.data.info.structured`.
 *   - Copilot: `defineTool` with `parameters: LanguageFactsSchema`; the
 *     handler receives already-validated args.
 *
 * The goal is NOT to test the model's knowledge — it's to prove the SDK
 * returns an object that matches the schema shape.
 */

import { z } from "zod";

export const LanguageFactsSchema = z.object({
  name: z.string().describe("Canonical language name, e.g. 'Python'"),
  year_created: z
    .number()
    .int()
    .describe("Year the language was first released"),
  paradigms: z
    .array(z.string())
    .describe("Programming paradigms it supports, e.g. ['object-oriented', 'functional']"),
  statically_typed: z
    .boolean()
    .describe("True if the language is statically typed by default"),
  summary: z
    .string()
    .describe("One-sentence summary of what the language is"),
});

export type LanguageFacts = z.infer<typeof LanguageFactsSchema>;

/**
 * JSON Schema derived from the Zod shape — used by Claude and OpenCode.
 *
 * `target: "openapi-3.0"` drops the `$schema` draft URL that Zod stamps
 * by default. The Claude Agent SDK's validator silently drops
 * `structured_output` when that metadata field is present, so we emit
 * the OpenAPI-flavoured variant which matches the hand-written shape in
 * the SDK docs' Quick Start example.
 */
export const LANGUAGE_FACTS_JSON_SCHEMA = z.toJSONSchema(LanguageFactsSchema, {
  target: "openapi-3.0",
});

export function buildPrompt(topic: string): string {
  return `Return structured facts about the programming language "${topic}".

Fill every field based on widely-known facts. Your final response must
validate against the schema enforced by the SDK.`;
}

/**
 * Log the validated object in a way that's easy to eyeball in the
 * orchestrator log. Using `console.log` (not a workflow-scoped logger)
 * because the demo is about visible proof, not production observability.
 */
export function logFacts(agent: string, facts: LanguageFacts | null): void {
  if (!facts) {
    console.log(`[${agent}] structured output: <missing or invalid>`);
    return;
  }
  console.log(`[${agent}] structured output:\n${JSON.stringify(facts, null, 2)}`);
}
