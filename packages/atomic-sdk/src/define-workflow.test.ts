import { test, expect, describe } from "bun:test";
import { defineWorkflow, WorkflowBuilder, RESERVED_INPUT_NAMES } from "./define-workflow.ts";
import type { WorkflowInput } from "./types.ts";

describe("defineWorkflow", () => {
  test("returns a WorkflowBuilder", () => {
    const builder = defineWorkflow({ name: "test" });
    expect(builder).toBeInstanceOf(WorkflowBuilder);
    expect(builder.__brand).toBe("WorkflowBuilder");
  });

  test("throws on empty name", () => {
    expect(() => defineWorkflow({ name: "" })).toThrow("Workflow name is required");
  });

  test("throws on whitespace-only name", () => {
    expect(() => defineWorkflow({ name: "   " })).toThrow("Workflow name is required");
  });

  test("auto-captures source from the caller's stack frame when `source` is omitted", () => {
    const def = defineWorkflow({ name: "auto-src" })
      .for("copilot")
      .run(async () => {})
      .compile();
    expect(def.source).toBe(import.meta.path);
  });

  test("explicit `source` overrides the auto-captured caller path", () => {
    const def = defineWorkflow({ name: "with-src", source: "/explicit/path.ts" })
      .for("copilot")
      .run(async () => {})
      .compile();
    expect(def.source).toBe("/explicit/path.ts");
  });

  test("throws when source is not resolvable (e.g. caller capture returned null + no override)", () => {
    // Construct a builder bypassing defineWorkflow's auto-capture so the
    // compile-time guard can be exercised in isolation.
    const { WorkflowBuilder } = require("./define-workflow.ts") as {
      WorkflowBuilder: new (opts: { name: string }) => {
        for: (a: "copilot") => {
          run: (fn: () => Promise<void>) => { compile: () => unknown };
        };
      };
    };
    const builder = new WorkflowBuilder({ name: "no-source" });
    expect(() =>
      builder.for("copilot").run(async () => {}).compile(),
    ).toThrow(/no resolvable source path/);
  });
});

describe("WorkflowBuilder.run()", () => {
  test("accepts a function and returns this for chaining", () => {
    const builder = defineWorkflow({ name: "test" });
    const result = builder.run(async () => {});
    expect(result).toBe(builder);
  });

  test("throws if called twice", () => {
    const builder = defineWorkflow({ name: "test" }).run(async () => {});
    expect(() => builder.run(async () => {})).toThrow("run() can only be called once");
  });

  test("throws if argument is not a function", () => {
    const builder = defineWorkflow({ name: "test" });
    expect(() => builder.run("not a function" as never)).toThrow("run() requires a function");
  });
});

describe("WorkflowBuilder.compile()", () => {
  test("produces a WorkflowDefinition with correct brand", () => {
    const def = defineWorkflow({ name: "test" })
      .for("copilot")
      .run(async () => {})
      .compile();
    expect(def.__brand).toBe("WorkflowDefinition");
  });

  test("defaults inputs to an empty array when none are declared", () => {
    const def = defineWorkflow({ name: "test" })
      .for("copilot")
      .run(async () => {})
      .compile();
    expect(def.inputs).toEqual([]);
  });

  test("preserves declared inputs in order", () => {
    const def = defineWorkflow({
      name: "gen-spec",
            inputs: [
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
      ],
    })
      .for("opencode")
      .run(async () => {})
      .compile();
    expect(def.inputs).toHaveLength(2);
    expect(def.inputs[0]?.name).toBe("research_doc");
    expect(def.inputs[1]?.name).toBe("focus");
    expect(def.inputs[1]?.type).toBe("enum");
  });

  test("freezes declared inputs to prevent downstream mutation", () => {
    const def = defineWorkflow({
      name: "test",
            inputs: [{ name: "foo", type: "string" }],
    })
      .for("claude")
      .run(async () => {})
      .compile();
    expect(() => {
      (def.inputs as unknown as WorkflowInput[])[0]!.name = "bar";
    }).toThrow();
  });

  test("rejects enum inputs with no values", () => {
    expect(() =>
      defineWorkflow({
        name: "bad",
                inputs: [{ name: "mode", type: "enum" }],
      })
        .for("copilot")
        .run(async () => {})
        .compile(),
    ).toThrow("declares no `values`");
  });

  test("rejects enum defaults outside the allowed values", () => {
    expect(() =>
      defineWorkflow({
        name: "bad",
                inputs: [
          {
            name: "mode",
            type: "enum",
            values: ["a", "b"],
            default: "c",
          },
        ],
      })
        .for("copilot")
        .run(async () => {})
        .compile(),
    ).toThrow(/not one of its declared values/);
  });

  test("rejects input names that are not valid CLI flag tails", () => {
    expect(() =>
      defineWorkflow({
        name: "bad",
                inputs: [{ name: "1bad", type: "string" }],
      })
        .for("copilot")
        .run(async () => {})
        .compile(),
    ).toThrow(/invalid/);
  });

  test("rejects duplicate input names", () => {
    expect(() =>
      defineWorkflow({
        name: "bad",
                inputs: [
          { name: "foo", type: "string" },
          { name: "foo", type: "string" },
        ],
      })
        .for("copilot")
        .run(async () => {})
        .compile(),
    ).toThrow(/duplicate input name/);
  });

  test("preserves name, description, and agent", () => {
    const def = defineWorkflow({ name: "my-wf", description: "A description" })
      .for("claude")
      .run(async () => {})
      .compile();
    expect(def.name).toBe("my-wf");
    expect(def.description).toBe("A description");
    expect(def.agent).toBe("claude");
  });

  test("defaults description to empty string", () => {
    const def = defineWorkflow({ name: "test" })
      .for("opencode")
      .run(async () => {})
      .compile();
    expect(def.description).toBe("");
  });

  test("stores the run function", () => {
    const fn = async () => {};
    const def = defineWorkflow({ name: "test" }).for("copilot").run(fn).compile();
    expect(def.run).toBe(fn);
  });

  test("throws if no run callback was provided", () => {
    const builder = defineWorkflow({ name: "test" }).for("copilot");
    expect(() => builder.compile()).toThrow("has no run callback");
  });

  test("throws if .for() was not called before compile()", () => {
    const builder = defineWorkflow({ name: "test" }).run(async () => {});
    expect(() => builder.compile()).toThrow("has no agent");
  });
});

