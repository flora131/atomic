/** @jsxImportSource @opentui/react */
/**
 * OrchestratorPanel — public API class that bridges the imperative
 * executor interface with the React-based session graph TUI.
 */

import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { resolveTheme } from "../runtime/theme.ts";
import { deriveGraphTheme } from "./graph-theme.ts";
import type { GraphTheme } from "./graph-theme.ts";
import { PanelStore } from "./orchestrator-panel-store.ts";
import { StoreContext, ThemeContext, TmuxSessionContext } from "./orchestrator-panel-contexts.ts";
import type { PanelSession, PanelOptions } from "./orchestrator-panel-types.ts";
import { SessionGraphPanel } from "./session-graph-panel.tsx";
import { ErrorBoundary } from "./error-boundary.tsx";

export class OrchestratorPanel {
  private store: PanelStore;
  private renderer: CliRenderer;
  private destroyed = false;

  private constructor(
    renderer: CliRenderer,
    store: PanelStore,
    graphTheme: GraphTheme,
    tmuxSession: string,
  ) {
    this.renderer = renderer;
    this.store = store;

    createRoot(renderer).render(
      <StoreContext.Provider value={store}>
        <ThemeContext.Provider value={graphTheme}>
          <TmuxSessionContext.Provider value={tmuxSession}>
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
                    <span fg={graphTheme.error}>
                      {`Fatal render error: ${err.message}`}
                    </span>
                  </text>
                </box>
              )}
            >
              <SessionGraphPanel />
            </ErrorBoundary>
          </TmuxSessionContext.Provider>
        </ThemeContext.Provider>
      </StoreContext.Provider>,
    );
  }

  /**
   * Create a new OrchestratorPanel with the default CLI renderer.
   *
   * This is the primary entry point — it initialises the terminal renderer
   * and mounts the React-based session graph TUI.
   */
  static async create(options: PanelOptions): Promise<OrchestratorPanel> {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: ["SIGTERM", "SIGQUIT", "SIGABRT", "SIGHUP", "SIGPIPE", "SIGBUS", "SIGFPE"],
    });
    return OrchestratorPanel.createWithRenderer(renderer, options);
  }

  /** Create with an externally-provided renderer (e.g. a test renderer). */
  static createWithRenderer(
    renderer: CliRenderer,
    options: PanelOptions,
  ): OrchestratorPanel {
    const termTheme = resolveTheme(renderer.themeMode);
    const graphTheme = deriveGraphTheme(termTheme);
    const store = new PanelStore();
    return new OrchestratorPanel(renderer, store, graphTheme, options.tmuxSession);
  }

  /**
   * Display the workflow overview in the TUI — name, agent, session graph,
   * and the user prompt. Call once after construction before sessions start.
   */
  showWorkflowInfo(
    name: string,
    agent: string,
    sessions: PanelSession[],
    prompt: string,
  ): void {
    this.store.setWorkflowInfo(name, agent, sessions, prompt);
  }

  /** Mark a session as running in the graph UI. */
  sessionStart(name: string): void {
    this.store.startSession(name);
  }

  /** Mark a session as successfully completed in the graph UI. */
  sessionSuccess(name: string): void {
    this.store.completeSession(name);
  }

  /** Mark a session as failed in the graph UI and display the error message. */
  sessionError(name: string, message: string): void {
    this.store.failSession(name, message);
  }

  /** Show the workflow-complete banner with a link to saved transcripts. */
  showCompletion(workflowName: string, transcriptsPath: string): void {
    this.store.setCompletion(workflowName, transcriptsPath);
  }

  /** Display a fatal error banner in the TUI. */
  showFatalError(message: string): void {
    this.store.setFatalError(message);
  }

  /**
   * Block until the user presses `q` or `Ctrl+C` in the TUI.
   * Call after {@link showCompletion} or {@link showFatalError}.
   */
  waitForExit(): Promise<void> {
    this.store.markCompletionReached();
    return new Promise<void>((resolve) => {
      this.store.exitResolve = resolve;
    });
  }

  /** Tear down the terminal renderer and release resources. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.renderer.destroy();
    } catch {}
  }
}
