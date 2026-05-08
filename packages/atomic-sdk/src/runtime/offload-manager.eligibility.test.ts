/**
 * Tests for isEligibleForOffload.
 * Spec: specs/2026-05-08-workflow-pane-offload-and-resume.md §5.2, RFC §3.1
 *
 * Tests:
 *  1. All three v1 providers (claude/opencode/copilot) offload by default.
 *  2. Headless session is skipped (headless check fires first).
 */

import { test, expect, mock, describe } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOffloadManager } from "./offload-manager.ts";
import type { OffloadManagerDeps } from "./offload-manager.ts";
import type { AgentKind } from "./offload-types.ts";
import type { SessionData } from "../components/orchestrator-panel-types.ts";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type EmitCall = { event: string; payload: Record<string, unknown> };

interface MutablePanelStore {
  sessions: SessionData[];
  activeAgentId: string;
  setSessionStatus: ReturnType<typeof mock>;
}

const TMUX_SESSION = "atomic-wf-elg-test-1";

function makeDeps(): { deps: OffloadManagerDeps; panelStore: MutablePanelStore; emitCalls: EmitCall[] } {
  const emitCalls: EmitCall[] = [];
  const panelStore: MutablePanelStore = {
    sessions: [],
    activeAgentId: "",
    setSessionStatus: mock(() => {}),
  };
  const deps: OffloadManagerDeps = {
    panelStore: panelStore as unknown as OffloadManagerDeps["panelStore"],
    tmux: {
      killWindow: mock(async () => {}),
      createWindow: mock(async () => {}),
      selectWindow: mock(async () => {}),
    },
    providers: {
      claude:   { buildResumeArgs: mock(() => []) },
      opencode: { buildResumeArgs: mock(() => []) },
      copilot:  { buildResumeArgs: mock(() => []) },
    },
    hookSettingsPath: mock(() => "/tmp/hook-settings.json"),
    shellQuote: mock((argv: readonly string[]) => argv.join(" ")),
    waitForReady: mock(async (_agent: AgentKind, _agentSessionId: string, _paneId: string) => {}),
    now: mock(() => Date.now()),
    emit: mock((event: string, payload: Record<string, unknown>) => {
      emitCalls.push({ event, payload });
    }),
  };
  return { deps, panelStore, emitCalls };
}

/**
 * Create a temp stageDir with a minimal metadata.json for persistResume.
 * registerSession (headless:false) reads/writes this file.
 */
function makeStageDir(name: string, agent: string): string {
  const dir = mkdtempSync(join(tmpdir(), `offload-elg-${agent}-`));
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      name,
      description: `${agent} stage`,
      agent,
      paneId: "%1",
      serverUrl: "",
      port: 0,
      startedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  return dir;
}

function pushSession(panelStore: MutablePanelStore, name: string): void {
  panelStore.sessions.push({
    name,
    status: "complete",
    parents: [],
    startedAt: null,
    endedAt: null,
  });
}

// ---------------------------------------------------------------------------
// Test 1 — All three providers offload by default (RFC §3.1 positive path)
// ---------------------------------------------------------------------------

describe("isEligibleForOffload: all v1 providers are eligible by default", () => {
  test("claude, opencode, copilot each emit WORKFLOW_OFFLOAD_COMPLETED and transition to offloaded", async () => {
    const { deps, panelStore, emitCalls } = makeDeps();
    const mgr = createOffloadManager(deps);
    const agents: AgentKind[] = ["claude", "opencode", "copilot"];

    for (const agent of agents) {
      const name = `pane-${agent}`;
      const stageDir = makeStageDir(name, agent);
      await mgr.registerSession({
        name,
        runId: "run-multi",
        stageDir,
        agent,
        agentSessionId: `sess-${agent}`,
        tmuxSession: TMUX_SESSION,
        tmuxWindow: name,
        spawnEnv: {},
        spawnCwd: "/home/user/project",
        chatFlags: [],
        headless: false,
      });
      pushSession(panelStore, name);
    }

    panelStore.activeAgentId = "";

    await mgr.onWorkflowCompletion();

    // killWindow called three times — once per agent.
    expect(deps.tmux.killWindow).toHaveBeenCalledTimes(3);

    // Each call used the correct session+window args.
    const killCalls = (deps.tmux.killWindow as ReturnType<typeof mock>).mock.calls as [string, string][];
    for (const agent of agents) {
      const name = `pane-${agent}`;
      expect(killCalls.some(([s, w]) => s === TMUX_SESSION && w === name)).toBe(true);
    }

    // WORKFLOW_OFFLOAD_COMPLETED emitted exactly three times.
    const completedEvents = emitCalls.filter((c) => c.event === "workflow.offload.completed");
    expect(completedEvents).toHaveLength(3);

    // All three sessions transitioned to "offloaded".
    for (const agent of agents) {
      expect(mgr.getStatus(`pane-${agent}`)).toBe("offloaded");
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Headless session is skipped (RFC §5.2.2)
// ---------------------------------------------------------------------------

describe("isEligibleForOffload: headless session is skipped", () => {
  test("headless claude session: killWindow not called", async () => {
    const { deps, panelStore } = makeDeps();
    const mgr = createOffloadManager(deps);

    mgr.registerSession({
      name: "stage-headless",
      runId: "run-headless",
      stageDir: "/tmp/nonexistent-headless",
      agent: "claude",
      agentSessionId: "sess-headless",
      tmuxSession: TMUX_SESSION,
      tmuxWindow: "stage-headless",
      spawnEnv: {},
      spawnCwd: "/home/user/project",
      chatFlags: [],
      headless: true,
    });
    pushSession(panelStore, "stage-headless");
    panelStore.activeAgentId = "";

    await mgr.onWorkflowCompletion();

    // Headless gate fired — no kill.
    expect(deps.tmux.killWindow).not.toHaveBeenCalled();
  });
});
