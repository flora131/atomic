/**
 * Tests for buildDoctorReport.
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { buildDoctorReport } from "../../src/extension/doctor.js";
import type { DoctorSiblingStatus } from "../../src/extension/doctor.js";
import { createRegistry } from "../../src/workflows/registry.js";
import type { DiscoveryResult } from "../../src/extension/discovery.js";

function emptyDiscovery(): DiscoveryResult {
  return {
    registry: createRegistry(),
    sources: [],
    errors: [],
  };
}

const allAbsent: DoctorSiblingStatus = {
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
  agentSessionAdapter: false,
};

const allPresent: DoctorSiblingStatus = {
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
  agentSessionAdapter: true,
};

describe("buildDoctorReport", () => {
  test("renders updated header", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    assert.ok(report.startsWith("atomic-workflows doctor report"));
  });

  test("renders absent host capabilities", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    assert.ok(report.includes("task delegation — unavailable"));
    assert.ok(report.includes("mcp scope evts  — unknown"));
    assert.ok(report.includes("session naming  — unavailable"));
    assert.ok(report.includes("hil            — unavailable"));
    assert.ok(report.includes("ui.custom      — unavailable"));
    assert.ok(report.includes("shortcut       — unavailable"));
    assert.ok(report.includes("persistence    — unavailable"));
  });

  test("renders present host capabilities", () => {
    const report = buildDoctorReport(emptyDiscovery(), allPresent);
    assert.ok(report.includes("task delegation — available"));
    assert.ok(report.includes("mcp scope evts  — known"));
    assert.ok(report.includes("session naming  — present"));
    assert.ok(report.includes("hil            — available"));
    assert.ok(report.includes("ui.custom      — available"));
    assert.ok(report.includes("shortcut       — available"));
    assert.ok(report.includes("persistence    — appendEntry available"));
  });

  test("renders runtime adapter capabilities", () => {
    const report = buildDoctorReport(emptyDiscovery(), allPresent);
    assert.ok(report.includes("Runtime adapters:"));
    assert.ok(report.includes("exec             — available"));
    assert.ok(report.includes("prompt adapter   — configured"));
    assert.ok(report.includes("complete adapter — configured"));
    assert.ok(report.includes("subagent adapter — configured via task tool"));
    assert.ok(report.includes("agent session    — configured via oh-my-pi SDK"));
  });

  test("renders unavailable runtime adapters", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    assert.ok(report.includes("exec             — unavailable"));
    assert.ok(report.includes("prompt adapter   — unconfigured"));
    assert.ok(report.includes("complete adapter — unconfigured"));
    assert.ok(report.includes("subagent adapter — unavailable"));
    assert.ok(report.includes("agent session    — unconfigured"));
  });

  test("includes registry and discovery diagnostics sections", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    assert.ok(report.includes("Registry: 0 workflow(s) loaded"));
    assert.ok(report.includes("Discovery diagnostics: (none)"));
    assert.ok(report.includes("Capabilities:"));
  });
});
