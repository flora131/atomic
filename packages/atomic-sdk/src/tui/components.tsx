/**
 * `<Box>` and `<Text>` are recognised by the compiler via reference
 * identity, not by rendering. They never actually run as React
 * components in the compile path — the parser intercepts their `type`
 * and emits format-string markup directly. They return `null` so that
 * a future OpenTUI live-render path can substitute a real renderer
 * without touching consumer code.
 */

import type { ReactNode } from "react";
import type { ElementProps, StatusPosition } from "./types.ts";

export function Box(_props: ElementProps): null {
  return null;
}

export function Text(_props: ElementProps): null {
  return null;
}

export type FooterProps = {
  children?: ReactNode;
  position?: StatusPosition;
  bg?: string;
  fg?: string;
};

type FooterSlotProps = { children?: ReactNode };

function FooterLeft(_props: FooterSlotProps): null {
  return null;
}

function FooterRight(_props: FooterSlotProps): null {
  return null;
}

/**
 * Compound footer component. Authoring shape:
 *
 *   <Footer position="bottom" bg="…" fg="…">
 *     <Footer.Left>{leftJsx}</Footer.Left>
 *     <Footer.Right>{rightJsx}</Footer.Right>
 *   </Footer>
 *
 * `<Footer>` itself doesn't render anything by itself — it's recognised
 * by the renderer (see `renderer.ts`), which walks its children to find
 * `Footer.Left` and `Footer.Right` slots and applies them to tmux's
 * `status-left` / `status-right`.
 */
export function Footer(_props: FooterProps): null {
  return null;
}

Footer.Left = FooterLeft;
Footer.Right = FooterRight;

export { FooterLeft, FooterRight };
