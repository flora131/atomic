/** @jsxImportSource @opentui/react */
/**
 * Tests for OrchestratorPanel.attachOffloadManager — setter-based wiring.
 */

import { test, expect, mock } from "bun:test";
import { OrchestratorPanel } from "./orchestrator-panel.tsx";
import type { OffloadManager } from "../runtime/offload-manager.ts";
import type { CliRenderer } from "@opentui/core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStubRenderer(): CliRenderer {
  // Minimal stub satisfying the surface used by createWithRenderer.
  // Note: React's scheduler dispatches async reconciler work after render;
  // this stub intentionally omits low-level renderer internals (getChildren,
  // etc.) so those async tasks may throw unhandled errors. The synchronous
  // test assertions below still pass correctly.
  return {
    themeMode: null,
    width: 80,
    height: 24,
    widthMethod: "terminal",
    root: {
      children: [],
      getChildren: () => [],
      requestRender: mock(() => {}),
      add: mock(() => {}),
      remove: mock(() => {}),
    } as unknown as CliRenderer["root"],
    setBackgroundColor: mock(() => {}),
    requestRender: mock(() => {}),
    addInputHandler: mock(() => {}),
    removeInputHandler: mock(() => {}),
    on: mock(() => ({}) as unknown as CliRenderer),
    once: mock(() => ({}) as unknown as CliRenderer),
    off: mock(() => ({}) as unknown as CliRenderer),
    emit: mock(() => false),
    destroy: mock(() => {}),
    resetTerminalBgColor: mock(() => {}),
    setFrameCallback: mock(() => {}),
    removeFrameCallback: mock(() => {}),
    clearFrameCallbacks: mock(() => {}),
    requestLive: mock(() => {}),
    dropLive: mock(() => {}),
  } as unknown as CliRenderer;
}

function makeStubOffloadManager(): OffloadManager {
  return {
    registerSession: mock(async () => {}),
    offloadSession: mock(async () => {}),
    onWorkflowCompletion: mock(async () => {}),
    requestResume: mock(async () => {}),
    getStatus: mock(() => "alive" as const),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("OrchestratorPanel exposes attachOffloadManager method", () => {
  const renderer = makeStubRenderer();
  const panel = OrchestratorPanel.createWithRenderer(renderer, { tmuxSession: "test-session" });
  expect(typeof panel.attachOffloadManager).toBe("function");
  panel.destroy();
});

test("attachOffloadManager does not throw when called with valid manager", () => {
  const renderer = makeStubRenderer();
  const panel = OrchestratorPanel.createWithRenderer(renderer, { tmuxSession: "test-session" });
  const mgr = makeStubOffloadManager();
  expect(() => panel.attachOffloadManager(mgr)).not.toThrow();
  panel.destroy();
});

test("attachOffloadManager is idempotent — calling twice does not throw", () => {
  const renderer = makeStubRenderer();
  const panel = OrchestratorPanel.createWithRenderer(renderer, { tmuxSession: "test-session" });
  const mgr = makeStubOffloadManager();
  expect(() => {
    panel.attachOffloadManager(mgr);
    panel.attachOffloadManager(mgr);
  }).not.toThrow();
  panel.destroy();
});

test("attachOffloadManager returns void", () => {
  const renderer = makeStubRenderer();
  const panel = OrchestratorPanel.createWithRenderer(renderer, { tmuxSession: "test-session" });
  const mgr = makeStubOffloadManager();
  const result = panel.attachOffloadManager(mgr);
  expect(result).toBeUndefined();
  panel.destroy();
});
