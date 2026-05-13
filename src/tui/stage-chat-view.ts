/**
 * StageChatView — in-place chat surface for an attached workflow stage.
 *
 * Visual contract: ui/attach-mockup.html — same outer popup chrome as
 * the orchestrator graph, only the interior swaps. The first frame is a
 * stage-profile / welcome panel (before transcript content exists); once
 * messages start streaming, the transcript replaces the welcome panel.
 *
 * Behaviour:
 *  - Idle stage: Enter sends `handle.prompt(text)`.
 *  - Running stage: Enter sends `handle.steer(text)` (interrupt mid-turn).
 *  - `ctrl+f` queues a follow-up via `handle.followUp(text)`.
 *  - `ctrl+p` triggers a controlled pause via `handle.pause()`; while
 *    paused, Enter sends the resume message via `handle.resume(text)`.
 *  - `ctrl+d` calls `onDetach` so the parent attach shell can swap back
 *    to graph mode.
 *  - Escape closes the whole popup via `onClose` (does NOT kill the run).
 *
 * cross-ref:
 *  - src/runs/foreground/stage-control-registry.ts (StageControlHandle)
 *  - src/tui/graph-view.ts (peer Component pattern)
 *  - oh-my-pi docs/sdk.md (AgentSession.prompt/steer/followUp)
 */

import type { Store } from "../shared/store.js";
import type { StageSnapshot } from "../shared/store-types.js";
import type { GraphTheme } from "./graph-theme.js";
import type { StageControlHandle } from "../runs/foreground/stage-control-registry.js";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent";
import { hexToAnsi, RESET, BOLD } from "./color-utils.js";
import { visibleWidth, truncateToWidth } from "./text-helpers.js";

export interface StageChatViewOpts {
  store: Store;
  graphTheme: GraphTheme;
  runId: string;
  stageId: string;
  /**
   * The workflow display name, used in the title chrome
   * (`<workflow> / <stage>`).
   */
  workflowName: string;
  /**
   * Live stage-control handle when available. When absent the chat is
   * inspect-only (settled stage with no live handle).
   */
  handle?: StageControlHandle;
  /** Called when the user presses ctrl+d (back to graph). */
  onDetach: () => void;
  /** Called when the user presses Escape (close the whole popup). */
  onClose: () => void;
  /**
   * Optional accessor returning the current terminal row count. The
   * chat surface expands its body band to roughly `viewportRows` minus
   * the fixed header/input/footer rows so the popup fills the terminal
   * under pi-tui's `width: "100%" / maxHeight: "100%"` geometry.
   * Returning `undefined` falls back to the constant 32-row frame.
   */
  getViewportRows?: () => number | undefined;
}

interface TranscriptEntry {
  /** Role + content text — small surface used for plain rendering. */
  readonly role: "user" | "assistant" | "tool" | "thinking" | "system";
  readonly text: string;
}

interface Component {
  render(width: number): string[];
  handleInput?(data: string): boolean | void;
  invalidate?(): void;
  dispose?(): void;
}

/**
 * Default line budget used when the host doesn't surface terminal
 * dimensions (direct unit renders, lightweight test mocks). The
 * mounted overlay overrides this by passing `getViewportRows()`.
 */
const VIEW_LINE_COUNT = 32;
const HEADER_ROWS = 3;
const FOOTER_ROWS = 3;
const INPUT_ROWS = 3;

const HINT_KEYS: Array<{ key: string; label: string }> = [
  { key: "↵", label: "send" },
  { key: "ctrl+f", label: "follow-up" },
  { key: "ctrl+p", label: "pause" },
  { key: "ctrl+d", label: "back" },
  { key: "esc", label: "close" },
];

const PAUSED_HINTS: Array<{ key: string; label: string }> = [
  { key: "↵", label: "resume" },
  { key: "ctrl+d", label: "back" },
  { key: "esc", label: "close" },
];

export class StageChatView implements Component {
  private store: Store;
  private theme: GraphTheme;
  private runId: string;
  private stageId: string;
  private workflowName: string;
  private handle: StageControlHandle | undefined;
  private onDetach: () => void;
  private onClose: () => void;
  private getViewportRows?: () => number | undefined;

  private inputBuffer = "";
  private transcript: TranscriptEntry[] = [];
  private statusMessage = "";
  /** True while a pending pause request is in flight (between ctrl+p and resolve). */
  private localPaused = false;

  private _unsubscribeStore: (() => void) | null = null;
  private _unsubscribeHandle: (() => void) | null = null;

