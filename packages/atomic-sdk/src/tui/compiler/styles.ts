/**
 * Style-prop emitter — direct port of better-tmux's `Styles.res`.
 *
 * Produces a `#[bg=…,fg=…,bold]` markup segment from a subset of
 * StyleProps. Empty when no style props are set, so callers can
 * concatenate without worrying about producing `#[]`.
 */

import type { StyleProps } from "../types.ts";

function pair(name: string, value: string | undefined): string {
  return value === undefined ? "" : `${name}=${value}`;
}

function flag(name: string, value: boolean | undefined): string {
  return value ? name : "";
}

/**
 * Space-joined contents of a `#[…]` block (no brackets).
 *
 * tmux/psmux accept either commas or spaces as attribute separators.
 * We deliberately use spaces so that compiled output never contains a
 * comma — psmux 3.3.3's status-line render-time parser miscounts
 * commas when `#[…]` markup is embedded inside a `#{?…}` conditional,
 * which leaks fragments of one branch into the other.
 */
export function styleAttributes(props: StyleProps): string {
  return [
    pair("bg", props.bg),
    pair("fg", props.fg),
    flag("bold", props.bold),
  ]
    .filter((v) => v !== "")
    .join(" ");
}

/**
 * Inline style markup with brackets, e.g. `#[bg=red,fg=white]`.
 * Returns an empty string when no style props are present, so emitting
 * it before every text segment doesn't produce stray `#[]` markers.
 */
export function inlineStyle(props: StyleProps): string {
  const attrs = styleAttributes(props);
  return attrs === "" ? "" : `#[${attrs}]`;
}
