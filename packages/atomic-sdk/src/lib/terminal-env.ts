const UTF8_RE = /utf-?8/i;

function isUtf8(value: string): boolean {
  return UTF8_RE.test(value);
}

const DEFAULT_LOCALE = "en_US.UTF-8";
const DEFAULT_TERM = "xterm-256color";
const DEFAULT_COLORTERM = "truecolor";

const LOCALE_KEYS = ["LANG", "LC_ALL", "LC_CTYPE"] as const;

export const TERMINAL_ENV_KEYS = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
] as const;

export type TerminalEnvKey = (typeof TERMINAL_ENV_KEYS)[number];

export function normalizedTerminalEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }

  for (const key of LOCALE_KEYS) {
    const existing = result[key];
    if (!existing || !isUtf8(existing)) {
      result[key] = DEFAULT_LOCALE;
    }
  }

  const term = result["TERM"];
  if (!term || term === "dumb") {
    result["TERM"] = DEFAULT_TERM;
  }

  if (!result["COLORTERM"]) {
    result["COLORTERM"] = DEFAULT_COLORTERM;
  }

  return result;
}

export function mergeTerminalEnv(
  envVars: Record<string, string> = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const defaults = normalizedTerminalEnv(baseEnv);
  return { ...defaults, ...envVars };
}

export function pickTerminalEnv(
  env: Record<string, string>,
): Partial<Record<TerminalEnvKey, string>> {
  const result: Partial<Record<TerminalEnvKey, string>> = {};
  for (const key of TERMINAL_ENV_KEYS) {
    if (key in env) {
      result[key] = env[key];
    }
  }
  return result;
}

export function buildSpawnEnv(
  explicitEnv: Record<string, string>,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return { ...normalizedTerminalEnv(baseEnv), ...explicitEnv };
}

function buildMinimalEnv(
  explicitEnv: Record<string, string>,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const terminalEnv = pickTerminalEnv(normalizedTerminalEnv(baseEnv));
  return { ...terminalEnv, ...explicitEnv };
}

export function buildLauncherEnv(
  explicitEnv: Record<string, string>,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return buildMinimalEnv(explicitEnv, baseEnv);
}

// Keys that describe the *current* multiplexer client / pane and would
// confuse a freshly created session if forwarded via `-e`. Stripping them
// also prevents the atomic socket's panes from inheriting the user's outer
// tmux/psmux identifiers.
const TMUX_INTERNAL_KEYS = new Set([
  "TMUX",
  "TMUX_PANE",
  "TMUX_TMPDIR",
  "PSMUX",
  "PSMUX_PANE",
  "WINDOWID",
]);

const POSIX_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isTmuxSafeEnvKey(key: string): boolean {
  return POSIX_ENV_KEY_RE.test(key) && !TMUX_INTERNAL_KEYS.has(key);
}

/**
 * Build the env passed to `tmux new-session -e KEY=VALUE …`.
 *
 * Carries the caller's full shell env (filtered to POSIX-shaped, non-tmux
 * keys) so that vars set in the user's terminal — `ANTHROPIC_API_KEY`,
 * `GITHUB_TOKEN`, arbitrary user vars — reach the new session even when
 * the persistent `tmux -L atomic` server's snapshot is stale. Without
 * `-e`, panes inherit only from the daemon's environment (captured once
 * at first fork), so a value updated between two `atomic` invocations
 * would silently be ignored.
 */
export function buildTmuxEnv(
  explicitEnv: Record<string, string>,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const filtered: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (isTmuxSafeEnvKey(key)) {
      filtered[key] = value;
    }
  }
  return { ...normalizedTerminalEnv(filtered), ...explicitEnv };
}
