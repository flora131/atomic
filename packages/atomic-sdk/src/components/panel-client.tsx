/** @jsxImportSource @opentui/react */
/**
 * PanelClient — daemon-protocol panel client.
 *
 * Connects to daemon, subscribes to panel/update notifications,
 * mounts the OpenTUI session graph tree, and blocks until the user
 * presses q or Ctrl+C to detach.
 *
 * §5.4, §5.5 of specs/2026-05-09-ui-server-bun-native.md
 */

import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { MessageConnection } from "vscode-jsonrpc/node";
import { connectToDaemon } from "../runtime/daemon.ts";
import { resolveTheme } from "../runtime/theme.ts";
import { deriveGraphTheme } from "./graph-theme.ts";
import type { GraphTheme } from "./graph-theme.ts";
import { PanelStore } from "./orchestrator-panel-store.ts";
import {
  StoreContext,
  ThemeContext,
  TmuxSessionContext,
  OffloadManagerContext,
} from "./orchestrator-panel-contexts.ts";
import { SessionGraphPanel } from "./session-graph-panel.tsx";
import { ErrorBoundary } from "./error-boundary.tsx";
import type { OffloadManager } from "../runtime/offload-manager.ts";
import {
  requestRendererBackgroundRepaint,
  resetRendererTerminalBackground,
  setRendererBackground,
} from "./renderer-background.ts";
import type {
  WorkflowStatusSnapshot as OpaqueSnapshot,
  PanelUpdateNotificationParams,
  PanelForegroundChangeNotificationParams,
} from "../runtime/ui-protocol/schemas.ts";
import type { WorkflowStatusSnapshot } from "../runtime/status-writer.ts";
import type { SessionData, SessionStatus } from "./orchestrator-panel-types.ts";

// ---------------------------------------------------------------------------
// DaemonPanelStore — extends PanelStore with snapshot-driven updates
// ---------------------------------------------------------------------------

/**
 * PanelStore subclass that accepts a full `WorkflowStatusSnapshot` and applies
 * it atomically, triggering a single re-render through the private `emit` path.
 */
export class DaemonPanelStore extends PanelStore {
  /**
   * Apply a `WorkflowStatusSnapshot` from a `panel/update` notification.
   *
   * Maps all snapshot fields onto store properties and fires `emit()` so
   * React components subscribed via `useSyncExternalStore` re-render.
   */
  applySnapshot(snapshot: WorkflowStatusSnapshot): void {
    this.workflowName = snapshot.workflowName;
    this.agent = snapshot.agent;
    this.prompt = snapshot.prompt;
    this.fatalError = snapshot.fatalError;

    this.sessions = snapshot.sessions.map(
      (s): SessionData => ({
        name: s.name,
        status: s.status as SessionStatus,
        parents: s.parents,
        error: s.error,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      }),
    );

    // Mirror completionReached from the snapshot without double-firing if
    // it's already set (markCompletionReached would call emit a second time).
    if (snapshot.completionReached && !this.completionReached) {
      this.completionReached = true;
    }

    // Trigger re-render via the private `emit()` method.
    // The cast is intentional: `emit` is `private` in PanelStore but we
    // need to call it from the subclass for snapshot-driven updates that
    // don't map cleanly onto any single public mutator.
    (this as unknown as { emit(): void }).emit();
  }
}

// ---------------------------------------------------------------------------
// Stub OffloadManager — satisfies the context requirement without tmux
// ---------------------------------------------------------------------------

/**
 * No-op OffloadManager for the panel-client context where tmux is not
 * available. SessionGraphPanel reads from this but only invokes it when
 * the user tries to attach to a session window — which is a no-op here.
 */
const STUB_OFFLOAD_MANAGER: OffloadManager = {
  getStatus: (_name: string) => "alive" as const,
  offloadSession: async (_name: string) => {},
  requestResume: async (_name: string) => {},
  subscribe: (_fn: () => void) => () => {},
  emit: () => {},
} as unknown as OffloadManager;

