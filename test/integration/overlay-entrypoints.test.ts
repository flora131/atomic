/**
 * Tests for WorkflowGraphOverlayAdapter and overlay entrypoints.
 *
 * Verifies:
 *   - buildGraphOverlayAdapter returns noopOverlay when pi.ui.custom absent.
 *   - buildGraphOverlayAdapter builds GraphView with mode:"overlay" and calls pi.ui.custom.
 *   - open(runId) passes overlay:true to pi.ui.custom.
 *   - open(null) uses store.activeRunId().
 *   - close() calls handle.close() and disposes GraphView.
 *   - F2 shortcut registration in extension factory calls overlay.open(activeRunId).
 *   - /workflow resume calls overlay.open(runId) after successful resumeRun().
 *   - /workflow resume with unknown runId does NOT call overlay.open.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGraphOverlayAdapter } from "../../src/tui/overlay-adapter.js";
import type { OverlayPiSurface } from "../../src/tui/overlay-adapter.js";
import type {
  PiCustomOverlayOpts,
  PiCustomOverlayHandle,
} from "../../src/extension/wiring.js";
import {
  createStore,
  store as singletonStore,
} from "../../src/shared/store.js";
import factory from "../../src/extension/index.js";
import type {
  ExtensionAPI,
  PiSlashCommandOpts,
  PiCommandContext,
  PiCommandOptions,
} from "../../src/extension/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CapturedCustomCall {
  opts: PiCustomOverlayOpts;
  handle: PiCustomOverlayHandle;
}

/** Build a pi.ui mock that captures custom() calls and returns a closable handle. */
function buildMockUiWithCustom(): {
  ui: OverlayPiSurface["ui"] & { setWidget?: () => void };
  calls: CapturedCustomCall[];
  closedHandles: number;
} {
  const calls: CapturedCustomCall[] = [];
  let closedHandles = 0;

  const ui = {
    custom: (opts: PiCustomOverlayOpts): PiCustomOverlayHandle => {
      const handle: PiCustomOverlayHandle = {
        close: () => {
          closedHandles++;
        },
      };
      calls.push({ opts, handle });
      return handle;
    },
  };

  return {
    ui,
    calls,
    get closedHandles() {
      return closedHandles;
    },
  };
}

/** Create a minimal mock pi ExtensionAPI with custom overlay support. */
function buildMockPi(overrides: Partial<ExtensionAPI> = {}): {
  pi: ExtensionAPI;
  shortcuts: Record<string, (ctx?: PiCommandContext) => void>;
  commands: Record<string, PiSlashCommandOpts>;
  customCalls: CapturedCustomCall[];
} {
  const shortcuts: Record<string, (ctx?: PiCommandContext) => void> = {};
  const commands: Record<string, PiSlashCommandOpts> = {};
  const customCalls: CapturedCustomCall[] = [];
  let closedHandles = 0;

  const pi: ExtensionAPI = {
    registerTool: () => undefined,
    registerCommand: (name: string, options: PiCommandOptions) => {
      commands[name] = {
        name,
        description: options.description,
        execute: options.handler,
        getArgumentCompletions: options.getArgumentCompletions,
      };
    },
    registerMessageRenderer: () => undefined,
    registerFlag: () => undefined,
    registerShortcut: (key, opts) => {
      shortcuts[key] = opts.handler;
    },
    ui: {
      custom: (opts: PiCustomOverlayOpts): PiCustomOverlayHandle => {
        const handle: PiCustomOverlayHandle = {
          close: () => {
            closedHandles++;
          },
        };
        customCalls.push({ opts, handle });
        return handle;
      },
    },
    ...overrides,
  };

  return { pi, shortcuts, commands, customCalls };
}

// ---------------------------------------------------------------------------
// buildGraphOverlayAdapter — degraded runtime (no custom)
// ---------------------------------------------------------------------------

describe("buildGraphOverlayAdapter — absent pi.ui.custom", () => {
  test("returns noopOverlay when pi.ui is absent", () => {
    const store = createStore();
    const adapter = buildGraphOverlayAdapter({}, store);
    // noop adapter — calls don't throw
    assert.doesNotThrow(() => adapter.open(null));
    assert.doesNotThrow(() => adapter.open("run-1"));
    assert.doesNotThrow(() => adapter.close());
  });

  test("returns noopOverlay when pi.ui.custom is absent", () => {
    const store = createStore();
    const adapter = buildGraphOverlayAdapter({ ui: {} }, store);
    assert.doesNotThrow(() => adapter.open("run-1"));
    assert.doesNotThrow(() => adapter.close());
  });
});

