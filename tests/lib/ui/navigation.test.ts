import { describe, expect, test } from "bun:test";
import { navigateUp, navigateDown } from "@/lib/ui/navigation.ts";

describe("navigateUp", () => {
  test("empty list returns 0", () => {
    expect(navigateUp(0, 0)).toBe(0);
  });

  test("from index 0 wraps to last item", () => {
    expect(navigateUp(0, 5)).toBe(4);
  });

  test("from middle goes up by one", () => {
    expect(navigateUp(3, 5)).toBe(2);
  });

  test("from last item goes to second-to-last", () => {
    expect(navigateUp(4, 5)).toBe(3);
  });

  test("single item list wraps from 0 to 0", () => {
    expect(navigateUp(0, 1)).toBe(0);
  });

  test("negative index wraps to last item", () => {
    // currentIndex <= 0 triggers wrap
    expect(navigateUp(-1, 5)).toBe(4);
  });
});

describe("navigateDown", () => {
  test("empty list returns 0", () => {
    expect(navigateDown(0, 0)).toBe(0);
  });

  test("from last item wraps to 0", () => {
    expect(navigateDown(4, 5)).toBe(0);
  });

  test("from middle goes down by one", () => {
    expect(navigateDown(2, 5)).toBe(3);
  });

  test("from index 0 goes to 1", () => {
    expect(navigateDown(0, 5)).toBe(1);
  });

  test("single item list wraps from 0 to 0", () => {
    expect(navigateDown(0, 1)).toBe(0);
  });

  test("index beyond bounds wraps to 0", () => {
    // currentIndex >= totalItems - 1 triggers wrap
    expect(navigateDown(10, 5)).toBe(0);
  });
});

describe("navigateUp and navigateDown round-trip", () => {
  test("down then up returns to original index", () => {
    const total = 5;
    for (let i = 0; i < total; i++) {
      const down = navigateDown(i, total);
      const backUp = navigateUp(down, total);
      expect(backUp).toBe(i);
    }
  });

  test("up then down returns to original index", () => {
    const total = 5;
    for (let i = 0; i < total; i++) {
      const up = navigateUp(i, total);
      const backDown = navigateDown(up, total);
      expect(backDown).toBe(i);
    }
  });

  test("full cycle down through all items returns to start", () => {
    const total = 4;
    let index = 0;
    for (let step = 0; step < total; step++) {
      index = navigateDown(index, total);
    }
    expect(index).toBe(0);
  });

  test("full cycle up through all items returns to start", () => {
    const total = 4;
    let index = 0;
    for (let step = 0; step < total; step++) {
      index = navigateUp(index, total);
    }
    expect(index).toBe(0);
  });
});
