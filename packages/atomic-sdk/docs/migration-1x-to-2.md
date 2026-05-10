# Migrating from atomic 1.x to 2.0

atomic 2.0 is a hard-cutover major release. There is no dual-runtime mode, no backward-compat shims, no `ATOMIC_DAEMON_MODE` env var, no `--use-tmux` escape hatch. Every contract from 1.x — tmux sessions, hidden subcommands, the self-exec dispatcher, `hostLocalWorkflows`, every primitive's underlying transport — is replaced. Upgrade by accepting the break.

---

## What changed at a glance

- **tmux dependency removed.** Process supervision moves into the daemon via `bun-pty`. No tmux, no psmux, no platform-specific tmux quirks.
- **Daemon (`atomic --ui-server`) is now the single source of truth.** All workflow state lives in the daemon's memory. The disk writer (`~/.atomic/sessions/<runId>/status.json`) is a persistence shadow, not canonical state.
- **All workflow control flows through JSON-RPC 2.0.** Discovery, dispatch, lifecycle, panel state, and PTY I/O are all methods and notifications on the daemon's JSON-RPC protocol surface (`vscode-jsonrpc` over LSP `Content-Length` framing).
- **Hidden subcommands removed.** `_orchestrator-entry`, `_emit-workflow-meta`, `_atomic-run`, and `_cc-debounce` are gone. Their dispatch roles are replaced by RPC methods on the daemon.
- **`hostLocalWorkflows([wf])` removed from SDK exports.** Replace with `export default workflow` in workflow source files.
- **SDK auto-installs the platform binary via `optionalDependencies`.** `@bastani/atomic-sdk` declares every `@bastani/atomic-${platform}-${arch}` variant as an optional dep. SDK-only users no longer hit `MissingDependencyError` for a missing binary.

---

## Breaking changes

### Workflow source files calling `hostLocalWorkflows([wf])` at the top level break at import time

`hostLocalWorkflows` is deleted from the SDK surface. Any workflow file that calls it at the module top level will throw at import time under 2.0.

**Before (1.x):**

```ts
import { hostLocalWorkflows } from "@bastani/atomic-sdk";
import { myWorkflow } from "./my-workflow.js";

hostLocalWorkflows([myWorkflow]);
```

**After (2.0):**

```ts
import { myWorkflow } from "./my-workflow.js";

export default myWorkflow;
```

The daemon imports registered workflow files directly and reads the default export.

---

### Running 1.x tmux sessions are not migrated

atomic 2.0 cannot reattach to a tmux session created by atomic 1.x. Let in-flight 1.x runs complete before upgrading, or terminate them:

```sh
tmux kill-server -L atomic
```

---

### 1.x on-disk artifacts under `~/.atomic/sessions/<runId>/` are ignored by 2.0

The 2.0 daemon initializes an empty run registry. Existing session artifacts on disk are not read. Operators can remove them safely:

```sh
rm -rf ~/.atomic/sessions/
```

---

### Detach/reattach is now connection-layer, not tmux-layer

In 1.x, detach/reattach was a tmux concept. In 2.0, detach means the panel client closes its connection; the daemon retains the run state. Reattach means a new client connects and subscribes.

Use the new public command:

```sh
atomic workflow attach <runId>
```

There is no tmux-layer concept involved.

---

### `attachSession` primitive is no longer blocking

In 1.x, `attachSession` called `Bun.spawnSync` with inherited stdio — blocking the event loop. In 2.0, `attachSession` is replaced by `run/getAttachInfo`, which returns a `subscriptionId`. The caller drives the panel client.

**Before (1.x):**

```ts
// Blocking — froze the event loop
await attachSession(runId);
```

**After (2.0):**

```ts
const conn = await connectToDaemon();
const { subscriptionId } = await conn.sendRequest("run/getAttachInfo", { runId });
// subscriptionId is used to drive the panel client; the call returns immediately
```

---

## What stayed the same

- **`~/.atomic/settings.json` schema is unchanged.** Workflow registrations in settings work as-is. Only the dispatch path changed (RPC instead of self-exec).
- **`WorkflowDefinition` API surface is unchanged.** All fields, methods, and types on `WorkflowDefinition` work as before. The only difference is how the daemon dispatches a workflow — through `workflow/start` RPC, not hidden subcommands.

---

## Step-by-step upgrade

1. Let any in-flight 1.x runs complete, OR terminate them:

   ```sh
   tmux kill-server -L atomic
   ```

2. (Optional) Remove 1.x session artifacts:

   ```sh
   rm -rf ~/.atomic/sessions/
   ```

3. Install the 2.0 SDK. The binary is auto-installed via `optionalDependencies`:

   ```sh
   bun add @bastani/atomic-sdk@2
   ```

4. Update workflow source files: remove any `hostLocalWorkflows([workflow])` call and export the workflow definition as the default export instead:

   ```ts
   // Remove this:
   // hostLocalWorkflows([myWorkflow]);

   // Add this:
   export default myWorkflow;
   ```

5. Update any code calling `attachSession` — it is now non-blocking. See the [Breaking changes](#attachsession-primitive-is-no-longer-blocking) section above for the replacement pattern.

6. Run `atomic workflow ...` as before. The SDK auto-spawns the daemon on first use.

---

## FAQ

**Can I run 1.x and 2.0 side by side?**

No. Pin one version per workspace. 1.x and 2.0 cannot coexist on the same machine without isolation (e.g., separate containers or separate user accounts). The daemon discovery file (`~/.atomic/daemon.endpoint.json`) and the session artifact layout differ between major versions.

**What happened to tmux?**

Replaced by the daemon's process supervisor, which allocates PTYs using `bun-pty`. Agent CLIs (Claude Code, Copilot CLI, OpenCode) are now PTY-attached subprocess clients of the daemon. The psmux Windows fork and every tmux-specific helper are deleted.

**How do I attach to a backgrounded run?**

```sh
atomic workflow attach <runId>
```

The daemon retains full run state while no panel is attached. Any number of clients can attach simultaneously; each renders independently.
