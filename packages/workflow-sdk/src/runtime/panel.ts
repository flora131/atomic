/**
 * OpenTUI-based orchestrator panel with session switcher sidebar.
 *
 * Renders a full TUI inside the tmux orchestrator pane using @opentui/core.
 * Design inspired by the Atomic Workflow Builder UX prototype — pipeline-style
 * execution rail with status pills, animated spinners, and tree connectors.
 */

import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  StyledText,
  t, bold, dim, fg,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { tmuxRun } from "./tmux.ts";
import { resolveTheme, type TerminalTheme } from "./theme.ts";

// ---------------------------------------------------------------------------
// Unicode icons (cross-platform safe, no emoji)
// ---------------------------------------------------------------------------

const ICON = {
  check: "\u2713",      // ✓
  cross: "\u2717",      // ✗
  arrow: "\u2192",      // →
  ellipsis: "\u2026",   // …
  dot: "\u00B7",        // ·
  pending: "\u25CB",    // ○
  active: "\u25CF",     // ●
  pipe: "\u2502",       // │
} as const;

const SPINNER_FRAMES = [
  "\u280B", "\u2819", "\u2839", "\u2838",
  "\u283C", "\u2834", "\u2826", "\u2827",
  "\u2807", "\u280F",
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIDEBAR_WIDTH = 24;
const SIDEBAR_COLLAPSE_THRESHOLD = 80;
const SIDEBAR_NAME_MAX = 18;
const SPINNER_INTERVAL_MS = 80;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionStatus = "pending" | "running" | "complete" | "error";

interface SidebarEntry {
  name: string;
  status: SessionStatus;
  windowTarget: string | null;
  box: BoxRenderable;
  text: TextRenderable;
}

interface SessionNode {
  name: string;
  status: SessionStatus;
  headerBox: BoxRenderable;
  statusText: TextRenderable;
  nameText: TextRenderable;
  detailBox: BoxRenderable;
}

export interface PanelOptions {
  tmuxSession: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateName(name: string, maxLen: number): string {
  return name.length > maxLen
    ? name.slice(0, maxLen - 1) + ICON.ellipsis
    : name;
}

// ---------------------------------------------------------------------------
// OrchestratorPanel
// ---------------------------------------------------------------------------

export class OrchestratorPanel {
  private renderer: CliRenderer;

  // Main content
  private rootBox: BoxRenderable;
  private mainBox: BoxRenderable;
  private headerText: TextRenderable;
  private contentScroll: ScrollBoxRenderable;
  private footerBox: BoxRenderable;
  private completionLine: TextRenderable;
  private transcriptsLine: TextRenderable;
  private footerHintsLine: TextRenderable;

  // Session pipeline tracking
  private sessionNodes: SessionNode[] = [];
  private currentNode: SessionNode | null = null;
  private stepCounter = 0;

  // Sidebar
  private sidebarBox: BoxRenderable;
  private sidebarList: BoxRenderable;
  private sidebarHints: TextRenderable;
  private sidebarEntries: SidebarEntry[] = [];
  private selectedIndex = 0;
  private sidebarFocused = false;
  private sidebarVisible = true;

  // State
  private tmuxSession: string;
  private theme: TerminalTheme;
  private destroyed = false;
  private completionReached = false;
  private exitResolve: (() => void) | null = null;

  // Spinner animation
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  private spinnerText: TextRenderable | null = null;
  private spinnerBox: BoxRenderable | null = null;
  private spinnerLabel = "";

  // ── Construction ────────────────────────────────────────────────────────

  private constructor(renderer: CliRenderer, options: PanelOptions, theme: TerminalTheme) {
    this.renderer = renderer;
    this.tmuxSession = options.tmuxSession;
    this.theme = theme;

    // Root: row layout, no border
    this.rootBox = new BoxRenderable(renderer, {
      id: "orch-root",
      width: "100%",
      height: "100%",
      flexDirection: "row",
      backgroundColor: this.theme.bg,
      gap: 1,
    });

    // ── Main content panel ──────────────────────────────────────────────

    this.mainBox = new BoxRenderable(renderer, {
      id: "orch-main",
      flexGrow: 1,
      flexDirection: "column",
      borderStyle: "rounded",
      borderColor: this.theme.border,
      title: " Orchestrator ",
      titleAlignment: "left",
      padding: 1,
    });

    this.headerText = new TextRenderable(renderer, {
      id: "orch-header",
      content: t`${dim(`Loading workflow${ICON.ellipsis}`)}`,
    });

    this.contentScroll = new ScrollBoxRenderable(renderer, {
      id: "orch-scroll",
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: "bottom",
      contentOptions: {
        flexDirection: "column",
        paddingTop: 1,
      },
    });

    // Footer — three separate TextRenderables to prevent garbled output
    this.footerBox = new BoxRenderable(renderer, {
      id: "orch-footer",
      flexDirection: "column",
      paddingTop: 1,
    });
    this.footerBox.visible = false;

    this.completionLine = new TextRenderable(renderer, {
      id: "orch-completion-line",
      content: "",
    });
    this.transcriptsLine = new TextRenderable(renderer, {
      id: "orch-transcripts-line",
      content: "",
    });
    this.footerHintsLine = new TextRenderable(renderer, {
      id: "orch-hints-line",
      content: "",
    });

    this.footerBox.add(this.completionLine);
    this.footerBox.add(this.transcriptsLine);
    this.footerBox.add(this.footerHintsLine);

    this.mainBox.add(this.headerText);
    this.mainBox.add(this.contentScroll);
    this.mainBox.add(this.footerBox);

    // ── Sidebar panel ───────────────────────────────────────────────────

    this.sidebarBox = new BoxRenderable(renderer, {
      id: "orch-sidebar",
      width: SIDEBAR_WIDTH,
      flexDirection: "column",
      borderStyle: "rounded",
      borderColor: this.theme.borderDim,
      title: " Sessions ",
      titleAlignment: "left",
    });

    this.sidebarList = new BoxRenderable(renderer, {
      id: "orch-sidebar-list",
      flexGrow: 1,
      flexDirection: "column",
      paddingTop: 1,
    });

    this.sidebarHints = new TextRenderable(renderer, {
      id: "orch-sidebar-hints",
      content: t`${dim(" Tab to focus")}`,
    });

    this.sidebarBox.add(this.sidebarList);
    this.sidebarBox.add(this.sidebarHints);

    // ── Compose root ────────────────────────────────────────────────────

    this.rootBox.add(this.mainBox);
    this.rootBox.add(this.sidebarBox);
    renderer.root.add(this.rootBox);

    // ── Orchestrator entry in sidebar ───────────────────────────────────

    this.addSidebarEntry("orchestrator", "running", "orchestrator");

    // ── Event handlers ──────────────────────────────────────────────────

    renderer.keyInput.on("keypress", this.handleKey);
    renderer.on("resize", this.handleResize);

    this.sidebarVisible = renderer.width >= SIDEBAR_COLLAPSE_THRESHOLD;
    this.sidebarBox.visible = this.sidebarVisible;
  }

  static async create(options: PanelOptions): Promise<OrchestratorPanel> {
    const theme = await resolveTheme();
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      // Exclude SIGINT — executor's signal handler manages Ctrl+C shutdown.
      // Keep other signals so the terminal is restored on unexpected termination.
      exitSignals: ["SIGTERM", "SIGQUIT", "SIGABRT", "SIGHUP", "SIGPIPE", "SIGBUS", "SIGFPE"],
    });
    return new OrchestratorPanel(renderer, options, theme);
  }

  // ── Sidebar ────────────────────────────────────────────────────────────

  private addSidebarEntry(name: string, status: SessionStatus, windowTarget: string | null): void {
    const index = this.sidebarEntries.length;
    const truncated = truncateName(name, SIDEBAR_NAME_MAX);

    const box = new BoxRenderable(this.renderer, {
      id: `sidebar-${index}`,
      paddingLeft: 1,
      paddingRight: 1,
    });

    const text = new TextRenderable(this.renderer, {
      id: `sidebar-${index}-text`,
      content: this.formatSidebarEntry(truncated, status),
    });

    box.add(text);
    this.sidebarList.add(box);
    this.sidebarEntries.push({ name, status, windowTarget, box, text });

    if (index === this.selectedIndex) {
      box.backgroundColor = this.theme.selection;
    }
  }

  private updateSidebarEntry(name: string, status: SessionStatus, windowTarget?: string): void {
    const entry = this.sidebarEntries.find((e) => e.name === name);
    if (!entry) return;
    entry.status = status;
    if (windowTarget !== undefined) entry.windowTarget = windowTarget;
    entry.text.content = this.formatSidebarEntry(
      truncateName(entry.name, SIDEBAR_NAME_MAX), status,
    );
  }

  private formatSidebarEntry(name: string, status: SessionStatus): StyledText {
    switch (status) {
      case "pending":  return t`${dim(`${ICON.pending} ${name}`)}`;
      case "running":  return t`${fg(this.theme.accent)(`${ICON.active} ${name}`)}`;
      case "complete": return t`${fg(this.theme.success)(`${ICON.check} ${name}`)}`;
      case "error":    return t`${fg(this.theme.error)(`${ICON.cross} ${name}`)}`;
    }
  }

  private navigateSidebar(dir: number): void {
    if (this.sidebarEntries.length === 0) return;
    const cur = this.sidebarEntries[this.selectedIndex];
    if (cur) cur.box.backgroundColor = "transparent";
    this.selectedIndex =
      (this.selectedIndex + dir + this.sidebarEntries.length) % this.sidebarEntries.length;
    const next = this.sidebarEntries[this.selectedIndex];
    if (next) next.box.backgroundColor = this.theme.selection;
  }

  private switchToSelectedWindow(): void {
    const entry = this.sidebarEntries[this.selectedIndex];
    if (!entry?.windowTarget) return;
    tmuxRun(["select-window", "-t", `${this.tmuxSession}:${entry.windowTarget}`]);
  }

  private updateSidebarFocus(): void {
    this.sidebarBox.borderColor = this.sidebarFocused ? this.theme.accent : this.theme.borderDim;
    this.sidebarHints.content = this.sidebarFocused
      ? t`${dim(` \u2191\u2193 ${ICON.dot} Enter`)}`
      : t`${dim(" Tab to focus")}`;
  }

  // ── Spinner Animation ─────────────────────────────────────────────────

  private startSpinner(textNode: TextRenderable, box: BoxRenderable, label: string): void {
    this.stopSpinner();
    this.spinnerText = textNode;
    this.spinnerBox = box;
    this.spinnerLabel = label;
    this.spinnerFrame = 0;
    this.tickSpinner();
    this.renderer.requestLive();
    this.spinnerTimer = setInterval(() => this.tickSpinner(), SPINNER_INTERVAL_MS);
  }

  private tickSpinner(): void {
    if (!this.spinnerText) return;
    const frame = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length];
    this.spinnerText.content = t`${fg(this.theme.accent)(`${frame} ${this.spinnerLabel}`)}`;
    this.spinnerFrame++;
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    if (this.spinnerBox) {
      this.spinnerBox.visible = false;
      this.spinnerBox = null;
    }
    if (this.spinnerText) {
      this.spinnerText.visible = false;
      this.spinnerText = null;
    }
    try { this.renderer.dropLive(); } catch {}
  }

  // ── Key Handling ───────────────────────────────────────────────────────

  private handleKey = (key: KeyEvent): void => {
    if (key.ctrl && key.name === "c") { this.exitResolve?.(); return; }

    if (key.name === "tab" && this.sidebarVisible) {
      this.sidebarFocused = !this.sidebarFocused;
      this.updateSidebarFocus();
      return;
    }
    if (key.name === "escape" && this.sidebarFocused) {
      this.sidebarFocused = false;
      this.updateSidebarFocus();
      return;
    }

    if (this.sidebarFocused) {
      if (key.name === "up" || key.name === "k") this.navigateSidebar(-1);
      else if (key.name === "down" || key.name === "j") this.navigateSidebar(1);
      else if (key.name === "return") this.switchToSelectedWindow();
      return;
    }

    if (key.name === "return" && this.completionReached) this.exitResolve?.();
  };

  // ── Resize Handling ────────────────────────────────────────────────────

  private handleResize = (width: number, _height: number): void => {
    const shouldShow = width >= SIDEBAR_COLLAPSE_THRESHOLD;
    if (shouldShow === this.sidebarVisible) return;
    this.sidebarVisible = shouldShow;
    this.sidebarBox.visible = shouldShow;
    if (!shouldShow && this.sidebarFocused) {
      this.sidebarFocused = false;
      this.updateSidebarFocus();
    }
  };

  // ── Workflow Info ──────────────────────────────────────────────────────

  showWorkflowInfo(name: string, agent: string, sessions: string[], prompt: string): void {
    const sessionFlow = sessions.join(` ${ICON.arrow} `);
    const maxLen = 60;
    const truncPrompt = prompt.length > maxLen
      ? prompt.slice(0, maxLen - 1) + ICON.ellipsis
      : prompt;

    this.headerText.content =
      t`${fg(this.theme.accent)(ICON.active)} ${fg(this.theme.accent)(bold(name))}  ${dim(`with ${agent}`)}
${dim(`  Sessions: ${sessionFlow}`)}
${dim(`  Prompt: ${truncPrompt}`)}`;

    for (const sessionName of sessions) {
      this.addSidebarEntry(sessionName, "pending", null);
    }
  }

  // ── Session Lifecycle (Pipeline Rail) ─────────────────────────────────

  sessionStart(name: string, description?: string): void {
    this.stepCounter = 0;

    this.updateSidebarEntry(name, "running", name);

    // Pipeline node header bar
    const headerBox = new BoxRenderable(this.renderer, {
      id: `node-${this.sessionNodes.length}`,
      borderStyle: "rounded",
      borderColor: this.theme.accent,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingLeft: 1,
      paddingRight: 1,
    });

    const nameText = new TextRenderable(this.renderer, {
      id: `node-${this.sessionNodes.length}-name`,
      content: t`${fg(this.theme.accent)(ICON.active)} ${bold(name)}  ${dim(description ?? "")}`,
    });

    const statusText = new TextRenderable(this.renderer, {
      id: `node-${this.sessionNodes.length}-status`,
      content: t`${fg(this.theme.accent)("running")}`,
    });

    headerBox.add(nameText);
    headerBox.add(statusText);
    this.contentScroll.add(headerBox);

    // Detail area for step output
    const detailBox = new BoxRenderable(this.renderer, {
      id: `node-${this.sessionNodes.length}-detail`,
      flexDirection: "column",
      paddingLeft: 3,
      paddingRight: 1,
    });
    this.contentScroll.add(detailBox);

    const node: SessionNode = {
      name, status: "running",
      headerBox, statusText, nameText, detailBox,
    };
    this.sessionNodes.push(node);
    this.currentNode = node;
  }

  sessionStep(text: string): void {
    if (!this.currentNode) return;
    this.stepCounter++;
    this.stopSpinner();

    this.currentNode.detailBox.add(new TextRenderable(this.renderer, {
      id: `node-${this.sessionNodes.length - 1}-step-${this.stepCounter}`,
      content: t`${dim(text)}`,
    }));
  }

  /** Animated braille spinner for the "Running" state. */
  sessionRunning(): void {
    if (!this.currentNode) return;
    this.stepCounter++;

    const runBox = new BoxRenderable(this.renderer, {
      id: `node-${this.sessionNodes.length - 1}-running-box`,
      minHeight: 2,
      justifyContent: "center",
    });
    const runText = new TextRenderable(this.renderer, {
      id: `node-${this.sessionNodes.length - 1}-running`,
      content: "",
    });
    runBox.add(runText);
    this.currentNode.detailBox.add(runBox);
    this.startSpinner(runText, runBox, "Running");
  }

  sessionSuccess(text: string): void {
    if (!this.currentNode) return;
    this.stopSpinner();

    this.currentNode.headerBox.borderColor = this.theme.success;
    this.currentNode.statusText.content = t`${fg(this.theme.success)("done")}`;
    this.currentNode.nameText.content =
      t`${fg(this.theme.success)(ICON.check)} ${bold(this.currentNode.name)}`;
    this.currentNode.status = "complete";

    this.updateSidebarEntry(this.currentNode.name, "complete");
    this.currentNode = null;
  }

  sessionError(text: string): void {
    if (!this.currentNode) return;
    this.stopSpinner();

    this.currentNode.headerBox.borderColor = this.theme.error;
    this.currentNode.statusText.content = t`${fg(this.theme.error)("failed")}`;
    this.currentNode.nameText.content =
      t`${fg(this.theme.error)(ICON.cross)} ${bold(this.currentNode.name)}`;
    this.currentNode.status = "error";

    this.currentNode.detailBox.add(new TextRenderable(this.renderer, {
      id: `node-${this.sessionNodes.length - 1}-err-msg`,
      content: t`${fg(this.theme.error)(text)}`,
    }));

    this.updateSidebarEntry(this.currentNode.name, "error");
    this.currentNode = null;
  }

  // ── Completion ─────────────────────────────────────────────────────────

  showCompletion(workflowName: string, transcriptsPath: string): void {
    this.completionLine.content =
      t`${fg(this.theme.success)(bold(`${ICON.check} Workflow "${workflowName}" completed!`))}`;
    this.transcriptsLine.content =
      t`${dim(`Transcripts: ${transcriptsPath}`)}`;
    this.footerHintsLine.content =
      t`${dim(`Tab: sessions ${ICON.dot} Enter: exit`)}`;
    this.footerBox.visible = true;
    this.mainBox.borderColor = this.theme.success;
  }

  showFatalError(message: string): void {
    this.completionReached = true;
    this.completionLine.content =
      t`${fg(this.theme.error)(bold(`${ICON.cross} Workflow failed`))}`;
    this.transcriptsLine.content = t`${dim(message)}`;
    this.footerHintsLine.content =
      t`${dim(`Tab: sessions ${ICON.dot} Enter: exit`)}`;
    this.footerBox.visible = true;
    this.mainBox.borderColor = this.theme.error;
  }

  // ── Exit / Cleanup ─────────────────────────────────────────────────────

  waitForExit(): Promise<void> {
    this.completionReached = true;
    return new Promise<void>((resolve) => { this.exitResolve = resolve; });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopSpinner();
    try { this.renderer.keyInput.off("keypress", this.handleKey); } catch {}
    try { this.renderer.destroy(); } catch {}
  }
}
