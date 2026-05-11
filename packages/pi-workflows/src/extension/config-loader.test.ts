/**
 * Tests for toDiscoveryConfig — pure mapping helper from WorkflowExtensionConfig
 * to DiscoveryConfig shape accepted by discoverWorkflows().
 */

import { test, expect, describe } from "bun:test";
import { toDiscoveryConfig } from "./config-loader.js";
import type { WorkflowExtensionConfig } from "./config-loader.js";

describe("toDiscoveryConfig", () => {
  test("returns empty object when config has no workflows field", () => {
    const config: WorkflowExtensionConfig = {};
    expect(toDiscoveryConfig(config)).toEqual({});
  });

  test("returns empty object when config.workflows is empty record", () => {
    const config: WorkflowExtensionConfig = { workflows: {} };
    expect(toDiscoveryConfig(config)).toEqual({});
  });

  test("maps single workflow entry to projectWorkflows record", () => {
    const config: WorkflowExtensionConfig = {
      workflows: {
        "my-workflow": { path: "/abs/my-workflow.ts" },
      },
    };
    const result = toDiscoveryConfig(config);
    expect(result).toEqual({
      projectWorkflows: { "my-workflow": "/abs/my-workflow.ts" },
    });
  });

  test("maps multiple workflow entries preserving all names", () => {
    const config: WorkflowExtensionConfig = {
      workflows: {
        alpha: { path: "./alpha.ts" },
        beta: { path: "/global/beta.js" },
        gamma: { path: "relative/gamma.mjs" },
      },
    };
    const result = toDiscoveryConfig(config);
    expect(result).toEqual({
      projectWorkflows: {
        alpha: "./alpha.ts",
        beta: "/global/beta.js",
        gamma: "relative/gamma.mjs",
      },
    });
  });

  test("omits globalWorkflows — all entries map to projectWorkflows", () => {
    const config: WorkflowExtensionConfig = {
      workflows: { wf: { path: "/wf.ts" } },
    };
    const result = toDiscoveryConfig(config);
    expect("globalWorkflows" in result).toBe(false);
    expect(result.projectWorkflows).toBeDefined();
  });

  test("does not include other config fields in output", () => {
    const config: WorkflowExtensionConfig = {
      maxDepth: 8,
      defaultConcurrency: 2,
      persistRuns: false,
      statusFile: true,
      resumeInFlight: "auto",
      workflows: { wf: { path: "/wf.ts" } },
    };
    const result = toDiscoveryConfig(config);
    // Only projectWorkflows in result
    expect(Object.keys(result)).toEqual(["projectWorkflows"]);
    expect(result.projectWorkflows).toEqual({ wf: "/wf.ts" });
  });

  test("result projectWorkflows is a Record<string, string> (name → path)", () => {
    const config: WorkflowExtensionConfig = {
      workflows: {
        "deploy-prod": { path: "/workflows/deploy-prod.ts" },
      },
    };
    const result = toDiscoveryConfig(config);
    const pw = result.projectWorkflows;
    expect(typeof pw).toBe("object");
    expect(Array.isArray(pw)).toBe(false);
    expect(pw).not.toBeNull();
    // Each value is a string path
    for (const val of Object.values(pw as Record<string, string>)) {
      expect(typeof val).toBe("string");
    }
  });
});
