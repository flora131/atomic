import { test } from "bun:test";
import assert from "node:assert/strict";
import factory from "../../src/extension/index.js";

test("extension factory is a function", () => {
  assert.equal(typeof factory, "function");
});

test("extension factory runs without error (no-op)", () => {
  // Phase A: factory accepts any API object and does nothing.
  assert.doesNotThrow(() => factory({}));
});
