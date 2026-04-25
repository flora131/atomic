/** @jsxImportSource @opentui/react */
/**
 * Internal command that renders the attached-mode footer inside an agent's
 * tmux window. The executor splits each agent window after creation and
 * runs `atomic _footer --name <window-name>` in the bottom pane.
 *
 * The footer is rendered through OpenTUI's headless renderer and repainted
 * into the footer pane. A normal CLI renderer must not be used here:
 * terminal capability probes from a footer pane can be answered by the
 * attached client and routed by tmux into the active agent pane as input.
 */

import {
  getBaseAttributes,
  TextAttributes,
  type CapturedFrame,
  type CapturedSpan,
} from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resolveTheme } from "../../sdk/runtime/theme.ts";
import {
  deriveGraphTheme,
} from "../../sdk/components/graph-theme.ts";
import { AttachedStatusline } from "../../sdk/components/attached-statusline.tsx";
import type { AgentType } from "../../sdk/types.ts";

const PARENT_WATCHDOG_MS = 2000;
const FOOTER_RENDER_INTERVAL_MS = 250;
const FOOTER_RENDER_ROWS = 1;
const CLEAR_LINE = "\r\x1b[2K";

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

const ANSI_RESET = "\x1b[0m";

function ansiColor(kind: 38 | 48, spanColor: CapturedSpan["fg"]): string {
  const [r, g, b] = spanColor.toInts();
  return `${kind};2;${r};${g};${b}`;
}

function sanitizeText(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, " ");
}

function spanToAnsi(span: CapturedSpan): string {
  const attrs = getBaseAttributes(span.attributes);
  const codes = [
    ansiColor(38, span.fg),
    ansiColor(48, span.bg),
  ];

  if ((attrs & TextAttributes.BOLD) !== 0) codes.unshift("1");
  if ((attrs & TextAttributes.DIM) !== 0) codes.unshift("2");
  if ((attrs & TextAttributes.ITALIC) !== 0) codes.unshift("3");
  if ((attrs & TextAttributes.UNDERLINE) !== 0) codes.unshift("4");
  if ((attrs & TextAttributes.INVERSE) !== 0) codes.unshift("7");

  return `\x1b[${codes.join(";")}m${sanitizeText(span.text)}`;
}

function frameToAnsi(frame: CapturedFrame): string {
  const lines = frame.lines.map((line) =>
    line.spans.map(spanToAnsi).join("")
  );
  return `${lines.join("\n")}${ANSI_RESET}`;
}

async function createFooterTestRenderer({
  name,
  agentType,
  width = process.stdout.columns ?? 80,
}: {
  name: string;
  agentType?: AgentType;
  width?: number;
}) {
  const theme = deriveGraphTheme(resolveTheme(null));
  return await testRender(
    <AttachedStatusline name={name} theme={theme} agentType={agentType} />,
    {
      width: Math.max(width, 1),
      height: FOOTER_RENDER_ROWS,
      exitOnCtrlC: false,
      exitSignals: [],
      clearOnShutdown: false,
      useMouse: false,
      useKittyKeyboard: null,
      openConsoleOnError: false,
    },
  );
}

async function renderFooterSetupFrame(
  testSetup: Awaited<ReturnType<typeof createFooterTestRenderer>>,
): Promise<string> {
  await act(async () => {
    await testSetup.renderOnce();
  });
  return frameToAnsi(testSetup.captureSpans());
}

export async function renderFooterFrame({
  name,
  agentType,
  width = process.stdout.columns ?? 80,
}: {
  name: string;
  agentType?: AgentType;
  width?: number;
}): Promise<string> {
  const testSetup = await createFooterTestRenderer({ name, agentType, width });
  try {
    return await renderFooterSetupFrame(testSetup);
  } finally {
    act(() => {
      testSetup.renderer.destroy();
    });
  }
}

export async function runFooterRenderer({
  name,
  agentType,
  stdout = process.stdout,
}: {
  name: string;
  agentType?: AgentType;
  stdout?: NodeJS.WriteStream;
}): Promise<void> {
  const testSetup = await createFooterTestRenderer({
    name,
    agentType,
    width: stdout.columns,
  });
  let currentWidth = Math.max(stdout.columns ?? 80, 1);
  let lastFrame = "";
  let renderInFlight = false;
  let tornDown = false;
  let teardown!: () => void;

  const render = async () => {
    if (tornDown || renderInFlight) return;
    renderInFlight = true;
    try {
      const nextWidth = Math.max(stdout.columns ?? 80, 1);
      if (nextWidth !== currentWidth) {
        currentWidth = nextWidth;
        testSetup.resize(currentWidth, FOOTER_RENDER_ROWS);
      }

      const frame = await renderFooterSetupFrame(testSetup);
      if (!tornDown && frame !== lastFrame) {
        stdout.write(`${CLEAR_LINE}${frame}`);
        lastFrame = frame;
      }
    } finally {
      renderInFlight = false;
    }
  };

  await render();

  await new Promise<void>((resolve) => {
    teardown = () => {
      if (tornDown) return;
      tornDown = true;
      for (const sig of EXIT_SIGNALS) {
        process.off(sig, teardown);
      }
      process.off("SIGWINCH", requestRender);
      clearInterval(renderTick);
      clearInterval(watchdog);
      act(() => {
        testSetup.renderer.destroy();
      });
      resolve();
    };

    const requestRender = () => {
      void render();
    };

    for (const sig of EXIT_SIGNALS) {
      process.on(sig, teardown);
    }
    process.on("SIGWINCH", requestRender);

    const renderTick = setInterval(() => {
      void render();
    }, FOOTER_RENDER_INTERVAL_MS);
    const watchdog = setInterval(() => {
      if (!originalParentAlive()) teardown();
    }, PARENT_WATCHDOG_MS);
  });
}

export async function footerCommand(
  name: string,
  agentType?: AgentType,
): Promise<number> {
  await runFooterRenderer({ name, agentType });
  return 0;
}
