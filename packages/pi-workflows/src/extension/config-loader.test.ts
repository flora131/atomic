/**
 * Tests for pure helpers in config-loader:
 *   - toDiscoveryConfig — maps WorkflowExtensionConfig to DiscoveryConfig
 *   - toScopedDiscoveryConfig — scope-aware DiscoveryConfig with provenance
 *   - withWorkflowDefaults — fills absent fields with RFC-specified defaults
 */

import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import {
  toDiscoveryConfig,
  toScopedDiscoveryConfig,
  withWorkflowDefaults,
  WORKFLOW_CONFIG_DEFAULTS,
} from "./config-loader.js";
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

// ---------------------------------------------------------------------------
// withWorkflowDefaults
// ---------------------------------------------------------------------------

describe("withWorkflowDefaults — empty config applies all defaults", () => {
  test("maxDepth defaults to 4", () => {
    expect(withWorkflowDefaults({}).maxDepth).toBe(WORKFLOW_CONFIG_DEFAULTS.maxDepth);
  });

  test("defaultConcurrency defaults to 4", () => {
    expect(withWorkflowDefaults({}).defaultConcurrency).toBe(
      WORKFLOW_CONFIG_DEFAULTS.defaultConcurrency,
    );
  });

  test("persistRuns defaults to true", () => {
    expect(withWorkflowDefaults({}).persistRuns).toBe(WORKFLOW_CONFIG_DEFAULTS.persistRuns);
  });

  test("statusFile defaults to false", () => {
    expect(withWorkflowDefaults({}).statusFile).toBe(WORKFLOW_CONFIG_DEFAULTS.statusFile);
  });

  test("resumeInFlight defaults to 'ask'", () => {
    expect(withWorkflowDefaults({}).resumeInFlight).toBe(
      WORKFLOW_CONFIG_DEFAULTS.resumeInFlight,
    );
  });

  test("workflows is undefined when absent from config", () => {
    expect(withWorkflowDefaults({}).workflows).toBeUndefined();
  });
});

describe("withWorkflowDefaults — explicit values are preserved", () => {
  test("maxDepth override is kept", () => {
    expect(withWorkflowDefaults({ maxDepth: 10 }).maxDepth).toBe(10);
  });

  test("defaultConcurrency override is kept", () => {
    expect(withWorkflowDefaults({ defaultConcurrency: 8 }).defaultConcurrency).toBe(8);
  });

  test("persistRuns false is preserved", () => {
    expect(withWorkflowDefaults({ persistRuns: false }).persistRuns).toBe(false);
  });

  test("statusFile true is preserved", () => {
    expect(withWorkflowDefaults({ statusFile: true }).statusFile).toBe(true);
  });

  test("resumeInFlight 'auto' is preserved", () => {
    expect(withWorkflowDefaults({ resumeInFlight: "auto" }).resumeInFlight).toBe("auto");
  });

  test("resumeInFlight 'never' is preserved", () => {
    expect(withWorkflowDefaults({ resumeInFlight: "never" }).resumeInFlight).toBe("never");
  });

  test("workflows map is passed through unchanged", () => {
    const wf = { deploy: { path: "/deploy.ts" } };
    expect(withWorkflowDefaults({ workflows: wf }).workflows).toEqual(wf);
  });
});

describe("withWorkflowDefaults — partial config: only absent fields get defaults", () => {
  test("only maxDepth set — remaining fields get defaults", () => {
    const result = withWorkflowDefaults({ maxDepth: 2 });
    expect(result.maxDepth).toBe(2);
    expect(result.defaultConcurrency).toBe(WORKFLOW_CONFIG_DEFAULTS.defaultConcurrency);
    expect(result.persistRuns).toBe(WORKFLOW_CONFIG_DEFAULTS.persistRuns);
    expect(result.statusFile).toBe(WORKFLOW_CONFIG_DEFAULTS.statusFile);
    expect(result.resumeInFlight).toBe(WORKFLOW_CONFIG_DEFAULTS.resumeInFlight);
  });

  test("only persistRuns set — tunables still get defaults", () => {
    const result = withWorkflowDefaults({ persistRuns: false });
    expect(result.persistRuns).toBe(false);
    expect(result.maxDepth).toBe(WORKFLOW_CONFIG_DEFAULTS.maxDepth);
    expect(result.defaultConcurrency).toBe(WORKFLOW_CONFIG_DEFAULTS.defaultConcurrency);
  });

  test("full config — all values come from config, none from defaults", () => {
    const config: WorkflowExtensionConfig = {
      maxDepth: 1,
      defaultConcurrency: 16,
      persistRuns: false,
      statusFile: true,
      resumeInFlight: "never",
      workflows: { wf: { path: "/x.ts" } },
    };
    const result = withWorkflowDefaults(config);
    expect(result.maxDepth).toBe(1);
    expect(result.defaultConcurrency).toBe(16);
    expect(result.persistRuns).toBe(false);
    expect(result.statusFile).toBe(true);
    expect(result.resumeInFlight).toBe("never");
    expect(result.workflows).toEqual({ wf: { path: "/x.ts" } });
  });
});

