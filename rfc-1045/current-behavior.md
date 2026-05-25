## Analysis: MCP initialization and OAuth error surfacing for issue #1045

### Overview
MCP is initialized per AgentSession by the `@bastani/mcp` extension on `session_start`. Main chat and workflow stage sessions both load the MCP package, but workflow stages are separate child AgentSessions, so they get their own MCP adapter state and their own OAuth callback-server initialization path.

The most relevant suppression is in `packages/mcp/index.ts`: startup OAuth initialization errors are caught and reduced to a console-only message, so they do not reach `ctx.ui.notify()` in either the main chat or the graph/stage panel. Later MCP connection failures are surfaced differently: eager/keep-alive startup connection failures notify the active UI, while lazy tool-call failures are converted to tool results or silent “not connected” states.

### Entry Points
- `packages/mcp/index.ts:88` - MCP adapter `session_start` lifecycle handler.
- `packages/mcp/index.ts:107-111` - initializes OAuth first, then starts MCP server/tool initialization.
- `packages/mcp/init.ts:28-33` - `initializeMcp()` loads MCP config for the session cwd/flag.
- `packages/workflows/src/extension/wiring.ts:178-183` - workflow stage sessions are created with `createAgentSession()`.
- `packages/workflows/src/extension/wiring.ts:169-175` - stage sessions keep builtin MCP, subagents, web-access, and intercom packages, excluding only workflows.
- `packages/workflows/src/extension/wiring.ts:331-334` - stage sessions bind extension UI to the workflow stage UI broker/panel when available.

### Core Implementation

#### 1. MCP extension session lifecycle (`packages/mcp/index.ts:88-136`)
- On every `session_start`, the adapter increments `lifecycleGeneration`, clears `state` and `initPromise`, and shuts down previous MCP/OAuth state (`packages/mcp/index.ts:88-100`).
- It then calls `initializeOAuth()` and catches all rejections with only `console.error("MCP OAuth initialization failed")` (`packages/mcp/index.ts:107-109`). The actual error object/message is not included, and no `ctx.ui.notify()` is called here.
- It starts `initializeMcp(pi, ctx)` asynchronously and stores that promise in `initPromise` (`packages/mcp/index.ts:111-112`).
- Successful initialization stores `state`, updates the MCP status bar, and clears `initPromise` (`packages/mcp/index.ts:114-126`).
- Failed `initializeMcp()` is also console-only from this background path: `console.error("MCP initialization failed:", err)` and `initPromise = null` (`packages/mcp/index.ts:127-135`).

#### 2. OAuth callback server initialization (`packages/mcp/mcp-auth-flow.ts:336-347`, `packages/mcp/mcp-callback-server.ts:151-213`)
- OAuth is supported for URL-based MCP servers unless `auth === false` or `oauth === false`; auto-detect happens when `auth` is `"oauth"` or undefined (`packages/mcp/mcp-auth-flow.ts:336-345`).
- Session startup calls `initializeOAuth()`, which calls `ensureCallbackServer()` (`packages/mcp/mcp-auth-flow.ts:347`).
- `ensureCallbackServer()` binds a local HTTP server on the configured callback port, scanning up to 25 ports unless strict-port mode is requested (`packages/mcp/mcp-callback-server.ts:151-190`).
- If all scanned ports are busy, it throws an error including the occupied range (`packages/mcp/mcp-callback-server.ts:212-213`). In strict mode it throws a specific pre-registered-client message (`packages/mcp/mcp-callback-server.ts:205-208`).
- At normal session startup, that thrown error is swallowed by the catch in `packages/mcp/index.ts:107-109`, so the UI does not receive it.

#### 3. Server/tool initialization (`packages/mcp/init.ts:28-143`)
- `initializeMcp()` loads config, constructs `McpServerManager`, lifecycle manager, metadata map, failure tracker, UI resource handler, and consent manager (`packages/mcp/init.ts:28-62`).
- It registers all configured servers with lifecycle metadata and reconstructs cached tool metadata when valid (`packages/mcp/init.ts:88-105`).
- Startup connections are limited to all servers on first cache bootstrap, otherwise only `keep-alive` or `eager` servers (`packages/mcp/init.ts:108-113`).
- If UI exists, startup sets status text while connecting (`packages/mcp/init.ts:115-116`).
- Each startup server is connected through `manager.connect()`. A `needs-auth` connection is converted into the error string `OAuth authentication required. Run /mcp-auth <name>.` (`packages/mcp/init.ts:119-124`). Other thrown errors are converted to their message (`packages/mcp/init.ts:126-128`).
- Startup connection errors notify UI with `MCP: Failed to connect to <name>: <error>` and also log to console (`packages/mcp/init.ts:132-138`). This path is distinct from OAuth callback-server initialization errors, which never reach `initializeMcp()` because they are caught earlier.

#### 4. Transport/OAuth connection behavior (`packages/mcp/server-manager.ts:45-129`, `packages/mcp/server-manager.ts:162-219`)
- `McpServerManager.connect()` deduplicates concurrent connection attempts and reuses existing connected sessions (`packages/mcp/server-manager.ts:45-67`).
- For command servers it builds `StdioClientTransport`; for URL servers it calls `createHttpTransport()` (`packages/mcp/server-manager.ts:78-102`).
- URL transports add bearer headers when configured and create `McpOAuthProvider` when `supportsOAuth(definition)` is true (`packages/mcp/server-manager.ts:162-201`).
- The manager probes Streamable HTTP with a temporary client, closes it, then creates a fresh transport on success (`packages/mcp/server-manager.ts:204-219`).
- During actual client connection/discovery, an SDK `UnauthorizedError` for an OAuth-capable server is converted to a returned connection with `status: "needs-auth"` instead of being thrown (`packages/mcp/server-manager.ts:105-129`).

