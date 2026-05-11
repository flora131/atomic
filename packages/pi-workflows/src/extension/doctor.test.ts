/**
 * Tests for buildDoctorReport.
 *
 * Exercises the pure report-builder function in isolation — no ExtensionAPI
 * mock required.
 *
 * cross-ref: packages/pi-workflows/src/extension/doctor.ts
 */

import { test, expect, describe } from "bun:test";
import { buildDoctorReport } from "./doctor.js";
import type { DoctorSiblingStatus } from "./doctor.js";
import { createRegistry } from "../workflows/registry.js";
import type { DiscoveryResult } from "./discovery.js";

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
};

// ---------------------------------------------------------------------------
// hil field
// ---------------------------------------------------------------------------

describe("buildDoctorReport — hil field", () => {
  test("hil: false renders unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, hil: false });
    expect(report).toContain("hil            — unavailable");
  });

  test("hil: true renders available", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, hil: true });
    expect(report).toContain("hil            — available");
  });
});

// ---------------------------------------------------------------------------
// pi-subagents available / callable
// ---------------------------------------------------------------------------

describe("buildDoctorReport — pi-subagents callable", () => {
  test("subagents absent renders not detected", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, subagents: false, subagentsCallable: false });
    expect(report).toContain("pi-subagents   — not detected");
  });

  test("subagents present but not callable renders available", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, subagents: true, subagentsCallable: false });
    expect(report).toContain("pi-subagents   — available");
  });

  test("subagents present and callable renders available (callable)", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, subagents: true, subagentsCallable: true });
    expect(report).toContain("pi-subagents   — available (callable)");
  });
});

// ---------------------------------------------------------------------------
// pi-mcp-adapter + mcp scope events
// ---------------------------------------------------------------------------

describe("buildDoctorReport — mcp scope events", () => {
  test("mcpScopeEvents false renders unknown", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, mcpScopeEvents: false });
    expect(report).toContain("mcp scope evts — unknown");
  });

  test("mcpScopeEvents true renders known", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, mcpScopeEvents: true });
    expect(report).toContain("mcp scope evts — known");
  });
});

// ---------------------------------------------------------------------------
// ui.custom capability
// ---------------------------------------------------------------------------

describe("buildDoctorReport — ui.custom", () => {
  test("uiCustom false renders unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, uiCustom: false });
    expect(report).toContain("ui.custom      — unavailable");
  });

  test("uiCustom true renders available", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, uiCustom: true });
    expect(report).toContain("ui.custom      — available");
  });
});

// ---------------------------------------------------------------------------
// shortcut capability
// ---------------------------------------------------------------------------

describe("buildDoctorReport — shortcut", () => {
  test("shortcut false renders unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, shortcut: false });
    expect(report).toContain("shortcut       — unavailable");
  });

  test("shortcut true renders available", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, shortcut: true });
    expect(report).toContain("shortcut       — available");
  });
});

// ---------------------------------------------------------------------------
// exec abortable capability
// ---------------------------------------------------------------------------

describe("buildDoctorReport — exec abortable", () => {
  test("execAbortable false renders unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, execAbortable: false });
    expect(report).toContain("exec abortable — unavailable");
  });

  test("execAbortable true renders yes", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, execAbortable: true });
    expect(report).toContain("exec abortable — yes");
  });
});

// ---------------------------------------------------------------------------
// persistence appendEntry capability
// ---------------------------------------------------------------------------

describe("buildDoctorReport — persistence appendEntry", () => {
  test("persistenceAppendEntry false renders unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, persistenceAppendEntry: false });
    expect(report).toContain("persistence    — unavailable");
  });

  test("persistenceAppendEntry true renders appendEntry available", () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, persistenceAppendEntry: true });
    expect(report).toContain("persistence    — appendEntry available");
  });
});

// ---------------------------------------------------------------------------
// Capabilities section — all fields
// ---------------------------------------------------------------------------

describe("buildDoctorReport — capabilities section", () => {
  test("all absent renders not-detected / unavailable / unknown", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    expect(report).toContain("pi-subagents   — not detected");
    expect(report).toContain("pi-mcp-adapter — not detected");
    expect(report).toContain("mcp scope evts — unknown");
    expect(report).toContain("pi-intercom    — not detected");
    expect(report).toContain("hil            — unavailable");
    expect(report).toContain("ui.custom      — unavailable");
    expect(report).toContain("shortcut       — unavailable");
    expect(report).toContain("exec abortable — unavailable");
    expect(report).toContain("persistence    — unavailable");
  });

  test("all present renders available / known / yes", () => {
    const report = buildDoctorReport(emptyDiscovery(), allPresent);
    expect(report).toContain("pi-subagents   — available (callable)");
    expect(report).toContain("pi-mcp-adapter — available");
    expect(report).toContain("mcp scope evts — known");
    expect(report).toContain("pi-intercom    — present");
    expect(report).toContain("hil            — available");
    expect(report).toContain("ui.custom      — available");
    expect(report).toContain("shortcut       — available");
    expect(report).toContain("exec abortable — yes");
    expect(report).toContain("persistence    — appendEntry available");
  });
});

// ---------------------------------------------------------------------------
// Smoke — report structure
// ---------------------------------------------------------------------------

describe("buildDoctorReport — structure", () => {
  test("includes header", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    expect(report).toContain("pi-workflows doctor report");
  });

  test("includes registry count", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    expect(report).toContain("Registry: 0 workflow(s) loaded");
  });

  test("includes Capabilities section header", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    expect(report).toContain("Capabilities:");
  });
});
