/**
 * Widget installer — wires the orchestrator's below-editor widget to the
 * workflow store using a single long-lived component that is updated in
 * place (issue #1109).
 *
 * Placement note (belowEditor, not aboveEditor): the widget renders a live
 * elapsed clock that re-renders every second. pi-tui full-clears the screen +
 * scrollback whenever a changed line is above the viewport fold. An
 * aboveEditor widget gets pushed above the fold once the bottom region grows
 * tall, so each clock tick repainted the whole screen (the resize flicker in
 * #1109). belowEditor keeps the widget among the last rendered lines (always
 * within the bottom viewport), so the clock tick is a clean differential
 * redraw. See the `setWidget` call site for the full rationale.
 *
 * Pattern:
 *   1. The widget mounts once (`ui.setWidget(WIDGET_KEY, factory)`) on the
 *      hidden→visible transition and unmounts once
 *      (`ui.setWidget(WIDGET_KEY, undefined)`) on visible→hidden. Pi treats
 *      every `setWidget` call as a full replacement — it disposes the
 *      previous component, constructs a fresh one, rebuilds the widget
 *      container, and redraws — so re-issuing `setWidget` on each store
 *      mutation or clock tick produces a visible flicker. We therefore call
 *      it only on real mount/unmount transitions.
 *   2. For every other refresh — store mutations that change content and
 *      the one-shot clock-refresh timer alike — we call `ui.requestRender()`
 *      only. Pi re-invokes the *same* mounted component's `render(width)`
 *      with no dispose/remount, so the elapsed-time label keeps ticking
 *      smoothly without flicker.
 *   3. The long-lived component reads the *latest* store snapshot through a
 *      live getter (`() => currentSnap`) at render time, so it is never
 *      visually stale — including after `up-arrow` history recall and other
 *      editor events that force a host re-render without a `setWidget` call.
 *   4. The mount / unmount / update / none decision is extracted into the
 *      pure, unit-testable `decideWidgetAction`, keeping this module a thin
 *      orchestration layer over a pure policy (SRP).
 *   5. The widget contents are static per snapshot (no spinner), but the
 *      rendered lines include wall-clock labels (`3s`, `complete · 4s ago`)
 *      and recent-ended visibility. We therefore keep one lightweight
 *      one-shot refresh timer while the widget is visible, matching other
 *      live Atomic widgets without reintroducing a high-frequency spinner.
 */

import type { Store } from "../shared/store.js";
import type { StoreSnapshot } from "../shared/store-types.js";
import { buildThemedWidgetLines, nextWidgetRefreshDelayMs } from "./widget.js";

export interface PiTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

export type WidgetFactory = (
  tui: unknown,
  theme: PiTheme | unknown,
) => Component & { dispose?(): void };

export interface Component {
  render(width: number): string[];
  dispose?(): void;
}

interface UiSlice {
  setWidget?: (
    key: string,
    factory: WidgetFactory | undefined,
    opts?: { placement?: string },
  ) => void;
  requestRender?: () => void;
}

interface TimerHandle {
  unref?: () => void;
}

