import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  parsePassthroughArgs,
  validateInputsAgainstSchema,
  resolveInputs,
  renderWorkflowList,
} from "./workflow.ts";
import type { WorkflowInput } from "../../sdk/workflows/index.ts";
import type {
  DiscoveredWorkflow,
  WorkflowWithMetadata,
} from "../../sdk/workflows/index.ts";

// ─── Colour handling ────────────────────────────────────────────────────────
// The renderer emits ANSI sequences when the host terminal claims truecolor
// support. Force `NO_COLOR=1` for this file so renderWorkflowList assertions
// can match on plain-text output rather than brittle SGR escapes. Restore the
// prior value on teardown so other suites in the same run are unaffected.
let originalNoColor: string | undefined;
beforeAll(() => {
  originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});
afterAll(() => {
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
});

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

  test("flags an empty flag name when `--=value` slips through", () => {
    // `--=foo` tokenises to body="=foo", splits at the first `=`,
    // and yields an empty name. The parser rejects this so users see
    // "did you mean --name=foo?" rather than silently accepting a
    // nameless entry in the flags record.
    const out = parsePassthroughArgs(["--=foo"]);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0]).toContain("Malformed flag");
    expect(out.flags).toEqual({});
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

  test("flags a required enum that resolves to empty when no values are declared", () => {
    // Pathological but reachable: a declared enum with an empty
    // `values` array and no default falls through to value==="" in the
    // resolver, which should trip the enum-specific required-input
    // error branch rather than the generic string-required branch.
    const brokenSchema: WorkflowInput[] = [
      { name: "mode", type: "enum", required: true, values: [] },
    ];
    const errors = validateInputsAgainstSchema({}, brokenSchema);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("--mode");
    expect(errors[0]).toContain("expected one of:");
  });
});

// ─── renderWorkflowList ────────────────────────────────────────────────────

function wf(
  name: string,
  agent: DiscoveredWorkflow["agent"],
  source: DiscoveredWorkflow["source"],
  status: WorkflowWithMetadata["status"] = { kind: "ok" },
): WorkflowWithMetadata {
  return {
    name,
    agent,
    source,
    path: `/tmp/fake/${source}/${name}/${agent}/index.ts`,
    description: "",
    inputs: [],
    status,
  };
}

describe("renderWorkflowList", () => {
  test("renders an empty-state stanza when no workflows are available", () => {
    const out = renderWorkflowList([]);
    expect(out).toContain("no workflows found");
    // Teaches the user where to drop a new workflow.
    expect(out).toContain(".atomic/workflows/<name>/<agent>/index.ts");
  });

  test("uses singular 'workflow' for a count of exactly one", () => {
    const out = renderWorkflowList([wf("only", "claude", "local")]);
    // Must say "1 workflow", never "1 workflows".
    expect(out).toMatch(/\b1 workflow\b/);
    expect(out).not.toMatch(/\b1 workflows\b/);
    expect(out).toContain("only");
  });

  test("groups entries by source → provider and sorts names", () => {
    const workflows: WorkflowWithMetadata[] = [
      wf("zebra", "claude", "local"),
      wf("apple", "claude", "local"),
      wf("middle", "opencode", "local"),
      wf("personal", "claude", "global"),
      wf("shipped", "copilot", "builtin"),
    ];
    const out = renderWorkflowList(workflows);

    // Count uses plural noun.
    expect(out).toMatch(/\b5 workflows\b/);

    // Section headings appear with friendly directory hints.
    expect(out).toContain("local");
    expect(out).toContain(".atomic/workflows");
    expect(out).toContain("global");
    expect(out).toContain("~/.atomic/workflows");
    expect(out).toContain("builtin");
    expect(out).toContain("built-in");

    // Provider sub-headings are present with branded names.
    expect(out).toContain("Claude");
    expect(out).toContain("OpenCode");
    expect(out).toContain("Copilot CLI");

    // Run-hint footer is appended.
    expect(out).toContain("run: atomic workflow -n <name> -a <agent>");

    // Local/Claude names are sorted alphabetically: apple before zebra.
    const appleIdx = out.indexOf("apple");
    const zebraIdx = out.indexOf("zebra");
    expect(appleIdx).toBeGreaterThanOrEqual(0);
    expect(zebraIdx).toBeGreaterThan(appleIdx);

    // Source ordering: local before global before builtin.
    const localIdx = out.indexOf("local");
    const globalIdx = out.indexOf("global");
    const builtinIdx = out.indexOf("builtin");
    expect(localIdx).toBeLessThan(globalIdx);
    expect(globalIdx).toBeLessThan(builtinIdx);
  });

  test("omits provider sub-groups that have no entries for a given source", () => {
    // Only a copilot workflow exists, so the local stanza should render a
    // single "Copilot CLI" sub-heading — never "Claude" or "OpenCode".
    const out = renderWorkflowList([wf("alone", "copilot", "local")]);
    expect(out).toContain("Copilot CLI");
    expect(out).not.toContain("Claude");
    expect(out).not.toContain("OpenCode");
    expect(out).toContain("alone");
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
