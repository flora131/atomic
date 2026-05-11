/**
 * Tests for buildDoctorReport.
 *
 * Exercises the pure report-builder function in isolation — no ExtensionAPI
 * mock required.
 *
 * cross-ref: packages/pi-workflows/src/extension/doctor.ts
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildDoctorReport } from "../../src/extension/doctor.js";
import type { DoctorSiblingStatus } from "../../src/extension/doctor.js";
import { createRegistry } from "../../src/workflows/registry.js";
import type { DiscoveryResult } from "../../src/extension/discovery.js";

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

function emptyDiscovery(): DiscoveryResult {
  return {
    registry: createRegistry(),
    sources: [],
    errors: [],
  };
}

const allAbsent: DoctorSiblingStatus = {
  subagents: false,
  subagentsCallable: false,
  mcpAdapter: false,
  mcpScopeEvents: false,
  intercom: false,
  hil: false,
  uiCustom: false,
  shortcut: false,
  execAbortable: false,
  persistenceAppendEntry: false,
  promptAdapter: false,
  completeAdapter: false,
  subagentAdapterVia: "unavailable",
};

const allPresent: DoctorSiblingStatus = {
  subagents: true,
  subagentsCallable: true,
  mcpAdapter: true,
  mcpScopeEvents: true,
  intercom: true,
  hil: true,
  uiCustom: true,
  shortcut: true,
  execAbortable: true,
  persistenceAppendEntry: true,
  promptAdapter: true,
  completeAdapter: true,
  subagentAdapterVia: "pi.subagents",
};

// ---------------------------------------------------------------------------
// hil field
// ---------------------------------------------------------------------------

describe("buildDoctorReport — hil field", () => {
  test("hil: false renders unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, hil: false });
    assert.ok(report.includes("hil            — unavailable"));
  });

  test("hil: true renders available", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, hil: true });
    assert.ok(report.includes("hil            — available"));
  });
});

// ---------------------------------------------------------------------------
// pi-subagents available / callable
// ---------------------------------------------------------------------------

describe("buildDoctorReport — pi-subagents callable", () => {
  test("subagents absent renders not detected", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, subagents: false, subagentsCallable: false });
    assert.ok(report.includes("pi-subagents   — not detected"));
  });

  test("subagents present but not callable renders available", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, subagents: true, subagentsCallable: false });
    assert.ok(report.includes("pi-subagents   — available"));
  });

  test("subagents present and callable renders available (callable)", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, subagents: true, subagentsCallable: true });
    assert.ok(report.includes("pi-subagents   — available (callable)"));
  });
});

// ---------------------------------------------------------------------------
// pi-mcp-adapter + mcp scope events
// ---------------------------------------------------------------------------

describe("buildDoctorReport — mcp scope events", () => {
  test("mcpScopeEvents false renders unknown", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, mcpScopeEvents: false });
    assert.ok(report.includes("mcp scope evts — unknown"));
  });

  test("mcpScopeEvents true renders known", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, mcpScopeEvents: true });
    assert.ok(report.includes("mcp scope evts — known"));
  });
});

// ---------------------------------------------------------------------------
// ui.custom capability
// ---------------------------------------------------------------------------

describe("buildDoctorReport — ui.custom", () => {
  test("uiCustom false renders unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, uiCustom: false });
    assert.ok(report.includes("ui.custom      — unavailable"));
  });

  test("uiCustom true renders available", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, uiCustom: true });
    assert.ok(report.includes("ui.custom      — available"));
  });
});

// ---------------------------------------------------------------------------
// shortcut capability
// ---------------------------------------------------------------------------

describe("buildDoctorReport — shortcut", () => {
  test("shortcut false renders unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, shortcut: false });
    assert.ok(report.includes("shortcut       — unavailable"));
  });

  test("shortcut true renders available", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, shortcut: true });
    assert.ok(report.includes("shortcut       — available"));
  });
});

// ---------------------------------------------------------------------------
// exec abortable capability
// ---------------------------------------------------------------------------

describe("buildDoctorReport — exec abortable", () => {
  test("execAbortable false renders unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, execAbortable: false });
    assert.ok(report.includes("exec abortable — unavailable"));
  });

  test("execAbortable true renders yes", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, execAbortable: true });
    assert.ok(report.includes("exec abortable — yes"));
  });
});

// ---------------------------------------------------------------------------
// persistence appendEntry capability
// ---------------------------------------------------------------------------

describe("buildDoctorReport — persistence appendEntry", () => {
  test("persistenceAppendEntry false renders unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, persistenceAppendEntry: false });
    assert.ok(report.includes("persistence    — unavailable"));
  });

  test("persistenceAppendEntry true renders appendEntry available", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, persistenceAppendEntry: true });
    assert.ok(report.includes("persistence    — appendEntry available"));
  });
});

// ---------------------------------------------------------------------------
// Capabilities section — all fields
// ---------------------------------------------------------------------------

describe("buildDoctorReport — capabilities section", () => {
  test("all absent renders not-detected / unavailable / unknown", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    assert.ok(report.includes("pi-subagents   — not detected"));
    assert.ok(report.includes("pi-mcp-adapter — not detected"));
    assert.ok(report.includes("mcp scope evts — unknown"));
    assert.ok(report.includes("pi-intercom    — not detected"));
    assert.ok(report.includes("hil            — unavailable"));
    assert.ok(report.includes("ui.custom      — unavailable"));
    assert.ok(report.includes("shortcut       — unavailable"));
    assert.ok(report.includes("exec abortable — unavailable"));
    assert.ok(report.includes("persistence    — unavailable"));
  });

  test("all present renders available / known / yes", () => {
    const report = buildDoctorReport(emptyDiscovery(), allPresent);
    assert.ok(report.includes("pi-subagents   — available (callable)"));
    assert.ok(report.includes("pi-mcp-adapter — available"));
    assert.ok(report.includes("mcp scope evts — known"));
    assert.ok(report.includes("pi-intercom    — present"));
    assert.ok(report.includes("hil            — available"));
    assert.ok(report.includes("ui.custom      — available"));
    assert.ok(report.includes("shortcut       — available"));
    assert.ok(report.includes("exec abortable — yes"));
    assert.ok(report.includes("persistence    — appendEntry available"));
  });
});

// ---------------------------------------------------------------------------
// Smoke — report structure
// ---------------------------------------------------------------------------

describe("buildDoctorReport — structure", () => {
  test("includes header", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    assert.ok(report.includes("pi-workflows doctor report"));
  });

  test("includes registry count", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    assert.ok(report.includes("Registry: 0 workflow(s) loaded"));
  });

  test("includes Capabilities section header", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    assert.ok(report.includes("Capabilities:"));
  });
});

// ---------------------------------------------------------------------------
// Runtime adapters — pi.exec
// ---------------------------------------------------------------------------

describe("buildDoctorReport — pi.exec capability", () => {
  test("execAbortable false renders unavailable under Runtime adapters", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, execAbortable: false });
    assert.ok(report.includes("pi.exec          — unavailable"));
  });

  test("execAbortable true renders available under Runtime adapters", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, execAbortable: true });
    assert.ok(report.includes("pi.exec          — available"));
  });
});

// ---------------------------------------------------------------------------
// Runtime adapters — prompt adapter
// ---------------------------------------------------------------------------

describe("buildDoctorReport — prompt adapter", () => {
  test("promptAdapter false renders unconfigured", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, promptAdapter: false });
    assert.ok(report.includes("prompt adapter   — unconfigured"));
  });

  test("promptAdapter true renders configured", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, promptAdapter: true });
    assert.ok(report.includes("prompt adapter   — configured"));
  });
});

// ---------------------------------------------------------------------------
// Runtime adapters — complete adapter
// ---------------------------------------------------------------------------

describe("buildDoctorReport — complete adapter", () => {
  test("completeAdapter false renders unconfigured", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, completeAdapter: false });
    assert.ok(report.includes("complete adapter — unconfigured"));
  });

  test("completeAdapter true renders configured", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, completeAdapter: true });
    assert.ok(report.includes("complete adapter — configured"));
  });
});

// ---------------------------------------------------------------------------
// Runtime adapters — subagent adapter via
// ---------------------------------------------------------------------------

describe("buildDoctorReport — subagent adapter via", () => {
  test("unavailable renders unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, subagentAdapterVia: "unavailable" });
    assert.ok(report.includes("subagent adapter — unavailable"));
  });

  test("pi.subagents renders configured via pi.subagents", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, subagentAdapterVia: "pi.subagents" });
    assert.ok(report.includes("subagent adapter — configured via pi.subagents"));
  });

  test("callTool renders configured via callTool", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, subagentAdapterVia: "callTool" });
    assert.ok(report.includes("subagent adapter — configured via callTool"));
  });
});

// ---------------------------------------------------------------------------
// Runtime adapters — section header + combined
// ---------------------------------------------------------------------------

describe("buildDoctorReport — Runtime adapters section", () => {
  test("includes Runtime adapters header", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    assert.ok(report.includes("Runtime adapters:"));
  });

  test("all absent renders all unconfigured/unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    assert.ok(report.includes("pi.exec          — unavailable"));
    assert.ok(report.includes("prompt adapter   — unconfigured"));
    assert.ok(report.includes("complete adapter — unconfigured"));
    assert.ok(report.includes("subagent adapter — unavailable"));
  });

  test("all present renders all configured/available", () => {
    const report = buildDoctorReport(emptyDiscovery(), allPresent);
    assert.ok(report.includes("pi.exec          — available"));
    assert.ok(report.includes("prompt adapter   — configured"));
    assert.ok(report.includes("complete adapter — configured"));
    assert.ok(report.includes("subagent adapter — configured via pi.subagents"));
  });
});
