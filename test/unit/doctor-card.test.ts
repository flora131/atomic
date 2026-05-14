/**
 * Plain-mode snapshot tests for the doctor chat-surface card.
 *
 * Themed (ANSI) rendering is left untested at the snapshot level — the
 * theme primitives are exercised by `chat-surface.test.ts`; here we
 * verify the structural shape (band, stripes, glyphs, hint rows)
 * survives plain mode. That's the layout consumers see in logs and
 * test transcripts.
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { buildDoctorPayload, type DoctorSiblingStatus } from "../../src/extension/doctor.js";
import { COMPANIONS, type CompanionStatus } from "../../src/extension/companions.js";
import { renderDoctorCard } from "../../src/tui/doctor-card.js";
import { createRegistry } from "../../src/workflows/registry.js";
import type { DiscoveryResult } from "../../src/extension/discovery.js";

function emptyDiscovery(): DiscoveryResult {
  return { registry: createRegistry(), sources: [], errors: [] };
}

const minimalSiblings: DoctorSiblingStatus = {
  taskDelegation: true,
  mcpScopeEvents: true,
  sessionNaming: true,
  hil: true,
  uiCustom: true,
  shortcut: true,
  persistenceAppendEntry: true,
  subagentAdapterVia: "pi-subagents tool",
  agentSessionAdapter: true,
};

const allMissing: readonly CompanionStatus[] = COMPANIONS.map((companion) => ({
  companion,
  installed: false,
}));

const allInstalled: readonly CompanionStatus[] = COMPANIONS.map((companion) => ({
  companion,
  installed: true,
  evidence: "tool subagent",
}));

describe("renderDoctorCard — plain mode", () => {
  test("renders the [ DOCTOR ] header band with the payload subtitle", () => {
    const payload = buildDoctorPayload({
      discovery: emptyDiscovery(),
      siblings: minimalSiblings,
      companions: allMissing,
    });
    const out = renderDoctorCard(payload, { width: 100 });
    assert.match(out, /\[ DOCTOR \]/);
    assert.ok(out.includes("atomic-workflows"));
  });

  test("emits a band per section in catalogue order", () => {
    const payload = buildDoctorPayload({
      discovery: emptyDiscovery(),
      siblings: minimalSiblings,
      companions: allMissing,
    });
    const out = renderDoctorCard(payload, { width: 100 });
    const indices = [
      "[ REGISTRY ]",
      "[ DIAGNOSTICS ]",
      "[ TUNABLES ]",
      "[ CONFIGURED WORKFLOWS ]",
      "[ HOST CAPABILITIES ]",
      "[ RUNTIME ADAPTERS ]",
      "[ COMPANIONS ]",
    ].map((label) => out.indexOf(label));

    for (const idx of indices) {
      assert.ok(idx >= 0, `each section band should appear in plain output`);
    }
    // Strictly increasing — sections come out in catalogue order.
    for (let i = 1; i < indices.length; i++) {
      assert.ok(indices[i]! > indices[i - 1]!, "sections should appear in order");
    }
  });

  test("renders status glyphs for capability rows", () => {
    const payload = buildDoctorPayload({
      discovery: emptyDiscovery(),
      siblings: minimalSiblings,
      companions: allInstalled,
    });
    const out = renderDoctorCard(payload, { width: 100 });
    // ✓ glyph appears next to ok rows.
    assert.ok(out.includes("✓ task delegation"));
    // The stripe `│` (plain mode) prefixes every body row.
    assert.match(out, /^\s*│ /m);
  });

  test("appends `▸ pi install …` hint rows when companions are missing", () => {
    const payload = buildDoctorPayload({
      discovery: emptyDiscovery(),
      siblings: minimalSiblings,
      companions: allMissing,
    });
    const out = renderDoctorCard(payload, { width: 120 });
    for (const companion of COMPANIONS) {
      assert.ok(
        out.includes(`pi install ${companion.installSpec}`),
        `should include hint for ${companion.name}`,
      );
    }
    // One arrow per missing companion.
    const arrowCount = (out.match(/▸/g) ?? []).length;
    assert.equal(arrowCount, COMPANIONS.length);
  });

  test("omits the hint block when all companions are installed", () => {
    const payload = buildDoctorPayload({
      discovery: emptyDiscovery(),
      siblings: minimalSiblings,
      companions: allInstalled,
    });
    const out = renderDoctorCard(payload, { width: 120 });
    assert.ok(!out.includes("▸ pi install"));
  });

  test("warn glyph appears for missing companions", () => {
    const payload = buildDoctorPayload({
      discovery: emptyDiscovery(),
      siblings: minimalSiblings,
      companions: allMissing,
    });
    const out = renderDoctorCard(payload, { width: 100 });
    // At least one ⚠ glyph in the COMPANIONS section.
    assert.ok(out.includes("⚠"));
  });
});
