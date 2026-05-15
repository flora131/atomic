/**
 * Widget installer — wires the orchestrator's above-editor widget to the
 * workflow store, mirroring the eager `setWidget + requestRender` pattern
 * from nicobailon/pi-subagents src/tui/render.ts `renderWidget`.
 *
 * Pattern:
 *   1. Every store mutation re-calls `ui.setWidget(WIDGET_KEY, factory)`
 *      with a *fresh* factory. Pi disposes the previous component,
 *      mounts the new one, and redraws. There is no long-lived component
 *      that subscribes to the store internally — that pattern leaves the
 *      widget visually stale after `up-arrow` history recall and similar
 *      editor events that force a re-render without a setWidget call.
 *   2. After `setWidget` we call `ui.requestRender()` to flush the new
 *      content immediately; pi-subagents does the same in its
 *      `rerenderWidget` helper.
 *   3. The widget contents are static per snapshot (no spinner, no live
 *      ticker) so we do not run an animation timer. Store mutations from
 *      stage / tool-execution events are the sole render trigger — this
 *      matches every other workflow status surface (`/workflow status`,
 *      `renderRunDetail`, the orchestrator overlay) which all render
 *      instantly without animation.
 *   4. The factory builds a pi-tui `Container` of `Text` children styled
 *      via pi's runtime `Theme` (theme.fg, theme.bold). This is what
 *      makes the widget visually distinct from chat content.
 */

import type { Store } from "../shared/store.js";
import type { StoreSnapshot, RunSnapshot } from "../shared/store-types.js";
import { buildThemedWidgetLines } from "./widget.js";

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

export interface LiveWidgetAPI {
  ui?: UiSlice;
  events?: {
    on?: (event: string, handler: (payload: unknown) => void) => void;
  };
}

const WIDGET_KEY = "workflow.run";
const STALE_CONTEXT = "This extension ctx is stale";

function isStale(err: unknown): boolean {
  return err instanceof Error && err.message.includes(STALE_CONTEXT);
}

/**
 * Build the widget factory closure. Pi invokes the factory with
 * `(this.ui, theme)` — we use the supplied theme to apply pi's terminal
 * palette to every span.
 */
function widgetFactory(snap: StoreSnapshot): WidgetFactory {
  return (_tui, theme) => {
    const lines = buildThemedWidgetLines(snap, theme as PiTheme | undefined);
    return {
      render: (_width: number) => lines,
    };
  };
}

export function installStoreWidget(
  pi: LiveWidgetAPI,
  storeInstance: Store,
): () => void {
  const ui = pi.ui;
  if (!ui?.setWidget) return () => {};

  const rerender = (): void => {
    try {
      const snap = storeInstance.snapshot();
      const hasActiveRuns = (snap.runs as RunSnapshot[]).some(
        (r) => r.endedAt === undefined,
      );
      if (!hasActiveRuns) {
        ui.setWidget?.(WIDGET_KEY, undefined);
        return;
      }
      ui.setWidget?.(WIDGET_KEY, widgetFactory(snap), { placement: "aboveEditor" });
      ui.requestRender?.();
    } catch (err) {
      if (isStale(err)) return;
      throw err;
    }
  };

  const unsubscribe = storeInstance.subscribe(() => rerender());
  rerender();

  return () => {
    unsubscribe();
    try {
      ui.setWidget?.(WIDGET_KEY, undefined);
    } catch (err) {
      if (!isStale(err)) throw err;
    }
  };
}

interface ToolExecutionStartPayload {
  toolName?: string;
  tool_name?: string;
  runId?: string;
  run_id?: string;
  stageId?: string;
  stage_id?: string;
  input?: Record<string, unknown>;
  ts?: number;
}

interface ToolExecutionEndPayload extends ToolExecutionStartPayload {
  output?: string;
  endedAt?: number;
  ended_at?: number;
  error?: string;
}

export function installToolExecutionHooks(pi: LiveWidgetAPI, storeInstance: Store): void {
  const on = pi.events?.on;
  if (typeof on !== "function") return;

  function resolveIds(payload: ToolExecutionStartPayload): { runId: string; stageId: string } | null {
    const runId = payload.runId ?? payload.run_id ?? storeInstance.activeRunId();
    if (!runId) return null;

    const stageId = payload.stageId ?? payload.stage_id;
    if (stageId) return { runId, stageId };

    const run = storeInstance.runs().find((candidate) => candidate.id === runId);
    const runningStage = run?.stages.find((s) => s.status === "running");
    if (!runningStage) return null;

    return { runId, stageId: runningStage.id };
  }

  function recordToolStart(payload: unknown): void {
    if (!isToolExecutionPayload(payload)) return;

    const ids = resolveIds(payload);
    if (!ids) return;

    storeInstance.recordToolStart(ids.runId, ids.stageId, {
      name: toolName(payload),
      input: payload.input,
      startedAt: payload.ts ?? Date.now(),
    });
  }

  function recordToolEnd(payload: unknown): void {
    if (!isToolExecutionPayload(payload)) return;

    const ids = resolveIds(payload);
    if (!ids) return;

    storeInstance.recordToolEnd(ids.runId, ids.stageId, {
      name: toolName(payload),
      input: payload.input,
      startedAt: payload.ts ?? Date.now(),
      endedAt: payload.endedAt ?? payload.ended_at ?? Date.now(),
      output: payload.output,
    });
  }

  on.call(pi.events, "tool_execution_start", safelyHandle(recordToolStart));
  on.call(pi.events, "tool_execution_update", safelyHandle(recordToolStart));
  on.call(pi.events, "tool_execution_end", safelyHandle(recordToolEnd));
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
  return payload.toolName ?? payload.tool_name ?? "unknown";
}
