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
  mcpAdapter: false,
  intercom: false,
  hil: false,
};

const allPresent: DoctorSiblingStatus = {
  subagents: true,
  mcpAdapter: true,
  intercom: true,
  hil: true,
};

// ---------------------------------------------------------------------------
// hil field — core feature under test
// ---------------------------------------------------------------------------

describe("buildDoctorReport — hil field", () => {
  test('hil: false renders "hil            — unavailable"', () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, hil: false });
    expect(report).toContain("hil            — unavailable");
  });

  test('hil: true renders "hil            — available"', () => {
    const report = buildDoctorReport(emptyDiscovery(), { ...allAbsent, hil: true });
    expect(report).toContain("hil            — available");
  });
});

// ---------------------------------------------------------------------------
// Siblings section — all fields present
// ---------------------------------------------------------------------------

describe("buildDoctorReport — siblings section", () => {
  test("all siblings absent renders not-detected / unavailable", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    expect(report).toContain("pi-subagents   — not detected");
    expect(report).toContain("pi-mcp-adapter — not detected");
    expect(report).toContain("pi-intercom    — not detected");
    expect(report).toContain("hil            — unavailable");
  });

  test("all siblings present renders available", () => {
    const report = buildDoctorReport(emptyDiscovery(), allPresent);
    expect(report).toContain("pi-subagents   — available");
    expect(report).toContain("pi-mcp-adapter — available");
    expect(report).toContain("pi-intercom    — available");
    expect(report).toContain("hil            — available");
  });
});

// ---------------------------------------------------------------------------
// Smoke — report includes header + registry line
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

  test("includes Siblings section", () => {
    const report = buildDoctorReport(emptyDiscovery(), allAbsent);
    expect(report).toContain("Siblings:");
  });
});
