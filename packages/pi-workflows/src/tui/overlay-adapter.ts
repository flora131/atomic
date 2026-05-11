/**
 * WorkflowGraphOverlayAdapter — opens/closes the GraphView overlay
 * via pi.ui.custom({ overlay: true }).
 *
 * The adapter is constructed once during extension initialisation and then
 * shared between:
 *   - The F2 keyboard shortcut (open active run or list all runs).
 *   - The `/workflow resume <runId>` slash command.
 *
 * cross-ref:
 *   - packages/pi-workflows/src/tui/graph-view.ts
 *   - packages/pi-workflows/src/extension/wiring.ts  PiCustomOverlayOpts
 *   - research/docs/2026-05-11-pi-coding-agent-reference.md §5.4
 */

import type { Store } from "../store.js";
import { GraphView } from "./graph-view.js";
import { deriveGraphTheme } from "./graph-theme.js";
import type { PiCustomOverlayHandle } from "../extension/wiring.js";
import type { PiCustomOverlayOpts } from "../extension/wiring.js";

// ---------------------------------------------------------------------------
// Surface slices (structurally typed — no import of full ExtensionAPI)
// ---------------------------------------------------------------------------

/** Minimum pi.ui slice needed to open a custom overlay. */
export interface OverlayUISurface {
  custom?: (opts: PiCustomOverlayOpts) => PiCustomOverlayHandle | undefined;
}

/** Minimum pi slice consumed by buildGraphOverlayAdapter. */
export interface OverlayPiSurface {
  ui?: OverlayUISurface;
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Port exposed to the extension factory.
 * `open(runId)` — show overlay for a specific run.
 * `open(null)`  — show overlay for the active run (F2 behaviour).
 * `close()`     — dismiss the overlay if open.
 */
export interface GraphOverlayPort {
  open(runId: string | null): void;
  close(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * No-op adapter returned when pi.ui.custom is absent.
 * Keeps the extension factory logic unconditional.
 */
const noopOverlay: GraphOverlayPort = {
  open: () => undefined,
  close: () => undefined,
};

/**
 * Build a GraphOverlayPort backed by pi.ui.custom + GraphView.
 *
 * Returns noopOverlay when pi.ui?.custom is absent (degraded runtime).
 */
export function buildGraphOverlayAdapter(
  pi: OverlayPiSurface,
  store: Store,
): GraphOverlayPort {
  if (typeof pi.ui?.custom !== "function") {
    return noopOverlay;
  }

  const piCustom = pi.ui.custom.bind(pi.ui);

  let currentView: GraphView | null = null;
  let currentHandle: PiCustomOverlayHandle | null = null;
  const graphTheme = deriveGraphTheme({});

  function close(): void {
    currentHandle?.close();
    currentView?.dispose();
    currentHandle = null;
    currentView = null;
  }

  function open(runId: string | null): void {
    // Dismiss any existing overlay first.
    close();

    const view = new GraphView({
      mode: "overlay",
      runId,
      store,
      graphTheme,
      onClose: close,
    });

    const handle = piCustom({
      overlay: true,
      render: (width: number) => view.render(width),
      onInput: (data: string) => view.handleInput(data),
      onClose: close,
    });

    if (!handle) {
      // pi.ui.custom returned undefined — runtime doesn't support overlays.
      view.dispose();
      return;
    }

    currentView = view;
    currentHandle = handle;
  }

  return { open, close };
}
