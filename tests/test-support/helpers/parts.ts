/**
 * Assertion helpers for the Parts state system.
 *
 * Provides type-narrowing assertions and ordering checks for Part[]
 * arrays. These helpers throw descriptive errors on failure and
 * return typed values for further assertions.
 */

import { expect } from "bun:test";
import type { PartId } from "@/state/parts/id.ts";
import type {
  Part,
  TextPart,
  ReasoningPart,
  ToolPart,
  AgentPart,
  TaskListPart,
  SkillLoadPart,
  McpSnapshotPart,
  AgentListPart,
  TruncationPart,
  TaskResultPart,
  WorkflowStepPart,
} from "@/state/parts/types.ts";

// ---------------------------------------------------------------------------
// Part type → concrete type map (for assertPartType generic narrowing)
// ---------------------------------------------------------------------------

interface PartTypeMap {
  text: TextPart;
  reasoning: ReasoningPart;
  tool: ToolPart;
  agent: AgentPart;
  "task-list": TaskListPart;
  "skill-load": SkillLoadPart;
  "mcp-snapshot": McpSnapshotPart;
  "agent-list": AgentListPart;
  truncation: TruncationPart;
  "task-result": TaskResultPart;
  "workflow-step": WorkflowStepPart;
}

type PartTypeName = keyof PartTypeMap;

// ---------------------------------------------------------------------------
// assertPartExists
// ---------------------------------------------------------------------------

/**
 * Asserts that a part with the given ID exists in the array and returns it.
 *
 * Throws a descriptive error if the part is not found, including
 * the available IDs for easy debugging.
 *
 * @param parts - The Part[] array to search
 * @param id - The PartId to look up
 * @returns The matching Part
 *
 * @example
 * ```ts
 * const part = assertPartExists(parts, "part_000000000001");
 * expect(part.type).toBe("text");
 * ```
 */
export function assertPartExists(
  parts: ReadonlyArray<Part>,
  id: PartId,
): Part {
  const part = parts.find((p) => p.id === id);
  if (!part) {
    const availableIds = parts.map((p) => p.id).join(", ");
    throw new Error(
      `assertPartExists: no part with id "${id}" found. ` +
        `Available ids: [${availableIds}]`,
    );
  }
  return part;
}

// ---------------------------------------------------------------------------
// assertPartType
// ---------------------------------------------------------------------------

/**
 * Asserts that a part has the expected type discriminant and returns
 * it narrowed to the concrete part type.
 *
 * @param part - The Part to check
 * @param type - The expected type discriminant string
 * @returns The part narrowed to the corresponding concrete type
 *
 * @example
 * ```ts
 * const textPart = assertPartType(part, "text");
 * expect(textPart.content).toBe("Hello");
 * ```
 */
export function assertPartType<T extends PartTypeName>(
  part: Part,
  type: T,
): PartTypeMap[T] {
  if (part.type !== type) {
    throw new Error(
      `assertPartType: expected part.type to be "${type}" but got "${part.type}" ` +
        `(id: ${part.id})`,
    );
  }
  return part as PartTypeMap[T];
}

// ---------------------------------------------------------------------------
// assertPartOrder
// ---------------------------------------------------------------------------

/**
 * Asserts that the parts array contains exactly the expected IDs in
 * the given order. Useful for verifying insertion ordering.
 *
 * @param parts - The Part[] array to check
 * @param expectedIds - The expected PartId sequence
 *
 * @example
 * ```ts
 * assertPartOrder(parts, [id1, id2, id3]);
 * ```
 */
export function assertPartOrder(
  parts: ReadonlyArray<Part>,
  expectedIds: ReadonlyArray<PartId>,
): void {
  const actualIds = parts.map((p) => p.id);
  expect(actualIds).toEqual([...expectedIds]);
}

// ---------------------------------------------------------------------------
// assertPartsContain
// ---------------------------------------------------------------------------

/**
 * Field matcher for a Part subset check. Each key is a Part field
 * name and each value is the expected value for that field.
 */
type PartMatcher = {
  [K in keyof Part]?: Part[K];
};

