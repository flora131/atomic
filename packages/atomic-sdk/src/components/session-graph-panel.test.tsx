/** @jsxImportSource @opentui/react */

import { test, expect, describe } from "bun:test";
import { isEnterKey } from "./session-graph-panel.tsx";

describe("isEnterKey", () => {
  test("accepts both OpenTUI Enter key aliases", () => {
    expect(isEnterKey("enter")).toBe(true);
    expect(isEnterKey("return")).toBe(true);
  });

  test("rejects non-Enter keys", () => {
    expect(isEnterKey("space")).toBe(false);
    expect(isEnterKey("q")).toBe(false);
  });
});
