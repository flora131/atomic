/** @jsxImportSource @opentui/react */
/**
 * Internal command that renders the attached-mode footer inside an agent's
 * tmux window. The executor splits each agent window after creation and
 * runs `atomic _footer --name <window-name>` in the bottom pane.
 *
 * Setting `exitOnCtrlC: false` suppresses OpenTUI's built-in signal
 * handling, so we install our own teardown path. In the tmux case the
 * closed pty raises SIGPIPE on the next render, which hits our handler.
 * The parent-liveness watchdog is a portable fallback for the orphan case
 * where no signal arrives (process gets reparented to init/unknown).
 */

import { useEffect } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, flushSync, useRenderer } from "@opentui/react";
import { resolveTheme } from "../../sdk/runtime/theme.ts";
import {
  deriveGraphTheme,
  type GraphTheme,
} from "../../sdk/components/graph-theme.ts";
import { AttachedStatusline } from "../../sdk/components/attached-statusline.tsx";
import type { AgentType } from "../../sdk/types.ts";

const PARENT_WATCHDOG_MS = 2000;
const FOOTER_RENDER_ROWS = 1;

type FooterStdoutSource = {
  readonly columns?: number;
  readonly rows?: number;
  write: NodeJS.WriteStream["write"];
};

/**
 * Snapshot the parent PID at module load. `process.ppid` is cached in both
 * Node and Bun, so we can't re-read it to detect reparenting — instead we
 * probe whether the original parent PID is still alive.
 */
const ORIGINAL_PPID = process.ppid;

/**
 * Returns false only when the original parent is definitively gone.
 * - signal 0 is a no-op existence check supported on Linux, macOS, and Windows.
 * - ESRCH means the PID no longer exists → parent is gone.
 * - EPERM means the PID exists but we can't signal it → still alive.
 * - If the original PPID was already ≤1 (init-launched or unknown), we can't
 *   distinguish a legitimate boot parent from orphan state, so skip the check.
 */
function originalParentAlive(): boolean {
  if (ORIGINAL_PPID <= 1) return true;
  try {
    process.kill(ORIGINAL_PPID, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Signals whose delivery should tear down the renderer. Node silently
 * supports listening for non-native signals on Windows (they just never
 * fire), so branching is purely for documentation.
 */
const EXIT_SIGNALS: NodeJS.Signals[] =
  process.platform === "win32"
    ? ["SIGTERM", "SIGINT", "SIGBREAK", "SIGHUP"]
    : ["SIGHUP", "SIGTERM", "SIGINT", "SIGPIPE"];

/**
 * The footer runs in a tmux/psmux pane that is intentionally one row tall.
 * On Windows, psmux child processes can expose no TTY row count to Bun, which
 * makes OpenTUI fall back to 24 rows and paint the one-line footer off-screen.
 */
export function createFooterStdout(
  stdout: FooterStdoutSource = process.stdout,
): NodeJS.WriteStream {
  const footerStdout = Object.create(stdout) as NodeJS.WriteStream;
  Object.defineProperties(footerStdout, {
    columns: {
      configurable: true,
      enumerable: true,
      get: () => Math.max(stdout.columns ?? 80, 1),
    },
    rows: {
      configurable: true,
      enumerable: true,
      get: () => FOOTER_RENDER_ROWS,
    },
  });
  footerStdout.write = stdout.write.bind(stdout) as NodeJS.WriteStream["write"];
  return footerStdout;
}

function FooterShell({
  name,
  theme,
  agentType,
}: {
  name: string;
  theme: GraphTheme;
  agentType?: AgentType;
}) {
  const renderer = useRenderer();

  useEffect(() => {
    let tornDown = false;
    const teardown = () => {
      if (tornDown) return;
      tornDown = true;
      try {
        renderer.destroy();
      } catch {
        // renderer may already be mid-destroy; the pty is likely gone
      }
      // Pane pty is already closed by the time we reach here, so there is
      // no terminal state left to preserve. Exit explicitly in case
      // destroy() doesn't (e.g. when stdout writes fail silently).
      process.exit(0);
    };
    for (const sig of EXIT_SIGNALS) {
      process.on(sig, teardown);
    }

    const watchdog = setInterval(() => {
      if (!originalParentAlive()) teardown();
    }, PARENT_WATCHDOG_MS);
    watchdog.unref?.();

    return () => {
      for (const sig of EXIT_SIGNALS) {
        process.off(sig, teardown);
      }
      clearInterval(watchdog);
    };
  }, [renderer]);

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      justifyContent="flex-end"
      backgroundColor={theme.background}
    >
      <AttachedStatusline name={name} theme={theme} agentType={agentType} />
    </box>
  );
}

export async function footerCommand(
  name: string,
  agentType?: AgentType,
): Promise<number> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    stdout: createFooterStdout(),
  });
  const theme = deriveGraphTheme(resolveTheme(renderer.themeMode));
  const root = createRoot(renderer);
  flushSync(() => {
    root.render(
      <FooterShell name={name} theme={theme} agentType={agentType} />,
    );
  });
  renderer.requestRender();

  await new Promise<void>(() => {});
  return 0;
}
