import { test, expect, describe } from "bun:test";
import {
  MissingDependencyError,
  WorkflowNotCompiledError,
  InvalidWorkflowError,
  errorMessage,
} from "./errors";

describe("MissingDependencyError", () => {
  test("sets name, dependency, and message", () => {
    const err = new MissingDependencyError("tmux");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MissingDependencyError");
    expect(err.dependency).toBe("tmux");
    expect(err.message).toBe("Required dependency not found: tmux");
  });

  test.each(["tmux", "psmux", "bun"] as const)("accepts %s", (dep) => {
    const err = new MissingDependencyError(dep);
    expect(err.message).toContain(dep);
  });
});

describe("WorkflowNotCompiledError", () => {
  test("sets name, path, and message", () => {
    const err = new WorkflowNotCompiledError("/tmp/wf.ts");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WorkflowNotCompiledError");
    expect(err.path).toBe("/tmp/wf.ts");
    expect(err.message).toContain("Workflow at /tmp/wf.ts was defined but not compiled");
    expect(err.message).toContain(".compile()");
  });
});

describe("InvalidWorkflowError", () => {
  test("sets name, path, and message", () => {
    const err = new InvalidWorkflowError("/tmp/bad.ts");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InvalidWorkflowError");
    expect(err.path).toBe("/tmp/bad.ts");
    expect(err.message).toContain("/tmp/bad.ts does not export a valid WorkflowDefinition");
  });
});

describe("errorMessage", () => {
  test("extracts message from Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  test("stringifies non-Error values", () => {
    expect(errorMessage("oops")).toBe("oops");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
