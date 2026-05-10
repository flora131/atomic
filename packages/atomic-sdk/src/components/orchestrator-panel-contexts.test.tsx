import { test, expect } from "bun:test";
import { StoreContext, ThemeContext } from "./orchestrator-panel-contexts.ts";

test("StoreContext default value is null", () => {
  expect((StoreContext as { _currentValue?: unknown })._currentValue).toBeNull();
});

test("ThemeContext default value is null", () => {
  expect((ThemeContext as { _currentValue?: unknown })._currentValue).toBeNull();
});