describe("withWorkflowDefaults — does not mutate input", () => {
  test("original config object is unchanged after call", () => {
    const config: WorkflowExtensionConfig = { maxDepth: 3 };
    withWorkflowDefaults(config);
    // Only maxDepth was set; no extra keys were added to the original
    expect(Object.keys(config)).toEqual(["maxDepth"]);
  });
});

describe("withWorkflowDefaults — WORKFLOW_CONFIG_DEFAULTS constants", () => {
  test("WORKFLOW_CONFIG_DEFAULTS.maxDepth is 4", () => {
    expect(WORKFLOW_CONFIG_DEFAULTS.maxDepth).toBe(4);
  });

  test("WORKFLOW_CONFIG_DEFAULTS.defaultConcurrency is 4", () => {
    expect(WORKFLOW_CONFIG_DEFAULTS.defaultConcurrency).toBe(4);
  });

  test("WORKFLOW_CONFIG_DEFAULTS.persistRuns is true", () => {
    expect(WORKFLOW_CONFIG_DEFAULTS.persistRuns).toBe(true);
  });

  test("WORKFLOW_CONFIG_DEFAULTS.statusFile is false", () => {
    expect(WORKFLOW_CONFIG_DEFAULTS.statusFile).toBe(false);
  });

  test("WORKFLOW_CONFIG_DEFAULTS.resumeInFlight is 'ask'", () => {
    expect(WORKFLOW_CONFIG_DEFAULTS.resumeInFlight).toBe("ask");
  });
});

// ---------------------------------------------------------------------------
// toScopedDiscoveryConfig
// ---------------------------------------------------------------------------

const PROJ_ROOT = "/home/user/myproject";
const HOME_DIR = "/home/user";
const GLOBAL_BASE = join(HOME_DIR, ".pi", "agent");
const OPTS = { projectRoot: PROJ_ROOT, homeDir: HOME_DIR };

describe("toScopedDiscoveryConfig — null inputs", () => {
  test("both null → empty object", () => {
    expect(toScopedDiscoveryConfig(null, null, OPTS)).toEqual({});
  });

  test("null globalConfig + null projectConfig → no projectWorkflows, no globalWorkflows", () => {
    const r = toScopedDiscoveryConfig(null, null, OPTS);
    expect("projectWorkflows" in r).toBe(false);
    expect("globalWorkflows" in r).toBe(false);
  });

  test("both null or empty workflows → empty object", () => {
    expect(toScopedDiscoveryConfig({ workflows: {} }, { workflows: {} }, OPTS)).toEqual({});
  });
});

describe("toScopedDiscoveryConfig — project-only", () => {
  test("projectConfig with absolute path → projectWorkflows with unchanged path", () => {
    const project: WorkflowExtensionConfig = { workflows: { wf: { path: "/abs/wf.ts" } } };
    const r = toScopedDiscoveryConfig(null, project, OPTS);
    expect(r).toEqual({ projectWorkflows: { wf: "/abs/wf.ts" } });
    expect("globalWorkflows" in r).toBe(false);
  });

  test("projectConfig with relative path → resolved under projectRoot", () => {
    const project: WorkflowExtensionConfig = { workflows: { deploy: { path: "workflows/deploy.ts" } } };
    const r = toScopedDiscoveryConfig(null, project, OPTS);
    expect(r.projectWorkflows).toEqual({ deploy: join(PROJ_ROOT, "workflows/deploy.ts") });
  });

  test("projectConfig with dot-relative path → resolved under projectRoot", () => {
    const project: WorkflowExtensionConfig = { workflows: { wf: { path: "./wf.ts" } } };
    const r = toScopedDiscoveryConfig(null, project, OPTS);
    expect(r.projectWorkflows).toEqual({ wf: join(PROJ_ROOT, "./wf.ts") });
  });
});

