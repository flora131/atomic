/** @jsxImportSource @opentui/react */
/**
 * OrchestratorPanel — imperative wrapper around the React session graph.
 *
 * This class is retained as a renderer/store facade for tests and embedded
 * callers. Runtime attach/detach now goes through the daemon PanelClient.
 */

import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { resolveTheme } from "../runtime/theme.ts";
import { deriveGraphTheme } from "./graph-theme.ts";
import type { GraphTheme } from "./graph-theme.ts";
import { PanelStore } from "./orchestrator-panel-store.ts";
import { StoreContext, ThemeContext } from "./orchestrator-panel-contexts.ts";
import type { PanelSession, PanelOptions, SessionData } from "./orchestrator-panel-types.ts";
import { SessionGraphPanel } from "./session-graph-panel.tsx";
import { ErrorBoundary } from "./error-boundary.tsx";
import {
  requestRendererBackgroundRepaint,
  resetRendererTerminalBackground,
  setRendererBackground,
} from "./renderer-background.ts";
import { createTuiDiagnostics, type TuiDiagnostics } from "./tui-diagnostics.ts";

export class OrchestratorPanel {
  private store: PanelStore;
  private renderer: CliRenderer;
  private destroyed = false;
  private terminalBackgroundSynced: boolean;
  private diagnostics: TuiDiagnostics | null = null;
  private unsubscribeDiagnostics: (() => void) | null = null;
  private graphTheme: GraphTheme;

  private constructor(
    renderer: CliRenderer,
    store: PanelStore,
    graphTheme: GraphTheme,
    terminalBackgroundSynced: boolean,
  ) {
    this.renderer = renderer;
    this.store = store;
    this.graphTheme = graphTheme;
    this.terminalBackgroundSynced = terminalBackgroundSynced;
    this.diagnostics = createTuiDiagnostics({
      renderer,
      graphTheme,
      getSnapshot: () => this.getDiagnosticSnapshot(),
    });
    this.unsubscribeDiagnostics = this.diagnostics
      ? store.subscribe(() => this.diagnostics?.capture("store-update"))
      : null;

    const root = createRoot(renderer);
    root.render(
      <StoreContext.Provider value={store}>
        <ThemeContext.Provider value={graphTheme}>
          <ErrorBoundary
            fallback={(err) => (
              <box
                width="100%"
                height="100%"
                justifyContent="center"
                alignItems="center"
                backgroundColor={graphTheme.background}
              >
                <text>
                  <span fg={graphTheme.error}>{`Fatal render error: ${err.message}`}</span>
                </text>
              </box>
            )}
          >
            <SessionGraphPanel />
          </ErrorBoundary>
        </ThemeContext.Provider>
      </StoreContext.Provider>,
    );
    requestRendererBackgroundRepaint(this.renderer);
    this.diagnostics?.capture("post-mount");
  }

  /** Create a new OrchestratorPanel with the default CLI renderer. */
  static async create(options: PanelOptions = {}): Promise<OrchestratorPanel> {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: ["SIGTERM", "SIGQUIT", "SIGABRT", "SIGHUP", "SIGPIPE", "SIGBUS", "SIGFPE"],
    });
    return OrchestratorPanel.createWithRenderer(renderer, options, { syncTerminalBackground: true });
  }

  /** Create with an externally-provided renderer (e.g. a test renderer). */
  static createWithRenderer(
    renderer: CliRenderer,
    options: PanelOptions = {},
    { syncTerminalBackground = false }: { syncTerminalBackground?: boolean } = {},
  ): OrchestratorPanel {
    void options;
    const termTheme = resolveTheme(renderer.themeMode);
    setRendererBackground(renderer, termTheme.bg, { syncTerminalDefault: syncTerminalBackground });
    const graphTheme = deriveGraphTheme(termTheme);
    const store = new PanelStore();
    return new OrchestratorPanel(renderer, store, graphTheme, syncTerminalBackground);
  }

  showWorkflowInfo(name: string, agent: string, sessions: PanelSession[], prompt: string): void {
    this.store.setWorkflowInfo(name, agent, sessions, prompt);
  }

  sessionStart(name: string): void {
    this.store.startSession(name);
  }

  sessionSuccess(name: string): void {
    this.store.completeSession(name);
  }

  sessionError(name: string, message: string): void {
    this.store.failSession(name, message);
  }

  sessionAwaitingInput(name: string): void {
    this.store.awaitingInput(name);
  }

  sessionResumed(name: string): void {
    this.store.resumeSession(name);
  }

  addSession(name: string, parents: string[]): void {
    this.store.addSession({
      name,
      status: "running",
      parents,
      startedAt: Date.now(),
      endedAt: null,
    });
  }

  backgroundTaskStarted(): void {
    this.store.incrementBackgroundTasks();
  }

  backgroundTaskFinished(): void {
    this.store.decrementBackgroundTasks();
  }

  showCompletion(workflowName: string, transcriptsPath: string): void {
    this.store.setCompletion(workflowName, transcriptsPath);
  }

  showFatalError(message: string): void {
    this.store.setFatalError(message);
  }

  waitForExit(): Promise<void> {
    this.store.markCompletionReached();
    return new Promise<void>((resolve) => {
      this.store.exitResolve = resolve;
    });
  }

  waitForAbort(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.store.abortResolve = resolve;
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribeDiagnostics?.();
    this.unsubscribeDiagnostics = null;
    this.diagnostics?.capture("destroy");
    this.diagnostics?.dispose();
    this.diagnostics = null;
    try {
      if (this.terminalBackgroundSynced) resetRendererTerminalBackground(this.renderer);
      this.renderer.destroy();
    } catch {}
  }

  subscribe(fn: () => void): () => void {
    return this.store.subscribe(fn);
  }

  getPanelStore(): PanelStore {
    return this.store;
  }

  getSnapshot(): {
    workflowName: string;
    agent: string;
    prompt: string;
    fatalError: string | null;
    completionReached: boolean;
    sessions: readonly SessionData[];
  } {
    return {
      workflowName: this.store.workflowName,
      agent: this.store.agent,
      prompt: this.store.prompt,
      fatalError: this.store.fatalError,
      completionReached: this.store.completionReached,
      sessions: this.store.sessions,
    };
  }

  private getDiagnosticSnapshot() {
    return {
      workflowName: this.store.workflowName,
      agent: this.store.agent,
      prompt: this.store.prompt,
      fatalError: this.store.fatalError,
      completionReached: this.store.completionReached,
      sessions: this.store.sessions,
      backgroundTaskCount: this.store.backgroundTaskCount,
      viewMode: this.store.viewMode,
      activeAgentId: this.store.activeAgentId,
    };
  }
}
