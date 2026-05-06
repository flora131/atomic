import type { ReactNode } from "react";

/**
 * Style props recognized by the format-string compiler. A subset of
 * tmux's `#[…]` style attributes — the ones every supported widget
 * actually needs. Keep this surface intentionally small: the compiled
 * output is a flat 1-D string, so we don't try to pretend tmux has
 * flexbox.
 */
export type StyleProps = {
  bg?: string;
  fg?: string;
  bold?: boolean;
  padding?: number;
  paddingLeft?: number;
  paddingRight?: number;
  gap?: number;
};

export type ElementProps = StyleProps & { children?: ReactNode };

/** Position of the status line in the client viewport. */
export type StatusPosition = "top" | "bottom";

/** Configuration accepted by `renderFooter`. */
export type FooterConfig = {
  left?: ReactNode;
  right?: ReactNode;
  position?: StatusPosition;
  bg?: string;
  fg?: string;
  /**
   * tmux session to scope the status-line options to. When omitted
   * options are set globally (`-g`); when set, every option write goes
   * through `set-option -t <sessionName>`. Provided so concurrent
   * atomic sessions on the shared psmux server don't clobber each
   * other's status-line.
   */
  sessionName?: string;
};
