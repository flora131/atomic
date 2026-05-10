/** @jsxImportSource @opentui/react */

import { test, expect, mock } from "bun:test";
import { OrchestratorPanel } from "./orchestrator-panel.tsx";
import type { CliRenderer } from "@opentui/core";

function makeStubRenderer(): CliRenderer {
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

test("OrchestratorPanel creates with renderer and exposes PanelStore", () => {
  const renderer = makeStubRenderer();
  const panel = OrchestratorPanel.createWithRenderer(renderer);
  expect(panel.getPanelStore()).toBeDefined();
  panel.destroy();
});

test("OrchestratorPanel destroy is idempotent", () => {
  const renderer = makeStubRenderer();
  const panel = OrchestratorPanel.createWithRenderer(renderer);
  expect(() => {
    panel.destroy();
    panel.destroy();
  }).not.toThrow();
});
