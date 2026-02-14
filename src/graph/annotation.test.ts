/**
 * Tests for state annotation system and reducer functions
 */

import { describe, expect, test } from "bun:test";
import {
  annotation,
  applyReducer,
  applyStateUpdate,
  getDefaultValue,
  initializeState,
  Reducers,
} from "./annotation.ts";

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
    const result1 = Reducers.concat([], [1, 2]);
    expect(result1).toEqual([1, 2]);
    
    const result2 = Reducers.concat([1, 2], []);
    expect(result2).toEqual([1, 2]);
    
    const result3 = Reducers.concat([], []);
    expect(result3).toEqual([]);
  });

  test("merge reducer performs shallow object merge", () => {
    const current: Record<string, number> = { a: 1, b: 2 };
    const update: Record<string, number> = { b: 3, c: 4 };
    const result = Reducers.merge(current, update);
    
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  test("mergeById reducer updates items by ID field", () => {
    interface Item {
      id: string;
      value: number;
    }
    
    const current: Item[] = [
      { id: "1", value: 10 },
      { id: "2", value: 20 },
    ];
    
    const update: Item[] = [
      { id: "2", value: 25 }, // Update existing
      { id: "3", value: 30 }, // Add new
    ];
    
    const reducer = Reducers.mergeById<Item>("id");
    const result = reducer(current, update);
    
    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ id: "1", value: 10 });
    expect(result).toContainEqual({ id: "2", value: 25 });
    expect(result).toContainEqual({ id: "3", value: 30 });
  });

  test("mergeById reducer merges properties of existing items", () => {
    interface Item {
      id: string;
      name: string;
      age?: number;
    }
    
    const current: Item[] = [{ id: "1", name: "Alice" }];
    const update: Item[] = [{ id: "1", name: "Alice", age: 30 }];
    
    const reducer = Reducers.mergeById<Item>("id");
    const result = reducer(current, update);
    
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "1", name: "Alice", age: 30 });
  });

  test("max reducer returns the maximum number", () => {
    expect(Reducers.max(5, 10)).toBe(10);
    expect(Reducers.max(10, 5)).toBe(10);
    expect(Reducers.max(-5, -10)).toBe(-5);
  });

  test("min reducer returns the minimum number", () => {
    expect(Reducers.min(5, 10)).toBe(5);
    expect(Reducers.min(10, 5)).toBe(5);
    expect(Reducers.min(-5, -10)).toBe(-10);
  });

  test("sum reducer adds numbers", () => {
    expect(Reducers.sum(5, 10)).toBe(15);
    expect(Reducers.sum(-5, 10)).toBe(5);
    expect(Reducers.sum(0, 0)).toBe(0);
  });

  test("or reducer performs logical OR", () => {
    expect(Reducers.or(true, true)).toBe(true);
    expect(Reducers.or(true, false)).toBe(true);
    expect(Reducers.or(false, true)).toBe(true);
    expect(Reducers.or(false, false)).toBe(false);
  });

  test("and reducer performs logical AND", () => {
    expect(Reducers.and(true, true)).toBe(true);
    expect(Reducers.and(true, false)).toBe(false);
    expect(Reducers.and(false, true)).toBe(false);
    expect(Reducers.and(false, false)).toBe(false);
  });

  test("ifDefined reducer only updates if value is defined", () => {
    expect(Reducers.ifDefined(10, 20)).toBe(20);
    expect(Reducers.ifDefined(10, null)).toBe(10);
    expect(Reducers.ifDefined(10, undefined)).toBe(10);
    expect(Reducers.ifDefined(10, 0)).toBe(0); // 0 is defined
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
    const ann = annotation(42);
    const value = getDefaultValue(ann);
    
    expect(value).toBe(42);
  });

  test("calls factory function for default value", () => {
    const ann = annotation(() => ({ nested: "object" }));
    const value = getDefaultValue(ann);
    
    expect(value).toEqual({ nested: "object" });
  });

  test("factory function creates new instances", () => {
    const ann = annotation(() => []);
    const value1 = getDefaultValue(ann);
    const value2 = getDefaultValue(ann);
    
    // Should be different instances
    expect(value1).not.toBe(value2);
  });
});

