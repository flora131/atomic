/**
 * Direct tests for the shared worker/dispatcher helpers. The happy paths
 * are exercised indirectly via the workflow-command harness; this file
 * covers the error branches (unknown input, invalid enum, integer parse
 * failure, reserved-name use, type collision) plus `stringifyDefaults`
 * end-to-end.
 */

import { test, expect, describe } from "bun:test";
import type { WorkflowInput } from "./types.ts";
import {
  toCamelCase,
  validateAndResolve,
  stringifyDefaults,
  buildInputUnion,
} from "./worker-shared.ts";

describe("toCamelCase", () => {
  test("converts hyphenated names", () => {
    expect(toCamelCase("output-type")).toBe("outputType");
    expect(toCamelCase("max-loops")).toBe("maxLoops");
  });

  test("leaves non-hyphenated names unchanged", () => {
    expect(toCamelCase("simple")).toBe("simple");
  });
});

describe("validateAndResolve", () => {
  test("throws on an input key not declared in the schema", () => {
    const schema: WorkflowInput[] = [{ name: "foo", type: "string" }];
    expect(() => validateAndResolve({ bar: "1" }, schema)).toThrow(
      /Unknown input "--bar"/,
    );
  });

  test("reports valid inputs in the error message", () => {
    const schema: WorkflowInput[] = [
      { name: "foo", type: "string" },
      { name: "bar", type: "integer" },
    ];
    expect(() => validateAndResolve({ baz: "1" }, schema)).toThrow(
      /--foo, --bar/,
    );
  });

  test("reports (none) for free-form schemas", () => {
    expect(() => validateAndResolve({ bar: "1" }, [])).toThrow(
      /\(none — free-form workflow\)/,
    );
  });

  test("throws on missing required input", () => {
    const schema: WorkflowInput[] = [
      { name: "prompt", type: "text", required: true },
    ];
    expect(() => validateAndResolve({}, schema)).toThrow(
      /Missing required input "--prompt"/,
    );
  });

  test("throws on invalid enum value", () => {
    const schema: WorkflowInput[] = [
      { name: "mode", type: "enum", values: ["fast", "slow"] },
    ];
    expect(() => validateAndResolve({ mode: "medium" }, schema)).toThrow(
      /Invalid value for "--mode": "medium".*Expected one of: fast, slow/,
    );
  });

  test("throws on non-integer value for integer fields", () => {
    const schema: WorkflowInput[] = [{ name: "loops", type: "integer" }];
    expect(() => validateAndResolve({ loops: "3.5" }, schema)).toThrow(
      /Expected an integer/,
    );
    expect(() => validateAndResolve({ loops: "abc" }, schema)).toThrow(
      /Expected an integer/,
    );
  });

  test("fills defaults and drops empty values", () => {
    const schema: WorkflowInput[] = [
      { name: "mode", type: "enum", values: ["fast", "slow"], default: "fast" },
      { name: "note", type: "text" },
    ];
    const out = validateAndResolve({}, schema);
    expect(out).toEqual({ mode: "fast" });
  });

  test("picks the first enum value when no default is declared", () => {
    const schema: WorkflowInput[] = [
      { name: "mode", type: "enum", values: ["a", "b"] },
    ];
    const out = validateAndResolve({}, schema);
    expect(out).toEqual({ mode: "a" });
  });
});

describe("stringifyDefaults", () => {
  test("returns undefined when defaults is undefined", () => {
    expect(stringifyDefaults(undefined)).toBeUndefined();
  });

  test("coerces numbers to strings and passes strings through", () => {
    const out = stringifyDefaults({ a: "hello", b: 42 });
    expect(out).toEqual({ a: "hello", b: "42" });
  });

  test("drops undefined values", () => {
    const out = stringifyDefaults({ a: "x", b: undefined });
    expect(out).toEqual({ a: "x" });
  });
});

describe("buildInputUnion", () => {
  test("merges inputs from multiple workflows by name", () => {
    const union = buildInputUnion([
      {
        agent: "claude",
        name: "wf-a",
        inputs: [{ name: "shared", type: "string" }],
      },
      {
        agent: "copilot",
        name: "wf-b",
        inputs: [
          { name: "shared", type: "string" },
          { name: "extra", type: "integer" },
        ],
      },
    ]);
    expect(Array.from(union.keys()).sort()).toEqual(["extra", "shared"]);
  });

  test("throws when a workflow uses a reserved input name", () => {
    expect(() =>
      buildInputUnion([
        {
          agent: "claude",
          name: "wf",
          inputs: [{ name: "session", type: "string" }],
        },
      ]),
    ).toThrow(/reserved by the worker CLI/);
  });

  test("throws when the same input name has conflicting types", () => {
    expect(() =>
      buildInputUnion([
        {
          agent: "claude",
          name: "wf-a",
          inputs: [{ name: "loops", type: "integer" }],
        },
        {
          agent: "copilot",
          name: "wf-b",
          inputs: [{ name: "loops", type: "string" }],
        },
      ]),
    ).toThrow(/Input name conflict.*"loops"/);
  });
});