describe("toScopedDiscoveryConfig — global-only", () => {
  test("globalConfig with absolute path → globalWorkflows with unchanged path", () => {
    const global: WorkflowExtensionConfig = { workflows: { shared: { path: "/shared/wf.ts" } } };
    const r = toScopedDiscoveryConfig(global, null, OPTS);
    expect(r).toEqual({ globalWorkflows: { shared: "/shared/wf.ts" } });
    expect("projectWorkflows" in r).toBe(false);
  });

  test("globalConfig with relative path → resolved under <homeDir>/.pi/agent", () => {
    const global: WorkflowExtensionConfig = { workflows: { shared: { path: "workflows/shared.ts" } } };
    const r = toScopedDiscoveryConfig(global, null, OPTS);
    expect(r.globalWorkflows).toEqual({ shared: join(GLOBAL_BASE, "workflows/shared.ts") });
  });

  test("globalConfig with dot-relative path → resolved under <homeDir>/.pi/agent", () => {
    const global: WorkflowExtensionConfig = { workflows: { g: { path: "./g.ts" } } };
    const r = toScopedDiscoveryConfig(global, null, OPTS);
    expect(r.globalWorkflows).toEqual({ g: join(GLOBAL_BASE, "./g.ts") });
  });
});

describe("toScopedDiscoveryConfig — mixed global + project", () => {
  test("disjoint keys → both projectWorkflows and globalWorkflows populated", () => {
    const global: WorkflowExtensionConfig = { workflows: { g: { path: "/g/wf.ts" } } };
    const project: WorkflowExtensionConfig = { workflows: { p: { path: "/p/wf.ts" } } };
    const r = toScopedDiscoveryConfig(global, project, OPTS);
    expect(r.projectWorkflows).toEqual({ p: "/p/wf.ts" });
    expect(r.globalWorkflows).toEqual({ g: "/g/wf.ts" });
  });

  test("overlapping key → project wins; global entry for that key excluded from globalWorkflows", () => {
    const global: WorkflowExtensionConfig = { workflows: { shared: { path: "/g/shared.ts" }, "g-only": { path: "/g/only.ts" } } };
    const project: WorkflowExtensionConfig = { workflows: { shared: { path: "/p/shared.ts" } } };
    const r = toScopedDiscoveryConfig(global, project, OPTS);
    // project "shared" wins
    expect(r.projectWorkflows).toEqual({ shared: "/p/shared.ts" });
    // global "shared" excluded; "g-only" kept
    expect(r.globalWorkflows).toEqual({ "g-only": "/g/only.ts" });
  });

  test("all keys overlap → globalWorkflows absent", () => {
    const global: WorkflowExtensionConfig = { workflows: { wf: { path: "/g/wf.ts" } } };
    const project: WorkflowExtensionConfig = { workflows: { wf: { path: "/p/wf.ts" } } };
    const r = toScopedDiscoveryConfig(global, project, OPTS);
    expect(r.projectWorkflows).toEqual({ wf: "/p/wf.ts" });
    expect("globalWorkflows" in r).toBe(false);
  });

  test("relative global path and relative project path resolve to their respective bases", () => {
    const global: WorkflowExtensionConfig = { workflows: { g: { path: "g.ts" } } };
    const project: WorkflowExtensionConfig = { workflows: { p: { path: "p.ts" } } };
    const r = toScopedDiscoveryConfig(global, project, OPTS);
    expect(r.projectWorkflows).toEqual({ p: join(PROJ_ROOT, "p.ts") });
    expect(r.globalWorkflows).toEqual({ g: join(GLOBAL_BASE, "g.ts") });
  });

  test("absolute paths in both scopes are kept as-is", () => {
    const global: WorkflowExtensionConfig = { workflows: { g: { path: "/abs/global/g.ts" } } };
    const project: WorkflowExtensionConfig = { workflows: { p: { path: "/abs/project/p.ts" } } };
    const r = toScopedDiscoveryConfig(global, project, OPTS);
    expect(r.projectWorkflows).toEqual({ p: "/abs/project/p.ts" });
    expect(r.globalWorkflows).toEqual({ g: "/abs/global/g.ts" });
  });
});

describe("toScopedDiscoveryConfig — does not include non-workflow config fields", () => {
  test("only projectWorkflows/globalWorkflows appear in result", () => {
    const global: WorkflowExtensionConfig = { maxDepth: 8, workflows: { g: { path: "/g.ts" } } };
    const project: WorkflowExtensionConfig = { persistRuns: false, workflows: { p: { path: "/p.ts" } } };
    const r = toScopedDiscoveryConfig(global, project, OPTS);
    const keys = Object.keys(r).sort();
    expect(keys).toEqual(["globalWorkflows", "projectWorkflows"]);
  });
});

