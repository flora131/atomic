## Pattern Examples: MCP OAuth initialization failure suppression

### Pattern 1: Swallow startup OAuth init failure, log only
**Found in**: `packages/mcp/index.ts:107-109`
**Used for**: Non-blocking MCP startup when OAuth callback setup fails

```ts
await initializeOAuth().catch(() => {
  console.error("MCP OAuth initialization failed");
});
```

### Pattern 2: Return init failure to caller as user-visible error
**Found in**: `packages/mcp/index.ts:160-168`
**Used for**: Showing initialization problems in the `/mcp` command UI path

```ts
if (!state && initPromise) {
  try {
    state = await initPromise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
    return;
  }
}
```

### Pattern 3: OAuth callback server emits debug logs for rejected callbacks
**Found in**: `packages/mcp/mcp-callback-server.ts:99-132`
**Used for**: Debug logging for expected callback rejection cases, with generic error HTML for the browser

```ts
if (!state) {
  logger.debug("OAuth callback rejected: missing state parameter")
  res.writeHead(400, { "Content-Type": "text/html" })
  res.end(renderCallbackErrorHtml())
  return
}
```

### Pattern 4: Browser-facing OAuth error page stays generic
**Found in**: `packages/mcp/mcp-callback-server.ts:38-50`
**Used for**: UI panel/browser error rendering during OAuth callback failures

```ts
export const renderCallbackErrorHtml = () => `<!DOCTYPE html>
<html>
<head>
  <title>Pi - Authorization Failed</title>
...
  <div class="error">Return to Atomic and try again.</div>
