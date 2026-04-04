import { describe, expect, test } from "bun:test";

import {
  getElevatedPrivilegesHint,
  isPermissionError,
} from "@/commands/cli/permission-guidance.ts";

describe("isPermissionError", () => {
  test("detects standard permission-denied messages", () => {
    expect(isPermissionError("EACCES: permission denied, rename '/tmp/file' -> '/usr/local/bin/atomic'"))
      .toBe(true);
    expect(isPermissionError("EPERM: operation not permitted")).toBe(true);
    expect(isPermissionError("permission denied while removing binary")).toBe(true);
  });

  test("ignores unrelated failures", () => {
    expect(isPermissionError("404 not found")).toBe(false);
    expect(isPermissionError("rate limit exceeded")).toBe(false);
  });
});

describe("getElevatedPrivilegesHint", () => {
  test("builds update guidance for Unix installs", () => {
    expect(getElevatedPrivilegesHint("update", false)).toEqual([
      "",
      "Permission denied. Try running with elevated privileges:",
      "  sudo atomic update",
    ]);
  });

  test("builds uninstall guidance with manual fallback", () => {
    expect(getElevatedPrivilegesHint("uninstall", false, true)).toEqual([
      "",
      "Permission denied. Try running with elevated privileges:",
      "  sudo atomic uninstall",
      "",
      "Or manually delete the files shown above.",
    ]);
  });

  test("builds Windows guidance", () => {
    expect(getElevatedPrivilegesHint("update", true)).toEqual([
      "",
      "Permission denied. Try running with elevated privileges:",
      "  Run PowerShell as Administrator and try again",
    ]);
  });
});
