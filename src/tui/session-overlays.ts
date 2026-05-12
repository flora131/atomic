/**
 * Mount adapters for the session picker and kill-confirmation overlays.
 * Each function returns a Promise that resolves with the user's action,
 * so call sites read like clack: `const choice = await openPicker(...)`.
 *
 * Both helpers prefer pi-tui's real two-arg `(factory, opts)` signature
 * (returns a Promise that resolves on `done()`), and fall back to the
 * legacy single-arg `(opts)` shape used by older test mocks.
 *
 * The picker auto-refreshes when the store changes — every store
 * mutation invalidates the overlay so a stage transitioning to "running"
 * is visible without keystrokes.
 *
 * cross-ref:
 *  - src/tui/overlay-adapter.ts (same mount pattern for the GraphView)
 *  - src/extension/wiring.ts PiCustomOverlayFunction shape definitions
 */

import type {
  PiCustomComponent,
  PiCustomOverlayFunction,
  PiCustomOverlayHandle,
  PiCustomOverlayOpts,
  PiOverlayHandle,
} from "../extension/wiring.js";
import type { Store } from "../shared/store.js";
import type { GraphTheme } from "./graph-theme.js";
import {
  createSessionPickerState,
  handleSessionPickerInput,
  renderSessionPicker,
  selectRunsForPicker,
} from "./session-picker.js";
import {
  createKillConfirmState,
  handleKillConfirmInput,
  renderKillConfirm,
} from "./session-confirm.js";
import type { RunSnapshot } from "../shared/store-types.js";

const PICKER_OVERLAY = {
  anchor: "center" as const,
  width: "70%",
  maxHeight: "80%",
} satisfies NonNullable<PiCustomOverlayOpts["overlayOptions"]>;

const CONFIRM_OVERLAY = {
  anchor: "center" as const,
  width: "60%",
} satisfies NonNullable<PiCustomOverlayOpts["overlayOptions"]>;

export interface UiSurface {
  custom?: PiCustomOverlayFunction;
}

export type SessionPickerResult =
  | { kind: "connect"; runId: string }
  | { kind: "kill"; runId: string }
  | { kind: "close" };

/**
 * Mount the session picker. Resolves when the user picks an action
 * (connect / kill) or dismisses with esc. The overlay handles its own
 * filter input + navigation; callers receive only the terminal action.
 */
export function openSessionPicker(
  ui: UiSurface,
  store: Store,
  theme: GraphTheme,
): Promise<SessionPickerResult> {
  return new Promise<SessionPickerResult>((resolve) => {
    const custom = ui.custom;
    if (typeof custom !== "function") {
      // No custom-overlay surface — caller should fall back to a textual
      // path (e.g. resolve immediately as "close" so the slash command
      // can print a hint to use a runId argument).
      resolve({ kind: "close" });
      return;
    }

    const state = createSessionPickerState();
    let settled = false;
    let unsubscribe: (() => void) | null = null;

    const factoryReal = (
      tui: { requestRender?: () => void },
      _theme: unknown,
      _keys: unknown,
      done: (r: undefined) => void,
    ): PiCustomComponent => {
      const finish = (result: SessionPickerResult): void => {
        if (settled) return;
        settled = true;
        unsubscribe?.();
        unsubscribe = null;
        done(undefined);
        resolve(result);
      };
      // Re-render on store changes so newly-started runs appear and
      // status icons refresh without the user having to press a key.
      unsubscribe = store.subscribe(() => tui.requestRender?.());
      return {
        render: (width: number) => {
          const rows = selectRunsForPicker(store.runs(), state.query, state.includeAll);
          return renderSessionPicker({ width, theme, rows, state });
        },
        handleInput: (data: string) => {
          const rows = selectRunsForPicker(store.runs(), state.query, state.includeAll);
          const action = handleSessionPickerInput(data, state, rows);
          if (action.kind === "noop") {
            tui.requestRender?.();
            return;
          }
          if (action.kind === "close") finish({ kind: "close" });
          else if (action.kind === "connect") finish({ kind: "connect", runId: action.runId });
          else finish({ kind: "kill", runId: action.runId });
        },
        invalidate: () => tui.requestRender?.(),
        dispose: () => {
          unsubscribe?.();
          unsubscribe = null;
          if (!settled) {
            settled = true;
            resolve({ kind: "close" });
          }
        },
      };
    };

    if (custom.length >= 2) {
      const realCustom = custom as (
        factory: typeof factoryReal,
        opts: { overlay: boolean; overlayOptions?: PiCustomOverlayOpts["overlayOptions"] },
      ) => Promise<undefined> | undefined;
      void realCustom(factoryReal, { overlay: true, overlayOptions: PICKER_OVERLAY });
      return;
    }

    // Legacy mock fallback.
    const legacyCustom = custom as (opts: PiCustomOverlayOpts) => PiCustomOverlayHandle | undefined;
    let handle: PiCustomOverlayHandle | undefined;
    const finishLegacy = (result: SessionPickerResult): void => {
      if (settled) return;
      settled = true;
      handle?.close();
      resolve(result);
    };
    handle = legacyCustom({
      overlay: true,
      overlayOptions: PICKER_OVERLAY,
      render: (width: number) => {
        const rows = selectRunsForPicker(store.runs(), state.query, state.includeAll);
        return renderSessionPicker({ width, theme, rows, state });
      },
      onInput: (data: string) => {
        const rows = selectRunsForPicker(store.runs(), state.query, state.includeAll);
        const action = handleSessionPickerInput(data, state, rows);
        if (action.kind === "noop") return true;
        if (action.kind === "close") finishLegacy({ kind: "close" });
        else if (action.kind === "connect") finishLegacy({ kind: "connect", runId: action.runId });
        else finishLegacy({ kind: "kill", runId: action.runId });
        return true;
      },
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve({ kind: "close" });
        }
      },
    });
    if (!handle) {
      resolve({ kind: "close" });
    }
  });
}

