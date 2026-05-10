/**
 * Minimal Bun client for the atomic daemon JSON-RPC UI server.
 *
 * Demonstrates §5.1.5 connection lifecycle using vscode-jsonrpc/node over
 * TCP loopback:
 *   1. Read ~/.atomic/daemon.endpoint.json → port
 *   2. net.connect({ host: "127.0.0.1", port })
 *   3. createMessageConnection(StreamMessageReader, StreamMessageWriter)
 *   4. connect({ token, clientName })
 *   5. panel/subscribe({})
 *   6. Log 5 panel/update (or any server) notifications
 *   7. panel/unsubscribe
 *   8. dispose + exit
 *
 * Usage:
 *   atomic --ui-server &          # start daemon (auto-starts on first use)
 *   bun run index.ts
 *
 * Optional env:
 *   ATOMIC_UI_SERVER_TOKEN   — shared token (match daemon's token)
 *   ATOMIC_ENDPOINT_FILE     — override endpoint file path
 */

import * as net from "node:net";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DaemonEndpoint {
  host: string;
  port: number;
  pid: number;
  startedAt: string;
  atomicVersion: string;
  protocolVersion: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultEndpointFile(): string {
  return (
    process.env.ATOMIC_ENDPOINT_FILE ??
    path.join(os.homedir(), ".atomic", "daemon.endpoint.json")
  );
}

async function readEndpoint(): Promise<DaemonEndpoint> {
  const file = defaultEndpointFile();
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    throw new Error(
      `Daemon endpoint file not found: ${file}\n` +
        "Start the daemon with: atomic --ui-server",
    );
  }
  return JSON.parse(raw) as DaemonEndpoint;
}

function openConnection(
  host: string,
  port: number,
  token: string | undefined,
  clientName: string,
): Promise<MessageConnection> {
  return new Promise<MessageConnection>((resolve, reject) => {
    const socket = net.createConnection({ host, port });

    socket.once("error", reject);

    socket.once("connect", () => {
      const reader = new StreamMessageReader(socket);
      const writer = new StreamMessageWriter(socket);
      const conn = createMessageConnection(reader, writer);
      conn.listen();

      const connectParams: { token?: string; clientName: string } = {
        clientName,
      };
      if (token !== undefined) connectParams.token = token;

      conn
        .sendRequest("connect", connectParams)
        .then(() => resolve(conn))
        .catch((err: unknown) => {
          socket.on("error", () => {});
          conn.dispose();
          socket.destroy();
          reject(err as Error);
        });
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const MAX_EVENTS = 5;

async function main(): Promise<void> {
  // 1. Discover daemon.
  const ep = await readEndpoint();
  console.log(
    `Connecting to daemon pid=${ep.pid} at ${ep.host}:${ep.port} ` +
      `(atomic ${ep.atomicVersion}, protocol ${ep.protocolVersion})`,
  );

  // 2. Open connection + authenticate.
  const token = process.env.ATOMIC_UI_SERVER_TOKEN;
  const conn = await openConnection(ep.host, ep.port, token, "example-client");
  console.log("Authenticated.");

  // 3. Subscribe to all-run panel updates.
  const { subscriptionId } = (await conn.sendRequest("panel/subscribe", {})) as {
    subscriptionId: string;
  };
  console.log(`Subscribed. subscriptionId=${subscriptionId}`);
  console.log(`Waiting for up to ${MAX_EVENTS} server notifications…\n`);

  // 4. Count and log up to MAX_EVENTS incoming notifications.
  let received = 0;

  await new Promise<void>((resolve) => {
    // Register handler for all notification methods we care about.
    const methods = [
      "panel/update",
      "panel/foregroundChange",
      "run/started",
      "run/ended",
      "pane/output",
      "pane/exit",
      "server/closing",
    ] as const;

    for (const method of methods) {
      conn.onNotification(method, (params: unknown) => {
        received++;
        console.log(`[${received}/${MAX_EVENTS}] ${method}`, JSON.stringify(params, null, 2));
        if (received >= MAX_EVENTS) resolve();
      });
    }

    // Also resolve when connection closes (daemon shutdown etc.)
    conn.onClose(() => {
      console.log("Connection closed by daemon.");
      resolve();
    });
  });

  // 5. Unsubscribe and disconnect.
  try {
    await conn.sendRequest("panel/unsubscribe", { subscriptionId });
    console.log("\nUnsubscribed.");
  } catch {
    // Best-effort; connection may have closed.
  }

  conn.dispose();
  console.log("Done.");
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
