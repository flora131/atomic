/**
 * Integration tests for chat/index.ts — resolver and env wiring.
 *
 * Verifies that:
 *  - resolveChatCommand("copilot") delegates to resolveCopilotCliPath()
 *    and honors COPILOT_CLI_PATH even when copilot absent from PATH.
 *  - resolveChatCommand for non-copilot agents uses getCommandPath.
 *  - buildLauncherEnv (used inside launcher scripts) keeps the in-script
 *    `export` set minimal — only terminal keys + explicit envVars — so the
 *    bash/pwsh script doesn't have to re-export the user's whole shell.
 *  - buildTmuxEnv (used for `tmux new-session -e KEY=VAL`) carries the full
 *    user shell env so vars updated between invocations override the
 *    persistent atomic tmux server's stale snapshot.
 *  - buildSpawnEnv (used for direct Bun.spawn) inherits full env + normalized
 *    terminal keys.
 *  - Normalized LANG, LC_ALL, LC_CTYPE, TERM, COLORTERM always appear in
 *    every env builder.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";

import {
  resolveChatCommand,
  buildLauncherEnv,
  buildSpawnEnv,
  buildTmuxEnv,
  TERMINAL_ENV_KEYS,
} from "../../../../packages/atomic/src/commands/cli/chat/index.ts";
import type { CommandPathResolver } from "../../../../packages/atomic-sdk/src/providers/copilot.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let savedEnv: NodeJS.ProcessEnv;
let mockGetCommandPath: CommandPathResolver = () => null;

function saveEnv() {
  savedEnv = { ...process.env };
}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, savedEnv);
}

// ---------------------------------------------------------------------------
// resolveChatCommand — copilot branch
// ---------------------------------------------------------------------------

describe("resolveChatCommand – copilot", () => {
  beforeEach(() => {
    saveEnv();
    mockGetCommandPath = () => null;
  });
  afterEach(() => {
    restoreEnv();
    mockGetCommandPath = () => null;
  });

  test("returns COPILOT_CLI_PATH when set, even if PATH lookup returns null", () => {
    process.env["COPILOT_CLI_PATH"] = "/custom/bin/copilot";
    mockGetCommandPath = () => null;
    expect(resolveChatCommand("copilot", mockGetCommandPath)).toBe("/custom/bin/copilot");
  });

  test("returns PATH-resolved path when COPILOT_CLI_PATH absent", () => {
    delete process.env["COPILOT_CLI_PATH"];
    mockGetCommandPath = (cmd) => (cmd === "copilot" ? "/usr/local/bin/copilot" : null);
    expect(resolveChatCommand("copilot", mockGetCommandPath)).toBe("/usr/local/bin/copilot");
  });

  test("returns undefined when COPILOT_CLI_PATH unset and copilot not in PATH", () => {
    delete process.env["COPILOT_CLI_PATH"];
    mockGetCommandPath = () => null;
    expect(resolveChatCommand("copilot", mockGetCommandPath)).toBeUndefined();
  });

  test("COPILOT_CLI_PATH takes precedence over PATH-resolved path", () => {
    process.env["COPILOT_CLI_PATH"] = "/explicit/copilot";
    mockGetCommandPath = () => "/usr/local/bin/copilot";
    expect(resolveChatCommand("copilot", mockGetCommandPath)).toBe("/explicit/copilot");
  });
});

// ---------------------------------------------------------------------------
// resolveChatCommand — non-copilot agents (claude, opencode)
// ---------------------------------------------------------------------------

describe("resolveChatCommand – claude / opencode", () => {
  beforeEach(() => {
    saveEnv();
    mockGetCommandPath = () => null;
  });
  afterEach(() => {
    restoreEnv();
    mockGetCommandPath = () => null;
  });

  test("claude: returns path from getCommandPath('claude')", () => {
    mockGetCommandPath = (cmd) => (cmd === "claude" ? "/usr/bin/claude" : null);
    expect(resolveChatCommand("claude", mockGetCommandPath)).toBe("/usr/bin/claude");
  });

  test("claude: returns undefined when not in PATH", () => {
    mockGetCommandPath = () => null;
    expect(resolveChatCommand("claude", mockGetCommandPath)).toBeUndefined();
  });

  test("opencode: returns path from getCommandPath('opencode')", () => {
    mockGetCommandPath = (cmd) => (cmd === "opencode" ? "/usr/local/bin/opencode" : null);
    expect(resolveChatCommand("opencode", mockGetCommandPath)).toBe("/usr/local/bin/opencode");
  });

  test("copilot COPILOT_CLI_PATH does not affect claude resolution", () => {
    process.env["COPILOT_CLI_PATH"] = "/custom/copilot";
    mockGetCommandPath = (cmd) => (cmd === "claude" ? "/usr/bin/claude" : null);
    expect(resolveChatCommand("claude", mockGetCommandPath)).toBe("/usr/bin/claude");
  });
});

// ---------------------------------------------------------------------------
// buildLauncherEnv — secret exclusion and terminal key export
// ---------------------------------------------------------------------------

describe("buildLauncherEnv – launcher script safety", () => {
  test("excludes GH_TOKEN from inherited env", () => {
    const base: NodeJS.ProcessEnv = { GH_TOKEN: "ghp_secret", LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
    const env = buildLauncherEnv({}, base);
    expect("GH_TOKEN" in env).toBe(false);
  });

  test("excludes COPILOT_GITHUB_TOKEN from inherited env", () => {
    const base: NodeJS.ProcessEnv = { COPILOT_GITHUB_TOKEN: "ghu_secret", LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
    const env = buildLauncherEnv({}, base);
    expect("COPILOT_GITHUB_TOKEN" in env).toBe(false);
  });

  test("excludes ANTHROPIC_API_KEY from inherited env", () => {
    const base: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: "sk-ant-secret", LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
    const env = buildLauncherEnv({}, base);
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
  });

  test("exports normalized LANG, LC_ALL, LC_CTYPE, TERM, COLORTERM", () => {
    const base: NodeJS.ProcessEnv = { LANG: "C", TERM: "dumb" };
    const env = buildLauncherEnv({}, base);
    expect(env["LANG"]).toBe("en_US.UTF-8");
    expect(env["LC_ALL"]).toBe("en_US.UTF-8");
    expect(env["LC_CTYPE"]).toBe("en_US.UTF-8");
    expect(env["TERM"]).toBe("xterm-256color");
    expect(env["COLORTERM"]).toBe("truecolor");
  });

  test("all TERMINAL_ENV_KEYS present in launcher env", () => {
    const env = buildLauncherEnv({}, {});
    for (const key of TERMINAL_ENV_KEYS) {
      expect(key in env).toBe(true);
    }
  });

  test("explicit envVars appear in launcher env even if not terminal keys", () => {
    const env = buildLauncherEnv({ ATOMIC_AGENT: "copilot", CUSTOM: "val" }, {});
    expect(env["ATOMIC_AGENT"]).toBe("copilot");
    expect(env["CUSTOM"]).toBe("val");
  });

  test("only terminal keys + explicit vars — no HOME/PATH leakage from baseEnv", () => {
    const base: NodeJS.ProcessEnv = { HOME: "/home/user", PATH: "/usr/bin", LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
    const env = buildLauncherEnv({}, base);
    expect("HOME" in env).toBe(false);
    expect("PATH" in env).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSpawnEnv — full env inheritance + normalized terminal keys
// ---------------------------------------------------------------------------

describe("buildSpawnEnv – direct spawn env", () => {
  test("inherits full baseEnv including non-terminal keys", () => {
    const base: NodeJS.ProcessEnv = { HOME: "/home/user", PATH: "/usr/bin:/bin", GH_TOKEN: "ghp_secret", LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
    const env = buildSpawnEnv({}, base);
    expect(env["HOME"]).toBe("/home/user");
    expect(env["PATH"]).toBe("/usr/bin:/bin");
    // Secrets inherited in spawn env (intentional — process already has access)
    expect(env["GH_TOKEN"]).toBe("ghp_secret");
  });

  test("normalizes LANG/TERM/COLORTERM from baseEnv", () => {
    const base: NodeJS.ProcessEnv = { LANG: "C", TERM: "dumb", HOME: "/root" };
    const env = buildSpawnEnv({}, base);
    expect(env["LANG"]).toBe("en_US.UTF-8");
    expect(env["TERM"]).toBe("xterm-256color");
    expect(env["COLORTERM"]).toBe("truecolor");
  });

  test("explicit envVars override baseEnv", () => {
    const base: NodeJS.ProcessEnv = { LANG: "C" };
    const env = buildSpawnEnv({ LANG: "ja_JP.UTF-8", ATOMIC_AGENT: "copilot" }, base);
    expect(env["LANG"]).toBe("ja_JP.UTF-8");
    expect(env["ATOMIC_AGENT"]).toBe("copilot");
  });

  test("applies all TERMINAL_ENV_KEYS with sane defaults when base empty", () => {
    const env = buildSpawnEnv({}, {});
    for (const key of TERMINAL_ENV_KEYS) {
      expect(key in env).toBe(true);
    }
    expect(env["LANG"]).toBe("en_US.UTF-8");
    expect(env["TERM"]).toBe("xterm-256color");
    expect(env["COLORTERM"]).toBe("truecolor");
  });
});

// ---------------------------------------------------------------------------
// buildTmuxEnv — env injected via `tmux new-session -e KEY=VALUE` so the
// pane sees the user's *current* shell env rather than the persistent
// atomic tmux server's stale snapshot.
// ---------------------------------------------------------------------------

describe("buildTmuxEnv – tmux session env (chat wiring)", () => {
  const FULL_BASE: NodeJS.ProcessEnv = {
    GH_TOKEN: "ghp_secret",
    COPILOT_GITHUB_TOKEN: "ghu_secret",
    ANTHROPIC_API_KEY: "sk-ant-secret",
    OPENAI_API_KEY: "sk-openai-secret",
    HOME: "/home/user",
    PATH: "/usr/bin:/bin",
    ARBITRARY_VAR: "user-set-value",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    LC_CTYPE: "en_US.UTF-8",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };

  test("forwards the user's shell env so values updated between atomic invocations override the daemon snapshot", () => {
    const env = buildTmuxEnv({}, FULL_BASE);
    expect(env["GH_TOKEN"]).toBe("ghp_secret");
    expect(env["COPILOT_GITHUB_TOKEN"]).toBe("ghu_secret");
    expect(env["ANTHROPIC_API_KEY"]).toBe("sk-ant-secret");
    expect(env["OPENAI_API_KEY"]).toBe("sk-openai-secret");
    expect(env["HOME"]).toBe("/home/user");
    expect(env["PATH"]).toBe("/usr/bin:/bin");
    expect(env["ARBITRARY_VAR"]).toBe("user-set-value");
  });

  test("strips outer-tmux/psmux identifiers so the new pane doesn't reuse the caller's TMUX/TMUX_PANE", () => {
    const env = buildTmuxEnv({}, {
      ...FULL_BASE,
      TMUX: "/tmp/tmux-1000/default,123,0",
      TMUX_PANE: "%5",
      TMUX_TMPDIR: "/tmp",
      PSMUX: "/tmp/psmux/default,123,0",
      PSMUX_PANE: "%5",
      WINDOWID: "12345",
    });
    expect("TMUX" in env).toBe(false);
    expect("TMUX_PANE" in env).toBe(false);
    expect("TMUX_TMPDIR" in env).toBe(false);
    expect("PSMUX" in env).toBe(false);
    expect("PSMUX_PANE" in env).toBe(false);
    expect("WINDOWID" in env).toBe(false);
  });

  test("includes normalized LANG, LC_ALL, LC_CTYPE, TERM, COLORTERM", () => {
    const env = buildTmuxEnv({}, { LANG: "C", TERM: "dumb" });
    expect(env["LANG"]).toBe("en_US.UTF-8");
    expect(env["LC_ALL"]).toBe("en_US.UTF-8");
    expect(env["LC_CTYPE"]).toBe("en_US.UTF-8");
    expect(env["TERM"]).toBe("xterm-256color");
    expect(env["COLORTERM"]).toBe("truecolor");
  });

  test("all TERMINAL_ENV_KEYS present", () => {
    const env = buildTmuxEnv({}, {});
    for (const key of TERMINAL_ENV_KEYS) {
      expect(key in env).toBe(true);
    }
  });

  test("includes explicit ATOMIC_AGENT", () => {
    const env = buildTmuxEnv({ ATOMIC_AGENT: "copilot" }, FULL_BASE);
    expect(env["ATOMIC_AGENT"]).toBe("copilot");
  });

  test("includes explicit COPILOT_CUSTOM_INSTRUCTIONS_DIRS", () => {
    const env = buildTmuxEnv({ COPILOT_CUSTOM_INSTRUCTIONS_DIRS: "/workspace/.github" }, FULL_BASE);
    expect(env["COPILOT_CUSTOM_INSTRUCTIONS_DIRS"]).toBe("/workspace/.github");
  });

  test("explicit envVars override values inherited from the shell", () => {
    const env = buildTmuxEnv(
      { ANTHROPIC_API_KEY: "explicit-override" },
      { ANTHROPIC_API_KEY: "from-shell" },
    );
    expect(env["ANTHROPIC_API_KEY"]).toBe("explicit-override");
  });

  test("buildTmuxEnv is symmetric with buildSpawnEnv — both expose the full shell env", () => {
    const base: NodeJS.ProcessEnv = { HOME: "/root", PATH: "/usr/bin", GH_TOKEN: "ghp_x", LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
    const tmuxEnv = buildTmuxEnv({}, base);
    const spawnEnv = buildSpawnEnv({}, base);
    expect(tmuxEnv["HOME"]).toBe(spawnEnv["HOME"]);
    expect(tmuxEnv["PATH"]).toBe(spawnEnv["PATH"]);
    expect(tmuxEnv["GH_TOKEN"]).toBe(spawnEnv["GH_TOKEN"]);
  });
});