  constructor(opts: StageChatViewOpts) {
    this.store = opts.store;
    this.theme = opts.graphTheme;
    this.runId = opts.runId;
    this.stageId = opts.stageId;
    this.workflowName = opts.workflowName;
    this.handle = opts.handle;
    this.onDetach = opts.onDetach;
    this.onClose = opts.onClose;
    this.getViewportRows = opts.getViewportRows;

    // Snapshot live messages from the handle so the transcript reflects
    // the SDK session state at attach time. After this, we rely on
    // subscribe events for incremental updates.
    this._snapshotMessagesFromHandle();

    this._unsubscribeStore = this.store.subscribe(() => {
      // Re-snapshot if the stage transitioned (paused/resumed). The
      // host re-renders independently when the store notifies, so the
      // subscription is just used to refresh `localPaused`.
      const stage = this._currentStage();
      if (stage && stage.status === "paused") this.localPaused = true;
      else if (stage && stage.status === "running") this.localPaused = false;
    });

    if (this.handle) {
      this._unsubscribeHandle = this.handle.subscribe((event) => {
        this._appendEvent(event);
      });
    }
  }

  private _snapshotMessagesFromHandle(): void {
    if (!this.handle) return;
    for (const message of this.handle.messages) {
      const role = (message.role as "user" | "assistant" | "tool" | "system" | undefined) ?? "assistant";
      const text = extractMessageText(message.content);
      if (text) this.transcript.push({ role, text });
    }
  }

  private _appendEvent(event: AgentSessionEvent): void {
    // Best-effort event → transcript projection. The SDK event shape is
    // intentionally loose (see oh-my-pi-shim.d.ts) so we project only
    // text-bearing events we recognise.
    const type = String((event as { type?: unknown }).type ?? "");
    if (type === "message_update") {
      const text = extractMessageText((event as { content?: unknown }).content);
      const role = ((event as { role?: unknown }).role as TranscriptEntry["role"] | undefined) ?? "assistant";
      if (text) this._upsertLastByRole(role, text);
    } else if (type === "tool_call" || type === "tool_use") {
      const name = String((event as { name?: unknown }).name ?? "tool");
      this.transcript.push({ role: "tool", text: `→ ${name}` });
    } else if (type === "tool_result") {
      const name = String((event as { name?: unknown }).name ?? "tool");
      const out = String((event as { output?: unknown }).output ?? "");
      this.transcript.push({
        role: "tool",
        text: out ? `← ${name} ${truncateToWidth(out.replace(/\s+/g, " "), 80)}` : `← ${name}`,
      });
    } else if (type === "thinking_delta" || type === "thinking") {
      const delta = String((event as { delta?: unknown }).delta ?? (event as { text?: unknown }).text ?? "");
      if (delta) this._upsertLastByRole("thinking", delta);
    }
  }

  private _upsertLastByRole(role: TranscriptEntry["role"], text: string): void {
    const last = this.transcript[this.transcript.length - 1];
    if (last && last.role === role) {
      this.transcript[this.transcript.length - 1] = { role, text };
    } else {
      this.transcript.push({ role, text });
    }
  }

  private _currentStage(): StageSnapshot | undefined {
    const snap = this.store.snapshot();
    const run = snap.runs.find((r) => r.id === this.runId);
    return run?.stages.find((s) => s.id === this.stageId);
  }

  /**
   * Number of rows the chat surface paints per frame. Pi-tui positions
   * the overlay based on rendered line count, so to fill the terminal
   * under `maxHeight: "100%"` we render `terminal.rows` lines. Returns
   * `VIEW_LINE_COUNT` (32) when the host hasn't surfaced terminal
   * dimensions, preserving the legacy fixed rectangle for unit tests
   * and lightweight mocks.
   */
  private _viewLineCount(): number {
    const reported = this.getViewportRows?.();
    if (typeof reported !== "number" || !Number.isFinite(reported)) {
      return VIEW_LINE_COUNT;
    }
    return Math.max(VIEW_LINE_COUNT, Math.floor(reported));
  }

  /** Rows available for the transcript body (between header/input/footer). */
  private _bodyRows(): number {
    return Math.max(1, this._viewLineCount() - HEADER_ROWS - FOOTER_ROWS - INPUT_ROWS);
  }

  render(width: number): string[] {
    const w = Math.max(40, width);
    const stage = this._currentStage();
    const lineCount = this._viewLineCount();
    const lines: string[] = [];
    lines.push(...this._renderHeader(w, stage));
    lines.push(...this._renderBody(w));
    lines.push(...this._renderInput(w));
    lines.push(...this._renderFooter(w, stage));
    while (lines.length < lineCount) lines.push(this._blankRow(w));
    if (lines.length > lineCount) lines.length = lineCount;
    return lines;
  }