interface TimerApi {
  setTimeout(handler: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

const defaultTimerApi: TimerApi = {
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs) as TimerHandle,
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface LiveWidgetAPI {
  ui?: UiSlice;
  on?: (event: string, handler: (payload: unknown, context?: unknown) => void) => void;
  events?: {
    on?: (event: string, handler: (payload: unknown) => void) => void;
  };
}

const WIDGET_KEY = "workflow.run";
const STALE_CONTEXT = "This extension ctx is stale";

function isStale(err: unknown): boolean {
  return err instanceof Error && err.message.includes(STALE_CONTEXT);
}

/** The four ways a refresh can reach (or skip) the terminal. */
export type WidgetAction = "mount" | "unmount" | "update" | "none";

export interface WidgetRenderState {
  /** Whether the widget is currently mounted (factory installed via setWidget). */
  readonly mounted: boolean;
  /** Plain preview lines last rendered while mounted (empty when not mounted). */
  readonly lines: readonly string[];
}

function linesEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Pure decision: given the previous mount state + previously rendered lines
 * and the next preview lines, decide how a refresh should reach the terminal.
 *  - hidden  → visible             => "mount"   (setWidget(factory))
 *  - visible → hidden              => "unmount" (setWidget(undefined))
 *  - visible → visible, changed    => "update"  (requestRender only — no remount)
 *  - visible → visible, identical  => "none"    (skip the redundant repaint)
 *  - hidden  → hidden              => "none"
 *
 * No UI/terminal dependency, so it is unit-testable without a real terminal.
 */
export function decideWidgetAction(
  prev: WidgetRenderState,
  nextLines: readonly string[],
): WidgetAction {
  const nextVisible = nextLines.length > 0;
  if (!prev.mounted) return nextVisible ? "mount" : "none";
  if (!nextVisible) return "unmount";
  return linesEqual(prev.lines, nextLines) ? "none" : "update";
}

/**
 * Build the long-lived widget factory closure. Pi invokes the factory once
 * with `(this.ui, theme)` at mount; the returned component is reused across
 * renders. It closes over a *live* snapshot getter rather than a captured
 * snapshot, so each `requestRender()` recomputes lines from the latest
 * snapshot (and a fresh `Date.now()`) with no dispose/remount.
 */
function widgetFactory(getSnap: () => StoreSnapshot): WidgetFactory {
  return (_tui, theme) => {
    return {
      render: (width: number) =>
        buildThemedWidgetLines(getSnap(), theme as PiTheme | undefined, width),
    };
  };
}

export function installStoreWidget(
  pi: LiveWidgetAPI,
  storeInstance: Store,
  timers: TimerApi = defaultTimerApi,
): () => void {
  const ui = pi.ui;
  if (!ui?.setWidget) return () => {};

  let disposed = false;
  let refreshTimer: TimerHandle | undefined;
  // In-place widget state: whether the long-lived component is mounted, the
  // latest snapshot it should render, and the last plain preview lines used
  // to detect no-op refreshes.
  let mounted = false;
  let currentSnap: StoreSnapshot;
  let lastLines: readonly string[] = [];

  const clearRefreshTimer = (): void => {
    if (refreshTimer === undefined) return;
    timers.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  };

  const scheduleRefresh = (snap: StoreSnapshot): void => {
    const delayMs = nextWidgetRefreshDelayMs(snap);
    if (delayMs === undefined) return;
    refreshTimer = timers.setTimeout(() => {
      refreshTimer = undefined;
      rerender();
    }, delayMs);
    refreshTimer.unref?.();
  };

  const rerender = (): void => {
    if (disposed) return;
    clearRefreshTimer();
    try {
      currentSnap = storeInstance.snapshot();
      const nextLines = buildThemedWidgetLines(currentSnap, undefined);
      const action = decideWidgetAction({ mounted, lines: lastLines }, nextLines);

      switch (action) {
        case "mount":
          // Mount the single long-lived component. It reads `currentSnap`
          // through the getter on every subsequent render, so we never need
          // to re-issue setWidget to refresh content.
          ui.setWidget?.(WIDGET_KEY, widgetFactory(() => currentSnap), {
            // belowEditor (not aboveEditor): the widget renders a live elapsed
            // clock that re-renders every second. pi-tui's differential
            // renderer does a full screen+scrollback clear whenever a *changed*
            // line sits ABOVE the viewport fold (tui.js `firstChanged <
            // prevViewportTop -> fullRender(true)`). An aboveEditor widget is
            // pushed above the fold when the bottom region (usage meter,
            // multi-line editor, below-editor widgets, footer) grows tall,
            // so each clock tick then repainted the whole screen — the resize
            // flicker in #1109. belowEditor keeps the widget among the last
            // rendered lines (always within the bottom viewport), so its
            // per-second tick is a clean in-place differential redraw.
            placement: "belowEditor",
          });
          ui.requestRender?.();
          mounted = true;
          break;
        case "unmount":
          ui.setWidget?.(WIDGET_KEY, undefined);
          ui.requestRender?.();
          mounted = false;
          break;
        case "update":
          // In place — NO setWidget, NO dispose/remount (the #1109 flicker fix).
          ui.requestRender?.();
          break;
        case "none":
          break;
      }

      lastLines = nextLines;
      scheduleRefresh(currentSnap);
    } catch (err) {
      if (isStale(err)) return;
      throw err;
    }
  };

  const unsubscribe = storeInstance.subscribe(() => rerender());
  rerender();

  return () => {
    disposed = true;
    clearRefreshTimer();
    unsubscribe();
    try {
      ui.setWidget?.(WIDGET_KEY, undefined);
      ui.requestRender?.();
    } catch (err) {
      if (!isStale(err)) throw err;
    }
  };
}

interface ToolExecutionStartPayload {
  toolName?: string;
  tool_name?: string;
  name?: string;
  runId?: string;
  run_id?: string;
  stageId?: string;
  stage_id?: string;
  toolCallId?: string;
  tool_call_id?: string;
  toolUseId?: string;
  tool_use_id?: string;
  id?: string;
  input?: Record<string, unknown>;
  args?: Record<string, unknown>;
  ts?: number;
}

interface ToolExecutionEndPayload extends ToolExecutionStartPayload {
  output?: string;
  endedAt?: number;
  ended_at?: number;
  error?: string;
}

export function installToolExecutionHooks(pi: LiveWidgetAPI, storeInstance: Store): void {
  const eventBusOn = pi.events?.on;
  const extensionOn = pi.on;
  if (typeof eventBusOn !== "function" && typeof extensionOn !== "function") return;

  const activeAskUserQuestionCalls = new Map<string, { runId: string; stageId: string; callId: string }>();

  function resolveIds(payload: ToolExecutionStartPayload, includeAwaitingInput = false): { runId: string; stageId: string } | null {
    const runId = payload.runId ?? payload.run_id ?? storeInstance.activeRunId();
    if (!runId) return null;

    const stageId = payload.stageId ?? payload.stage_id;
    if (stageId) return { runId, stageId };

    const run = storeInstance.runs().find((candidate) => candidate.id === runId);
    const runningStage = run?.stages.find((s) => s.status === "running");
    if (runningStage) return { runId, stageId: runningStage.id };

    if (includeAwaitingInput) {
      const awaitingStage = run?.stages.find((s) => s.status === "awaiting_input");
      if (awaitingStage) return { runId, stageId: awaitingStage.id };
    }

    return null;
  }

  function activeCallKey(runId: string, stageId: string, callId: string): string {
    return `${runId}:${stageId}:${callId}`;
  }

  function findActiveAskCall(payload: ToolExecutionStartPayload): { runId: string; stageId: string; callId: string } | undefined {
    const runId = payload.runId ?? payload.run_id;
    const stageId = payload.stageId ?? payload.stage_id;
    const callId = toolCallId(payload);

    if (runId !== undefined && stageId !== undefined) {
      return activeAskUserQuestionCalls.get(activeCallKey(runId, stageId, callId));
    }

    const matches = [...activeAskUserQuestionCalls.values()].filter((entry) => {
      if (entry.callId !== callId) return false;
      if (runId !== undefined && entry.runId !== runId) return false;
      if (stageId !== undefined && entry.stageId !== stageId) return false;
      return true;
    });
    return matches.length === 1 ? matches[0] : undefined;
  }

  function stageHasActiveAskCall(runId: string, stageId: string): boolean {
    return [...activeAskUserQuestionCalls.values()].some(
      (entry) => entry.runId === runId && entry.stageId === stageId,
    );
  }

  function recordAskUserQuestionStart(payload: ToolExecutionStartPayload, ids: { runId: string; stageId: string }): void {
    if (!isAskUserQuestionToolName(toolName(payload))) return;
    const callId = toolCallId(payload);
    activeAskUserQuestionCalls.set(activeCallKey(ids.runId, ids.stageId, callId), {
      ...ids,
      callId,
    });
    storeInstance.recordStageAwaitingInput(ids.runId, ids.stageId, true, payload.ts);
  }

  function recordAskUserQuestionEnd(payload: ToolExecutionStartPayload, ids: { runId: string; stageId: string } | null): void {
    const activeCall = findActiveAskCall(payload);
    const resolvedIds = activeCall ?? ids;
    if (resolvedIds === null || resolvedIds === undefined) return;

    const shouldClear = activeCall !== undefined || isAskUserQuestionToolName(toolName(payload));
    if (!shouldClear) return;

    activeAskUserQuestionCalls.delete(activeCallKey(resolvedIds.runId, resolvedIds.stageId, toolCallId(payload)));
    if (!stageHasActiveAskCall(resolvedIds.runId, resolvedIds.stageId)) {
      storeInstance.recordStageAwaitingInput(resolvedIds.runId, resolvedIds.stageId, false);
    }
  }

  function recordToolStart(payload: unknown): void {
    if (!isToolExecutionPayload(payload)) return;

    const ids = resolveIds(payload);
    if (!ids) return;

    storeInstance.recordToolStart(ids.runId, ids.stageId, {
      name: toolName(payload),
      input: toolInput(payload),
      startedAt: payload.ts ?? Date.now(),
    });
    recordAskUserQuestionStart(payload, ids);
  }

  function recordToolEnd(payload: unknown): void {
    if (!isToolExecutionPayload(payload)) return;

    const ids = findActiveAskCall(payload) ?? resolveIds(payload, true);
    if (!ids) return;

    storeInstance.recordToolEnd(ids.runId, ids.stageId, {
      name: toolName(payload),
      input: toolInput(payload),
      startedAt: payload.ts ?? Date.now(),
      endedAt: payload.endedAt ?? payload.ended_at ?? Date.now(),
      output: payload.output,
    });
    recordAskUserQuestionEnd(payload, ids);
  }

  const safeStart = safelyHandle(recordToolStart);
  const safeEnd = safelyHandle(recordToolEnd);

  if (typeof eventBusOn === "function") {
    eventBusOn.call(pi.events, "tool_execution_start", safeStart);
    eventBusOn.call(pi.events, "tool_execution_update", safeStart);
    eventBusOn.call(pi.events, "tool_execution_end", safeEnd);
  }
  if (typeof extensionOn === "function") {
    extensionOn.call(pi, "tool_execution_start", safeStart);
    extensionOn.call(pi, "tool_execution_update", safeStart);
    extensionOn.call(pi, "tool_execution_end", safeEnd);
    extensionOn.call(pi, "tool_call", safeStart);
    extensionOn.call(pi, "tool_result", safeEnd);
  }
}

function isToolExecutionPayload(payload: unknown): payload is ToolExecutionEndPayload {
  return typeof payload === "object" && payload !== null;
}

function safelyHandle(handler: (payload: unknown) => void): (payload: unknown) => void {
  return (payload: unknown): void => {
    try {
      handler(payload);
    } catch {
      // Event hooks must not crash pi runtime when optional event payloads vary.
    }
  };
}

function toolName(payload: ToolExecutionStartPayload): string {
  return payload.toolName ?? payload.tool_name ?? payload.name ?? "unknown";
}

function toolCallId(payload: ToolExecutionStartPayload): string {
  return payload.toolCallId ?? payload.tool_call_id ?? payload.toolUseId ?? payload.tool_use_id ?? payload.id ?? "__ask_user_question__";
}

function toolInput(payload: ToolExecutionStartPayload): Record<string, unknown> | undefined {
  return payload.input ?? payload.args;
}

function isAskUserQuestionToolName(name: string): boolean {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "") === "askuserquestion";
}
