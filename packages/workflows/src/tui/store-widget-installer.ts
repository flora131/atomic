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

import {
  decideReactiveWidgetAction,
  installReactiveWidget,
  type ReactiveWidgetAction,
  type ReactiveWidgetFactory,
  type ReactiveWidgetRenderState,
  type ReactiveWidgetTimerApi,
  type ReactiveWidgetTimerHandle,
} from "@bastani/atomic";
import type { Store } from "../shared/store.js";
import type { StoreSnapshot } from "../shared/store-types.js";
import { buildThemedWidgetLines, nextWidgetRefreshDelayMs } from "./widget.js";

export interface PiTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

export type WidgetFactory = ReactiveWidgetFactory<unknown>;
export type WidgetAction = ReactiveWidgetAction;
export type WidgetRenderState = ReactiveWidgetRenderState;

interface UiSlice {
  setWidget?: (
    key: string,
    factory: WidgetFactory | undefined,
    opts?: { placement?: string },
  ) => void;
  requestRender?: () => void;
}

interface TimerApi extends ReactiveWidgetTimerApi {}
interface TimerHandle extends ReactiveWidgetTimerHandle {}

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

export function decideWidgetAction(
  prev: WidgetRenderState,
  nextLines: readonly string[],
): WidgetAction {
  return decideReactiveWidgetAction(prev, nextLines);
}

export function installStoreWidget(
  pi: LiveWidgetAPI,
  storeInstance: Store,
  timers: TimerApi = defaultTimerApi,
): () => void {
  const ui = pi.ui;
  if (!ui?.setWidget) return () => {};

  const requestRender = ui.requestRender;
  const controller = installReactiveWidget<StoreSnapshot, unknown>({
    ui: {
      setWidget: (key, factory, opts) => ui.setWidget?.(key, factory, opts),
      ...(requestRender ? { requestRender: () => requestRender.call(ui) } : {}),
    },
    key: WIDGET_KEY,
    placement: "belowEditor",
    timers,
    getSnapshot: () => storeInstance.snapshot(),
    subscribe: (listener) => storeInstance.subscribe(() => listener()),
    getPreviewLines: (snap, now) => buildThemedWidgetLines(snap, undefined, 120, now),
    render: (snap, { theme, width, now }) =>
      buildThemedWidgetLines(snap, theme as PiTheme | undefined, width, now),
    getNextRefreshDelayMs: (snap, now) => nextWidgetRefreshDelayMs(snap, now),
    isStaleError: isStale,
  });

  return () => controller.dispose();
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

    const activeAskCall = findActiveAskCall(payload);
    const ids = activeAskCall ?? resolveIds(payload, false);
    if (!ids) return;

    storeInstance.recordToolEnd(ids.runId, ids.stageId, {
      name: toolName(payload),
      input: toolInput(payload),
      startedAt: payload.ts ?? Date.now(),
      endedAt: payload.endedAt ?? payload.ended_at ?? Date.now(),
      output: payload.output,
    });
    recordAskUserQuestionEnd(payload, activeAskCall ?? ids);
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