  private _renderHeader(width: number, stage: StageSnapshot | undefined): string[] {
    const accent = hexToAnsi(this.theme.accent);
    const dim = hexToAnsi(this.theme.dim);
    const text = hexToAnsi(this.theme.text);
    const muted = hexToAnsi(this.theme.textMuted);
    const stageName = stage?.name ?? "stage";
    const title = `${BOLD}${text}${this.workflowName}${RESET}${dim} / ${RESET}${accent}${stageName}${RESET}`;
    const backPill = `${muted}Ctrl+D ${RESET}${dim}← back to graph${RESET}`;
    const titleW = visibleWidth(this.workflowName) + 3 + visibleWidth(stageName);
    const backW = visibleWidth("Ctrl+D ← back to graph");
    const gap = Math.max(1, width - titleW - backW - 2);
    return [
      ` ${title}${" ".repeat(gap)}${backPill} `,
      this._blankRow(width),
      this._sepRow(width),
    ];
  }

  private _renderBody(width: number): string[] {
    const lines: string[] = [];
    const accent = hexToAnsi(this.theme.accent);
    const dim = hexToAnsi(this.theme.dim);
    const text = hexToAnsi(this.theme.text);
    const muted = hexToAnsi(this.theme.textMuted);
    const bodyRows = this._bodyRows();

    if (this.transcript.length === 0) {
      // Welcome panel (no transcript yet). Mirrors the mockup's stage
      // profile, scaled down to a single column.
      lines.push(` ${BOLD}${text}Welcome back!${RESET}`);
      lines.push(this._blankRow(width));
      const sessionId = this.handle?.sessionId ?? "(no session yet)";
      const sessionFile = this.handle?.sessionFile;
      lines.push(` ${muted}session id  ${RESET}${dim}${sessionId}${RESET}`);
      if (sessionFile) lines.push(` ${muted}session file${RESET} ${dim}${sessionFile}${RESET}`);
      lines.push(this._blankRow(width));
      lines.push(` ${muted}stage status${RESET} ${accent}${this._currentStage()?.status ?? "pending"}${RESET}`);
      if (this.statusMessage) {
        lines.push(this._blankRow(width));
        lines.push(` ${dim}${truncateToWidth(this.statusMessage, width - 2)}${RESET}`);
      }
    } else {
      const visible = this.transcript.slice(-bodyRows);
      for (const entry of visible) {
        lines.push(this._renderTranscriptRow(entry, width));
      }
    }
    while (lines.length < bodyRows) lines.push(this._blankRow(width));
    if (lines.length > bodyRows) lines.length = bodyRows;
    return lines;
  }

  private _renderTranscriptRow(entry: TranscriptEntry, width: number): string {
    const accent = hexToAnsi(this.theme.accent);
    const text = hexToAnsi(this.theme.text);
    const muted = hexToAnsi(this.theme.textMuted);
    const dim = hexToAnsi(this.theme.dim);
    const labelColor = entry.role === "user" ? accent : entry.role === "tool" ? muted : text;
    const label =
      entry.role === "user"
        ? "you"
        : entry.role === "assistant"
        ? "agent"
        : entry.role === "tool"
        ? "tool"
        : entry.role === "thinking"
        ? "thinking"
        : entry.role;
    const body = truncateToWidth(entry.text.replace(/\s+/g, " ").trim(), Math.max(8, width - 12));
    return ` ${labelColor}${label.padEnd(8)}${RESET}${dim}│${RESET} ${text}${body}${RESET}`;
  }

  private _renderInput(width: number): string[] {
    const accent = hexToAnsi(this.theme.accent);
    const dim = hexToAnsi(this.theme.dim);
    const text = hexToAnsi(this.theme.text);
    const muted = hexToAnsi(this.theme.textMuted);
    const placeholder =
      this.localPaused
        ? "type to resume, or ctrl+d to back out…"
        : this.handle?.isStreaming
        ? "Enter steers the current turn · ctrl+f follow-up · ctrl+p pause"
        : "type a message…";
    const value = this.inputBuffer
      ? `${text}${truncateToWidth(this.inputBuffer, width - 6)}${RESET}`
      : `${muted}${placeholder}${RESET}`;
    return [
      ` ${accent}▎${RESET} ${value}${dim}▌${RESET}`,
      this._blankRow(width),
      this._sepRow(width),
    ];
  }

