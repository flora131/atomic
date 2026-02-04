/**
 * Tests for Lazy Initialization Utility
 */

import { test, expect, describe } from "bun:test";
import { lazy } from "../../src/util/lazy.ts";

describe("lazy", () => {
  describe("basic functionality", () => {
    test("computes value only once", () => {
      let callCount = 0;
      const getValue = lazy(() => {
        callCount++;
        return "computed";
      });

      // First call should compute
      expect(getValue()).toBe("computed");
      expect(callCount).toBe(1);

      // Subsequent calls should not recompute
      expect(getValue()).toBe("computed");
      expect(getValue()).toBe("computed");
      expect(callCount).toBe(1);
    });

    test("returns same cached value on subsequent calls", () => {
      const obj = { id: Math.random() };
      const getValue = lazy(() => obj);

      const result1 = getValue();
      const result2 = getValue();
      const result3 = getValue();

      // Should be the exact same object reference
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
      expect(result1).toBe(obj);
    });

    test("handles different return types", () => {
      // Number
      const getNumber = lazy(() => 42);
      expect(getNumber()).toBe(42);

      // String
      const getString = lazy(() => "hello");
      expect(getString()).toBe("hello");

      // Array
      const arr = [1, 2, 3];
      const getArray = lazy(() => arr);
      expect(getArray()).toBe(arr);

      // Null
      const getNull = lazy(() => null);
      expect(getNull()).toBeNull();

      // Undefined
      const getUndefined = lazy(() => undefined);
      expect(getUndefined()).toBeUndefined();
    });
  });

  describe("reset", () => {
    test("allows recomputation after reset", () => {
      let callCount = 0;
      const getValue = lazy(() => {
        callCount++;
        return `value-${callCount}`;
      });

      // First computation
      expect(getValue()).toBe("value-1");
      expect(callCount).toBe(1);

      // Cached value
      expect(getValue()).toBe("value-1");
      expect(callCount).toBe(1);

      // Reset and recompute
      getValue.reset();
      expect(getValue()).toBe("value-2");
      expect(callCount).toBe(2);

      // Cached again
      expect(getValue()).toBe("value-2");
      expect(callCount).toBe(2);
    });

    test("reset can be called multiple times", () => {
      let callCount = 0;
      const getValue = lazy(() => ++callCount);

      expect(getValue()).toBe(1);
      getValue.reset();
      expect(getValue()).toBe(2);
      getValue.reset();
      expect(getValue()).toBe(3);
      getValue.reset();
      expect(getValue()).toBe(4);
    });

    test("reset before first call works correctly", () => {
      let callCount = 0;
      const getValue = lazy(() => {
        callCount++;
        return "value";
      });

      // Reset before ever calling
      getValue.reset();
      expect(callCount).toBe(0);

      // First call still works
      expect(getValue()).toBe("value");
      expect(callCount).toBe(1);
    });
  });

  describe("async lazy function support", () => {
    test("works with async factory function", async () => {
      let callCount = 0;
      const getValue = lazy(async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "async-value";
      });

      // First call returns a promise
      const result1 = await getValue();
      expect(result1).toBe("async-value");
      expect(callCount).toBe(1);

      // Subsequent calls return the same cached promise
      const result2 = await getValue();
      expect(result2).toBe("async-value");
      expect(callCount).toBe(1);
    });

    test("cached promise is the same reference", async () => {
      const getValue = lazy(async () => {
        return { data: "test" };
      });

      const promise1 = getValue();
      const promise2 = getValue();

      // Should be the exact same promise
      expect(promise1).toBe(promise2);

      const result1 = await promise1;
      const result2 = await promise2;
      expect(result1).toBe(result2);
    });

    test("reset works with async functions", async () => {
      let callCount = 0;
      const getValue = lazy(async () => {
        callCount++;
        return `async-${callCount}`;
      });

      expect(await getValue()).toBe("async-1");
      expect(await getValue()).toBe("async-1");

      getValue.reset();

      expect(await getValue()).toBe("async-2");
      expect(await getValue()).toBe("async-2");
    });
  });
});
