import { describe, expect, test } from "bun:test";
import {
  TERMINAL_ENV_KEYS,
  buildLauncherEnv,
  buildSpawnEnv,
  buildTmuxEnv,
  mergeTerminalEnv,
  normalizedTerminalEnv,
  pickTerminalEnv,
} from "./terminal-env.ts";

describe("normalizedTerminalEnv", () => {
  test("missing locale defaults to en_US.UTF-8", () => {
    const env = normalizedTerminalEnv({});
    expect(env["LANG"]).toBe("en_US.UTF-8");
    expect(env["LC_ALL"]).toBe("en_US.UTF-8");
    expect(env["LC_CTYPE"]).toBe("en_US.UTF-8");
  });

  test("existing UTF-8 locale is preserved", () => {
    const base = { LANG: "en_GB.UTF-8", LC_ALL: "fr_FR.utf8", LC_CTYPE: "C.UTF-8" };
    const env = normalizedTerminalEnv(base);
    expect(env["LANG"]).toBe("en_GB.UTF-8");
    expect(env["LC_ALL"]).toBe("fr_FR.utf8");
    expect(env["LC_CTYPE"]).toBe("C.UTF-8");
  });

  test("non-UTF-8 locale is replaced with en_US.UTF-8", () => {
    const base = { LANG: "en_US.ISO-8859-1", LC_ALL: "C", LC_CTYPE: "POSIX" };
    const env = normalizedTerminalEnv(base);
    expect(env["LANG"]).toBe("en_US.UTF-8");
    expect(env["LC_ALL"]).toBe("en_US.UTF-8");
    expect(env["LC_CTYPE"]).toBe("en_US.UTF-8");
  });

  test("TERM=dumb becomes xterm-256color", () => {
    const env = normalizedTerminalEnv({ TERM: "dumb" });
    expect(env["TERM"]).toBe("xterm-256color");
  });

  test("missing TERM defaults to xterm-256color", () => {
    const env = normalizedTerminalEnv({});
    expect(env["TERM"]).toBe("xterm-256color");
  });

  test("explicit COLORTERM is preserved", () => {
    const env = normalizedTerminalEnv({ COLORTERM: "24bit" });
    expect(env["COLORTERM"]).toBe("24bit");
  });

  test("missing COLORTERM defaults to truecolor", () => {
    const env = normalizedTerminalEnv({});
    expect(env["COLORTERM"]).toBe("truecolor");
  });

  test("other env vars carried through unchanged", () => {
    const env = normalizedTerminalEnv({ HOME: "/root", PATH: "/usr/bin" });
    expect(env["HOME"]).toBe("/root");
    expect(env["PATH"]).toBe("/usr/bin");
  });

  test("undefined values dropped", () => {
    const base: NodeJS.ProcessEnv = { SOME_VAR: undefined };
    const env = normalizedTerminalEnv(base);
    expect("SOME_VAR" in env).toBe(false);
  });
});

describe("mergeTerminalEnv", () => {
  test("explicit env vars win over defaults", () => {
    const env = mergeTerminalEnv(
      { LANG: "ja_JP.UTF-8", TERM: "screen", COLORTERM: "256" },
      {},
    );
    expect(env["LANG"]).toBe("ja_JP.UTF-8");
    expect(env["TERM"]).toBe("screen");
    expect(env["COLORTERM"]).toBe("256");
  });

  test("missing keys still get sane defaults", () => {
    const env = mergeTerminalEnv({}, {});
    expect(env["LANG"]).toBe("en_US.UTF-8");
    expect(env["TERM"]).toBe("xterm-256color");
    expect(env["COLORTERM"]).toBe("truecolor");
  });

  test("explicit vars merged on top of baseEnv normalization", () => {
    const base = { LANG: "C", TERM: "dumb" };
    const env = mergeTerminalEnv({ LANG: "de_DE.UTF-8" }, base);
    // explicit wins
    expect(env["LANG"]).toBe("de_DE.UTF-8");
    // TERM=dumb normalized then no override → xterm-256color
    expect(env["TERM"]).toBe("xterm-256color");
  });
});

describe("TERMINAL_ENV_KEYS", () => {
  test("contains exactly the five expected keys", () => {
    expect(TERMINAL_ENV_KEYS).toEqual(["LANG", "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM"]);
  });
});