  private _renderFooter(width: number, stage: StageSnapshot | undefined): string[] {
    const dim = hexToAnsi(this.theme.dim);
    const text = hexToAnsi(this.theme.text);
    const muted = hexToAnsi(this.theme.textMuted);
    const sep = `${dim} · ${RESET}`;
    const hints = this.localPaused || stage?.status === "paused" ? PAUSED_HINTS : HINT_KEYS;
    const hintLine = hints
      .map(({ key, label }) => `${text}${key}${RESET} ${muted}${label}${RESET}`)
      .join(sep);
    const tag = `${muted}pi-workflows/${this.workflowName}/${stage?.name ?? "stage"}${RESET}`;
    const tagW = visibleWidth(`pi-workflows/${this.workflowName}/${stage?.name ?? "stage"}`);
    const hintW = visibleWidth(hintLine);
    const gap = Math.max(1, width - hintW - tagW - 2);
    return [
      this._blankRow(width),
      ` ${hintLine}${" ".repeat(gap)}${tag} `,
      this._blankRow(width),
    ];
  }

  private _blankRow(width: number): string {
    return " ".repeat(width);
  }

  private _sepRow(width: number): string {
    const dim = hexToAnsi(this.theme.dim);
    return `${dim}${"─".repeat(width)}${RESET}`;
  }

  handleInput(data: string): boolean {
    // ctrl+d — back to graph
    if (data === "\x04") {
      this.onDetach();
      return true;
    }
    // Escape — close popup
    if (data === "\x1b") {
      this.onClose();
      return true;
    }
    // ctrl+p — pause
    if (data === "\x10") {
      void this._pause();
      return true;
    }
    // ctrl+f — follow-up
    if (data === "\x06") {
      void this._submit("followUp");
      return true;
    }
    // Enter — submit (prompt|steer|resume depending on state)
    if (data === "\r" || data === "\n") {
      void this._submit("auto");
      return true;
    }
    // Backspace
    if (data === "\x7f" || data === "\b") {
      this.inputBuffer = this.inputBuffer.slice(0, -1);
      return true;
    }
    // Printable
    if (data.length === 1 && data >= " " && data <= "~") {
      this.inputBuffer += data;
      return true;
    }
    return false;
  }

  private async _pause(): Promise<void> {
    if (!this.handle) {
      this.statusMessage = "no live handle on this stage";
      return;
    }
    this.localPaused = true;
    this.statusMessage = "pausing…";
    try {
      await this.handle.pause();
      this.statusMessage = "paused";
    } catch (err) {
      this.statusMessage = `pause failed: ${err instanceof Error ? err.message : String(err)}`;
      this.localPaused = false;
    }
  }

  private async _submit(mode: "auto" | "followUp"): Promise<void> {
    const text = this.inputBuffer.trim();
    if (!text) return;
    this.inputBuffer = "";
    if (!this.handle) {
      this.statusMessage = "no live handle on this stage";
      this.transcript.push({ role: "system", text: "(no live handle — message dropped)" });
      return;
    }
    this.transcript.push({ role: "user", text });
    try {
      if (this.localPaused) {
        await this.handle.resume(text);
        this.localPaused = false;
        this.statusMessage = "resumed";
        return;
      }
      if (mode === "followUp") {
        await this.handle.followUp(text);
        return;
      }
      if (this.handle.isStreaming) {
        // Default for running stage: steer the current turn (interrupt
        // mid-stream). Explicit follow-up is on ctrl+f.
        await this.handle.steer(text);
      } else {
        await this.handle.ensureAttached();
        await this.handle.prompt(text);
      }
    } catch (err) {
      this.statusMessage = err instanceof Error ? err.message : String(err);
    }
  }

  invalidate(): void {
    // No-op: render reads directly from the store snapshot + handle.
  }

  dispose(): void {
    this._unsubscribeStore?.();
    this._unsubscribeStore = null;
    this._unsubscribeHandle?.();
    this._unsubscribeHandle = null;
  }

  // ---- Test seams ----
  get _inputBuffer(): string {
    return this.inputBuffer;
  }
  get _transcript(): readonly TranscriptEntry[] {
    return this.transcript;
  }
  get _statusMessage(): string {
    return this.statusMessage;
  }
  get _isLocalPaused(): boolean {
    return this.localPaused;
  }
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (item == null) continue;
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    const obj = item as { type?: unknown; text?: unknown };
    if (typeof obj.text === "string") parts.push(obj.text);
    else if (obj.type === "text" && typeof obj.text === "string") parts.push(obj.text);
  }
  return parts.join("");
}
