import { describe, expect, test } from "bun:test";
import {
  annotation,
  applyReducer,
  applyStateUpdate,
  getDefaultValue,
  initializeState,
  Reducers,
} from "@/services/workflows/graph/annotation.ts";

describe("Reducers", () => {
  test("replace reducer returns the update value", () => {
    const result = Reducers.replace(10, 20);
    expect(result).toBe(20);

    const objResult = Reducers.replace({ a: 1 }, { a: 2 });
    expect(objResult).toEqual({ a: 2 });
  });

  test("concat reducer concatenates arrays", () => {
    const result = Reducers.concat([1, 2], [3, 4]);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  test("concat reducer handles empty arrays", () => {
    expect(Reducers.concat([], [1, 2])).toEqual([1, 2]);
    expect(Reducers.concat([1, 2], [])).toEqual([1, 2]);
    expect(Reducers.concat([], [])).toEqual([]);
  });

  test("merge reducer performs shallow object merge", () => {
    const current: Record<string, number> = { a: 1, b: 2 };
    const update: Record<string, number> = { b: 3, c: 4 };
    expect(Reducers.merge(current, update)).toEqual({ a: 1, b: 3, c: 4 });
  });

  test("mergeById reducer updates items by ID field", () => {
    interface Item {
      id: string;
      value: number;
    }

    const reducer = Reducers.mergeById<Item>("id");
    const result = reducer(
      [
        { id: "1", value: 10 },
        { id: "2", value: 20 },
      ],
      [
        { id: "2", value: 25 },
        { id: "3", value: 30 },
      ],
    );

    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ id: "1", value: 10 });
    expect(result).toContainEqual({ id: "2", value: 25 });
    expect(result).toContainEqual({ id: "3", value: 30 });
  });

  test("mergeById reducer merges properties of existing items", () => {
    interface Item {
      age?: number;
      id: string;
      name: string;
    }

    const reducer = Reducers.mergeById<Item>("id");
    const result = reducer(
      [{ id: "1", name: "Alice" }],
      [{ id: "1", name: "Alice", age: 30 }],
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "1", name: "Alice", age: 30 });
  });

  test("numeric and boolean reducers work", () => {
    expect(Reducers.max(5, 10)).toBe(10);
    expect(Reducers.max(-5, -10)).toBe(-5);
    expect(Reducers.min(5, 10)).toBe(5);
    expect(Reducers.min(-5, -10)).toBe(-10);
    expect(Reducers.sum(5, 10)).toBe(15);
    expect(Reducers.sum(-5, 10)).toBe(5);
    expect(Reducers.or(false, true)).toBe(true);
    expect(Reducers.and(true, false)).toBe(false);
  });

  test("ifDefined reducer only updates if value is defined", () => {
    expect(Reducers.ifDefined(10, 20)).toBe(20);
    expect(Reducers.ifDefined(10, null)).toBe(10);
    expect(Reducers.ifDefined(10, undefined)).toBe(10);
    expect(Reducers.ifDefined(10, 0)).toBe(0);
  });
});

describe("annotation factory", () => {
  test("creates annotation with default value", () => {
    const ann = annotation(42);
    expect(ann.default).toBe(42);
    expect(ann.reducer).toBeUndefined();
  });

  test("creates annotation with default value and reducer", () => {
    const ann = annotation(0, Reducers.sum);
    expect(ann.default).toBe(0);
    expect(ann.reducer).toBe(Reducers.sum);
  });

  test("creates annotation with factory function", () => {
    const ann = annotation(() => [1, 2, 3]);
    expect(typeof ann.default).toBe("function");
    expect((ann.default as () => number[])()).toEqual([1, 2, 3]);
  });
});

describe("getDefaultValue", () => {
  test("returns static default value", () => {
    expect(getDefaultValue(annotation(42))).toBe(42);
  });

  test("calls factory function for default value", () => {
    expect(getDefaultValue(annotation(() => ({ nested: "object" })))).toEqual({
      nested: "object",
    });
  });

  test("factory function creates new instances", () => {
    const ann = annotation(() => []);
    const value1 = getDefaultValue(ann);
    const value2 = getDefaultValue(ann);
    expect(value1).not.toBe(value2);
  });
});

