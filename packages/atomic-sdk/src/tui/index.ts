/**
 * Public API for the SDK's tui sub-package.
 *
 * Compiles JSX into tmux/psmux status-line format strings and applies
 * them. Designed to replace the live-render OpenTUI footer pane on
 * psmux, where the pane-resize plumbing is non-functional. See
 * runtime/attached-footer.ts for the integration point.
 */

export {
  Box,
  Footer,
  FooterLeft,
  FooterRight,
  Text,
  type FooterProps,
} from "./components.tsx";
export { compile } from "./compiler/parser.ts";
export { inlineStyle, styleAttributes } from "./compiler/styles.ts";
export { tmuxGlobals } from "./globals.ts";
export { setOption, setOptionRaw, setStatuslineState } from "./mux.ts";
export { renderFooter, clearFooter, type RenderFooterResult } from "./renderer.ts";
export type {
  ElementProps,
  FooterConfig,
  StatusPosition,
  StyleProps,
} from "./types.ts";
