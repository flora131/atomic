/**
 * Tests for the State Compiler module.
 *
 * Verifies that:
 * - resolveReducer maps string names to Reducers.* functions
 * - resolveReducer passes custom function reducers through directly
 * - resolveReducer handles "mergeById" with required key parameter
 * - resolveReducer throws on unknown reducer names
 * - resolveReducer throws on "mergeById" without a key
 * - compileStateSchema produces correct AnnotationRoot from a schema
 * - createStateFactory produces base state without a schema
 * - createStateFactory produces base + custom state with a schema
 * - State factories use defaults from static values and factory functions
 * - Compiled annotations work with applyStateUpdate
 */

import { describe, test, expect } from "bun:test";
import {
  resolveReducer,
  compileStateSchema,
  createStateFactory,
} from "@/services/workflows/dsl/state-compiler.ts";
import type { StateFieldOptions } from "@/services/workflows/dsl/types.ts";
import { Reducers, applyStateUpdate } from "@/services/workflows/graph/annotation.ts";

// ---------------------------------------------------------------------------
// resolveReducer
// ---------------------------------------------------------------------------

describe("resolveReducer", () => {
  test("returns undefined when no reducer is specified", () => {
    const config: StateFieldOptions<string> = { default: "hello" };
    const result = resolveReducer(config);
    expect(result).toBeUndefined();
  });

  test("maps 'replace' to Reducers.replace", () => {
    const config: StateFieldOptions<string> = {
      default: "",
      reducer: "replace",
    };
    const reducer = resolveReducer(config);
    expect(reducer).toBeDefined();
    expect(reducer!("old", "new")).toBe("new");
  });

  test("maps 'concat' to Reducers.concat", () => {
    const config: StateFieldOptions<string[]> = {
      default: [],
      reducer: "concat",
    };
    const reducer = resolveReducer(config);
    expect(reducer).toBeDefined();
    expect(reducer!(["a"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("maps 'merge' to Reducers.merge", () => {
    const config: StateFieldOptions<Record<string, unknown>> = {
      default: {},
      reducer: "merge",
    };
    const reducer = resolveReducer(config);
    expect(reducer).toBeDefined();
    expect(reducer!({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  test("maps 'max' to Reducers.max", () => {
    const config: StateFieldOptions<number> = {
      default: 0,
      reducer: "max",
    };
    const reducer = resolveReducer(config);
    expect(reducer).toBeDefined();
    expect(reducer!(5, 3)).toBe(5);
    expect(reducer!(3, 5)).toBe(5);
  });

  test("maps 'min' to Reducers.min", () => {
    const config: StateFieldOptions<number> = {
      default: 100,
      reducer: "min",
    };
    const reducer = resolveReducer(config);
    expect(reducer).toBeDefined();
    expect(reducer!(5, 3)).toBe(3);
    expect(reducer!(3, 5)).toBe(3);
  });

  test("maps 'sum' to Reducers.sum", () => {
    const config: StateFieldOptions<number> = {
      default: 0,
      reducer: "sum",
    };
    const reducer = resolveReducer(config);
    expect(reducer).toBeDefined();
    expect(reducer!(10, 5)).toBe(15);
  });

  test("maps 'or' to Reducers.or", () => {
    const config: StateFieldOptions<boolean> = {
      default: false,
      reducer: "or",
    };
    const reducer = resolveReducer(config);
    expect(reducer).toBeDefined();
    expect(reducer!(false, true)).toBe(true);
    expect(reducer!(false, false)).toBe(false);
    expect(reducer!(true, false)).toBe(true);
  });

  test("maps 'and' to Reducers.and", () => {
    const config: StateFieldOptions<boolean> = {
      default: true,
      reducer: "and",
    };
    const reducer = resolveReducer(config);
    expect(reducer).toBeDefined();
    expect(reducer!(true, true)).toBe(true);
    expect(reducer!(true, false)).toBe(false);
    expect(reducer!(false, true)).toBe(false);
  });

  test("maps 'mergeById' with a key to a merge-by-id reducer", () => {
    const config: StateFieldOptions<Array<{ id: string; name: string }>> = {
      default: [],
      reducer: "mergeById",
      key: "id",
    };
    const reducer = resolveReducer(config);
    expect(reducer).toBeDefined();

    const current = [{ id: "1", name: "Alice" }];
    const update = [
      { id: "1", name: "Alice Updated" },
      { id: "2", name: "Bob" },
    ];
    const result = reducer!(current, update);
    expect(result).toEqual([
      { id: "1", name: "Alice Updated" },
      { id: "2", name: "Bob" },
    ]);
  });

  test("throws when 'mergeById' is used without a key", () => {
    const config: StateFieldOptions<Array<{ id: string }>> = {
      default: [],
      reducer: "mergeById",
    };
    expect(() => resolveReducer(config)).toThrow(
      'StateFieldOptions with reducer "mergeById" requires a "key" field',
    );
  });

  test("passes custom function reducer through directly", () => {
    const customReducer = (current: number, update: number): number =>
      current * update;
    const config: StateFieldOptions<number> = {
      default: 1,
      reducer: customReducer,
    };
    const reducer = resolveReducer(config);
    expect(reducer).toBeDefined();
    expect(reducer!(3, 4)).toBe(12);
  });

  test("passes custom function reducer identity check", () => {
    const customReducer = (current: string, update: string): string =>
      `${current}+${update}`;
    const config: StateFieldOptions<string> = {
      default: "",
      reducer: customReducer,
    };
    const resolver = resolveReducer(config);
    // The resolved reducer should be the same function reference
    expect(resolver).toBe(customReducer);
  });
});

// ---------------------------------------------------------------------------
// compileStateSchema
// ---------------------------------------------------------------------------

describe("compileStateSchema", () => {
  test("compiles an empty schema to an empty AnnotationRoot", () => {
    const result = compileStateSchema({});
    expect(result).toEqual({});
  });

  test("compiles a single field with default and no reducer", () => {
    const schema: Record<string, StateFieldOptions> = {
      name: { default: "untitled" },
    };
    const result = compileStateSchema(schema);

    expect(result.name).toBeDefined();
    expect(result.name!.default).toBe("untitled");
    expect(result.name!.reducer).toBeUndefined();
  });

  test("compiles a single field with a string reducer", () => {
    const schema: Record<string, StateFieldOptions> = {
      count: { default: 0, reducer: "sum" },
    };
    const result = compileStateSchema(schema);

    expect(result.count).toBeDefined();
    expect(result.count!.default).toBe(0);
    expect(result.count!.reducer).toBeDefined();
    // Verify the reducer works correctly
    expect(result.count!.reducer!(10, 5)).toBe(15);
  });

  test("compiles a factory default", () => {
    const factory = () => ({ key: "value" });
    const schema: Record<string, StateFieldOptions> = {
      config: { default: factory },
    };
    const result = compileStateSchema(schema);

    expect(result.config).toBeDefined();
    expect(typeof result.config!.default).toBe("function");
    // Calling the factory should produce the expected value
    const defaultValue = (result.config!.default as () => Record<string, string>)();
    expect(defaultValue).toEqual({ key: "value" });
  });

  test("compiles a multi-field schema with mixed reducers", () => {
    const schema: Record<string, StateFieldOptions> = {
      title: { default: "" },
      items: { default: () => [], reducer: "concat" },
      errorCount: { default: 0, reducer: "sum" },
      isReady: { default: false, reducer: "or" },
      metadata: { default: () => ({}), reducer: "merge" },
    };
    const result = compileStateSchema(schema);

    expect(Object.keys(result)).toHaveLength(5);
    expect(result.title!.reducer).toBeUndefined();
    expect(result.items!.reducer).toBeDefined();
    expect(result.errorCount!.reducer).toBeDefined();
    expect(result.isReady!.reducer).toBeDefined();
    expect(result.metadata!.reducer).toBeDefined();
  });

  test("compiled schema works with applyStateUpdate", () => {
    const schema: Record<string, StateFieldOptions> = {
      count: { default: 0, reducer: "sum" },
      items: { default: () => [] as string[], reducer: "concat" },
    };
    const annotations = compileStateSchema(schema);

    // Initialize state from annotations
    const initial = { count: 0, items: [] as string[] };

    // Apply an update
    const updated = applyStateUpdate(annotations, initial, {
      count: 5,
      items: ["hello"],
    });

    expect(updated.count).toBe(5); // 0 + 5
    expect(updated.items).toEqual(["hello"]); // [] ++ ["hello"]

    // Apply another update
    const updated2 = applyStateUpdate(annotations, updated, {
      count: 3,
      items: ["world"],
    });

    expect(updated2.count).toBe(8); // 5 + 3
    expect(updated2.items).toEqual(["hello", "world"]);
  });
});

// ---------------------------------------------------------------------------
// createStateFactory
// ---------------------------------------------------------------------------

describe("createStateFactory", () => {
  const defaultParams = {
    prompt: "test prompt",
    sessionId: "test-session-123",
    sessionDir: "/tmp/test",
    maxIterations: 10,
  };

  test("returns a function", () => {
    const factory = createStateFactory(undefined);
    expect(typeof factory).toBe("function");
  });

  test("returns bare BaseState when schema is undefined", () => {
    const factory = createStateFactory(undefined);
    const state = factory(defaultParams);

    expect(state.executionId).toBe("test-session-123");
    expect(typeof state.lastUpdated).toBe("string");
    expect(state.outputs).toEqual({});
  });

  test("uses sessionId as executionId", () => {
    const factory = createStateFactory(undefined);
    const state = factory(defaultParams);
    expect(state.executionId).toBe("test-session-123");
  });

  test("generates a UUID when sessionId is empty", () => {
    const factory = createStateFactory(undefined);
    const state = factory({
      ...defaultParams,
      sessionId: "",
    });
    // Should be a UUID-like string (non-empty)
    expect(state.executionId).toBeTruthy();
    expect(state.executionId).not.toBe("");
  });

  test("returns BaseState merged with custom defaults when schema is provided", () => {
    const schema: Record<string, StateFieldOptions> = {
      title: { default: "My Workflow" },
      count: { default: 0, reducer: "sum" },
      items: { default: () => [] as string[], reducer: "concat" },
    };
    const factory = createStateFactory(schema);
    const state = factory(defaultParams);

    // BaseState fields
    expect(state.executionId).toBe("test-session-123");
    expect(typeof state.lastUpdated).toBe("string");
    expect(state.outputs).toEqual({});

    // Custom fields (access via index since BaseState doesn't know about them)
    const extended = state as unknown as Record<string, unknown>;
    expect(extended.title).toBe("My Workflow");
    expect(extended.count).toBe(0);
    expect(extended.items).toEqual([]);
  });

  test("factory default functions are invoked for each state creation", () => {
    let callCount = 0;
    const schema: Record<string, StateFieldOptions> = {
      data: {
        default: () => {
          callCount++;
          return { created: true };
        },
      },
    };
    const factory = createStateFactory(schema);

    const state1 = factory(defaultParams);
    const state2 = factory(defaultParams);

    expect(callCount).toBe(2);
    // Each invocation should produce a fresh object
    const data1 = (state1 as unknown as Record<string, unknown>).data;
    const data2 = (state2 as unknown as Record<string, unknown>).data;
    expect(data1).toEqual({ created: true });
    expect(data2).toEqual({ created: true });
    expect(data1).not.toBe(data2); // Different instances
  });

  test("produces ISO timestamp for lastUpdated", () => {
    const factory = createStateFactory(undefined);
    const state = factory(defaultParams);
    // Verify it parses as a valid date
    const parsed = new Date(state.lastUpdated);
    expect(parsed.getTime()).not.toBeNaN();
  });

  test("empty schema produces only base state fields", () => {
    const factory = createStateFactory({});
    const state = factory(defaultParams);

    expect(state.executionId).toBe("test-session-123");
    expect(typeof state.lastUpdated).toBe("string");
    expect(state.outputs).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Integration: compileStateSchema + applyStateUpdate roundtrip
// ---------------------------------------------------------------------------

describe("Integration: schema compile + state update roundtrip", () => {
  test("mergeById reducer works end-to-end through compiled schema", () => {
    const schema: Record<string, StateFieldOptions> = {
      features: {
        default: () => [] as Array<{ id: string; status: string }>,
        reducer: "mergeById",
        key: "id",
      },
    };
    const annotations = compileStateSchema(schema);

    const initial = {
      features: [
        { id: "f1", status: "pending" },
        { id: "f2", status: "pending" },
      ],
    };

    const updated = applyStateUpdate(annotations, initial, {
      features: [
        { id: "f1", status: "done" },
        { id: "f3", status: "new" },
      ],
    });

    expect(updated.features).toEqual([
      { id: "f1", status: "done" },
      { id: "f2", status: "pending" },
      { id: "f3", status: "new" },
    ]);
  });

  test("custom reducer works end-to-end through compiled schema", () => {
    const customReducer = (current: unknown, update: unknown): unknown => {
      const cur = current as string;
      const upd = update as string;
      if (!cur) return upd;
      return `${cur}\n${upd}`;
    };
    const schema: Record<string, StateFieldOptions> = {
      log: { default: "", reducer: customReducer },
    };
    const annotations = compileStateSchema(schema);

    const initial = { log: "" };
    const step1 = applyStateUpdate(annotations, initial, { log: "Step 1" });
    expect(step1.log).toBe("Step 1");

    const step2 = applyStateUpdate(annotations, step1, { log: "Step 2" });
    expect(step2.log).toBe("Step 1\nStep 2");
  });

  test("boolean reducers work end-to-end through compiled schema", () => {
    const schema: Record<string, StateFieldOptions> = {
      anyError: { default: false, reducer: "or" },
      allReady: { default: true, reducer: "and" },
    };
    const annotations = compileStateSchema(schema);

    const initial = { anyError: false, allReady: true };

    const updated = applyStateUpdate(annotations, initial, {
      anyError: true,
      allReady: true,
    });
    expect(updated.anyError).toBe(true);
    expect(updated.allReady).toBe(true);

    const updated2 = applyStateUpdate(annotations, updated, {
      anyError: false,
      allReady: false,
    });
    expect(updated2.anyError).toBe(true); // or: true || false
    expect(updated2.allReady).toBe(false); // and: true && false
  });

  test("numeric reducers work end-to-end through compiled schema", () => {
    const schema: Record<string, StateFieldOptions> = {
      total: { default: 0, reducer: "sum" },
      highest: { default: 0, reducer: "max" },
      lowest: { default: 100, reducer: "min" },
    };
    const annotations = compileStateSchema(schema);

    const initial = { total: 0, highest: 0, lowest: 100 };

    const updated = applyStateUpdate(annotations, initial, {
      total: 10,
      highest: 42,
      lowest: 7,
    });
    expect(updated.total).toBe(10);
    expect(updated.highest).toBe(42);
    expect(updated.lowest).toBe(7);

    const updated2 = applyStateUpdate(annotations, updated, {
      total: 5,
      highest: 30,
      lowest: 15,
    });
    expect(updated2.total).toBe(15); // 10 + 5
    expect(updated2.highest).toBe(42); // max(42, 30)
    expect(updated2.lowest).toBe(7); // min(7, 15)
  });

  test("replace reducer replaces values end-to-end", () => {
    const schema: Record<string, StateFieldOptions> = {
      status: { default: "idle", reducer: "replace" },
    };
    const annotations = compileStateSchema(schema);

    const initial = { status: "idle" };
    const updated = applyStateUpdate(annotations, initial, {
      status: "running",
    });
    expect(updated.status).toBe("running");
  });

  test("merge reducer merges objects end-to-end", () => {
    const schema: Record<string, StateFieldOptions> = {
      config: { default: () => ({ debug: false }), reducer: "merge" },
    };
    const annotations = compileStateSchema(schema);

    const initial = { config: { debug: false } };
    const updated = applyStateUpdate(annotations, initial, {
      config: { verbose: true },
    });
    expect(updated.config).toEqual({ debug: false, verbose: true });
  });

  test("concat reducer concatenates arrays end-to-end", () => {
    const schema: Record<string, StateFieldOptions> = {
      logs: { default: () => [] as string[], reducer: "concat" },
    };
    const annotations = compileStateSchema(schema);

    const initial = { logs: ["boot"] };
    const updated = applyStateUpdate(annotations, initial, {
      logs: ["init", "ready"],
    });
    expect(updated.logs).toEqual(["boot", "init", "ready"]);
  });
});