#### 5. Main chat surfacing paths (`packages/mcp/index.ts:155-170`, `packages/mcp/index.ts:218-238`, `packages/mcp/index.ts:294-309`)
- `/mcp` waits for `initPromise`; if that promise rejects, it notifies `MCP initialization failed: <message>` (`packages/mcp/index.ts:155-164`). If no state exists, it notifies `MCP not initialized` (`packages/mcp/index.ts:167-169`).
- `/mcp-auth` has the same wait-and-notify behavior (`packages/mcp/index.ts:218-238`).
- The registered `mcp` tool similarly awaits `initPromise`, but returns a tool result containing `MCP initialization failed: <message>` or `MCP not initialized` instead of notifying UI (`packages/mcp/index.ts:294-309`).
- Because OAuth callback startup errors are caught before `initPromise` is assigned (`packages/mcp/index.ts:107-112`), these command/tool wait paths generally cannot surface callback initialization failures; they see either later MCP initialization state or no state.

#### 6. Workflow graph/stage session behavior (`packages/workflows/src/extension/wiring.ts:169-183`, `packages/workflows/src/extension/wiring.ts:328-336`)
- Workflow stages are child AgentSessions created via the Atomic SDK (`packages/workflows/src/extension/wiring.ts:178-183`).
- Stage resource loading deliberately excludes only the workflows package, leaving MCP in the child session builtin package list (`packages/workflows/src/extension/wiring.ts:169-175`).
- Workflow-only `mcp` options are stripped before creating the child AgentSession (`packages/workflows/src/extension/wiring.ts:234-237`); they are used by workflow runtime scoping rather than passed directly to Atomic session creation.
- After creation, if possible, the child session binds extensions to a UI context produced by `makeStageExtensionUiContext()` (`packages/workflows/src/extension/wiring.ts:331-334`). That context routes `notify`, `setStatus`, and `custom` through the workflow graph/stage UI broker (`packages/workflows/src/extension/wiring.ts:240-244` and following).

#### 7. Workflow MCP scoping is emitted, but no MCP listener is present (`packages/workflows/src/extension/index.ts:1846-1869`, `packages/workflows/src/runs/foreground/executor.ts:1825-1830`)
- Workflows build a `WorkflowMcpPort` only if `pi.events.emit` exists (`packages/workflows/src/extension/index.ts:1846-1851`).
- The port emits `mcp.scope.set` through helper calls in `setScope()`/`clearScope()` (`packages/workflows/src/extension/index.ts:1859-1869`).
- The foreground executor calls `opts.mcp.setScope(stageId, allow, deny)` before the stage body and clears it in `finally` (`packages/workflows/src/runs/foreground/executor.ts:1825-1830`, `packages/workflows/src/runs/foreground/executor.ts:1877-1878`).
- A repository search found no `mcp.scope.set` listener under `packages/mcp`; only workflow-side emission helpers exist. As implemented here, scoping events are fire-and-forget unless some host/runtime listener outside this package handles them.

### Data Flow
1. Main chat or workflow child session starts and loads builtin extensions, including `@bastani/mcp`.
2. MCP adapter receives `session_start` at `packages/mcp/index.ts:88`.
3. Previous MCP/OAuth state is shut down (`packages/mcp/index.ts:94-100`).
4. OAuth callback server startup runs via `initializeOAuth()` (`packages/mcp/index.ts:107`; implementation reaches `packages/mcp/mcp-callback-server.ts:151-213`).
5. Any OAuth callback startup error is caught and reduced to console-only output (`packages/mcp/index.ts:107-109`).
6. MCP config/server initialization starts with `initializeMcp(pi, ctx)` (`packages/mcp/index.ts:111`; implementation at `packages/mcp/init.ts:28-143`).
7. Eager/keep-alive server failures notify the session UI (`packages/mcp/init.ts:132-138`).
8. Lazy connections from tool use return false on `needs-auth` or caught errors, recording only debug state for caught errors (`packages/mcp/init.ts:302-336`).
9. In workflow graph runs, stages create separate AgentSessions that repeat the same MCP extension initialization path (`packages/workflows/src/extension/wiring.ts:178-183`, `packages/workflows/src/extension/wiring.ts:328-336`).

### Likely Root Cause
OAuth callback initialization failures are intentionally suppressed at the MCP adapter session-start boundary. The catch at `packages/mcp/index.ts:107-109` discards the thrown error and only writes a generic console message, without `ctx.ui.notify()` and without preserving the failure in `initPromise`/`state` for later `/mcp`, `/mcp-auth`, or `mcp` tool calls.

This affects the graph orchestrator panel more visibly because workflow stages create child AgentSessions that still include the MCP builtin (`packages/workflows/src/extension/wiring.ts:169-175`, `packages/workflows/src/extension/wiring.ts:178-183`). Each child session can execute the same suppressed OAuth initialization path, but its UI is routed through the stage/graph broker only after session creation/binding (`packages/workflows/src/extension/wiring.ts:331-334`). Since the OAuth startup failure is console-only, there is no stage-panel notification to display. Main chat has the same suppression for callback-server startup errors, but eager server connection failures later in `initializeMcp()` can still appear as UI notifications (`packages/mcp/init.ts:132-138`), making main-chat behavior look more informative than graph-stage behavior.
