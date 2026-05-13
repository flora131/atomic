/**
 * Focused tests for doctor.ts — buildDoctorReport.
 *
 * Uses mock DiscoveryResult and DoctorSiblingStatus objects so the report
 * builder can be exercised without I/O or bundled workflow loading.
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { buildDoctorReport } from "../../src/extension/doctor.js";
import type { DoctorSiblingStatus } from "../../src/extension/doctor.js";
import { createRegistry } from "../../src/workflows/registry.js";
import type { DiscoveryResult } from "../../src/extension/discovery.js";
import type { ConfigLoadResult } from "../../src/extension/config-loader.js";
import factory, {
  type ExtensionAPI,
  type PiCommandOptions,
} from "../../src/extension/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const noSiblings: DoctorSiblingStatus = {
  taskDelegation: false,
  mcpScopeEvents: false,
  sessionNaming: false,
  hil: false,
  uiCustom: false,
  shortcut: false,
  execAbortable: false,
  persistenceAppendEntry: false,
  promptAdapter: false,
  completeAdapter: false,
  subagentAdapterVia: "unavailable",
};

const allSiblings: DoctorSiblingStatus = {
  taskDelegation: true,
  mcpScopeEvents: true,
  sessionNaming: true,
  hil: true,
  uiCustom: true,
  shortcut: true,
  execAbortable: true,
  persistenceAppendEntry: true,
  promptAdapter: true,
  completeAdapter: true,
  subagentAdapterVia: "task tool",
};

function makeDiscovery(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    registry: createRegistry(),
    sources: [],
    errors: [],
    ...overrides,
  };
}

interface RegisteredCommand {
  name: string;
  options: PiCommandOptions;
}

function makeMockApi(extras: Partial<ExtensionAPI> = {}): ExtensionAPI & { commands: RegisteredCommand[] } {
  const commands: RegisteredCommand[] = [];
  return {
    commands,
    registerCommand(name: string, options: PiCommandOptions) {
      commands.push({ name, options });
    },
    registerTool: () => undefined,
    registerMessageRenderer: () => undefined,
    registerFlag: () => undefined,
    ...extras,
  } as ExtensionAPI & { commands: RegisteredCommand[] };
}

// ---------------------------------------------------------------------------
// Header / structure
// ---------------------------------------------------------------------------

describe("buildDoctorReport — header", () => {
  test("starts with 'atomic-workflows doctor report'", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings);
    assert.equal(report.startsWith("atomic-workflows doctor report"), true);
  });

  test("contains separator line", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings);
    assert.ok(report.includes("──────────────────────────────"));
  });

  test("does NOT contain 'Phase B stub'", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings);
    assert.ok(!report.includes("Phase B stub"));
  });

  test("does NOT contain 'Executor: not yet implemented'", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings);
    assert.ok(!report.includes("Executor: not yet implemented"));
  });

  test("does NOT contain 'availability check not yet wired'", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings);
    assert.ok(!report.includes("availability check not yet wired"));
  });
});

// ---------------------------------------------------------------------------
// Registry count
// ---------------------------------------------------------------------------

describe("buildDoctorReport — registry count", () => {
  test("shows 0 workflows for empty registry", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings);
    assert.ok(report.includes("Registry: 0 workflow(s) loaded"));
  });

  test("shows correct count from registry.names()", () => {
    const discovery = makeDiscovery({
      sources: [
        { id: "alpha", kind: "bundled", name: "Alpha" },
        { id: "beta", kind: "bundled", name: "Beta" },
      ],
    });
    const report = buildDoctorReport(discovery, noSiblings);
    // registry is empty in this fixture; sources are listed separately
    assert.ok(report.includes("Registry: 0 workflow(s) loaded"));
    assert.ok(report.includes("Bundled sources (2):"));
  });
});

// ---------------------------------------------------------------------------
// Bundled sources
// ---------------------------------------------------------------------------

describe("buildDoctorReport — bundled sources", () => {
  test("shows '(none)' when no sources", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings);
    assert.ok(report.includes("Bundled sources: (none)"));
  });

  test("lists each source with kind, id, and name", () => {
    const discovery = makeDiscovery({
      sources: [
        { id: "my-workflow", kind: "bundled", name: "My Workflow" },
      ],
    });
    const report = buildDoctorReport(discovery, noSiblings);
    assert.ok(report.includes("[bundled]"));
    assert.ok(report.includes("my-workflow"));
    assert.ok(report.includes("My Workflow"));
  });

  test("shows count in header for multiple sources", () => {
    const discovery = makeDiscovery({
      sources: [
        { id: "wf-a", kind: "bundled", name: "Wf A" },
        { id: "wf-b", kind: "bundled", name: "Wf B" },
        { id: "wf-c", kind: "bundled", name: "Wf C" },
      ],
    });
    const report = buildDoctorReport(discovery, noSiblings);
    assert.ok(report.includes("Bundled sources (3):"));
  });
});

// ---------------------------------------------------------------------------
// Discovery diagnostics
// ---------------------------------------------------------------------------

describe("buildDoctorReport — discovery diagnostics", () => {
  test("shows '(none)' when no errors", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings);
    assert.ok(report.includes("Discovery diagnostics: (none)"));
  });

  test("lists each error with level and code", () => {
    const discovery = makeDiscovery({
      errors: [
        {
          level: "error",
          code: "INVALID_DEFINITION",
          message: "export \"badWf\" rejected: missing run function",
          source: "badWf",
        },
      ],
    });
    const report = buildDoctorReport(discovery, noSiblings);
    assert.ok(report.includes("[error]"));
    assert.ok(report.includes("INVALID_DEFINITION"));
    assert.ok(report.includes("badWf"));
  });

  test("lists warn-level duplicate diagnostic", () => {
    const discovery = makeDiscovery({
      errors: [
        {
          level: "warn",
          code: "DUPLICATE_NAME",
          message: 'export "dupWf" skipped: normalizedName "dup" already registered',
          source: "dupWf",
        },
      ],
    });
    const report = buildDoctorReport(discovery, noSiblings);
    assert.ok(report.includes("[warn]"));
    assert.ok(report.includes("DUPLICATE_NAME"));
  });

  test("shows count in header for multiple diagnostics", () => {
    const discovery = makeDiscovery({
      errors: [
        { level: "error", code: "INVALID_DEFINITION", message: "msg1", source: "a" },
        { level: "warn", code: "DUPLICATE_NAME", message: "msg2", source: "b" },
      ],
    });
    const report = buildDoctorReport(discovery, noSiblings);
    assert.ok(report.includes("Discovery diagnostics (2):"));
  });
});

// ---------------------------------------------------------------------------
// Runtime capability availability
// ---------------------------------------------------------------------------

describe("buildDoctorReport — siblings", () => {
  test("shows unavailable runtime capabilities when none present", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings);
    assert.ok(report.includes("task delegation — unavailable"));
    assert.ok(report.includes("session naming  — unavailable"));
  });

  test("shows available/present runtime capabilities when configured", () => {
    const report = buildDoctorReport(makeDiscovery(), allSiblings);
    assert.ok(report.includes("task delegation — available"));
    assert.ok(report.includes("session naming  — present"));
  });

  test("shows mixed availability correctly", () => {
    const mixed: DoctorSiblingStatus = {
      taskDelegation: true,
      mcpScopeEvents: false,
      sessionNaming: true,
      hil: false,
      uiCustom: false,
      shortcut: false,
      execAbortable: false,
      persistenceAppendEntry: false,
      promptAdapter: false,
      completeAdapter: false,
      subagentAdapterVia: "unavailable",
    };
    const report = buildDoctorReport(makeDiscovery(), mixed);
    assert.ok(report.includes("task delegation — available"));
    assert.ok(report.includes("mcp scope evts  — unknown"));
    assert.ok(report.includes("session naming  — present"));
  });
});

// ---------------------------------------------------------------------------
// Integration: /workflows-doctor execute via MockExtensionAPI
// ---------------------------------------------------------------------------

describe("/workflows-doctor execute — integration", () => {
  test("produces multi-line output containing header", async () => {
    const api = makeMockApi();
    factory(api);
    const cmd = api.commands.find((c) => c.name === "workflows-doctor");
    assert.notEqual(cmd, undefined);
    const messages: string[] = [];
    await cmd!.options.handler("", { ui: { notify: (m: string) => messages.push(m) } });
    const combined = messages.join("\n");
    assert.ok(combined.includes("atomic-workflows doctor report"));
  });

  test("shows 'Registry:' line with number", async () => {
    const api = makeMockApi();
    factory(api);
    const cmd = api.commands.find((c) => c.name === "workflows-doctor");
    const messages: string[] = [];
    await cmd!.options.handler("", { ui: { notify: (m: string) => messages.push(m) } });
    const combined = messages.join("\n");
    assert.match(combined, /Registry: \d+ workflow\(s\) loaded/);
  });

  test("shows 'Discovery diagnostics:' section", async () => {
    const api = makeMockApi();
    factory(api);
    const cmd = api.commands.find((c) => c.name === "workflows-doctor");
    const messages: string[] = [];
    await cmd!.options.handler("", { ui: { notify: (m: string) => messages.push(m) } });
    const combined = messages.join("\n");
    assert.ok(combined.includes("Discovery diagnostics:"));
  });

  test("shows 'Capabilities:' section", async () => {
    const api = makeMockApi();
    factory(api);
    const cmd = api.commands.find((c) => c.name === "workflows-doctor");
    const messages: string[] = [];
    await cmd!.options.handler("", { ui: { notify: (m: string) => messages.push(m) } });
    const combined = messages.join("\n");
    assert.ok(combined.includes("Capabilities:"));
  });

  test("task delegation shows 'available' when callTool is present", async () => {
    const api = makeMockApi({ callTool: async () => "ok" });
    factory(api);
    const cmd = api.commands.find((c) => c.name === "workflows-doctor");
    const messages: string[] = [];
    await cmd!.options.handler("", { ui: { notify: (m: string) => messages.push(m) } });
    assert.ok(messages.join("\n").includes("task delegation — available"));
  });

  test("task delegation shows 'unavailable' when callTool is absent", async () => {
    const api = makeMockApi();
    factory(api);
    const cmd = api.commands.find((c) => c.name === "workflows-doctor");
    const messages: string[] = [];
    await cmd!.options.handler("", { ui: { notify: (m: string) => messages.push(m) } });
    assert.ok(messages.join("\n").includes("task delegation — unavailable"));
  });

  test("session naming shows 'present' when setSessionName present", async () => {
    const api = makeMockApi({ setSessionName: () => undefined });
    factory(api);
    const cmd = api.commands.find((c) => c.name === "workflows-doctor");
    const messages: string[] = [];
    await cmd!.options.handler("", { ui: { notify: (m: string) => messages.push(m) } });
    assert.ok(messages.join("\n").includes("session naming  — present"));
  });

  test("does NOT say 'Phase B stub'", async () => {
    const api = makeMockApi();
    factory(api);
    const cmd = api.commands.find((c) => c.name === "workflows-doctor");
    const messages: string[] = [];
    await cmd!.options.handler("", { ui: { notify: (m: string) => messages.push(m) } });
    assert.ok(!messages.join("\n").includes("Phase B stub"));
  });

  test("does NOT say 'Executor: not yet implemented'", async () => {
    const api = makeMockApi();
    factory(api);
    const cmd = api.commands.find((c) => c.name === "workflows-doctor");
    const messages: string[] = [];
    await cmd!.options.handler("", { ui: { notify: (m: string) => messages.push(m) } });
    assert.ok(!messages.join("\n").includes("Executor: not yet implemented"));
  });
});

// ---------------------------------------------------------------------------
// Config diagnostics section
// ---------------------------------------------------------------------------

describe("buildDoctorReport — config diagnostics", () => {
  test("shows '(not loaded)' when configLoad is undefined", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings);
    assert.ok(report.includes("Config diagnostics: (not loaded)"));
  });

  test("shows '(not loaded)' when configLoad is null", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings, null);
    assert.ok(report.includes("Config diagnostics: (not loaded)"));
  });

  test("shows '(none)' when configLoad has no diagnostics", () => {
    const configLoad: ConfigLoadResult = { config: null, globalConfig: null, projectConfig: null, diagnostics: [] };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    assert.ok(report.includes("Config diagnostics: (none)"));
  });

  test("lists config diagnostic with level, code, source, and message", () => {
    const configLoad: ConfigLoadResult = {
      config: null,
      globalConfig: null,
      projectConfig: null,
      diagnostics: [
        {
          level: "error",
          code: "CONFIG_INVALID",
          message: "Invalid JSON in config file: Unexpected token",
          source: "/project/.omp/extensions/workflow/config.json",
        },
      ],
    };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    assert.ok(report.includes("Config diagnostics (1):"));
    assert.ok(report.includes("[error]"));
    assert.ok(report.includes("CONFIG_INVALID"));
    assert.ok(report.includes("/project/.omp/extensions/workflow/config.json"));
    assert.ok(report.includes("Invalid JSON in config file"));
  });

  test("shows count for multiple config diagnostics", () => {
    const configLoad: ConfigLoadResult = {
      config: null,
      globalConfig: null,
      projectConfig: null,
      diagnostics: [
        { level: "error", code: "CONFIG_INVALID", message: "err1", source: "/a.json" },
        { level: "error", code: "CONFIG_INVALID", message: "err2", source: "/b.json" },
      ],
    };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    assert.ok(report.includes("Config diagnostics (2):"));
  });

  test("shows diagnostic without source when source absent", () => {
    const configLoad: ConfigLoadResult = {
      config: null,
      globalConfig: null,
      projectConfig: null,
      diagnostics: [
        { level: "error", code: "CONFIG_INVALID", message: "some error" },
      ],
    };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    assert.ok(report.includes("CONFIG_INVALID: some error"));
  });
});

// ---------------------------------------------------------------------------
// Tunables section
// ---------------------------------------------------------------------------

describe("buildDoctorReport — tunables", () => {
  test("shows default tunables when config is null", () => {
    const configLoad: ConfigLoadResult = { config: null, globalConfig: null, projectConfig: null, diagnostics: [] };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    assert.ok(report.includes("Tunables:"));
    assert.ok(report.includes("persistRuns        — true"));
    assert.ok(report.includes("resumeInFlight     — ask"));
    assert.ok(report.includes("defaultConcurrency — 4"));
    assert.ok(report.includes("maxDepth           — 4"));
    assert.ok(report.includes("statusFile         — false"));
  });

  test("shows default tunables when configLoad is undefined", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings);
    assert.ok(report.includes("Tunables:"));
    assert.ok(report.includes("persistRuns        — true"));
    assert.ok(report.includes("resumeInFlight     — ask"));
    assert.ok(report.includes("defaultConcurrency — 4"));
    assert.ok(report.includes("maxDepth           — 4"));
    assert.ok(report.includes("statusFile         — false"));
  });

  test("shows overridden tunables from config", () => {
    const configLoad: ConfigLoadResult = {
      config: {
        persistRuns: false,
        resumeInFlight: "auto",
        defaultConcurrency: 8,
        maxDepth: 2,
        statusFile: true,
      },
      globalConfig: null,
      projectConfig: null,
      diagnostics: [],
    };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    assert.ok(report.includes("persistRuns        — false"));
    assert.ok(report.includes("resumeInFlight     — auto"));
    assert.ok(report.includes("defaultConcurrency — 8"));
    assert.ok(report.includes("maxDepth           — 2"));
    assert.ok(report.includes("statusFile         — true"));
  });

  test("shows partial overrides; unset fields fall back to defaults", () => {
    const configLoad: ConfigLoadResult = {
      config: { maxDepth: 10 },
      globalConfig: null,
      projectConfig: null,
      diagnostics: [],
    };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    assert.ok(report.includes("maxDepth           — 10"));
    assert.ok(report.includes("persistRuns        — true"));
    assert.ok(report.includes("defaultConcurrency — 4"));
  });
});

// ---------------------------------------------------------------------------
// Configured workflow entries section
// ---------------------------------------------------------------------------

describe("buildDoctorReport — configured workflows", () => {
  test("shows '(none configured)' when config has no workflows", () => {
    const configLoad: ConfigLoadResult = { config: {}, globalConfig: null, projectConfig: null, diagnostics: [] };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    assert.ok(report.includes("Configured workflows: (none configured)"));
  });

  test("shows '(none configured)' when configLoad is undefined", () => {
    const report = buildDoctorReport(makeDiscovery(), noSiblings);
    assert.ok(report.includes("Configured workflows: (none configured)"));
  });

  test("lists each configured workflow with name and path", () => {
    const configLoad: ConfigLoadResult = {
      config: {
        workflows: {
          "my-workflow": { path: "./workflows/my-workflow.ts" },
        },
      },
      globalConfig: null,
      projectConfig: null,
      diagnostics: [],
    };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    assert.ok(report.includes("Configured workflows (1):"));
    assert.ok(report.includes("my-workflow → ./workflows/my-workflow.ts"));
  });

  test("lists multiple configured workflows", () => {
    const configLoad: ConfigLoadResult = {
      config: {
        workflows: {
          alpha: { path: "/abs/alpha.ts" },
          beta: { path: "./beta.ts" },
        },
      },
      globalConfig: null,
      projectConfig: null,
      diagnostics: [],
    };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    assert.ok(report.includes("Configured workflows (2):"));
    assert.ok(report.includes("alpha → /abs/alpha.ts"));
    assert.ok(report.includes("beta → ./beta.ts"));
  });

  test("does NOT print file contents — only name and path", () => {
    const configLoad: ConfigLoadResult = {
      config: {
        workflows: {
          secret: { path: "./secret-workflow.ts" },
        },
      },
      globalConfig: null,
      projectConfig: null,
      diagnostics: [],
    };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    // Only path, not any file content
    assert.ok(report.includes("secret → ./secret-workflow.ts"));
    assert.ok(!report.includes("FILE_CONTENTS"));
  });
});

// ---------------------------------------------------------------------------
// Section ordering
// ---------------------------------------------------------------------------

describe("buildDoctorReport — section ordering", () => {
  test("config diagnostics appears before tunables", () => {
    const configLoad: ConfigLoadResult = { config: null, globalConfig: null, projectConfig: null, diagnostics: [] };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    const configIdx = report.indexOf("Config diagnostics:");
    const tunablesIdx = report.indexOf("Tunables:");
    assert.ok(configIdx < tunablesIdx);
  });

  test("tunables appears before configured workflows", () => {
    const configLoad: ConfigLoadResult = { config: null, globalConfig: null, projectConfig: null, diagnostics: [] };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    const tunablesIdx = report.indexOf("Tunables:");
    const workflowsIdx = report.indexOf("Configured workflows:");
    assert.ok(tunablesIdx < workflowsIdx);
  });

  test("configured workflows appears before capabilities", () => {
    const configLoad: ConfigLoadResult = { config: null, globalConfig: null, projectConfig: null, diagnostics: [] };
    const report = buildDoctorReport(makeDiscovery(), noSiblings, configLoad);
    const workflowsIdx = report.indexOf("Configured workflows:");
    const capabilitiesIdx = report.indexOf("Capabilities:");
    assert.ok(workflowsIdx < capabilitiesIdx);
  });
});

// ---------------------------------------------------------------------------
// Integration: /workflows-doctor includes new sections
// ---------------------------------------------------------------------------

describe("/workflows-doctor execute — config sections integration", () => {
  test("shows 'Config diagnostics:' section", async () => {
    const api = makeMockApi();
    factory(api);
    const cmd = api.commands.find((c) => c.name === "workflows-doctor");
    const messages: string[] = [];
    await cmd!.options.handler("", { ui: { notify: (m: string) => messages.push(m) } });
    assert.ok(messages.join("\n").includes("Config diagnostics:"));
  });

  test("shows 'Tunables:' section", async () => {
    const api = makeMockApi();
    factory(api);
    const cmd = api.commands.find((c) => c.name === "workflows-doctor");
    const messages: string[] = [];
    await cmd!.options.handler("", { ui: { notify: (m: string) => messages.push(m) } });
    assert.ok(messages.join("\n").includes("Tunables:"));
  });

  test("shows 'Configured workflows:' section", async () => {
    const api = makeMockApi();
    factory(api);
    const cmd = api.commands.find((c) => c.name === "workflows-doctor");
    const messages: string[] = [];
    await cmd!.options.handler("", { ui: { notify: (m: string) => messages.push(m) } });
    assert.ok(messages.join("\n").includes("Configured workflows:"));
  });
});