/**
 * Mount the kill-confirmation overlay. Resolves with `true` when the user
 * confirms, `false` otherwise. When `pi.ui.custom` is unavailable, falls
 * back to `pi.ui.confirm` if present, else returns `false` (safe default
 * for a destructive action).
 */
export interface ConfirmUiSurface extends UiSurface {
  confirm?: (title: string, message: string) => Promise<boolean>;
}

export function openKillConfirm(
  ui: ConfirmUiSurface,
  run: RunSnapshot,
  theme: GraphTheme,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const custom = ui.custom;
    if (typeof custom !== "function") {
      // Fall back to plain confirm dialog when available.
      if (typeof ui.confirm === "function") {
        ui.confirm(
          "Kill workflow run?",
          `Abort ${run.name} (${run.id.slice(0, 8)})? Active stage work will be discarded.`,
        ).then(resolve, () => resolve(false));
        return;
      }
      resolve(false);
      return;
    }

    const state = createKillConfirmState();
    let settled = false;

    const factoryReal = (
      tui: { requestRender?: () => void },
      _theme: unknown,
      _keys: unknown,
      done: (r: undefined) => void,
    ): PiCustomComponent => {
      const finish = (result: boolean): void => {
        if (settled) return;
        settled = true;
        done(undefined);
        resolve(result);
      };
      return {
        render: (width: number) => renderKillConfirm({ width, theme, run, state }),
        handleInput: (data: string) => {
          const action = handleKillConfirmInput(data, state);
          if (action.kind === "noop") {
            tui.requestRender?.();
            return;
          }
          finish(action.kind === "confirm");
        },
        invalidate: () => tui.requestRender?.(),
        dispose: () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        },
      };
    };

    if (custom.length >= 2) {
      const realCustom = custom as (
        factory: typeof factoryReal,
        opts: { overlay: boolean; overlayOptions?: PiCustomOverlayOpts["overlayOptions"]; onHandle?: (h: PiOverlayHandle) => void },
      ) => Promise<undefined> | undefined;
      void realCustom(factoryReal, { overlay: true, overlayOptions: CONFIRM_OVERLAY });
      return;
    }

    const legacyCustom = custom as (opts: PiCustomOverlayOpts) => PiCustomOverlayHandle | undefined;
    let handle: PiCustomOverlayHandle | undefined;
    const finishLegacy = (result: boolean): void => {
      if (settled) return;
      settled = true;
      handle?.close();
      resolve(result);
    };
    handle = legacyCustom({
      overlay: true,
      overlayOptions: CONFIRM_OVERLAY,
      render: (width: number) => renderKillConfirm({ width, theme, run, state }),
      onInput: (data: string) => {
        const action = handleKillConfirmInput(data, state);
        if (action.kind === "noop") return true;
        finishLegacy(action.kind === "confirm");
        return true;
      },
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
    if (!handle) resolve(false);
  });
}
