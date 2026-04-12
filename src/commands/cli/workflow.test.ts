import { describe, test, expect } from "bun:test";
import {
  parsePassthroughArgs,
  validateInputsAgainstSchema,
  resolveInputs,
} from "./workflow.ts";
import type { WorkflowInput } from "@/sdk/workflows/index.ts";

// ─── parsePassthroughArgs ──────────────────────────────────────────────────

describe("parsePassthroughArgs", () => {
  test("parses --name=value flag pairs", () => {
    const out = parsePassthroughArgs(["--foo=bar", "--baz=qux"]);
    expect(out.flags).toEqual({ foo: "bar", baz: "qux" });
    expect(out.positional).toEqual([]);
    expect(out.errors).toEqual([]);
  });

  test("parses --name value flag pairs", () => {
    const out = parsePassthroughArgs(["--foo", "bar", "--baz", "qux"]);
    expect(out.flags).toEqual({ foo: "bar", baz: "qux" });
    expect(out.errors).toEqual([]);
  });

  test("preserves values containing equals signs", () => {
    const out = parsePassthroughArgs(["--query=key=value"]);
    expect(out.flags).toEqual({ query: "key=value" });
  });

  test("collects positional tokens separately", () => {
    const out = parsePassthroughArgs(["fix", "the", "bug"]);
    expect(out.positional).toEqual(["fix", "the", "bug"]);
    expect(out.flags).toEqual({});
  });

  test("returns an error when a flag has no value", () => {
    const out = parsePassthroughArgs(["--foo"]);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0]).toContain("--foo");
  });

  test("treats a trailing --flag --other as a missing value", () => {
    // Second `--other` looks like a flag so the parser should not
    // silently consume it as the first flag's value.
    const out = parsePassthroughArgs(["--foo", "--other=x"]);
    expect(out.errors.length).toBe(1);
    expect(out.flags).toEqual({ other: "x" });
  });

  test("handles mixed positional and flag tokens", () => {
    const out = parsePassthroughArgs([
      "run",
      "--mode=fast",
      "now",
      "--retries",
      "3",
    ]);
    expect(out.positional).toEqual(["run", "now"]);
    expect(out.flags).toEqual({ mode: "fast", retries: "3" });
    expect(out.errors).toEqual([]);
  });
});

// ─── validateInputsAgainstSchema ───────────────────────────────────────────

const schema: WorkflowInput[] = [
  {
    name: "research_doc",
    type: "string",
    required: true,
    description: "path",
  },
  {
    name: "focus",
    type: "enum",
    required: true,
    values: ["minimal", "standard", "exhaustive"],
    default: "standard",
  },
  {
    name: "notes",
    type: "text",
  },
];

describe("validateInputsAgainstSchema", () => {
  test("passes when all required fields are present", () => {
    const errors = validateInputsAgainstSchema(
      { research_doc: "notes.md", focus: "standard" },
      schema,
    );
    expect(errors).toEqual([]);
  });

  test("accepts an omitted enum with a declared default", () => {
    // `focus` has a default of "standard", so omission should be OK.
    const errors = validateInputsAgainstSchema(
      { research_doc: "notes.md" },
      schema,
    );
    expect(errors).toEqual([]);
  });

  test("flags a missing required string input", () => {
    const errors = validateInputsAgainstSchema(
      { focus: "standard" },
      schema,
    );
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("--research_doc");
  });

  test("rejects required strings that are whitespace only", () => {
    const errors = validateInputsAgainstSchema(
      { research_doc: "   ", focus: "standard" },
      schema,
    );
    expect(errors[0]).toContain("--research_doc");
  });

  test("rejects enum values that are not in the allowed list", () => {
    const errors = validateInputsAgainstSchema(
      { research_doc: "notes.md", focus: "bogus" },
      schema,
    );
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("bogus");
    expect(errors[0]).toContain("minimal");
  });

  test("flags unknown inputs", () => {
    const errors = validateInputsAgainstSchema(
      {
        research_doc: "notes.md",
        focus: "standard",
        bogus: "hello",
      },
      schema,
    );
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("--bogus");
  });
});

// ─── resolveInputs ─────────────────────────────────────────────────────────

describe("resolveInputs", () => {
  test("fills in declared defaults", () => {
    const out = resolveInputs({ research_doc: "notes.md" }, schema);
    expect(out.research_doc).toBe("notes.md");
    expect(out.focus).toBe("standard");
    // `notes` has no default — should be absent, not empty-string.
    expect(out.notes).toBeUndefined();
  });

  test("prefers provided values over defaults", () => {
    const out = resolveInputs(
      { research_doc: "notes.md", focus: "exhaustive" },
      schema,
    );
    expect(out.focus).toBe("exhaustive");
  });

  test("falls back to the first enum value when no default and no input", () => {
    const enumOnly: WorkflowInput[] = [
      {
        name: "mode",
        type: "enum",
        required: true,
        values: ["a", "b", "c"],
      },
    ];
    expect(resolveInputs({}, enumOnly)).toEqual({ mode: "a" });
  });

  test("ignores unknown provided keys", () => {
    const out = resolveInputs(
      { research_doc: "notes.md", bogus: "hello" },
      schema,
    );
    expect(out.bogus).toBeUndefined();
  });
});
