/**
 * Coverage for the attached-mode footer's compile path. The footer
 * is now applied via tmux/psmux status-line options, authored against
 * the `<Footer>` compound component, so the regression surface here
 * is:
 *
 *   - the JSX tree produced by `attachedStatusline` is a valid
 *     `<Footer>` element with `<Footer.Left>` / `<Footer.Right>`
 *     slots in the right places;
 *   - those slots compile to well-formed tmux format strings (no
 *     stray brackets, paddings emit literal spaces, style markup
 *     encloses the right segments);
 *   - the compiled output retains the user-visible tokens callers
 *     rely on (the agent-type pill, the `#{window_name}` reference
 *     for workflow rendering, the navigation hints).
 *
 * We don't shell out to tmux/psmux from tests — `renderFooter` itself
 * is exercised in integration scripts (chat-smoke). Here we only
 * pin the compile output so a regression in the parser, the
 * statusline JSX, or the underlying tui primitives lands as a test
 * failure rather than a silently broken footer.
 */

import { test, expect, describe } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { attachedStatusline } from "../tui/attached-statusline.tsx";
import { compile } from "../tui/compiler/parser.ts";
import { Footer, FooterLeft, FooterRight } from "../tui/components.tsx";
import type { GraphTheme } from "../components/graph-theme.ts";

const THEME: GraphTheme = {
  background: "#000000",
  backgroundElement: "#111111",
  text: "#eeeeee",
  textMuted: "#aaaaaa",
  textDim: "#777777",
  primary: "#3366ff",
  success: "#22cc66",
  error: "#cc2244",
  warning: "#ffaa22",
  info: "#22aaff",
  mauve: "#cc66ff",
  border: "#333333",
  borderActive: "#666666",
};

/** Walk a <Footer> tree and return its slot children. */
function slots(
  node: ReactNode,
): { left: ReactNode; right: ReactNode; props: Record<string, unknown> } {
  if (!isValidElement(node) || node.type !== Footer) {
    throw new Error("expected a <Footer> element");
  }
  const footerEl = node as ReactElement<{ children?: ReactNode } & Record<string, unknown>>;
  const children = Array.isArray(footerEl.props.children)
    ? footerEl.props.children
    : [footerEl.props.children];
  let left: ReactNode;
  let right: ReactNode;
  for (const child of children) {
    if (!isValidElement(child)) continue;
    const slotEl = child as ReactElement<{ children?: ReactNode }>;
    if (slotEl.type === FooterLeft) left = slotEl.props.children;
    if (slotEl.type === FooterRight) right = slotEl.props.children;
  }
  const { children: _, ...rest } = footerEl.props;
  return { left, right, props: rest };
}

describe("attachedStatusline (workflow variant)", () => {
  const tree = attachedStatusline({ name: "agent-1", theme: THEME });
  const { left, right, props } = slots(tree);
  const compiledLeft = compile(left);
  const compiledRight = compile(right);

  test("Footer carries position and bg/fg from the theme", () => {
    expect(props.position).toBe("bottom");
    expect(props.bg).toBe(THEME.backgroundElement);
    expect(props.fg).toBe(THEME.text);
  });

  test("left/right wrap content in a per-window conditional", () => {
    expect(compiledLeft.startsWith("#{?#{==:#{window_name},orchestrator},")).toBe(true);
    expect(compiledRight.startsWith("#{?#{==:#{window_name},orchestrator},")).toBe(true);
    expect(compiledLeft.endsWith("}")).toBe(true);
    expect(compiledRight.endsWith("}")).toBe(true);
  });

  test("style attributes are space-separated (no commas inside #[…])", () => {
    expect(compiledLeft).not.toMatch(/#\[[^\]]*,[^\]]*\]/);
    expect(compiledRight).not.toMatch(/#\[[^\]]*,[^\]]*\]/);
  });

  test("orchestrator branch has GRAPH badge", () => {
    expect(compiledLeft).toContain("GRAPH");
  });

  test("orchestrator branch has graph-mode key hints", () => {
    expect(compiledRight).toContain("navigate");
    expect(compiledRight).toContain("attach");
    expect(compiledRight).toContain("stages");
    expect(compiledRight).toContain("quit");
  });

  test("agent branch has window-name pill referencing #{window_name}", () => {
    expect(compiledLeft).toContain("#{window_name}");
    expect(compiledLeft).toContain("#[bg=#3366ff]");
    expect(compiledLeft).toContain("#[fg=#111111 bold]");
  });

  test("agent branch has agent-mode navigation hints", () => {
    expect(compiledRight).toContain("ctrl+g");
    expect(compiledRight).toContain("graph");
    expect(compiledRight).toContain("ctrl+\\");
    expect(compiledRight).toContain("next");
  });

  test("no nested conditionals in compiled output", () => {
    // The outer `#{?cond,...,...}` is the only conditional; embedded
    // `#{?…}` would re-trigger the psmux 3.3.3 render-time bug.
    const occurrences = (compiledLeft.match(/#\{\?/g) ?? []).length;
    expect(occurrences).toBe(1);
    const occurrencesR = (compiledRight.match(/#\{\?/g) ?? []).length;
    expect(occurrencesR).toBe(1);
  });
});

describe("attachedStatusline (chat variant)", () => {
  test("claude renders a warning-color pill with literal agent name", () => {
    const tree = attachedStatusline({
      name: "atomic-chat-claude-abcd",
      theme: THEME,
      agentType: "claude",
    });
    const { left } = slots(tree);
    const compiled = compile(left);
    expect(compiled).toContain("#[bg=#ffaa22]"); // warning
    expect(compiled).toContain("CLAUDE");
    expect(compiled).not.toContain("#{window_name}"); // chat is single-window
    expect(compiled).not.toMatch(/,/); // no commas anywhere — render-safe
  });

  test("copilot uses the success color", () => {
    const tree = attachedStatusline({
      name: "atomic-chat-copilot-xyz",
      theme: THEME,
      agentType: "copilot",
    });
    const { left } = slots(tree);
    expect(compile(left)).toContain("#[bg=#22cc66]");
  });

  test("opencode uses the mauve color", () => {
    const tree = attachedStatusline({
      name: "atomic-chat-opencode-foo",
      theme: THEME,
      agentType: "opencode",
    });
    const { left } = slots(tree);
    expect(compile(left)).toContain("#[bg=#cc66ff]");
  });

  test("Footer.Right shows the agent name and detach hint", () => {
    const tree = attachedStatusline({
      name: "atomic-chat-opencode-foo",
      theme: THEME,
      agentType: "opencode",
    });
    const { right } = slots(tree);
    const compiled = compile(right);
    expect(compiled).toContain("atomic-chat-opencode-foo");
    expect(compiled).toContain("ctrl+b d");
    expect(compiled).toContain("detach");
  });
});