describe("pickTerminalEnv", () => {
  test("picks only TERMINAL_ENV_KEYS", () => {
    const env = { LANG: "en_US.UTF-8", TERM: "xterm", HOME: "/home/user", PATH: "/usr/bin" };
    const picked = pickTerminalEnv(env);
    expect(Object.keys(picked)).toEqual(expect.arrayContaining(["LANG", "TERM"]));
    expect("HOME" in picked).toBe(false);
    expect("PATH" in picked).toBe(false);
  });

  test("omits absent keys rather than setting undefined", () => {
    const env = { LANG: "en_US.UTF-8" };
    const picked = pickTerminalEnv(env);
    expect("LC_ALL" in picked).toBe(false);
    expect("TERM" in picked).toBe(false);
    expect("COLORTERM" in picked).toBe(false);
  });

  test("returns all five when all present", () => {
    const env = { LANG: "a", LC_ALL: "b", LC_CTYPE: "c", TERM: "d", COLORTERM: "e" };
    const picked = pickTerminalEnv(env);
    expect(Object.keys(picked).sort()).toEqual(["COLORTERM", "LANG", "LC_ALL", "LC_CTYPE", "TERM"]);
  });
});

describe("buildSpawnEnv", () => {
  test("includes full normalized baseEnv", () => {
    const base = { HOME: "/root", PATH: "/usr/bin", TERM: "xterm-256color" };
    const env = buildSpawnEnv({ MY_VAR: "1" }, base);
    expect(env["HOME"]).toBe("/root");
    expect(env["PATH"]).toBe("/usr/bin");
    expect(env["MY_VAR"]).toBe("1");
  });

  test("explicit env wins over baseEnv", () => {
    const base = { LANG: "C", TERM: "dumb" };
    const env = buildSpawnEnv({ LANG: "ja_JP.UTF-8" }, base);
    expect(env["LANG"]).toBe("ja_JP.UTF-8");
  });

  test("applies sane terminal defaults from baseEnv", () => {
    const env = buildSpawnEnv({}, {});
    expect(env["TERM"]).toBe("xterm-256color");
    expect(env["COLORTERM"]).toBe("truecolor");
  });
});

