# ui-server-client

Minimal Bun reference client for the **atomic daemon JSON-RPC UI server**.

Demonstrates the §5.1.5 connection lifecycle using `vscode-jsonrpc/node` over TCP loopback:

1. Read `~/.atomic/daemon.endpoint.json` → `port`
2. `net.connect({ host: "127.0.0.1", port })`
3. `createMessageConnection(new StreamMessageReader(socket), new StreamMessageWriter(socket))`
4. `connect({ token, clientName: "example-client" })`
5. `panel/subscribe({})` — subscribe to all-run panel notifications
6. Log up to 5 incoming server notifications (`panel/update`, `run/started`, `run/ended`, etc.)
7. `panel/unsubscribe` + dispose connection + exit

## Usage

```sh
# Start the daemon (auto-starts on first `atomic workflow` use)
atomic --ui-server &

# Install deps (resolved from workspace)
bun install

# Run the client
bun run index.ts
```

## Optional env

| Variable | Purpose |
|---|---|
| `ATOMIC_UI_SERVER_TOKEN` | Shared secret matching the daemon's token (required if daemon was started with `ATOMIC_UI_SERVER_TOKEN` set) |
| `ATOMIC_ENDPOINT_FILE` | Override the default `~/.atomic/daemon.endpoint.json` path |

## Example output

```
Connecting to daemon pid=4711 at 127.0.0.1:53247 (atomic 2.0.0, protocol 1.0.0)
Authenticated.
Subscribed. subscriptionId=sub-001
Waiting for up to 5 server notifications…

[1/5] panel/update {
  "runId": "r-7f3a",
  "snapshot": { "overall": "running", "stages": [...] }
}
[2/5] run/started {
  "runId": "r-a1b2",
  "workflowName": "deep-research",
  "agent": "claude"
}
…

Unsubscribed.
Done.
```

## Wire protocol

Protocol: JSON-RPC 2.0 with LSP `Content-Length` framing.  
Transport: TCP loopback (`127.0.0.1`), kernel-assigned port.  
Framing library: `vscode-jsonrpc/node` (`^8.2.1`).

See [`packages/atomic-sdk/docs/ui-server.md`](../../packages/atomic-sdk/docs/ui-server.md) for the full protocol reference.
