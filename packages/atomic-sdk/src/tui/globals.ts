/**
 * tmux/psmux format variables exposed as constants. Components embed
 * these as literal strings; psmux re-evaluates them on every status
 * refresh. Mirrors better-tmux's `tmux.ts` globals so widgets ported
 * from there work without modification.
 */
export const tmuxGlobals = {
  hostname: "#H",
  sessionName: "#S",

  hour_24: "%H",
  hour_12: "%I",
  hour_24_single: "%k",
  hour_12_single: "%l",
  minute: "%M",
  second: "%S",
  am_pm_upper: "%p",
  am_pm_lower: "%P",

  year: "%Y",
  month: "%m",
  day: "%d",
  abbreviated_month: "%b",
  full_month: "%B",
  abbreviated_day: "%a",
  full_day: "%A",
  week_number: "%V",
  day_of_year: "%j",
  day_of_week_number: "%u",
} as const;

export type TmuxGlobals = typeof tmuxGlobals;
