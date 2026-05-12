/**
 * WorkflowGraphOverlayAdapter — mounts the orchestrator as a large centred
 * popup via pi.ui.custom + pi-tui's `setHidden` for cheap show/hide toggles.
 *
 * The popup is anchored center with ~85% width / ~80% height so it lands
 * as a focused, generously-sized pane on top of the chat. The toggle path
 * never re-mounts the overlay: it flips `OverlayHandle.setHidden(boolean)`
 * so state and animations survive across hide/show cycles.
 *
 * cross-ref:
 *   - src/tui/graph-view.ts
 *   - src/extension/wiring.ts  PiCustomOverlayRealOptions, PiOverlayHandle
 *   - @earendil-works/pi-tui dist/tui.d.ts  OverlayOptions, OverlayHandle
 *   - github.com/flora131/atomic packages/atomic-sdk/src/components/orchestrator-panel.tsx
 */

import type { Store } from "../shared/store.js";
import { GraphView } from "./graph-view.js";
import { deriveGraphTheme } from "./graph-theme.js";
import { killRun } from "../runs/background/status.js";
import { cancellationRegistry } from "../runs/background/cancellation-registry.js";
import type {
  PiCustomComponent,
  PiCustomOverlayFunction,
  PiCustomOverlayHandle,
  PiCustomOverlayOpts,
  PiOverlayHandle,
} from "../extension/wiring.js";

export interface OverlayUISurface {
  custom?: PiCustomOverlayFunction;
}

export interface OverlayPiSurface {
  ui?: OverlayUISurface;
}

/**
 * Port exposed to the extension factory.
 * `open(runId)`  — bring the pane to front (creating it if needed).
 * `toggle(runId)`— show if hidden, hide if visible, create if absent.
 * `close()`      — permanently dismiss.
 */
export interface GraphOverlayPort {
  open(runId: string | null, surface?: OverlayPiSurface): void;
  toggle(runId: string | null, surface?: OverlayPiSurface): void;
  close(): void;
}

/**
 * Floating-popup positioning. NOTE: we currently mount the orchestrator
 * as a focused full-screen pane (`overlay: false`) because that's the
 * only pi-tui mode that keeps the orchestrator pane out of the chat's
 * scroll buffer. A floating overlay (`overlay: true`) lives in the same
 * terminal buffer as the chat — every chat scroll event captures the
 * overlay frame into scrollback, producing visible "duplicate" header
 * rows over time. These constants stay here for the legacy fallback
 * path and for an eventual switch back once pi-tui isolates overlays
 * from the scrollback.
 */
const CENTER_OVERLAY_OPTIONS = {
  anchor: "center" as const,
  width: "85%",
  maxHeight: "90%",
  margin: { top: 1 },
} satisfies NonNullable<PiCustomOverlayOpts["overlayOptions"]>;

