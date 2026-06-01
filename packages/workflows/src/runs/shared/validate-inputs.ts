/**
 * validateInputs — check a parsed input bag against a workflow's declared
 * input schema. Used by slash-command and programmatic SDK dispatch paths to
 * reject malformed input payloads before dispatch.
 *
 * Reports:
 *   - unknown input keys (catches typos like "propmt")
 *   - wrong-typed values (finite number/boolean/string/text/select)
 *   - select values not in the declared choices
 *   - missing required inputs
 *   - non-JSON-serializable values
 *
 * Does NOT coerce: "true" is not a boolean, "3" is not a number. JSON parsing
 * upstream already preserves types — string-typed values reaching this point
 * are user mistakes worth surfacing.
 */

import { workflowSerializableValidationError, workflowSerializableTypeName } from "../../shared/serializable.js";
import type { WorkflowInputSchema, WorkflowInputValues } from "../../shared/types.js";

export interface ValidationError {
  key: string;
  reason: string;
}

export function validateInputs(
  schema: Readonly<Record<string, WorkflowInputSchema>>,
  inputs: WorkflowInputValues,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const key of Object.keys(inputs)) {
    if (!(key in schema)) {
      errors.push({ key, reason: "unknown input key (not declared by this workflow)" });
    }
  }

  for (const [key, def] of Object.entries(schema)) {
    const value = inputs[key];
    let hasTypeError = false;

    if (value === undefined) {
      if (def.required === true) {
        errors.push({ key, reason: "required input is missing" });
      }
      continue;
    }

    switch (def.type) {
      case "text":
      case "string":
        if (typeof value !== "string") {
          errors.push({ key, reason: `expected string, got ${workflowSerializableTypeName(value)}` });
          hasTypeError = true;
        }
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push({ key, reason: `expected finite number, got ${workflowSerializableTypeName(value)}` });
          hasTypeError = true;
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          errors.push({ key, reason: `expected boolean, got ${workflowSerializableTypeName(value)}` });
          hasTypeError = true;
        }
        break;
      case "select": {
        const allowed = def.choices.join(", ");
        if (typeof value !== "string") {
          errors.push({ key, reason: `expected one of [${allowed}], got ${workflowSerializableTypeName(value)}` });
          hasTypeError = true;
        } else if (!def.choices.includes(value)) {
          errors.push({ key, reason: `must be one of [${allowed}]` });
        }
        break;
      }
    }

    const serializableError = hasTypeError
      ? undefined
      : workflowSerializableValidationError(value, `input "${key}"`);
    if (serializableError !== undefined) {
      errors.push({ key, reason: serializableError.replace(/^input "[^"]+" /, "") });
    }
  }

  return errors;
}