describe("applyReducer", () => {
  test("uses custom reducer when provided", () => {
    const ann = annotation(0, Reducers.sum);
    expect(applyReducer(ann, 10, 5)).toBe(15);
  });

  test("falls back to replace when no reducer is provided", () => {
    expect(applyReducer(annotation(10), 10, 20)).toBe(20);
  });

  test("applies concat reducer to arrays", () => {
    const ann = annotation<string[]>([], Reducers.concat);
    expect(applyReducer(ann, ["a", "b"], ["c", "d"])).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});

describe("initializeState", () => {
  test("creates state with default values", () => {
    const state = initializeState({
      counter: annotation(0),
      items: annotation<string[]>([]),
      enabled: annotation(true),
    });

    expect(state).toEqual({
      counter: 0,
      items: [],
      enabled: true,
    });
  });

  test("calls factory functions for defaults", () => {
    const state = initializeState({
      timestamp: annotation(() => "2024-01-01"),
      list: annotation(() => [1, 2, 3]),
    });

    expect(state.timestamp).toBe("2024-01-01");
    expect(state.list).toEqual([1, 2, 3]);
  });

  test("creates independent state instances", () => {
    const schema = {
      items: annotation<string[]>(() => []),
    };

    const state1 = initializeState(schema);
    const state2 = initializeState(schema);
    state1.items.push("item1");

    expect(state1.items).toEqual(["item1"]);
    expect(state2.items).toEqual([]);
  });
});

describe("applyStateUpdate", () => {
  test("applies updates using reducers", () => {
    const result = applyStateUpdate(
      {
        counter: annotation(0, Reducers.sum),
        items: annotation<string[]>([], Reducers.concat),
        name: annotation(""),
      },
      {
        counter: 10,
        items: ["a"],
        name: "Alice",
      },
      {
        counter: 5,
        items: ["b", "c"],
        name: "Bob",
      },
    );

    expect(result.counter).toBe(15);
    expect(result.items).toEqual(["a", "b", "c"]);
    expect(result.name).toBe("Bob");
  });

  test("applies partial updates", () => {
    const result = applyStateUpdate(
      {
        a: annotation(0),
        b: annotation(0),
        c: annotation(0),
      },
      { a: 1, b: 2, c: 3 },
      { b: 20 },
    );

    expect(result).toEqual({ a: 1, b: 20, c: 3 });
  });

  test("allows updates to keys not in schema", () => {
    const result = applyStateUpdate(
      { defined: annotation(0) },
      { defined: 10 },
      { defined: 20, extra: 999 } as never,
    );

    expect(result as unknown as Record<string, unknown>).toEqual({
      defined: 20,
      extra: 999,
    });
  });

  test("preserves current state when update is empty", () => {
    const result = applyStateUpdate(
      { value: annotation(42) },
      { value: 100 },
      {},
    );

    expect(result).toEqual({ value: 100 });
  });

  test("handles complex mergeById reducer", () => {
    interface FeatureState {
      description: string;
      passes: boolean;
    }

    const result = applyStateUpdate(
      {
        features: annotation<FeatureState[]>(
          [],
          Reducers.mergeById<FeatureState>("description"),
        ),
      },
      {
        features: [
          { description: "feature1", passes: false },
          { description: "feature2", passes: true },
        ],
      },
      {
        features: [
          { description: "feature1", passes: true },
          { description: "feature3", passes: false },
        ],
      },
    );

    expect(result.features).toHaveLength(3);
    expect(result.features).toContainEqual({
      description: "feature1",
      passes: true,
    });
    expect(result.features).toContainEqual({
      description: "feature2",
      passes: true,
    });
    expect(result.features).toContainEqual({
      description: "feature3",
      passes: false,
    });
  });
});
