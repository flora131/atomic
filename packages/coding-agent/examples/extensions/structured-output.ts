/**
 * Schema-specific structured_output override
 *
 * Atomic already ships a generic `structured_output` builtin. This extension
 * demonstrates the canonical factory for narrowing that builtin to a custom
 * schema while preserving the built-in terminating behavior.
 *
 * Custom factory names are additive: `createStructuredOutputTool({ name:
 * "final_decision", ... })` would register beside the default generic
 * `structured_output` builtin. Keep a strict contract isolated by overriding
 * the same `structured_output` name as below, using `tools: ["final_decision"]`,
 * or excluding the generic builtin with `excludedTools: ["structured_output"]`.
 */

import {
	createStructuredOutputTool,
	type ExtensionAPI,
} from "@bastani/atomic";
import { Type } from "typebox";

const SummarySchema = Type.Object({
	headline: Type.String({ description: "Short title for the result" }),
	summary: Type.String({ description: "One-paragraph summary" }),
	actionItems: Type.Array(Type.String(), { description: "Concrete next steps or key bullets" }),
}, { additionalProperties: false });

const structuredOutputTool = createStructuredOutputTool({
	schema: SummarySchema,
});

export default function (pi: ExtensionAPI) {
	// Registering the same name overrides the generic builtin for this session.
	pi.registerTool(structuredOutputTool);
}