/**
 * Asserts that the parts array contains all specified matchers.
 * Each matcher is an object with a subset of Part fields that must
 * match at least one part in the array.
 *
 * The check verifies that for each matcher, there exists at least
 * one part where every specified field matches.
 *
 * @param parts - The Part[] array to search
 * @param matchers - An array of partial-field objects to match against
 *
 * @example
 * ```ts
 * assertPartsContain(parts, [
 *   { type: "text", content: "Hello" },
 *   { type: "tool", toolName: "Read" },
 * ]);
 * ```
 */
export function assertPartsContain(
  parts: ReadonlyArray<Part>,
  matchers: ReadonlyArray<PartMatcher>,
): void {
  for (const matcher of matchers) {
    const matcherEntries = Object.entries(matcher);
    const found = parts.some((part) =>
      matcherEntries.every(([key, expectedValue]) => {
        const actualValue = (part as unknown as Record<string, unknown>)[key];
        if (typeof expectedValue === "object" && expectedValue !== null) {
          // Deep compare for objects/arrays
          try {
            expect(actualValue).toEqual(expectedValue);
            return true;
          } catch {
            return false;
          }
        }
        return actualValue === expectedValue;
      }),
    );

    if (!found) {
      const matcherStr = JSON.stringify(matcher, null, 2);
      const partsStr = parts
        .map((p) => `  { id: "${p.id}", type: "${p.type}" }`)
        .join("\n");
      throw new Error(
        `assertPartsContain: no part matches:\n${matcherStr}\n` +
          `Available parts:\n${partsStr}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience: find + narrow in one step
// ---------------------------------------------------------------------------

/**
 * Finds a part by ID and asserts its type in a single call.
 * Combines assertPartExists and assertPartType for convenience.
 *
 * @param parts - The Part[] array to search
 * @param id - The PartId to look up
 * @param type - The expected type discriminant
 * @returns The part narrowed to the concrete type
 *
 * @example
 * ```ts
 * const tool = assertPartExistsWithType(parts, toolId, "tool");
 * expect(tool.toolName).toBe("Read");
 * ```
 */
export function assertPartExistsWithType<T extends PartTypeName>(
  parts: ReadonlyArray<Part>,
  id: PartId,
  type: T,
): PartTypeMap[T] {
  const part = assertPartExists(parts, id);
  return assertPartType(part, type);
}

// ---------------------------------------------------------------------------
// findPartByType
// ---------------------------------------------------------------------------

/**
 * Finds the first part of the given type in the array.
 *
 * Returns `undefined` when no matching part exists. Useful for
 * non-assertion lookups where the caller wants to conditionally
 * inspect a part.
 *
 * @param parts - The Part[] array to search
 * @param type - The type discriminant to look for
 * @returns The first matching part (narrowed), or undefined
 *
 * @example
 * ```ts
 * const tool = findPartByType(parts, "tool");
 * if (tool) {
 *   expect(tool.toolName).toBe("Read");
 * }
 * ```
 */
export function findPartByType<T extends PartTypeName>(
  parts: ReadonlyArray<Part>,
  type: T,
): PartTypeMap[T] | undefined {
  const found = parts.find((p) => p.type === type);
  return found as PartTypeMap[T] | undefined;
}

// ---------------------------------------------------------------------------
// expectTextContent
// ---------------------------------------------------------------------------

/**
 * Asserts that the concatenated text content of all TextParts matches
 * the expected string.
 *
 * All parts with `type === "text"` are joined (in array order) and
 * compared against `expectedText`.
 *
 * @param parts - The Part[] array to search
 * @param expectedText - The expected concatenated text content
 *
 * @example
 * ```ts
 * expectTextContent(parts, "Hello, world!");
 * ```
 */
export function expectTextContent(
  parts: ReadonlyArray<Part>,
  expectedText: string,
): void {
  const textParts = parts.filter(
    (p): p is TextPart => p.type === "text",
  );
  const actualText = textParts.map((p) => p.content).join("");
  expect(actualText).toBe(expectedText);
}

// ---------------------------------------------------------------------------
// Aliases matching task specification naming
// ---------------------------------------------------------------------------

/**
 * Alias for `assertPartOrder` — asserts parts are in the expected order by ID.
 */
export const expectPartOrder = assertPartOrder;

/**
 * Alias for `assertPartType` — type-narrowing assertion.
 */
export const expectPartType = assertPartType;