// ---------------------------------------------------------------------------
// Pure helper — extract for testing
// ---------------------------------------------------------------------------

/**
 * Cast the opaque `WorkflowStatusSnapshot` from JSON-RPC into the typed
 * snapshot shape expected by `DaemonPanelStore.applySnapshot`.
 *
 * This is a pure, side-effect-free helper extracted so it can be unit-tested
 * without mounting any OpenTUI renderer.
 */
export function castSnapshot(opaque: OpaqueSnapshot): WorkflowStatusSnapshot {
  return opaque as unknown as WorkflowStatusSnapshot;
}

/**
 * Map a `WorkflowStatusSnapshot` to a `SessionData[]`.
 *
 * Pure helper — no side effects, fully unit-testable.
 */
export function mapSnapshotSessions(snapshot: WorkflowStatusSnapshot): SessionData[] {
  return snapshot.sessions.map(
    (s): SessionData => ({
      name: s.name,
      status: s.status as SessionStatus,
      parents: s.parents,
      error: s.error,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
    }),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PanelClientOptions {
  /** Run ID to attach to. */
  runId: string;
  /**
   * If provided, connect to this endpoint directly instead of reading the
   * default endpoint file.
   */
  daemonEndpoint?: { host: string; port: number };
  /** Pre-shared auth token. Defaults to ATOMIC_UI_SERVER_TOKEN env var. */
  token?: string;
  /** Absolute path to the daemon endpoint file. */
  endpointFile?: string;
  /** clientName sent in the connect() handshake. */
  clientName?: string;
}

/**
 * PanelClient — static-mount daemon panel client.
 *
 * Usage:
 * ```ts
 * await PanelClient.mount({ runId: "abc-123" });
 * ```
 *
 * Connects to the daemon, fetches the initial panel snapshot, subscribes
 * to live updates, mounts the OpenTUI session graph, and blocks until the
 * user presses q or Ctrl+C.
 */
export class PanelClient {
  private readonly connection: MessageConnection;
  private readonly store: DaemonPanelStore;
  private readonly renderer: CliRenderer;
  private readonly graphTheme: GraphTheme;
  private readonly runId: string;
  private subscriptionId: string | null = null;
  /** Tracks the currently foregrounded stage (from panel/foregroundChange). */
  foregroundStage: string | null = null;
  private destroyed = false;

  private constructor(
    connection: MessageConnection,
    store: DaemonPanelStore,
    renderer: CliRenderer,
    graphTheme: GraphTheme,
    runId: string,
  ) {
    this.connection = connection;
    this.store = store;
    this.renderer = renderer;
    this.graphTheme = graphTheme;
    this.runId = runId;
  }

  /**
   * Connect to the daemon, mount the OpenTUI panel, and block until the user
   * detaches (q or Ctrl+C). Cleans up all resources before returning.
   */
  static async mount(opts: PanelClientOptions): Promise<void> {
    const {
      runId,
      daemonEndpoint,
      token,
      endpointFile,
      clientName = "@bastani/atomic-sdk/panel-client",
    } = opts;

    // ── 1. Connect to daemon ──────────────────────────────────────────────
    let connection: MessageConnection;

    if (daemonEndpoint) {
      // Direct endpoint provided — import vscode-jsonrpc helpers manually
      // (mirrors the private openConnection() in daemon.ts).
      const net = await import("node:net");
      const { StreamMessageReader, StreamMessageWriter, createMessageConnection } =
        await import("vscode-jsonrpc/node");

      connection = await new Promise<MessageConnection>((resolve, reject) => {
        const socket = net.default.createConnection(daemonEndpoint);
        socket.once("error", reject);
        socket.once("connect", () => {
          const reader = new StreamMessageReader(socket);
          const writer = new StreamMessageWriter(socket);
          const conn = createMessageConnection(reader, writer);
          conn.listen();
          const connectParams: { token?: string; clientName: string } = { clientName };
          if (token !== undefined) connectParams.token = token;
          conn
            .sendRequest("connect", connectParams)
            .then(() => resolve(conn))
            .catch((err) => {
              socket.on("error", () => {});
              conn.dispose();
              socket.destroy();
              reject(err);
            });
        });
      });
    } else {
      connection = await connectToDaemon({ endpointFile, token, clientName });
    }

    // ── 2. Fetch initial snapshot ─────────────────────────────────────────
    const initialOpaque = (await connection.sendRequest("panel/get", {
      runId,
    })) as OpaqueSnapshot;
    const initialSnapshot = castSnapshot(initialOpaque);

    // ── 3. Subscribe for live updates ─────────────────────────────────────
    const subResult = (await connection.sendRequest("panel/subscribe", {
      runId,
    })) as { subscriptionId: string };
    const subscriptionId = subResult.subscriptionId;

    // ── 4. Create renderer + store ────────────────────────────────────────
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: ["SIGTERM", "SIGQUIT", "SIGABRT", "SIGHUP", "SIGPIPE", "SIGBUS", "SIGFPE"],
    });

    const termTheme = resolveTheme(renderer.themeMode);
    setRendererBackground(renderer, termTheme.bg, { syncTerminalDefault: true });
    const graphTheme = deriveGraphTheme(termTheme);

    const store = new DaemonPanelStore();

    // Apply initial snapshot before mounting so the first render has data.
    store.applySnapshot(initialSnapshot);

    const client = new PanelClient(connection, store, renderer, graphTheme, runId);
    client.subscriptionId = subscriptionId;

    // ── 5. Register notification handlers ────────────────────────────────
    connection.onNotification(
      "panel/update",
      (params: PanelUpdateNotificationParams) => {
        if (params.runId !== runId) return;
        store.applySnapshot(castSnapshot(params.snapshot));
      },
    );

    connection.onNotification(
      "panel/foregroundChange",
      (params: PanelForegroundChangeNotificationParams) => {
        if (params.runId !== runId) return;
        client.foregroundStage = params.stageName;
      },
    );

    // pane/output notifications are forwarded to PtyPane components via
    // the shared connection reference — PtyPane registers its own handlers.

    // ── 6. Mount React tree ───────────────────────────────────────────────
    const root = createRoot(renderer);
    root.render(
      <StoreContext.Provider value={store}>
        <ThemeContext.Provider value={graphTheme}>
          <TmuxSessionContext.Provider value="">
            <OffloadManagerContext.Provider value={STUB_OFFLOAD_MANAGER}>
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
            </OffloadManagerContext.Provider>
          </TmuxSessionContext.Provider>
        </ThemeContext.Provider>
      </StoreContext.Provider>,
    );

    requestRendererBackgroundRepaint(renderer);

    // ── 7. Block until user quits ─────────────────────────────────────────
    await new Promise<void>((resolve) => {
      store.exitResolve = resolve;
      store.abortResolve = resolve;
    });

    // ── 8. Cleanup ────────────────────────────────────────────────────────
    await client.destroy();
  }

  /**
   * Tear down all resources: unsubscribe from panel updates, dispose the
   * daemon connection, and destroy the terminal renderer. Idempotent.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    // Unsubscribe from panel updates.
    if (this.subscriptionId !== null) {
      try {
        await this.connection.sendRequest("panel/unsubscribe", {
          subscriptionId: this.subscriptionId,
        });
      } catch {
        // Best-effort; don't block cleanup.
      }
      this.subscriptionId = null;
    }

    // Dispose the JSON-RPC connection.
    try {
      this.connection.dispose();
    } catch {}

    // Tear down the renderer.
    try {
      resetRendererTerminalBackground(this.renderer);
      this.renderer.destroy();
    } catch {}
  }
}
