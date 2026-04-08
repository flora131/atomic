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
            <SessionGraphPanel />
          </TmuxSessionContext.Provider>
        </ThemeContext.Provider>
      </StoreContext.Provider>,
    );
  }

  static async create(options: PanelOptions): Promise<OrchestratorPanel> {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: ["SIGTERM", "SIGQUIT", "SIGABRT", "SIGHUP", "SIGPIPE", "SIGBUS", "SIGFPE"],
    });
    const termTheme = resolveTheme(renderer.themeMode);
    const graphTheme = deriveGraphTheme(termTheme);
    const store = new PanelStore();
    return new OrchestratorPanel(renderer, store, graphTheme, options.tmuxSession);
  }

  showWorkflowInfo(
    name: string,
    agent: string,
    sessions: PanelSession[],
    prompt: string,
  ): void {
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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.renderer.destroy();
    } catch {}
  }
}