describe("buildLauncherEnv", () => {
  test("does NOT include non-terminal keys from baseEnv", () => {
    const base = { HOME: "/root", PATH: "/usr/bin", LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
    const env = buildLauncherEnv({}, base);
    expect("HOME" in env).toBe(false);
    expect("PATH" in env).toBe(false);
  });

  test("includes TERMINAL_ENV_KEYS from normalized baseEnv", () => {
    const base = { LANG: "C", TERM: "dumb" };
    const env = buildLauncherEnv({}, base);
    // normalization applies: C → en_US.UTF-8, dumb → xterm-256color
    expect(env["LANG"]).toBe("en_US.UTF-8");
    expect(env["TERM"]).toBe("xterm-256color");
    expect(env["COLORTERM"]).toBe("truecolor");
  });

  test("explicit env wins and is included", () => {
    const base = { LANG: "en_US.UTF-8", TERM: "xterm-256color" };
    const env = buildLauncherEnv({ LANG: "ja_JP.UTF-8", MY_VAR: "hello" }, base);
    expect(env["LANG"]).toBe("ja_JP.UTF-8");
    expect(env["MY_VAR"]).toBe("hello");
  });

  test("no process.env leakage with empty baseEnv", () => {
    const env = buildLauncherEnv({}, {});
    // Only terminal keys + sane defaults, no PATH/HOME from process.env
    const envKeys = Object.keys(env);
    const nonTerminalKeys = envKeys.filter(
      (k) => !(TERMINAL_ENV_KEYS as readonly string[]).includes(k),
    );
    expect(nonTerminalKeys).toEqual([]);
  });

  test("excludes secret env vars: GH_TOKEN, COPILOT_GITHUB_TOKEN, ANTHROPIC_API_KEY", () => {
    const base = {
      LANG: "en_US.UTF-8",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      GH_TOKEN: "ghp_secret",
      COPILOT_GITHUB_TOKEN: "ghu_secret",
      ANTHROPIC_API_KEY: "sk-ant-secret",
      HOME: "/home/user",
      PATH: "/usr/bin:/bin",
    };
    const env = buildLauncherEnv({}, base);
    expect("GH_TOKEN" in env).toBe(false);
    expect("COPILOT_GITHUB_TOKEN" in env).toBe(false);
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
    expect("HOME" in env).toBe(false);
    expect("PATH" in env).toBe(false);
    // terminal keys still present
    expect(env["LANG"]).toBe("en_US.UTF-8");
    expect(env["TERM"]).toBe("xterm-256color");
    expect(env["COLORTERM"]).toBe("truecolor");
  });

  test("buildSpawnEnv preserves full inherited env including non-terminal keys", () => {
    const base = {
      HOME: "/home/user",
      PATH: "/usr/bin:/bin",
      GH_TOKEN: "ghp_secret",
      LANG: "C",
      TERM: "dumb",
    };
    const env = buildSpawnEnv({ MY_EXPLICIT: "yes" }, base);
    // full env inherited
    expect(env["HOME"]).toBe("/home/user");
    expect(env["PATH"]).toBe("/usr/bin:/bin");
    expect(env["GH_TOKEN"]).toBe("ghp_secret");
    // normalization applied
    expect(env["LANG"]).toBe("en_US.UTF-8");
    expect(env["TERM"]).toBe("xterm-256color");
    // explicit override present
    expect(env["MY_EXPLICIT"]).toBe("yes");
  });
});

describe("buildTmuxEnv", () => {
  const FULL_BASE = {
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    LC_CTYPE: "en_US.UTF-8",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    GH_TOKEN: "ghp_secret",
    COPILOT_GITHUB_TOKEN: "ghu_secret",
    ANTHROPIC_API_KEY: "sk-ant-secret",
    OPENAI_API_KEY: "sk-openai-secret",
    HOME: "/home/user",
    PATH: "/usr/bin:/bin",
    ARBITRARY_VAR: "should-pass-through",
  };

  test("forwards user shell env so updates survive the persistent atomic tmux server's stale snapshot", () => {
    const env = buildTmuxEnv({}, FULL_BASE);
    expect(env["GH_TOKEN"]).toBe("ghp_secret");
    expect(env["COPILOT_GITHUB_TOKEN"]).toBe("ghu_secret");
    expect(env["ANTHROPIC_API_KEY"]).toBe("sk-ant-secret");
    expect(env["OPENAI_API_KEY"]).toBe("sk-openai-secret");
    expect(env["HOME"]).toBe("/home/user");
    expect(env["PATH"]).toBe("/usr/bin:/bin");
    expect(env["ARBITRARY_VAR"]).toBe("should-pass-through");
  });

  test("filters tmux/psmux internal keys that describe the outer client", () => {
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

  test("filters non-POSIX env keys (e.g. exported bash function definitions)", () => {
    const env = buildTmuxEnv({}, {
      ...FULL_BASE,
      "BASH_FUNC_my-fn%%": "() {  echo hi\n}",
      "weird key with spaces": "x",
    });
    expect("BASH_FUNC_my-fn%%" in env).toBe(false);
    expect("weird key with spaces" in env).toBe(false);
  });

  test("includes normalized LANG", () => {
    const env = buildTmuxEnv({}, { LANG: "C" });
    expect(env["LANG"]).toBe("en_US.UTF-8");
  });

  test("includes normalized LC_ALL", () => {
    const env = buildTmuxEnv({}, { LC_ALL: "POSIX" });
    expect(env["LC_ALL"]).toBe("en_US.UTF-8");
  });

  test("includes normalized LC_CTYPE", () => {
    const env = buildTmuxEnv({}, { LC_CTYPE: "en_US.ISO-8859-1" });
    expect(env["LC_CTYPE"]).toBe("en_US.UTF-8");
  });

  test("includes normalized TERM (dumb → xterm-256color)", () => {
    const env = buildTmuxEnv({}, { TERM: "dumb" });
    expect(env["TERM"]).toBe("xterm-256color");
  });

  test("includes normalized COLORTERM default", () => {
    const env = buildTmuxEnv({}, {});
    expect(env["COLORTERM"]).toBe("truecolor");
  });

  test("preserves explicit UTF-8 LANG", () => {
    const env = buildTmuxEnv({}, { LANG: "ja_JP.UTF-8" });
    expect(env["LANG"]).toBe("ja_JP.UTF-8");
  });

  test("preserves explicit TERM when not dumb", () => {
    const env = buildTmuxEnv({}, { TERM: "screen-256color" });
    expect(env["TERM"]).toBe("screen-256color");
  });

  test("includes explicit ATOMIC_AGENT", () => {
    const env = buildTmuxEnv({ ATOMIC_AGENT: "copilot" }, {});
    expect(env["ATOMIC_AGENT"]).toBe("copilot");
  });

  test("includes explicit COPILOT_CUSTOM_INSTRUCTIONS_DIRS", () => {
    const env = buildTmuxEnv({ COPILOT_CUSTOM_INSTRUCTIONS_DIRS: "/a:/b" }, {});
    expect(env["COPILOT_CUSTOM_INSTRUCTIONS_DIRS"]).toBe("/a:/b");
  });

  test("explicit env wins over baseEnv for terminal keys", () => {
    const env = buildTmuxEnv({ LANG: "de_DE.UTF-8", TERM: "screen" }, { LANG: "C", TERM: "dumb" });
    expect(env["LANG"]).toBe("de_DE.UTF-8");
    expect(env["TERM"]).toBe("screen");
  });

  test("explicit env wins over baseEnv for arbitrary keys", () => {
    const env = buildTmuxEnv(
      { ANTHROPIC_API_KEY: "explicit-override" },
      { ANTHROPIC_API_KEY: "from-shell" },
    );
    expect(env["ANTHROPIC_API_KEY"]).toBe("explicit-override");
  });

  test("all TERMINAL_ENV_KEYS present with empty baseEnv", () => {
    const env = buildTmuxEnv({}, {});
    for (const key of TERMINAL_ENV_KEYS) {
      expect(key in env).toBe(true);
    }
  });
});
