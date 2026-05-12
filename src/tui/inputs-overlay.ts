/**
 * Mount adapter for the interactive argument picker. Reads like clack:
 *
 *     const result = await openInputsPicker(ui, workflow, fields, prefilled, theme);
 *     if (result.kind === "run") dispatch(workflow.name, result.values);
 *
 * The adapter handles the cursor-blink timer in addition to the standard
 * `pi.ui.custom` factory plumbing: a 530ms half-period interval (the
 * Neovim default rate, matching atomic's design TUI) drives a `cursorOn`
 * flag that's threaded into each render so single-line text fields show a
 * blinking caret instead of a static block.
 *
 * cross-ref:
 *  - src/tui/inputs-picker.ts (renderer + state + key handler)
 *  - src/tui/session-overlays.ts (same factory two-shape pattern)
 *  - flora131/atomic research/designs/workflow-picker-tui.tsx (cursor cadence)
 */

import type {
  PiCustomComponent,
  PiCustomOverlayFunction,
  PiCustomOverlayHandle,
  PiCustomOverlayOpts,
} from "../extension/wiring.js";
import type { WorkflowInputEntry } from "../extension/render-result.js";
import type { GraphTheme } from "./graph-theme.js";
import {
  coerceValues,
  createInputsPickerState,
  handleInputsPickerInput,
  renderInputsPicker,
} from "./inputs-picker.js";

const INPUTS_OVERLAY = {
  anchor: "center" as const,
  width: "70%",
  maxHeight: "85%",
} satisfies NonNullable<PiCustomOverlayOpts["overlayOptions"]>;

export interface InputsUiSurface {
  custom?: PiCustomOverlayFunction;
}

export type InputsPickerResult =
  | { kind: "run"; values: Record<string, unknown> }
  | { kind: "cancel" };

export interface OpenInputsPickerOpts {
  /** Workflow name shown in the header chip. */
  workflowName: string;
  /** Optional one-liner shown directly under the workflow name. */
  description?: string;
  /** Declared input schema. The picker handles 0-field workflows defensively
   *  but callers should gate on `fields.length > 0` before opening. */
  fields: readonly WorkflowInputEntry[];
  /** Values the user already supplied as CLI key=value tokens. The picker
   *  seeds these into the form so the user doesn't re-type what they typed. */
  prefilled?: Record<string, unknown>;
  theme: GraphTheme;
}

/**
 * Mount the inputs picker. Resolves with the coerced typed value map on
 * confirm, or `cancel` on esc / no UI surface.
 *
 * Behaviour matrix:
 *   - real two-arg `pi.ui.custom`: mounted as an overlay, settled by `done()`
 *   - legacy single-arg mock:     uses `onInput`/`onClose`/`close()` shape
 *   - no `pi.ui.custom` at all:   resolves `cancel` immediately so the slash
 *                                 command can fall back to the "missing
 *                                 required input" text path
 */
export function openInputsPicker(
  ui: InputsUiSurface,
  opts: OpenInputsPickerOpts,
): Promise<InputsPickerResult> {
  return new Promise<InputsPickerResult>((resolve) => {
    const { workflowName, description, fields, prefilled, theme } = opts;
    const custom = ui.custom;
    if (typeof custom !== "function") {
      resolve({ kind: "cancel" });
      return;
    }
    if (fields.length === 0) {
      // No inputs to collect — treat as immediate run with whatever the
      // caller already prefilled (likely empty).
      resolve({ kind: "run", values: coerceValues(fields, {}) });
      return;
    }

    const state = createInputsPickerState(fields, prefilled);
    let settled = false;
    let cursorOn = true;
    let cursorTimer: ReturnType<typeof setInterval> | null = null;

    const factoryReal = (
      tui: { requestRender?: () => void },
      _theme: unknown,
      _keys: unknown,
      done: (r: undefined) => void,
    ): PiCustomComponent => {
      // Start the blink as soon as the overlay mounts. We tear it down
      // on dispose to avoid leaking timers across overlay lifecycles.
      cursorTimer = setInterval(() => {
        cursorOn = !cursorOn;
        tui.requestRender?.();
      }, 530);

      const finish = (result: InputsPickerResult): void => {
        if (settled) return;
        settled = true;
        if (cursorTimer) clearInterval(cursorTimer);
        cursorTimer = null;
        done(undefined);
        resolve(result);
      };

      return {
        render: (width: number) =>
          renderInputsPicker({
            width,
            theme,
            workflowName,
            description,
            fields,
            state,
            cursorOn,
          }),
        handleInput: (data: string) => {
          const action = handleInputsPickerInput(data, state, fields);
          if (action.kind === "noop") {
            tui.requestRender?.();
            return;
          }
          finish(action);
        },
        invalidate: () => tui.requestRender?.(),
        dispose: () => {
          if (cursorTimer) clearInterval(cursorTimer);
          cursorTimer = null;
          if (!settled) {
            settled = true;
            resolve({ kind: "cancel" });
          }
        },
      };
    };

    if (custom.length >= 2) {
      const realCustom = custom as (
        factory: typeof factoryReal,
        o: { overlay: boolean; overlayOptions?: PiCustomOverlayOpts["overlayOptions"] },
      ) => Promise<undefined> | undefined;
      void realCustom(factoryReal, { overlay: true, overlayOptions: INPUTS_OVERLAY });
      return;
    }

    // Legacy mock fallback — same single-arg shape session-overlays uses.
    const legacyCustom = custom as (opts: PiCustomOverlayOpts) => PiCustomOverlayHandle | undefined;
    let handle: PiCustomOverlayHandle | undefined;
    const finishLegacy = (result: InputsPickerResult): void => {
      if (settled) return;
      settled = true;
      if (cursorTimer) clearInterval(cursorTimer);
      cursorTimer = null;
      handle?.close();
      resolve(result);
    };
    handle = legacyCustom({
      overlay: true,
      overlayOptions: INPUTS_OVERLAY,
      render: (width: number) =>
        renderInputsPicker({
          width,
          theme,
          workflowName,
          description,
          fields,
          state,
          cursorOn,
        }),
      onInput: (data: string) => {
        const action = handleInputsPickerInput(data, state, fields);
        if (action.kind === "noop") return true;
        finishLegacy(action);
        return true;
      },
      onClose: () => {
        if (cursorTimer) clearInterval(cursorTimer);
        cursorTimer = null;
        if (!settled) {
          settled = true;
          resolve({ kind: "cancel" });
        }
      },
    });
    if (!handle) {
      if (cursorTimer) clearInterval(cursorTimer);
      cursorTimer = null;
      resolve({ kind: "cancel" });
    }
  });
}