export function buildGraphOverlayAdapter(
  pi: OverlayPiSurface,
  store: Store,
): GraphOverlayPort {
  let currentView: GraphView | null = null;
  let currentLegacyHandle: PiCustomOverlayHandle | null = null;
  // pi-tui returns an OverlayHandle when running the real `(factory, opts)`
  // shape. We hold onto it so toggle() can flip `setHidden` rather than
  // remounting the overlay — every remount commits the previous overlay
  // frame into the chat scrollback, producing visible duplicates.
  let currentRealHandle: PiOverlayHandle | null = null;
  let mounted = false;
  let finishMounted: (() => void) | null = null;

  function close(): void {
    currentLegacyHandle?.close();
    currentRealHandle?.hide();
    finishMounted?.();
    currentView?.dispose();
    currentLegacyHandle = null;
    currentRealHandle = null;
    finishMounted = null;
    currentView = null;
    mounted = false;
  }

  function makeComponent(
    view: GraphView,
    tui?: { requestRender?: () => void },
  ): PiCustomComponent {
    // No render interval. Polling pi to redraw the overlay every 120ms
    // produced a fresh screen frame on each tick — tmux scrollback then
    // captured every transitional frame as a separate row, which is
    // what surfaced as duplicate `Orchestrator deep-research-codebase …`
    // rows when watching a long-running workflow. Re-renders now flow
    // only from store updates (pushed via `view.invalidate()`) and from
    // genuine keyboard input.
    const onStoreUpdate = (): void => {
      view.invalidate();
      tui?.requestRender?.();
    };
    const unsubscribe = store.subscribe(onStoreUpdate);
    return {
      render: (width: number) => view.render(width),
      handleInput: (data: string) => {
        const consumed = view.handleInput(data);
        if (consumed) tui?.requestRender?.();
      },
      invalidate: () => tui?.requestRender?.(),
      dispose: () => {
        unsubscribe();
        view.dispose();
      },
    };
  }

  function open(runId: string | null, surface?: OverlayPiSurface): void {
    // Already mounted but hidden — flip visibility without remounting.
    if (mounted && currentRealHandle?.isHidden()) {
      currentRealHandle.setHidden(false);
      currentRealHandle.focus();
      return;
    }
    if (mounted) return; // already showing.

    const ui = surface?.ui ?? pi.ui;
    const custom = ui?.custom;
    if (typeof custom !== "function") return;

    if (custom.length >= 2) {
      const realCustom = custom as (
        factory: (
          tui: { requestRender?: () => void },
          theme: unknown,
          keybindings: unknown,
          done: (result: undefined) => void,
        ) => PiCustomComponent,
        options: {
          overlay: boolean;
          overlayOptions?: PiCustomOverlayOpts["overlayOptions"];
          onHandle?: (handle: PiOverlayHandle) => void;
        },
      ) => Promise<undefined> | undefined;

      let settled = false;
      void realCustom(
        (tui, _theme, _keybindings, done) => {
          const finish = (): void => {
            if (settled) return;
            settled = true;
            currentView?.dispose();
            currentView = null;
            currentRealHandle = null;
            finishMounted = null;
            mounted = false;
            done(undefined);
          };
          const view = new GraphView({
            mode: "overlay",
            runId,
            store,
            graphTheme: deriveGraphTheme({}),
            onClose: finish,
            onHide: () => {
              currentRealHandle?.setHidden(true);
              currentRealHandle?.unfocus();
            },
            onKill: (id) => {
              killRun(id, { store, cancellation: cancellationRegistry });
            },
          });
          currentView = view;
          finishMounted = finish;
          mounted = true;
          return makeComponent(view, tui);
        },
        {
          // True floating overlay: pi-tui's overlay layer paints on top
          // of the chat without appending re-rendered frames to the
          // buffer (doom-overlay updates at 35fps with this mode and
          // stays in place). `overlay: false` mounts in editorContainer
          // and ended up appending every redraw to scrollback.
          overlay: true,
          overlayOptions: CENTER_OVERLAY_OPTIONS,
          onHandle: (handle) => {
            currentRealHandle = handle;
          },
        },
      );
      return;
    }

    // Legacy test-only shape: pi.ui.custom(opts) → handle.
    const view = new GraphView({
      mode: "overlay",
      runId,
      store,
      graphTheme: deriveGraphTheme({}),
      onClose: () => close(),
      onKill: (id) => {
        killRun(id, { store, cancellation: cancellationRegistry });
      },
    });
    const legacyOpts: PiCustomOverlayOpts = {
      overlay: true,
      overlayOptions: CENTER_OVERLAY_OPTIONS,
      render: (width: number) => view.render(width),
      onInput: (data: string) => view.handleInput(data),
      onClose: close,
    };
    const legacyCustom = custom as (opts: PiCustomOverlayOpts) => PiCustomOverlayHandle | undefined;
    const handle = legacyCustom(legacyOpts);
    if (!handle) {
      view.dispose();
      return;
    }
    currentView = view;
    currentLegacyHandle = handle;
    mounted = true;
  }

  function toggle(runId: string | null, surface?: OverlayPiSurface): void {
    // Hide without unmounting if we have a real handle (no remount means
    // no scroll-pollution). Falls back to close() for the legacy mock path.
    if (mounted && currentRealHandle) {
      const nowHidden = !currentRealHandle.isHidden();
      currentRealHandle.setHidden(nowHidden);
      if (!nowHidden) currentRealHandle.focus();
      return;
    }
    if (mounted) {
      close();
      return;
    }
    open(runId, surface);
  }

  return { open, toggle, close };
}
