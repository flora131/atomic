/**
 * Compile a footer JSX tree to tmux/psmux status-line options and
 * apply them globally. Mirrors better-tmux's `Renderer.res` but
 * scoped to the bottom status line — atomic doesn't need window-
 * status-format yet.
 *
 * One-shot: walks the React tree, emits format strings, and sets
 * status-left / status-right / status-position / status-style on
 * the running tmux/psmux server. The server then renders and
 * redraws on resize without any further help from us.
 *
 * Accepts either a config object (`{ left, right, position, … }`)
 * or a `<Footer>` JSX element with `<Footer.Left>` / `<Footer.Right>`
 * slot children. The latter is the more declarative authoring
 * surface; the former exists because some call sites build the
 * config programmatically without JSX.
 */

import { isValidElement, type ReactElement, type ReactNode } from "react";

import { Footer, FooterLeft, FooterRight } from "./components.tsx";
import { compile } from "./compiler/parser.ts";
import { setGlobalWindowOption, setOption, setOptionRaw } from "./mux.ts";
import type { FooterConfig } from "./types.ts";

type FooterElement = ReactElement<{
  children?: ReactNode;
  position?: FooterConfig["position"];
  bg?: string;
  fg?: string;
}>;

export type RenderFooterResult = {
  statusLeft: string;
  statusRight: string;
};

function flattenChildren(children: ReactNode): ReactNode[] {
  if (children === undefined || children === null) return [];
  if (Array.isArray(children)) return children.flatMap(flattenChildren);
  return [children];
}

function isFooterElement(node: unknown): node is FooterElement {
  return isValidElement(node) && node.type === Footer;
}

function extractFooterConfig(element: FooterElement): FooterConfig {
  let left: ReactNode;
  let right: ReactNode;

  for (const child of flattenChildren(element.props.children)) {
    if (!isValidElement(child)) continue;
    const childEl = child as ReactElement<{ children?: ReactNode }>;
    if (childEl.type === FooterLeft) {
      left = childEl.props.children;
    } else if (childEl.type === FooterRight) {
      right = childEl.props.children;
    }
  }

  return {
    left,
    right,
    position: element.props.position,
    bg: element.props.bg,
    fg: element.props.fg,
  };
}

/**
 * Compile and apply a footer. Returns the compiled left/right strings
 * for inspection (useful in tests and when debugging escape issues);
 * callers normally don't need them.
 *
 * `overrides` merges on top of the resolved config — typically used
 * by `spawnAttachedFooter` to thread a `sessionName` through without
 * the JSX author having to know the session.
 */
export function renderFooter(
  input: FooterConfig | ReactNode,
  overrides?: Partial<FooterConfig>,
): RenderFooterResult {
  const base: FooterConfig = isFooterElement(input)
    ? extractFooterConfig(input)
    : (input as FooterConfig);
  const config: FooterConfig = overrides ? { ...base, ...overrides } : base;

  const statusLeft = config.left === undefined ? "" : compile(config.left);
  const statusRight = config.right === undefined ? "" : compile(config.right);

  const s = config.sessionName;
  setOptionRaw("status", "on", s);
  setOption("status-position", config.position ?? "bottom", s);
  setOption("status-justify", "left", s);
  setOption("status-left", statusLeft, s);
  setOption("status-right", statusRight, s);
  setOption("status-left-length", "200", s);
  setOption("status-right-length", "200", s);
  // Blank out the window-list region between status-left and status-right.
  // tmux/psmux default to rendering `#I:#W` per window (e.g. `0:bash 1:zsh*`),
  // which competes visually with the agent pill and detach hint. These are
  // *window* options — `set-option -t <session>` only updates the session's
  // current window, so newly-created stage windows would fall back to the
  // built-in defaults and start showing tab names again. `-gw` sets the
  // server-wide default that every window inherits.
  setGlobalWindowOption("window-status-format", "");
  setGlobalWindowOption("window-status-current-format", "");
  setGlobalWindowOption("window-status-separator", "");
  if (config.bg !== undefined || config.fg !== undefined) {
    const styleParts: string[] = [];
    if (config.bg !== undefined) styleParts.push(`bg=${config.bg}`);
    if (config.fg !== undefined) styleParts.push(`fg=${config.fg}`);
    // Space-separated, not comma-separated; psmux 3.3.3's render-time
    // parser miscounts commas inside `#[…]` markup.
    setOption("status-style", styleParts.join(" "), s);
  }

  return { statusLeft, statusRight };
}

/**
 * Restore default status-line state. Used when tearing down a footer
 * (e.g., on agent pane exit) so the user's normal tmux config isn't
 * left with our overrides.
 */
export function clearFooter(sessionName?: string): void {
  setOption("status-left", "", sessionName);
  setOption("status-right", "", sessionName);
  setOption("window-status-format", "", sessionName);
  setOption("window-status-current-format", "", sessionName);
  setOptionRaw("status", "off", sessionName);
}