describe("RESERVED_INPUT_NAMES — reserved name validation", () => {
  test("RESERVED_INPUT_NAMES is exported and contains expected names", () => {
    expect(RESERVED_INPUT_NAMES).toContain("name");
    expect(RESERVED_INPUT_NAMES).toContain("agent");
    expect(RESERVED_INPUT_NAMES).toContain("detach");
    expect(RESERVED_INPUT_NAMES).toContain("list");
    expect(RESERVED_INPUT_NAMES).toContain("help");
    expect(RESERVED_INPUT_NAMES).toContain("version");
  });

  // Each reserved name must be rejected individually.
  for (const reserved of RESERVED_INPUT_NAMES) {
    test(`rejects reserved input name "${reserved}"`, () => {
      expect(() =>
        defineWorkflow({
          name: "bad",
                    inputs: [{ name: reserved, type: "string" }],
        })
          .for("copilot")
          .run(async () => {})
          .compile(),
      ).toThrow(reserved);
    });
  }

  test("error message lists all reserved names", () => {
    let message = "";
    try {
      defineWorkflow({
        name: "bad",
                inputs: [{ name: "name", type: "string" }],
      })
        .for("copilot")
        .run(async () => {})
        .compile();
    } catch (e) {
      message = (e as Error).message;
    }
    for (const reserved of RESERVED_INPUT_NAMES) {
      expect(message).toContain(reserved);
    }
  });

  test("non-reserved input name passes validation", () => {
    expect(() =>
      defineWorkflow({
        name: "ok",
                inputs: [{ name: "topic", type: "string" }],
      })
        .for("copilot")
        .run(async () => {})
        .compile(),
    ).not.toThrow();
  });

  test("non-reserved name that is a prefix of a reserved name passes", () => {
    expect(() =>
      defineWorkflow({
        name: "ok",
                inputs: [{ name: "named", type: "string" }],
      })
        .for("copilot")
        .run(async () => {})
        .compile(),
    ).not.toThrow();
  });
});

describe("WorkflowBuilder.for()", () => {
  test("returns a new builder with agent set", () => {
    const builder = defineWorkflow({ name: "test" });
    const narrowed = builder.for("copilot");
    // .for() returns a new builder instance
    expect(narrowed).toBeInstanceOf(WorkflowBuilder);
    expect(narrowed).not.toBe(builder as unknown);
  });

  test("stores agent on the compiled definition", () => {
    const def = defineWorkflow({ name: "test" })
      .for("copilot")
      .run(async () => {})
      .compile();
    expect(def.agent).toBe("copilot");
  });

  test("chains with run and compile", () => {
    const def = defineWorkflow({
      name: "test",
            inputs: [{ name: "greeting", type: "string" }],
    })
      .for("copilot")
      .run(async () => {})
      .compile();
    expect(def.__brand).toBe("WorkflowDefinition");
    expect(def.inputs[0]?.name).toBe("greeting");
  });
});

describe("typed inputs (compile-time)", () => {
  test("structured inputs restrict ctx.inputs keys", () => {
    // This test validates that the type system correctly narrows
    // ctx.inputs to only declared field names. The assertions below
    // are runtime no-ops — the real check is that tsc compiles this
    // file without errors (or produces errors only where expected).
    defineWorkflow({
      name: "typed-test",
            inputs: [
        { name: "greeting", type: "string", required: true },
        { name: "style", type: "enum", values: ["formal", "casual"] },
      ],
    })
      .for("copilot")
      .run(async (ctx) => {
        // Declared keys are valid
        const _g: string | undefined = ctx.inputs.greeting;
        const _s: string | undefined = ctx.inputs.style;
        // Undeclared key — would be a compile error without @ts-expect-error
        // @ts-expect-error — "prompt" is not a declared input
        ctx.inputs.prompt;
        expect(true).toBe(true);
      })
      .compile();
  });

  test("free-form workflows allow any key", () => {
    defineWorkflow({ name: "freeform-test" })
      .for("copilot")
      .run(async (ctx) => {
        const _p: string | undefined = ctx.inputs.prompt;
        expect(true).toBe(true);
      })
      .compile();
  });
});