describe("applyReducer", () => {
  test("uses custom reducer when provided", () => {
    const ann = annotation(0, Reducers.sum);
    const result = applyReducer(ann, 10, 5);
    
    expect(result).toBe(15);
  });

  test("falls back to replace when no reducer is provided", () => {
    const ann = annotation(10);
    const result = applyReducer(ann, 10, 20);
    
    expect(result).toBe(20);
  });

  test("applies concat reducer to arrays", () => {
    const ann = annotation<string[]>([], Reducers.concat);
    const result = applyReducer(ann, ["a", "b"], ["c", "d"]);
    
    expect(result).toEqual(["a", "b", "c", "d"]);
  });
});

describe("initializeState", () => {
  test("creates state with default values", () => {
    const schema = {
      counter: annotation(0),
      items: annotation<string[]>([]),
      enabled: annotation(true),
    };
    
    const state = initializeState(schema);
    
    expect(state).toEqual({
      counter: 0,
      items: [],
      enabled: true,
    });
  });

  test("calls factory functions for defaults", () => {
    const schema = {
      timestamp: annotation(() => "2024-01-01"),
      list: annotation(() => [1, 2, 3]),
    };
    
    const state = initializeState(schema);
    
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
    const schema = {
      counter: annotation(0, Reducers.sum),
      items: annotation<string[]>([], Reducers.concat),
      name: annotation(""),
    };
    
    const current = {
      counter: 10,
      items: ["a"],
      name: "Alice",
    };
    
    const update = {
      counter: 5,
      items: ["b", "c"],
      name: "Bob",
    };
    
    const result = applyStateUpdate(schema, current, update);
    
    expect(result.counter).toBe(15); // sum
    expect(result.items).toEqual(["a", "b", "c"]); // concat
    expect(result.name).toBe("Bob"); // replace (default)
  });

  test("applies partial updates", () => {
    const schema = {
      a: annotation(0),
      b: annotation(0),
      c: annotation(0),
    };
    
    const current = { a: 1, b: 2, c: 3 };
    const update = { b: 20 };
    
    const result = applyStateUpdate(schema, current, update);
    
    expect(result).toEqual({ a: 1, b: 20, c: 3 });
  });

  test("allows updates to keys not in schema", () => {
    const schema = {
      defined: annotation(0),
    };
    
    const current = { defined: 10 };
    const update = { defined: 20, extra: 999 };
    
    // TypeScript doesn't allow extra keys, but at runtime it works
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = applyStateUpdate(schema, current, update as any);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(result as any).toEqual({ defined: 20, extra: 999 });
  });

  test("preserves current state when update is empty", () => {
    const schema = {
      value: annotation(42),
    };
    
    const current = { value: 100 };
    const update = {};
    
    const result = applyStateUpdate(schema, current, update);
    
    expect(result).toEqual({ value: 100 });
  });

  test("handles complex mergeById reducer", () => {
    interface Feature {
      description: string;
      passes: boolean;
    }
    
    const schema = {
      features: annotation<Feature[]>([], Reducers.mergeById<Feature>("description")),
    };
    
    const current = {
      features: [
        { description: "feature1", passes: false },
        { description: "feature2", passes: true },
      ],
    };
    
    const update = {
      features: [
        { description: "feature1", passes: true }, // Update existing
        { description: "feature3", passes: false }, // Add new
      ],
    };
    
    const result = applyStateUpdate(schema, current, update);
    
    expect(result.features).toHaveLength(3);
    expect(result.features).toContainEqual({ description: "feature1", passes: true });
    expect(result.features).toContainEqual({ description: "feature2", passes: true });
    expect(result.features).toContainEqual({ description: "feature3", passes: false });
  });
});
