import { test, expect, describe } from "bun:test";
import {
  MissingDependencyError,
  WorkflowNotCompiledError,
  InvalidWorkflowError,
  IncompatibleSDKError,
  SessionNotFoundError,
  NoDispatcherError,
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

describe("SessionNotFoundError", () => {
  test("sets name, id, and message", () => {
    const err = new SessionNotFoundError("atomic-wf-claude-ralph-deadbeef");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SessionNotFoundError");
    expect(err.id).toBe("atomic-wf-claude-ralph-deadbeef");
    expect(err.message).toBe("session not found: atomic-wf-claude-ralph-deadbeef");
  });
});

describe("IncompatibleSDKError", () => {
  test("sets name, versions, and message", () => {
    const err = new IncompatibleSDKError("/tmp/wf.ts", "2.0.0", "1.4.0");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("IncompatibleSDKError");
    expect(err.path).toBe("/tmp/wf.ts");
    expect(err.requiredVersion).toBe("2.0.0");
    expect(err.currentVersion).toBe("1.4.0");
    expect(err.message).toContain("/tmp/wf.ts");
    expect(err.message).toContain("v2.0.0");
    expect(err.message).toContain("v1.4.0");
    expect(err.message).toContain("Update Atomic");
  });
});

describe("NoDispatcherError", () => {
  test("is instanceof Error", () => {
    const err = new NoDispatcherError({ searchedFor: ["@bastani/atomic-sdk/cli (host-bun)"] });
    expect(err).toBeInstanceOf(Error);
  });

  test("name is NoDispatcherError", () => {
    const err = new NoDispatcherError({ searchedFor: [] });
    expect(err.name).toBe("NoDispatcherError");
  });

  test("searchedFor matches input", () => {
    const searched = ["@bastani/atomic-sdk/cli (host-bun)"];
    const err = new NoDispatcherError({ searchedFor: searched });
    expect(err.searchedFor).toEqual(searched);
  });

  test("message contains 'runWorkflow() could not locate the atomic SDK dispatcher.'", () => {
    const err = new NoDispatcherError({ searchedFor: ["@bastani/atomic-sdk/cli (host-bun)"] });
    expect(err.message).toContain("runWorkflow() could not locate the atomic SDK dispatcher.");
  });

  test("message contains 'Searched:' with joined list", () => {
    const err = new NoDispatcherError({
      searchedFor: ["@bastani/atomic-sdk/cli (host-bun)"],
    });
    expect(err.message).toContain(
      "Searched: @bastani/atomic-sdk/cli (host-bun).",
    );
  });

  test("message contains pathToAtomicExecutable hint", () => {
    const err = new NoDispatcherError({ searchedFor: [] });
    expect(err.message).toContain("pathToAtomicExecutable");
    expect(err.message).toContain("auto-default to `process.execPath`");
  });

  test("searchedFor is readonly (frozen shape)", () => {
    const arr = ["@bastani/atomic-sdk/cli (host-bun)"] as const;
    const err = new NoDispatcherError({ searchedFor: arr });
    expect(Array.isArray(err.searchedFor)).toBe(true);
    expect(err.searchedFor[0]).toBe("@bastani/atomic-sdk/cli (host-bun)");
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
