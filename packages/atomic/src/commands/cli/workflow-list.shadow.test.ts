/**
 * Integration test: shadowed broken entries must not appear in
 * `atomic workflow list` output.
 *
 * Pipeline exercised: mergeIntoRegistry → rebuildWorkflowCommand → workflowListCommand
 *
 * The test calls workflowListCommand() with NO deps override (i.e. it uses
 * the real defaultDeps which reads getActiveBrokenList()). This validates
 * the full merge → rebuild → render contract end-to-end.
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { mergeIntoRegistry } from "../custom-workflows.ts";
import type { LoadCustomWorkflowsResult, LoadedWorkflow } from "../custom-workflows.ts";
import { createBuiltinRegistry } from "../builtin-registry.ts";
import { rebuildWorkflowCommand, getActiveBrokenList } from "./workflow.ts";
import { workflowListCommand } from "./workflow-list.ts";
import type { BrokenWorkflow, ExternalWorkflow } from "@bastani/atomic-sdk";

// ── helpers ──────────────────────────────────────────────────────────────────

function externalWorkflow(alias: string, agent: ExternalWorkflow["agent"]): ExternalWorkflow {
  return {
    kind: "external",
    name: alias,
    agent,
    description: `${alias} workflow`,
    inputs: [],
    source: { command: "bunx", args: ["some-cli"] },
  };
}

function loadedWorkflow(alias: string, agent: ExternalWorkflow["agent"], origin: "local" | "global"): LoadedWorkflow {
  return {
    alias,
    origin,
    workflow: externalWorkflow(alias, agent),
  };
}

function brokenEntry(alias: string, agent: ExternalWorkflow["agent"], origin: "local" | "global"): BrokenWorkflow {
  return {
    alias,
    origin,
    agents: [agent],
    reason: `"${alias}/${agent}": command not found`,
    source: `/path/to/${origin}/settings.json`,
    fix: `install the command`,
  };
}

// ── stdout capture ────────────────────────────────────────────────────────────

interface Captured {
  stdout: string;
  restore: () => void;
}

function captureStdout(): Captured {
  const cap: Captured = { stdout: "", restore: () => {} };
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    cap.stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;
  cap.restore = () => { process.stdout.write = orig; };
  return cap;
}

// ── env setup ─────────────────────────────────────────────────────────────────

let savedNoColor: string | undefined;
beforeAll(() => {
  savedNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});
afterAll(() => {
  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
});

// ── reset active registry state between tests ─────────────────────────────────

beforeEach(() => {
  // Reset to stock builtin registry so tests start from a clean slate.
  rebuildWorkflowCommand(createBuiltinRegistry(), new Map(), []);
});

afterEach(() => {
  rebuildWorkflowCommand(createBuiltinRegistry(), new Map(), []);
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("workflow-list: merge → rebuild → render pipeline (shadow integration)", () => {
  test("shadowed broken entry is not rendered when healthy local overrides it", async () => {
    // global: broken entry for alias "X" / agent "claude"
    const globalRes: LoadCustomWorkflowsResult = {
      loaded: [],
      broken: [brokenEntry("X", "claude", "global")],
    };

    // local: healthy loaded entry for alias "X" / agent "claude"
    const localRes: LoadCustomWorkflowsResult = {
      loaded: [loadedWorkflow("X", "claude", "local")],
      broken: [],
    };

    const { registry, brokenList, brokenIndex } = mergeIntoRegistry(
      createBuiltinRegistry(),
      globalRes,
      localRes,
    );

    // Verify the merge itself filtered the broken entry.
    expect(brokenList).toHaveLength(0);

    rebuildWorkflowCommand(registry, brokenIndex, brokenList);

    // getActiveBrokenList() must reflect the filtered result.
    expect(getActiveBrokenList()).toHaveLength(0);

    // workflowListCommand uses defaultDeps which calls getActiveBrokenList().
    const cap = captureStdout();
    let code: number;
    try {
      code = await workflowListCommand();
    } finally {
      cap.restore();
    }

    expect(code).toBe(0);

    // Negative: the broken row MUST NOT appear.
    expect(cap.stdout).not.toContain("✗");
    expect(cap.stdout).not.toContain("✗ X");
    expect(cap.stdout).not.toContain("failed to load");
    expect(cap.stdout).not.toContain("skipped");

    // Positive: the healthy override entry "X" appears in the registry listing.
    expect(cap.stdout).toContain("X");
  });

  test("un-shadowed broken entry IS rendered (positive control)", async () => {
    // global: broken entry for alias "Y" / agent "claude", no healthy override
    const globalRes: LoadCustomWorkflowsResult = {
      loaded: [],
      broken: [brokenEntry("Y", "claude", "global")],
    };
    const localRes: LoadCustomWorkflowsResult = {
      loaded: [],
      broken: [],
    };

    const { registry, brokenList, brokenIndex } = mergeIntoRegistry(
      createBuiltinRegistry(),
      globalRes,
      localRes,
    );

    expect(brokenList).toHaveLength(1);

    rebuildWorkflowCommand(registry, brokenIndex, brokenList);
    expect(getActiveBrokenList()).toHaveLength(1);

    const cap = captureStdout();
    let code: number;
    try {
      code = await workflowListCommand();
    } finally {
      cap.restore();
    }

    expect(code).toBe(0);
    expect(cap.stdout).toContain("✗");
    expect(cap.stdout).toContain("Y");
    expect(cap.stdout).toContain("failed to load");
    expect(cap.stdout).toContain("skipped");
  });

  test("partial-agent shadow: broken entry with un-shadowed agent still renders", async () => {
    // global broken: alias "Z" for both claude and opencode
    const globalBroken: BrokenWorkflow = {
      alias: "Z",
      origin: "global",
      agents: ["claude", "opencode"],
      reason: `"Z": spawn failed`,
      source: "/global/settings.json",
      fix: "install Z",
    };
    const globalRes: LoadCustomWorkflowsResult = {
      loaded: [],
      broken: [globalBroken],
    };

    // local: healthy override only for claude — opencode stays broken
    const localRes: LoadCustomWorkflowsResult = {
      loaded: [loadedWorkflow("Z", "claude", "local")],
      broken: [],
    };

    const { registry, brokenList, brokenIndex } = mergeIntoRegistry(
      createBuiltinRegistry(),
      globalRes,
      localRes,
    );

    // Entry has at least one un-shadowed agent (opencode), so it survives.
    expect(brokenList).toHaveLength(1);
    const survivingEntry = brokenList[0];
    expect(survivingEntry?.alias).toBe("Z");

    rebuildWorkflowCommand(registry, brokenIndex, brokenList);

    const cap = captureStdout();
    let code: number;
    try {
      code = await workflowListCommand();
    } finally {
      cap.restore();
    }

    expect(code).toBe(0);
    expect(cap.stdout).toContain("✗");
    expect(cap.stdout).toContain("Z");
    expect(cap.stdout).toContain("failed to load");
  });

  test("partial-agent shadow + agent filter: agent-filtered list hides shadowed agent, shows un-shadowed agent", async () => {
    // global broken: alias "X" for both claude and copilot
    const globalBroken: BrokenWorkflow = {
      alias: "X",
      origin: "global",
      agents: ["claude", "copilot"],
      reason: `"X": command not found`,
      source: "/global/settings.json",
      fix: "install X",
    };
    const globalRes: LoadCustomWorkflowsResult = {
      loaded: [],
      broken: [globalBroken],
    };

    // local: healthy override only for claude — copilot stays broken
    const localRes: LoadCustomWorkflowsResult = {
      loaded: [loadedWorkflow("X", "claude", "local")],
      broken: [],
    };

    const { registry, brokenList, brokenIndex } = mergeIntoRegistry(
      createBuiltinRegistry(),
      globalRes,
      localRes,
    );

    // After the fix: brokenList[0].agents narrowed to ["copilot"] only.
    expect(brokenList).toHaveLength(1);
    expect(brokenList[0]!.alias).toBe("X");
    expect(brokenList[0]!.agents).toEqual(["copilot"]);

    rebuildWorkflowCommand(registry, brokenIndex, brokenList);

    // Filter by claude: X was shadowed for claude → must NOT appear in broken section.
    {
      const cap = captureStdout();
      let code: number;
      try {
        code = await workflowListCommand({ agent: "claude" });
      } finally {
        cap.restore();
      }
      expect(code).toBe(0);
      // The broken section must not show X as broken under claude.
      expect(cap.stdout).not.toContain("failed to load");
      expect(cap.stdout).not.toContain("skipped");
      // The healthy claude override for X should appear in the registry listing.
      expect(cap.stdout).toContain("X");
    }

    // Filter by copilot: X is still broken for copilot → must appear in broken section.
    {
      const cap = captureStdout();
      let code: number;
      try {
        code = await workflowListCommand({ agent: "copilot" });
      } finally {
        cap.restore();
      }
      expect(code).toBe(0);
      expect(cap.stdout).toContain("✗");
      expect(cap.stdout).toContain("X");
      expect(cap.stdout).toContain("failed to load");
      expect(cap.stdout).toContain("skipped");
    }
  });
});