```

## Pattern Examples: Debug logging vs user-visible errors

### Pattern 1: Debug log on bootstrap failure, user-facing message elsewhere
**Found in**: `packages/mcp/init.ts:181-186`
**Used for**: Direct tool metadata bootstrap failures that should not stop startup

```ts
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  logger.debug(`MCP: direct-tools bootstrap failed for ${name}: ${message}`);
  return { name, ok: false };
}
```

### Pattern 2: Debug log on lazy connect failure, status update only
**Found in**: `packages/mcp/init.ts:328-336`
**Used for**: Connection failures during lazy server activation

```ts
} catch (error) {
  state.failureTracker.set(serverName, Date.now());
  const message = error instanceof Error ? error.message : String(error);
  logger.debug(`MCP: lazy connect failed for ${serverName}: ${message}`);
  updateStatusBar(state);
  return false;
}
```

### Pattern 3: User-visible notification in command handler
**Found in**: `packages/mcp/index.ts:160-168`
**Used for**: When initialization fails and the user invoked an interactive command

```ts
const message = error instanceof Error ? error.message : String(error);
if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
```

### Pattern 4: Panel-local notice for interactive failures
**Found in**: `packages/mcp/mcp-panel.ts:476-488`
**Used for**: Showing OAuth/reconnect errors in the MCP panel itself

```ts
this.callbacks.authenticate(server.name).then((result) => {
  server.connectionStatus = this.callbacks.getConnectionStatus(server.name);
  this.authNotice = result.ok
    ? `OAuth finished for ${server.name}. Run reconnect if it is still idle.`
    : `OAuth failed for ${server.name}${result.message ? `: ${result.message}` : ". Check the notification for details."}`;
  this.authInFlight = null;
  this.tui.requestRender();
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  server.connectionStatus = this.callbacks.getConnectionStatus(server.name);
  this.authNotice = `OAuth failed for ${server.name}: ${message}`;
  this.authInFlight = null;
  this.tui.requestRender();
});
```

## Pattern Examples: Lazy loading MCP tools

### Pattern 1: Resolve direct tools from cache, not live connections
**Found in**: `packages/mcp/direct-tools.ts:71-120`
**Used for**: Registering direct MCP tools from cached metadata during startup

```ts
export function resolveDirectTools(
  config: McpConfig,
  cache: MetadataCache | null,
  prefix: "server" | "none" | "short",
  envOverride?: string[],
): DirectToolSpec[] {
  const specs: DirectToolSpec[] = [];
  if (!cache) return specs;
```

### Pattern 2: Tool executor connects lazily on first invocation
**Found in**: `packages/mcp/direct-tools.ts:291-315`
**Used for**: Deferring MCP server connection until the tool is actually called

```ts
let connected = await lazyConnect(state, spec.serverName);
let autoAuthAttempted = false;

if (!connected && state.manager.getConnection(spec.serverName)?.status === "needs-auth") {
  autoAuthAttempted = true;
  const autoAuth = await attemptDirectAutoAuth(state, spec.serverName);
```

### Pattern 3: Lazy connect short-circuits connected/failed/auth states
**Found in**: `packages/mcp/init.ts:302-336`
**Used for**: Reusing existing connections and backing off after failures

```ts
const connection = state.manager.getConnection(serverName);
if (connection?.status === "needs-auth") {
  return false;
}
if (connection?.status === "connected") {
  updateServerMetadata(state, serverName);
  return true;
}

const failedAgo = getFailureAgeSeconds(state, serverName);
if (failedAgo !== null) return false;
```

### Pattern 4: Proxy-mode calls also use lazyConnect before execution
**Found in**: `packages/mcp/proxy-modes.ts:476-494`
**Used for**: Deferred connection before list/describe/search operations

```ts
const connected = await lazyConnect(state, serverName);
...
const connectedAfterAuth = await lazyConnect(state, serverName);
```

## Pattern Examples: UI panel error rendering

### Pattern 1: Panel auth errors render as inline notice text
**Found in**: `packages/mcp/mcp-panel.ts:667-669`
**Used for**: Displaying authentication/status errors directly in the panel body

```ts
if (this.authNotice) {
  lines.push(row(fg(t.needsAuth, italic(this.authNotice))));
  lines.push(emptyRow());
}
```

### Pattern 2: Connection state is rendered as a dedicated status label
**Found in**: `packages/mcp/mcp-panel.ts:780-789`
**Used for**: Visual status text in server rows

```ts
if (this.authInFlight === server.name) return `  ${fg(t.needsAuth, "authenticating")}`;
if (server.connectionStatus === "needs-auth") return `  ${fg(t.needsAuth, "needs auth")}`;
if (server.connectionStatus === "connecting") return `  ${fg(t.needsAuth, "connecting")}`;
if (server.connectionStatus === "failed") return `  ${fg(t.cancel, "failed")}`;
```

### Pattern 3: Setup panel renders warnings/success messages inline
**Found in**: `packages/mcp/mcp-setup-panel.ts:325-355`
**Used for**: Rendering user-visible setup errors and progress messages

```ts
} catch (error) {
  this.notice = {
    text: error instanceof Error ? error.message : String(error),
    tone: "warning",
  };
}
...
if (this.notice) {
  const tone = this.notice.tone === "success" ? this.t.success : this.notice.tone === "warning" ? this.t.warning : this.t.hint;
  for (const line of wrapText(this.notice.text, innerW - 6)) {
    lines.push(this.padLine(fg(tone, line), innerW));
  }
}
```

### Pattern 4: UI panel routes reconnect/auth failures into panel state
**Found in**: `packages/mcp/mcp-panel.ts:423-428` and `packages/mcp/mcp-panel.ts:483-488`
**Used for**: Rendering error feedback after async operations fail

```ts
server.connectionStatus = "failed";
const message = error instanceof Error ? error.message : String(error);
this.authNotice = `Reconnect failed for ${server.name}: ${message}`;
this.tui.requestRender();
```

## Related References

- `packages/mcp/index.ts:107-109` - startup OAuth init suppression
- `packages/mcp/mcp-callback-server.ts:99-132` - debug logs + generic callback error HTML
- `packages/mcp/init.ts:181-186` - bootstrap failure debug logging
- `packages/mcp/init.ts:302-336` - lazy connection path
- `packages/mcp/mcp-panel.ts:667-669` - inline panel error rendering
- `packages/mcp/mcp-setup-panel.ts:325-355` - setup panel notice rendering
