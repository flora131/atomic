import { z } from "zod";
import type {
  WorkflowOutputValues,
  WorkflowSerializableValue,
} from "./types.js";

export const WORKFLOW_SERIALIZABLE_DESCRIPTION =
  "JSON-serializable (string, finite number, boolean, null, array, or object)";

const workflowSerializableValueSchemaInner: z.ZodType<WorkflowSerializableValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(workflowSerializableValueSchemaInner),
    z.record(z.string(), workflowSerializableValueSchemaInner),
  ]),
);

export const workflowSerializableValueSchema = workflowSerializableValueSchemaInner;

export const workflowSerializableObjectSchema: z.ZodType<WorkflowOutputValues> = z.record(
  z.string(),
  workflowSerializableValueSchema,
);

export function workflowSerializableTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return typeof value;
}

function valueAtIssuePath(root: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return current;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "";
  return path
    .map((segment) =>
      typeof segment === "number"
        ? `[${segment}]`
        : typeof segment === "string" && /^[A-Za-z_$][\w$]*$/.test(segment)
          ? `.${segment}`
          : `[${JSON.stringify(String(segment))}]`,
    )
    .join("")
    .replace(/^\./, "");
}

export function workflowSerializableValidationError(
  value: unknown,
  label: string,
): string | undefined {
  const parsed = workflowSerializableValueSchema.safeParse(value);
  if (parsed.success) return undefined;
  const firstIssue = parsed.error.issues[0];
  const issuePath = firstIssue === undefined ? "" : formatIssuePath(firstIssue.path);
  const location = issuePath.length > 0 ? ` at ${issuePath}` : "";
  const offending = firstIssue === undefined ? value : valueAtIssuePath(value, firstIssue.path);
  return `${label}${location} must be ${WORKFLOW_SERIALIZABLE_DESCRIPTION}, got ${workflowSerializableTypeName(offending)}`;
}

export function workflowSerializableObjectValidationError(
  value: unknown,
  label: string,
): string | undefined {
  const parsed = workflowSerializableObjectSchema.safeParse(value);
  if (parsed.success) return undefined;
  const firstIssue = parsed.error.issues[0];
  const issuePath = firstIssue === undefined ? "" : formatIssuePath(firstIssue.path);
  const location = issuePath.length > 0 ? ` at ${issuePath}` : "";
  const offending = firstIssue === undefined ? value : valueAtIssuePath(value, firstIssue.path);
  return `${label}${location} must be a ${WORKFLOW_SERIALIZABLE_DESCRIPTION} object, got ${workflowSerializableTypeName(offending)}`;
}

export function assertWorkflowSerializableValue(
  value: unknown,
  label: string,
): asserts value is WorkflowSerializableValue {
  const error = workflowSerializableValidationError(value, label);
  if (error !== undefined) throw new Error(`atomic-workflows: ${error}`);
}

export function assertWorkflowSerializableObject(
  value: unknown,
  label: string,
): asserts value is WorkflowOutputValues {
  const error = workflowSerializableObjectValidationError(value, label);
  if (error !== undefined) throw new Error(`atomic-workflows: ${error}`);
}
