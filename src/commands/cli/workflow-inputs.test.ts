/**
 * Unit tests for the workflow-inputs CLI command.
 *
 * Focused on the pure helpers (`buildInputsPayload` + `renderInputsText`)
 * since they carry the schema-shaping logic. The thin command wrapper
 * is exercised end-to-end by the existing workflow-command harness.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  buildInputsPayload,
  renderInputsText,
} from "./workflow-inputs.ts";
import type { WorkflowInput } from "../../sdk/workflows/index.ts";

let originalNoColor: string | undefined;
beforeAll(() => {
  originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});
afterAll(() => {
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
});

describe("buildInputsPayload", () => {
  test("synthesises a 'prompt' field for free-form workflows", () => {
    const out = buildInputsPayload("ralph", "claude", "loop", []);
    expect(out.freeform).toBe(true);
    expect(out.inputs).toHaveLength(1);
    expect(out.inputs[0]!.name).toBe("prompt");
    expect(out.inputs[0]!.type).toBe("text");
  });

  test("clones structured inputs without mutating callers' arrays", () => {
    const schema: WorkflowInput[] = [
      { name: "research_doc", type: "string", required: true },
      {
        name: "focus",
        type: "enum",
        values: ["minimal", "standard"],
        default: "standard",
      },
    ];
    const out = buildInputsPayload("gen-spec", "claude", "spec", schema);
    expect(out.freeform).toBe(false);
    expect(out.inputs).toHaveLength(2);
    expect(out.inputs[0]!.name).toBe("research_doc");
    expect(out.inputs[1]!.values).toEqual(["minimal", "standard"]);
    // mutating the output must not leak into the input
    out.inputs[0]!.required = false;
    expect(schema[0]!.required).toBe(true);
  });

  test("propagates description and agent into the payload", () => {
    const out = buildInputsPayload("foo", "copilot", "describe me", []);
    expect(out.workflow).toBe("foo");
    expect(out.agent).toBe("copilot");
    expect(out.description).toBe("describe me");
  });
});

describe("renderInputsText", () => {
  test("free-form workflows show the positional-prompt run hint", () => {
    const payload = buildInputsPayload("ralph", "claude", "loop", []);
    const out = renderInputsText(payload);
    expect(out).toContain("ralph");
    expect(out).toContain("claude");
    expect(out).toContain("free-form");
    expect(out).toContain('atomic workflow -n ralph -a claude "<prompt>"');
  });

  test("structured workflows render flag names, types, required, defaults, and enum values", () => {
    const schema: WorkflowInput[] = [
      {
        name: "research_doc",
        type: "string",
        required: true,
        description: "path to research notes",
      },
      {
        name: "focus",
        type: "enum",
        values: ["minimal", "standard", "exhaustive"],
        default: "standard",
      },
    ];
    const payload = buildInputsPayload("gen-spec", "claude", "spec", schema);
    const out = renderInputsText(payload);

    expect(out).toContain("--research_doc");
    expect(out).toContain("(required)");
    expect(out).toContain("[string]");
    expect(out).toContain("path to research notes");

    expect(out).toContain("--focus");
    expect(out).toContain("[enum]");
    expect(out).toContain("minimal, standard, exhaustive");
    expect(out).toContain("default: standard");

    // run hint references both flags
    expect(out).toContain("--research_doc=<string>");
    expect(out).toContain("--focus=<enum>");
  });
});