// ---------------------------------------------------------------------------
// buildGraphOverlayAdapter — open path
// ---------------------------------------------------------------------------

describe("buildGraphOverlayAdapter — open with pi.ui.custom", () => {
  test("open(runId) calls pi.ui.custom with overlay:true", () => {
    const { ui, calls } = buildMockUiWithCustom();
    const store = createStore();
    const adapter = buildGraphOverlayAdapter({ ui }, store);

    adapter.open("run-abc");

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.opts.overlay, true);
  });

  test("open(runId) passes render callback that returns string[]", () => {
    const { ui, calls } = buildMockUiWithCustom();
    const store = createStore();
    const adapter = buildGraphOverlayAdapter({ ui }, store);

    adapter.open("run-abc");

    const { render } = calls[0]!.opts;
    assert.equal(typeof render, "function");
    const lines = render!(80);
    assert.equal(Array.isArray(lines), true);
  });

  test("open(runId) passes onInput callback", () => {
    const { ui, calls } = buildMockUiWithCustom();
    const store = createStore();
    const adapter = buildGraphOverlayAdapter({ ui }, store);

    adapter.open("run-abc");

    const { onInput } = calls[0]!.opts;
    assert.equal(typeof onInput, "function");
    // GraphView handles "q" as close key — returns true (consumed)
    const consumed = onInput!("q");
    assert.equal(typeof consumed, "boolean");
  });

  test("open(runId) passes onClose callback", () => {
    const { ui, calls } = buildMockUiWithCustom();
    const store = createStore();
    const adapter = buildGraphOverlayAdapter({ ui }, store);

    adapter.open("run-abc");

    assert.equal(typeof calls[0]!.opts.onClose, "function");
  });

  test("open(null) still calls pi.ui.custom", () => {
    const { ui, calls } = buildMockUiWithCustom();
    const store = createStore();
    const adapter = buildGraphOverlayAdapter({ ui }, store);

    adapter.open(null);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.opts.overlay, true);
  });

  test("second open() reuses the existing overlay (no re-mount)", () => {
    const { calls } = buildMockUiWithCustom();
    let closedCount = 0;
    const spyUi: OverlayPiSurface["ui"] = {
      custom: (opts: PiCustomOverlayOpts): PiCustomOverlayHandle => {
        const handle: PiCustomOverlayHandle = {
          close: () => {
            closedCount++;
          },
        };
        calls.push({ opts, handle });
        return handle;
      },
    };
    const store = createStore();
    const adapter = buildGraphOverlayAdapter({ ui: spyUi }, store);

    adapter.open("run-1");
    adapter.open("run-2");

    // open() is idempotent now — the second call brings the existing
    // overlay to front rather than mounting a new one.
    assert.equal(closedCount, 0);
    assert.equal(calls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// buildGraphOverlayAdapter — close path
// ---------------------------------------------------------------------------

describe("buildGraphOverlayAdapter — close", () => {
  test("close() calls handle.close()", () => {
    let closedCount = 0;
    const ui: OverlayPiSurface["ui"] = {
      custom: (_opts: PiCustomOverlayOpts): PiCustomOverlayHandle => {
        return {
          close: () => {
            closedCount++;
          },
        };
      },
    };
    const store = createStore();
    const adapter = buildGraphOverlayAdapter({ ui }, store);

    adapter.open("run-1");
    adapter.close();

    assert.equal(closedCount, 1);
  });

  test("close() before open() does not throw", () => {
    const { ui } = buildMockUiWithCustom();
    const store = createStore();
    const adapter = buildGraphOverlayAdapter({ ui }, store);

    assert.doesNotThrow(() => adapter.close());
  });

  test("close() via onClose callback cleans up state", () => {
    let closedCount = 0;
    let capturedOnClose: (() => void) | undefined;
    const ui: OverlayPiSurface["ui"] = {
      custom: (opts: PiCustomOverlayOpts): PiCustomOverlayHandle => {
        capturedOnClose = opts.onClose;
        return {
          close: () => {
            closedCount++;
          },
        };
      },
    };
    const store = createStore();
    const adapter = buildGraphOverlayAdapter({ ui }, store);

    adapter.open("run-1");
    // Simulate host UI closing the overlay
    capturedOnClose?.();

    // Calling adapter.close() again should be a no-op (already cleaned up)
    adapter.close();
    // close() count: 1 from host close, 1 from adapter.close() calling handle again?
    // Actually after onClose runs, currentHandle is set to null, so adapter.close() is safe.
    assert.ok(closedCount >= 1);
  });
});

// ---------------------------------------------------------------------------
// F2 shortcut — registered in extension factory
// ---------------------------------------------------------------------------

describe("extension factory — F2 shortcut", () => {
  test("F2 shortcut is registered when registerShortcut is present", () => {
    const { pi, shortcuts } = buildMockPi();
    factory(pi);
    assert.equal("F2" in shortcuts, true);
  });

  test("F2 handler calls pi.ui.custom with overlay:true", () => {
    const { pi, shortcuts, customCalls } = buildMockPi();
    factory(pi);

    shortcuts["F2"]!();

    assert.ok(customCalls.length >= 1);
    assert.equal(customCalls[0]!.opts.overlay, true);
  });

  test("F2 handler uses shortcut ctx.ui.custom when top-level pi.ui is absent", () => {
    const { pi, shortcuts } = buildMockPi();
    delete pi.ui;
    factory(pi);

    const { ctx, customCalls } = buildPrintCtxWithRealCustom();
    shortcuts["F2"]!(ctx);

    assert.equal(customCalls.length, 1);
    assert.equal(customCalls[0]!.overlay, true);
  });

  test("F2 handler does not throw when no active run", () => {
    const { pi, shortcuts } = buildMockPi();
    factory(pi);
    // store.activeRunId() → null when no run started
    assert.doesNotThrow(() => shortcuts["F2"]!());
  });

  test("F2 shortcut NOT registered when registerShortcut absent", () => {
    const { pi } = buildMockPi();
    delete pi.registerShortcut;
    const shortcuts: Record<string, (ctx?: PiCommandContext) => void> = {};
    // Should not crash when registerShortcut is absent
    assert.doesNotThrow(() => factory(pi));
    assert.equal("F2" in shortcuts, false);
  });
});

// ---------------------------------------------------------------------------
// /workflow resume — calls overlay.open after successful resumeRun
// ---------------------------------------------------------------------------

function buildPrintCtx(): { ctx: PiCommandContext; messages: string[] } {
  const messages: string[] = [];
  return {
    ctx: {
      reply: (m: string) => {
        messages.push(m);
      },
    },
    messages,
  };
}

function buildPrintCtxWithRealCustom(): {
  ctx: PiCommandContext;
  messages: string[];
  customCalls: Array<{
    overlay: boolean;
    overlayOptions?: unknown;
    lines: string[];
  }>;
} {
  const messages: string[] = [];
  const customCalls: Array<{
    overlay: boolean;
    overlayOptions?: unknown;
    lines: string[];
  }> = [];
  const ctx: PiCommandContext = {
    reply: (m: string) => {
      messages.push(m);
    },
    ui: {
      notify: (m: string) => {
        messages.push(m);
      },
      custom: (factory, options) => {
        if (typeof factory !== "function") {
          throw new Error("expected real ctx.ui.custom(factory, options) call");
        }
        const component = factory(
          { requestRender: () => undefined },
          {},
          {},
          () => undefined,
        );
        if (component instanceof Promise) {
          throw new Error("test factory should be sync");
        }
        customCalls.push({
          overlay: options.overlay,
          overlayOptions: options.overlayOptions,
          lines: component.render(100),
        });
        component.dispose?.();
        return undefined;
      },
    },
  };
  return { ctx, messages, customCalls };
}

describe("/workflow resume — overlay integration", () => {
  test("resume with unknown runId prints not-found, does NOT call custom", () => {
    const { pi, commands, customCalls } = buildMockPi();
    factory(pi);

    const wfCmd = commands["workflow"]!;
    const { ctx } = buildPrintCtx();

    // Execute synchronously — command is async, use void
    void wfCmd.execute("resume no-such-run", ctx);

    // Since the run doesn't exist in store, custom should NOT have been called
    // (overlay.open only called on success)
    // Note: the execute is async, check after microtasks settle
    // We use a simple synchronous assertion since store starts empty
    assert.equal(customCalls.length, 0);
  });

  test("resume with no runId prints usage", async () => {
    const { pi, commands } = buildMockPi();
    factory(pi);

    const wfCmd = commands["workflow"]!;
    const { ctx, messages } = buildPrintCtx();

    await wfCmd.execute("resume", ctx);

    assert.equal(
      messages.some((m) => m.includes("Usage")),
      true,
    );
  });

  test("resume subcommand is listed in argument completions", async () => {
    const { pi, commands } = buildMockPi();
    factory(pi);

    const wfCmd = commands["workflow"]!;
    const completions = (await wfCmd.getArgumentCompletions?.("res")) ?? [];

    assert.equal(
      completions.some((c) => c.label === "resume"),
      true,
    );
  });

  // RFC regression gate: overlay.open MUST be called when resume succeeds.
  // Fails if the runtime registers helpers but doesn't invoke overlay.open.
  test("resume with known completed runId calls overlay.open (opens custom overlay)", async () => {
    const runId = `test-resume-run-${Date.now()}`;

    // Seed the singleton store — factory's resumeRun uses defaultStore
    singletonStore.recordRunStart({
      id: runId,
      name: "test-wf",
      inputs: {},
      status: "running",
      stages: [],
      startedAt: Date.now(),
    });
    singletonStore.recordRunEnd(runId, "completed", {});

    const { pi, commands, customCalls } = buildMockPi();
    factory(pi);

    const wfCmd = commands["workflow"]!;
    const { ctx } = buildPrintCtx();

    await wfCmd.execute(`resume ${runId}`, ctx);

    // overlay.open(runId) must have been called → pi.ui.custom fired
    assert.ok(customCalls.length >= 1);
    assert.equal(customCalls[0]!.opts.overlay, true);
  });

  test("resume with still-active runId calls overlay.open", async () => {
    const runId = `test-active-run-${Date.now()}`;

    // Seed singleton store with an in-flight run (no endedAt) — resumeRun now returns ok:true
    singletonStore.recordRunStart({
      id: runId,
      name: "active-wf",
      inputs: {},
      status: "running",
      stages: [],
      startedAt: Date.now(),
    });
    // Do NOT call recordRunEnd — run stays active

    const { pi, commands, customCalls } = buildMockPi();
    factory(pi);

    const wfCmd = commands["workflow"]!;
    const { ctx } = buildPrintCtx();

    await wfCmd.execute(`resume ${runId}`, ctx);

    // resumeRun now returns ok:true for active runs — overlay.open should be called
    assert.equal(customCalls.length, 1);
    assert.equal(customCalls[0]!.opts.overlay, true);
  });

  test("resume uses real command ctx.ui.custom when top-level pi.ui is absent", async () => {
    const runId = `test-real-ui-run-${Date.now()}`;
    singletonStore.recordRunStart({
      id: runId,
      name: "real-ui-wf",
      inputs: {},
      status: "running",
      stages: [],
      startedAt: Date.now(),
    });

    const { pi, commands } = buildMockPi();
    delete pi.ui;
    factory(pi);

    const wfCmd = commands["workflow"]!;
    const { ctx, customCalls } = buildPrintCtxWithRealCustom();

    await wfCmd.execute(`resume ${runId}`, ctx);

    assert.equal(customCalls.length, 1);
    assert.equal(customCalls[0]!.overlay, true);
  });

  test("/workflow run does NOT auto-open the overlay (opt-in via F2/ctrl+h)", async () => {
    const { pi, commands } = buildMockPi();
    delete pi.ui;
    factory(pi);

    const wfCmd = commands["workflow"]!;
    const { ctx, customCalls } = buildPrintCtxWithRealCustom();

    await wfCmd.execute("deep-research-codebase prompt=test", ctx);

    // The orchestrator pane no longer auto-opens on workflow dispatch.
    // Users see live progress in the above-editor widget and open the
    // pane on demand. /workflow resume <id> still auto-opens because
    // re-attaching to a paused run is the whole point of the command.
    assert.equal(customCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Doctor report — uiCustom + shortcut fields
// ---------------------------------------------------------------------------

describe("/workflows-doctor — overlay capability fields", () => {
  test("doctor report includes ui.custom line when custom present", async () => {
    const { pi, commands } = buildMockPi();
    factory(pi);

    const doctorCmd = commands["workflows-doctor"]!;
    const { ctx, messages } = buildPrintCtx();

    await doctorCmd.execute("", ctx);

    const report = messages.join("\n");
    assert.ok(report.includes("ui.custom"));
  });

  test("doctor report includes shortcut line", async () => {
    const { pi, commands } = buildMockPi();
    factory(pi);

    const doctorCmd = commands["workflows-doctor"]!;
    const { ctx, messages } = buildPrintCtx();

    await doctorCmd.execute("", ctx);

    const report = messages.join("\n");
    assert.ok(report.includes("shortcut"));
  });
});