// ─── Cross-platform stack-walker contract ────────────────────────────────────
//
// `_captureCallerPath` is the helper that gives `defineWorkflow` its
// auto-`source`. The runtime stack format varies across V8 (Node, Bun,
// Chrome devtools), POSIX vs Windows, and `file://` URL vs absolute path,
// so we exercise every shape against canned traces. CI on Linux/macOS/
// Windows runs the same suite — when V8 ever changes the format, this is
// the test that should catch the regression.

import { _captureCallerPath } from "./define-workflow.ts";

describe("_captureCallerPath — cross-platform stack formats", () => {
  test("V8/Bun POSIX: parenthesised named frame", () => {
    const stack =
      "Error\n" +
      "    at _captureCallerPath (/abs/sdk/define-workflow.ts:42:5)\n" +
      "    at defineWorkflow (/abs/sdk/define-workflow.ts:300:24)\n" +
      "    at <anonymous> (/abs/consumer/index.ts:10:1)\n";
    expect(_captureCallerPath(stack)).toBe("/abs/consumer/index.ts");
  });

  test("V8/Bun POSIX: bare module-level frame (no parens)", () => {
    const stack =
      "Error\n" +
      "    at defineWorkflow (/abs/sdk/define-workflow.ts:300:24)\n" +
      "    at /abs/consumer/script.ts:7:13\n";
    expect(_captureCallerPath(stack)).toBe("/abs/consumer/script.ts");
  });

  test("Node ESM / file:// URL form", () => {
    const stack =
      "Error\n" +
      "    at defineWorkflow (file:///abs/sdk/define-workflow.ts:300:24)\n" +
      "    at file:///abs/consumer/main.mjs:5:1\n";
    expect(_captureCallerPath(stack)).toBe("/abs/consumer/main.mjs");
  });

  test("Windows backslash drive path", () => {
    const stack =
      "Error\r\n" +
      "    at defineWorkflow (C:\\sdk\\define-workflow.ts:300:24)\r\n" +
      "    at <anonymous> (C:\\Users\\alice\\project\\index.ts:10:1)\r\n";
    expect(_captureCallerPath(stack)).toBe("C:\\Users\\alice\\project\\index.ts");
  });

  test("Windows file:// URL form (drive letter preserved, leading slash stripped)", () => {
    const stack =
      "Error\n" +
      "    at defineWorkflow (file:///C:/sdk/define-workflow.ts:300:24)\n" +
      "    at <anonymous> (file:///C:/Users/alice/project/index.ts:10:1)\n";
    expect(_captureCallerPath(stack)).toBe("C:/Users/alice/project/index.ts");
  });

  test("returns null when every frame is inside this module (compiled binary)", () => {
    const stack =
      "Error\n" +
      "    at _captureCallerPath (/abs/sdk/define-workflow.ts:42:5)\n" +
      "    at defineWorkflow (/abs/sdk/define-workflow.ts:300:24)\n";
    expect(_captureCallerPath(stack)).toBeNull();
  });

  test("returns null when stack is empty / undefined", () => {
    expect(_captureCallerPath("")).toBeNull();
    expect(_captureCallerPath("Error\n")).toBeNull();
  });

  test("skips native: and [native code] frames", () => {
    const stack =
      "Error\n" +
      "    at defineWorkflow (/abs/sdk/define-workflow.ts:300:24)\n" +
      "    at moduleEvaluation (native:1:11)\n" +
      "    at <anonymous> (/abs/consumer/real.ts:1:1)\n" +
      "    at internal (Function.prototype.apply [native code])\n";
    expect(_captureCallerPath(stack)).toBe("/abs/consumer/real.ts");
  });

  test("uses the first non-SDK frame even when deeper frames also have paths", () => {
    const stack =
      "Error\n" +
      "    at defineWorkflow (/abs/sdk/define-workflow.ts:300:24)\n" +
      "    at <anonymous> (/abs/consumer/first.ts:10:1)\n" +
      "    at deeper (/abs/somewhere/else.ts:50:5)\n";
    expect(_captureCallerPath(stack)).toBe("/abs/consumer/first.ts");
  });

  test("real-runtime smoke: capturing this file resolves to define-workflow.test.ts", () => {
    // No injected stack: walks `new Error().stack` from inside this test,
    // which should resolve to the test file (the first frame outside
    // define-workflow.ts).
    const captured = _captureCallerPath();
    expect(captured).not.toBeNull();
    expect(captured).toMatch(/define-workflow\.test\.ts$/);
  });
});
