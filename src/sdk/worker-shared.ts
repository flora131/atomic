/**
 * Shared helpers for the single-definition worker (`./worker.ts`) and
 * the multi-workflow dispatcher (`./workflow-cli.ts`). These were all
 * inlined in the original `worker.ts` before the split.
 */

import type { WorkflowInput } from "./types.ts";
import { RESERVED_INPUT_NAMES } from "./define-workflow.ts";

/**
 * Convert a hyphenated option name to the camelCase key Commander uses
 * when storing options in `opts()`. Commander applies this transform
 * automatically: `--output-type` → `opts.outputType`.
 *
 * @example toCamelCase("output-type")  // → "outputType"
 * @example toCamelCase("max-loops")    // → "maxLoops"
 * @example toCamelCase("simple")       // → "simple"
 */
export function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Validate and resolve inputs against a workflow's declared schema.
 * Throws on unknown flags, missing required fields, invalid enum values,
 * and non-integer values for integer fields.
 */
export function validateAndResolve(
  inputs: Record<string, string>,
  schema: readonly WorkflowInput[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const known = new Set(schema.map((i) => i.name));

  for (const key of Object.keys(inputs)) {
    if (!known.has(key)) {
      throw new Error(
        `[atomic/worker] Unknown input "--${key}" for this workflow. ` +
          `Valid inputs: ${schema.length > 0 ? schema.map((i) => `--${i.name}`).join(", ") : "(none — free-form workflow)"}.`,
      );
    }
  }

  for (const field of schema) {
    const raw = inputs[field.name];
    const defaultStr = field.default !== undefined ? String(field.default) : undefined;
    const enumFirst =
      field.type === "enum" && field.values && field.values.length > 0
        ? field.values[0]
        : undefined;
    const value =
      raw !== undefined && raw !== ""
        ? raw
        : defaultStr ?? enumFirst ?? "";

    if (field.required && value.trim() === "") {
      throw new Error(
        `[atomic/worker] Missing required input "--${field.name}".`,
      );
    }

    if (field.type === "enum" && value !== "") {
      const allowed = field.values ?? [];
      if (!allowed.includes(value)) {
        throw new Error(
          `[atomic/worker] Invalid value for "--${field.name}": "${value}". ` +
            `Expected one of: ${allowed.join(", ")}.`,
        );
      }
    }

    if (field.type === "integer" && value !== "") {
      const parsed = Number.parseInt(value, 10);
      if (
        !Number.isFinite(parsed) ||
        !Number.isInteger(parsed) ||
        String(parsed) !== value.trim()
      ) {
        throw new Error(
          `[atomic/worker] Invalid value for "--${field.name}": "${value}". Expected an integer.`,
        );
      }
    }

    if (value !== "") {
      out[field.name] = value;
    }
  }
  return out;
}

/**
 * Coerce a typed defaults map (InputsOf shape — string | number values)
 * into the string-valued map the executor and CLI flag layer consume.
 * Returns `undefined` when `defaults` is `undefined` so callers can
 * skip merging entirely.
 */
export function stringifyDefaults(
  defaults: Record<string, string | number | undefined> | undefined,
): Record<string, string> | undefined {
  if (!defaults) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (v === undefined) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

/**
 * Inspect every workflow in a registry snapshot and build a
 * union-of-inputs map. Throws on reserved-name use and on same-name /
 * different-type collisions. Returns the deduplicated union map
 * (name → WorkflowInput). Used by the multi-workflow dispatcher to
 * expose a single set of flags across heterogeneous registry entries.
 */
export function buildInputUnion(
  workflows: readonly {
    readonly agent: string;
    readonly name: string;
    readonly inputs: readonly WorkflowInput[];
  }[],
): Map<string, WorkflowInput> {
  const union = new Map<string, WorkflowInput>();
  const origin = new Map<string, { agent: string; name: string }>();

  for (const wf of workflows) {
    for (const input of wf.inputs) {
      if ((RESERVED_INPUT_NAMES as readonly string[]).includes(input.name)) {
        throw new Error(
          `[atomic/worker] Workflow "${wf.agent}/${wf.name}" declares input ` +
            `"${input.name}" which is reserved by the worker CLI. ` +
            `Reserved names: ${(RESERVED_INPUT_NAMES as readonly string[]).join(", ")}.`,
        );
      }

      const existing = union.get(input.name);
      if (existing) {
        if (existing.type !== input.type) {
          const first = origin.get(input.name)!;
          throw new Error(
            `[atomic/worker] Input name conflict: "${input.name}" is declared as ` +
              `"${existing.type}" in "${first.agent}/${first.name}" but as ` +
              `"${input.type}" in "${wf.agent}/${wf.name}". ` +
              `Workflows sharing an input name must agree on the type.`,
          );
        }
      } else {
        union.set(input.name, input);
        origin.set(input.name, { agent: wf.agent, name: wf.name });
      }
    }
  }
  return union;
}
