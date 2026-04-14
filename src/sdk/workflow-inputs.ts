import type { WorkflowInput } from "./types.ts";

/** Canonical free-form prompt field used by the interactive picker. */
export const DEFAULT_PROMPT_INPUT: Readonly<WorkflowInput> = Object.freeze({
  name: "prompt",
  type: "text",
  required: true,
  description: "what do you want this workflow to do?",
  placeholder: "describe your task…",
});

/** Stable single-field schema for free-form workflows. */
export const DEFAULT_PROMPT_FIELDS: readonly WorkflowInput[] = Object.freeze([
  DEFAULT_PROMPT_INPUT,
]);

/**
 * Materialize the picker-facing input schema.
 *
 * Runtime workflow definitions keep `inputs: []` for free-form workflows so
 * the CLI can preserve positional-prompt semantics. The interactive picker,
 * however, benefits from a single normalized shape where every workflow has at
 * least one field to render.
 */
export function normalizePickerInputs(
  inputs: readonly WorkflowInput[],
): readonly WorkflowInput[] {
  return inputs.length > 0 ? inputs : DEFAULT_PROMPT_FIELDS;
}

/**
 * Whether a picker-facing schema represents the canonical free-form prompt.
 *
 * This accepts both the raw `[]` runtime shape and the normalized
 * `[DEFAULT_PROMPT_INPUT]` picker shape so callers can treat both as the same
 * conceptual "free-form prompt" mode.
 */
export function isFreeformPromptSchema(
  inputs: readonly WorkflowInput[],
): boolean {
  if (inputs.length === 0) return true;
  if (inputs.length !== 1) return false;

  const field = inputs[0];
  return (
    field?.name === DEFAULT_PROMPT_INPUT.name &&
    field.type === DEFAULT_PROMPT_INPUT.type &&
    field.required === DEFAULT_PROMPT_INPUT.required &&
    field.description === DEFAULT_PROMPT_INPUT.description &&
    field.placeholder === DEFAULT_PROMPT_INPUT.placeholder &&
    field.default === DEFAULT_PROMPT_INPUT.default &&
    field.values === DEFAULT_PROMPT_INPUT.values
  );
}
